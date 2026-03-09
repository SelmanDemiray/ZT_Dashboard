<#
.SYNOPSIS
    Safely imports all required modules into an Azure Automation PS 7.4
    Runtime Environment by staging them through Azure Blob Storage.

.SAFETY SUMMARY
    CREATES  : One temporary blob container named 'module-staging' (private)
    WRITES   : Module .zip files into 'module-staging' only
    DELETES  : Only those same .zip files and the 'module-staging' container
    UNTOUCHED: All existing containers ($web, etc), all blobs, your 7.2 runtime,
               runbook code, schedules, RBAC, Entra ID, Defender, Policy data

.NOTES
    Run inside Azure Cloud Shell (pwsh). Fill in the 5 Config variables first.
    Do NOT reorder the $modules table — it is in strict dependency order.
#>

#region ── CONFIG — fill in before running ────────────────────────────────
$subscriptionId   = "YOUR_SUBSCRIPTION_ID"
$rg               = "YOUR_RESOURCE_GROUP"
$aa               = "YOUR_AUTOMATION_ACCOUNT_NAME"
$runtimeName      = "YOUR_74_RUNTIME_ENV_NAME"   # exact name of the PS 7.4 runtime you created
$storageAccount   = "YOUR_STORAGE_ACCOUNT_NAME"  # same storage account your runbook uses

$apiVersion       = "2023-05-15-preview"
$stagingContainer = "module-staging"

# Ordered hashtable — do NOT reorder.
# $true  = CRITICAL: abort entire run if this module fails (others depend on it)
# $false = Non-critical: log failure and continue
$modules = [ordered]@{
    "Az.Accounts"                                  = $true
    "Az.Storage"                                   = $false
    "Az.ResourceGraph"                             = $false
    "Az.Security"                                  = $false
    "Microsoft.Graph.Authentication"               = $true
    "Microsoft.Graph.Identity.DirectoryManagement" = $false
    "Microsoft.Graph.Users"                        = $false
    "Microsoft.Graph.Groups"                       = $false
    "Microsoft.Graph.Applications"                 = $false
    "Microsoft.Graph.DeviceManagement"             = $false
    "PSFramework"                                  = $false
    "ZeroTrustAssessment"                          = $false
}
#endregion


#region ── FUNCTION: Wait-ModuleAvailable ─────────────────────────────────
# Polls every 15s until provisioningState = Succeeded or Failed.
# All config variables are explicit parameters (not inherited from outer scope —
# PowerShell functions do not inherit parent scope variables).
function Wait-ModuleAvailable {
    param(
        [string]$ModuleName,
        [string]$SubscriptionId,
        [string]$ResourceGroup,
        [string]$AutomationAccount,
        [string]$RuntimeName,
        [string]$ApiVersion,
        [int]$TimeoutSeconds = 360
    )

    # Lock context inside the function to prevent drift in multi-sub sessions
    Set-AzContext -SubscriptionId $SubscriptionId -ErrorAction SilentlyContinue | Out-Null

    $uri = "https://management.azure.com/subscriptions/$SubscriptionId" +
           "/resourceGroups/$ResourceGroup" +
           "/providers/Microsoft.Automation/automationAccounts/$AutomationAccount" +
           "/runtimeEnvironments/$RuntimeName/packages/$ModuleName" +
           "?api-version=$ApiVersion"

    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        $resp   = Invoke-AzRestMethod -Uri $uri -Method GET
        $parsed = $resp.Content | ConvertFrom-Json
        $state  = $parsed.properties.provisioningState

        switch ($state) {
            "Succeeded" {
                Write-Host "  ✅ $ModuleName — Available" -ForegroundColor Green
                return $true
            }
            { $_ -in "Failed", "Canceled" } {
                $errMsg = $parsed.properties.error.message
                Write-Host "  ❌ $ModuleName — FAILED: $errMsg" -ForegroundColor Red
                return $false
            }
            default {
                Write-Host "  ⏳ $ModuleName — $state ($elapsed`s)..." -ForegroundColor Yellow
                Start-Sleep -Seconds 15
                $elapsed += 15
            }
        }
    }

    Write-Host "  ⚠️  $ModuleName — Timed out after $($TimeoutSeconds)s. Check portal manually." -ForegroundColor Magenta
    return $false
}
#endregion


#region ── SETUP & SAFETY PRE-CHECK ──────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Azure Automation Module Importer — PS 7.4 Runtime" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════════`n" -ForegroundColor Cyan

Set-AzContext -SubscriptionId $subscriptionId | Out-Null
$ctx = (Get-AzStorageAccount -ResourceGroupName $rg -Name $storageAccount).Context

# ── SAFETY CHECK: warn if 'module-staging' already exists with foreign blobs ──
# This prevents accidentally deleting a container that was not created by this
# script. If it exists but is empty, or only has *.zip files, it is safe to reuse.
$existingContainer = Get-AzStorageContainer -Name $stagingContainer `
                                             -Context $ctx `
                                             -ErrorAction SilentlyContinue

if ($existingContainer) {
    $existingBlobs = Get-AzStorageBlob -Container $stagingContainer `
                                        -Context $ctx `
                                        -ErrorAction SilentlyContinue
    # Check for any blobs that were NOT created by this script (i.e. not *.zip)
    $foreignBlobs  = @($existingBlobs | Where-Object { $_.Name -notlike "*.zip" })

    if ($foreignBlobs.Count -gt 0) {
        Write-Host "⛔ SAFETY HALT" -ForegroundColor Red
        Write-Host "   A container named '$stagingContainer' already exists in '$storageAccount'" -ForegroundColor Red
        Write-Host "   and contains $($foreignBlobs.Count) blob(s) NOT created by this script:" -ForegroundColor Red
        $foreignBlobs | ForEach-Object { Write-Host "     - $($_.Name)" -ForegroundColor Red }
        Write-Host "`n   This script would delete that container at cleanup." -ForegroundColor Red
        Write-Host "   ACTION: Rename `$stagingContainer in the Config region to something else," -ForegroundColor Yellow
        Write-Host "   or manually delete/rename that container first, then re-run." -ForegroundColor Yellow
        exit 1
    }
    else {
        Write-Host "[SETUP] Container '$stagingContainer' already exists (empty or prior run). Reusing safely.`n" -ForegroundColor Yellow
    }
}
else {
    # Container does not exist — create it as a private container (no public blob access)
    New-AzStorageContainer -Name $stagingContainer `
                            -Context $ctx `
                            -Permission Off | Out-Null
    Write-Host "[SETUP] Created private staging container '$stagingContainer'.`n" -ForegroundColor Cyan
}
#endregion


#region ── MAIN IMPORT LOOP ───────────────────────────────────────────────
$failed  = @()
$aborted = $false

foreach ($mod in $modules.Keys) {

    # Skip remaining modules if a critical dependency failed
    if ($aborted) {
        Write-Host "`n[SKIP] $mod — skipped due to earlier critical module failure." -ForegroundColor DarkGray
        $failed += $mod
        continue
    }

    $isCritical = $modules[$mod]
    Write-Host "`n[MODULE] $mod$(if ($isCritical) { ' (CRITICAL)' })" -ForegroundColor Cyan

    # Step 1 — Download .nupkg from PSGallery to Cloud Shell /tmp
    # No version pin = latest. The .nupkg format is a zip — Azure Automation accepts it directly.
    $localPath = "/tmp/$mod.zip"
    Write-Host "  Downloading from PSGallery..."
    try {
        Invoke-WebRequest `
            -Uri     "https://www.powershellgallery.com/api/v2/package/$mod" `
            -OutFile $localPath `
            -ErrorAction Stop
        $sizeMB = [math]::Round((Get-Item $localPath).Length / 1MB, 2)
        Write-Host "  Downloaded — $sizeMB MB"
    }
    catch {
        Write-Host "  ❌ Download failed: $_" -ForegroundColor Red
        $failed += $mod
        if ($isCritical) { $aborted = $true }
        continue
    }

    # Step 2 — Upload to the staging container
    # Writes ONLY to 'module-staging'. Your $web container is never referenced.
    Write-Host "  Uploading to staging blob..."
    try {
        Set-AzStorageBlobContent `
            -Container $stagingContainer `
            -Blob      "$mod.zip" `
            -File      $localPath `
            -Context   $ctx `
            -Force `
            -ErrorAction Stop | Out-Null
    }
    catch {
        Write-Host "  ❌ Upload failed: $_" -ForegroundColor Red
        $failed += $mod
        if ($isCritical) { $aborted = $true }
        Remove-Item $localPath -ErrorAction SilentlyContinue
        continue
    }

    # Step 3 — Generate a 1-hour read-only SAS URL
    # -Permission r = read only. Cannot write, delete, or list with this token.
    # Azure Automation fetches the blob immediately on import, so 1 hour is plenty.
    $sasUrl = New-AzStorageBlobSASToken `
                  -Container  $stagingContainer `
                  -Blob       "$mod.zip" `
                  -Context    $ctx `
                  -Permission r `
                  -ExpiryTime (Get-Date).AddHours(1) `
                  -FullUri

    # Step 4 — Submit the import to the 7.4 runtime via REST API
    # New-AzAutomationModule -RuntimeVersion only accepts '5.1' and '7.2' (ValidateSet bug).
    # The REST API /runtimeEnvironments/{name}/packages/ has no such restriction.
    # This PUT only affects the exact $runtimeName path — the 7.2 runtime is untouched.
    Write-Host "  Submitting to runtime '$runtimeName'..."
    $importUri = "https://management.azure.com/subscriptions/$subscriptionId" +
                 "/resourceGroups/$rg" +
                 "/providers/Microsoft.Automation/automationAccounts/$aa" +
                 "/runtimeEnvironments/$runtimeName/packages/$mod" +
                 "?api-version=$apiVersion"

    $body = @{
        properties = @{ contentLink = @{ uri = $sasUrl } }
    } | ConvertTo-Json -Depth 5

    $resp = Invoke-AzRestMethod -Uri $importUri -Method PUT -Payload $body

    if ($resp.StatusCode -notin 200, 201, 202) {
        $errDetail = ($resp.Content | ConvertFrom-Json).error.message
        Write-Host "  ❌ Submission failed (HTTP $($resp.StatusCode)): $errDetail" -ForegroundColor Red
        $failed += $mod
        if ($isCritical) { $aborted = $true }
        Remove-Item $localPath -ErrorAction SilentlyContinue
        continue
    }

    # Step 5 — Wait for Available before processing the next module
    $ok = Wait-ModuleAvailable `
              -ModuleName        $mod `
              -SubscriptionId    $subscriptionId `
              -ResourceGroup     $rg `
              -AutomationAccount $aa `
              -RuntimeName       $runtimeName `
              -ApiVersion        $apiVersion

    if (-not $ok) {
        $failed += $mod
        if ($isCritical) { $aborted = $true }
    }

    # Step 6 — Remove the local /tmp file (Cloud Shell disk, not Azure storage)
    Remove-Item $localPath -ErrorAction SilentlyContinue
}
#endregion


#region ── CLEANUP ────────────────────────────────────────────────────────
# Safe to delete now — all modules are definitively succeeded or failed.
# Only 'module-staging' is deleted. No other container is referenced.
Write-Host "`n[CLEANUP] Removing staging blobs and container '$stagingContainer'..." -ForegroundColor Cyan

Get-AzStorageBlob -Container $stagingContainer -Context $ctx -ErrorAction SilentlyContinue |
    Remove-AzStorageBlob -Force -ErrorAction SilentlyContinue

Remove-AzStorageContainer -Name $stagingContainer -Context $ctx -Force -ErrorAction SilentlyContinue
Write-Host "[CLEANUP] Done."
#endregion


#region ── SUMMARY ────────────────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════" -ForegroundColor Cyan
if ($failed.Count -eq 0) {
    Write-Host "  ✅ ALL $($modules.Count) MODULES IMPORTED SUCCESSFULLY" -ForegroundColor Green
    Write-Host "  → Test your runbook via: Automation Account > Runbooks > Test Pane" -ForegroundColor Green
}
else {
    $successCount = $modules.Count - $failed.Count
    Write-Host "  ⚠️  COMPLETED WITH ERRORS" -ForegroundColor Yellow
    Write-Host "  Succeeded : $successCount / $($modules.Count)" -ForegroundColor Green
    Write-Host "  Failed    : $($failed.Count) / $($modules.Count)" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "    ✗ $_" -ForegroundColor Red }

    if ($aborted) {
        Write-Host "`n  ⛔ Run aborted early — a critical module failed." -ForegroundColor Red
        Write-Host "  Fix the critical module, then re-run with only failed modules in `$modules." -ForegroundColor Yellow
    }
    else {
        Write-Host "`n  To retry: remove successful modules from `$modules in Config and re-run." -ForegroundColor Yellow
    }
}
Write-Host "══════════════════════════════════════════════════`n" -ForegroundColor Cyan
#endregion
