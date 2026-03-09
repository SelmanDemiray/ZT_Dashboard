<#
.SYNOPSIS
    Safely imports all required modules into an Azure Automation PS 7.4
    Runtime Environment by staging them through Azure Blob Storage.

.DESCRIPTION
    Azure Automation's direct PSGallery importer has a blob size cap that
    causes large modules (e.g. ZeroTrustAssessment) to fail with:
    "Module data blob size is not supported."

    This script works around that by:
      1. Downloading each module .nupkg from PSGallery to a local temp folder
      2. Uploading it to a temporary private staging blob container you own
      3. Generating a short-lived read-only SAS URL for that blob
      4. Submitting the import to your 7.4 Runtime Environment via REST API
         (New-AzAutomationModule does not support -RuntimeVersion 7.4)
      5. Polling until each module reaches "Succeeded" before moving to the next
      6. Cleaning up all staging blobs and the container when done

.SAFETY SUMMARY
    CREATES  : One temporary private blob container named 'module-staging'
    WRITES   : Module .zip files into 'module-staging' only
    DELETES  : Only those same .zip files, the container, and local temp files
    UNTOUCHED: All existing containers ($web, etc), all existing blobs,
               your 7.2 runtime and its modules, runbook code, schedules,
               RBAC roles, Entra ID, Defender, Policy, Resource Graph data.
    SAFETY   : Pre-check halts the script if 'module-staging' already exists
               with foreign content to prevent accidental data loss.

.COMPATIBILITY
    Windows  : Run in local PowerShell or Cloud Shell (pwsh)
    Linux    : Run in Azure Cloud Shell (bash or pwsh)
    Requires : Az PowerShell module, Connect-AzAccount already run
               (Cloud Shell handles auth automatically)

.NOTES
    Fill in the 5 variables in the CONFIG region before running.
    Do NOT reorder the $modules table — it is in strict dependency order.
#>


#region ── CONFIG — fill in before running ────────────────────────────────
$subscriptionId   = "YOUR_SUBSCRIPTION_ID"
$rg               = "YOUR_RESOURCE_GROUP"
$aa               = "YOUR_AUTOMATION_ACCOUNT_NAME"
$runtimeName      = "YOUR_74_RUNTIME_ENV_NAME"    # exact name of PS 7.4 runtime you created in portal
$storageAccount   = "YOUR_STORAGE_ACCOUNT_NAME"   # same storage account your runbook uses

# Azure Automation REST API version that supports runtime environments
$apiVersion       = "2023-05-15-preview"

# Temporary blob container — created by this script, deleted at the end
$stagingContainer = "module-staging"

# Cross-platform temp folder:
#   Windows      → C:\Users\<you>\AppData\Local\Temp
#   Linux/Cloud  → /tmp
$tempDir          = $env:TEMP

# Modules in strict dependency order — do NOT reorder.
# $true  = CRITICAL: abort the entire run if this module fails
#          because all subsequent modules depend on it
# $false = Non-critical: log the failure and continue
$modules = [ordered]@{
    "Az.Accounts"                                  = $true   # CRITICAL — base for all Az.* modules
    "Az.Storage"                                   = $false
    "Az.ResourceGraph"                             = $false
    "Az.Security"                                  = $false
    "Microsoft.Graph.Authentication"               = $true   # CRITICAL — base for all Graph modules
    "Microsoft.Graph.Identity.DirectoryManagement" = $false
    "Microsoft.Graph.Users"                        = $false
    "Microsoft.Graph.Groups"                       = $false
    "Microsoft.Graph.Applications"                 = $false
    "Microsoft.Graph.DeviceManagement"             = $false
    "PSFramework"                                  = $false
    "ZeroTrustAssessment"                          = $false  # largest module — main reason this script exists
}
#endregion


#region ── FUNCTION: Wait-ModuleAvailable ─────────────────────────────────
# Polls the REST API every 15 seconds until the module's provisioningState
# reaches "Succeeded" or a terminal failure state.
# Returns $true on success, $false on failure or timeout.
#
# NOTE: All config variables are passed as explicit parameters.
# PowerShell functions do NOT inherit parent scope variables automatically —
# using outer scope vars directly would result in $null values and a silently
# malformed REST URL that returns 404 with no obvious error.
function Wait-ModuleAvailable {
    param(
        [string]$ModuleName,
        [string]$SubscriptionId,
        [string]$ResourceGroup,
        [string]$AutomationAccount,
        [string]$RuntimeName,
        [string]$ApiVersion,
        [int]$TimeoutSeconds = 360    # 6 minutes max — most modules provision in under 2
    )

    # Explicitly pin the Az context inside the function.
    # In multi-subscription Cloud Shell sessions, the context can drift between
    # function calls, causing Invoke-AzRestMethod to target the wrong subscription.
    Set-AzContext -SubscriptionId $SubscriptionId -ErrorAction SilentlyContinue | Out-Null

    # REST endpoint for a specific package inside a runtime environment
    $uri = "https://management.azure.com/subscriptions/$SubscriptionId" +
           "/resourceGroups/$ResourceGroup" +
           "/providers/Microsoft.Automation/automationAccounts/$AutomationAccount" +
           "/runtimeEnvironments/$RuntimeName/packages/$ModuleName" +
           "?api-version=$ApiVersion"

    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        $resp   = Invoke-AzRestMethod -Uri $uri -Method GET
        $parsed = $resp.Content | ConvertFrom-Json

        # provisioningState values: Creating, Updating, Succeeded, Failed, Canceled
        $state  = $parsed.properties.provisioningState

        switch ($state) {
            "Succeeded" {
                Write-Host "  ✅ $ModuleName — Available" -ForegroundColor Green
                return $true
            }
            { $_ -in "Failed", "Canceled" } {
                # Surface the actual error detail from the REST response
                $errMsg = $parsed.properties.error.message
                Write-Host "  ❌ $ModuleName — FAILED: $errMsg" -ForegroundColor Red
                return $false
            }
            default {
                Write-Host "  ⏳ $ModuleName — $state ($elapsed`s elapsed)..." -ForegroundColor Yellow
                Start-Sleep -Seconds 15
                $elapsed += 15
            }
        }
    }

    Write-Host "  ⚠️  $ModuleName — Timed out after $($TimeoutSeconds)s. Check portal manually." -ForegroundColor Magenta
    return $false
}
#endregion


#region ── SETUP ──────────────────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Azure Automation Module Importer — PS 7.4 Runtime" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════════`n" -ForegroundColor Cyan

# Ensure the Az session is pointed at the right subscription
Set-AzContext -SubscriptionId $subscriptionId | Out-Null

# Get the storage account context — read-only metadata fetch, no changes made
Write-Host "[SETUP] Connecting to storage account '$storageAccount'..." -ForegroundColor Cyan
$ctx = (Get-AzStorageAccount -ResourceGroupName $rg -Name $storageAccount).Context
#endregion


#region ── SAFETY PRE-CHECK ───────────────────────────────────────────────
# If a container named 'module-staging' already exists with blobs that were
# NOT created by this script (i.e. anything not named *.zip), halt immediately.
# This prevents the cleanup step from accidentally deleting foreign data.

$existingContainer = Get-AzStorageContainer -Name $stagingContainer `
                                             -Context $ctx `
                                             -ErrorAction SilentlyContinue

if ($existingContainer) {
    $existingBlobs = Get-AzStorageBlob -Container $stagingContainer `
                                        -Context $ctx `
                                        -ErrorAction SilentlyContinue

    # Any blob that doesn't look like a module zip is considered foreign
    $foreignBlobs = @($existingBlobs | Where-Object { $_.Name -notlike "*.zip" })

    if ($foreignBlobs.Count -gt 0) {
        Write-Host "⛔ SAFETY HALT — Aborting before making any changes." -ForegroundColor Red
        Write-Host "   Container '$stagingContainer' already exists in '$storageAccount'" -ForegroundColor Red
        Write-Host "   and contains $($foreignBlobs.Count) blob(s) not created by this script:" -ForegroundColor Red
        $foreignBlobs | ForEach-Object { Write-Host "     - $($_.Name)" -ForegroundColor Red }
        Write-Host "`n   This script deletes '$stagingContainer' during cleanup." -ForegroundColor Red
        Write-Host "   ACTION REQUIRED: Rename `$stagingContainer in the Config region" -ForegroundColor Yellow
        Write-Host "   to something unused (e.g. 'automation-module-staging'), then re-run." -ForegroundColor Yellow
        exit 1
    }
    else {
        # Container exists but is empty or has only leftover zips from a previous run — safe to reuse
        Write-Host "[SETUP] Container '$stagingContainer' already exists (safe to reuse).`n" -ForegroundColor Yellow
    }
}
else {
    # Container does not exist — create it as fully private (no public blob access)
    New-AzStorageContainer -Name $stagingContainer `
                            -Context $ctx `
                            -Permission Off | Out-Null
    Write-Host "[SETUP] Created private staging container '$stagingContainer'.`n" -ForegroundColor Cyan
}
#endregion


#region ── MAIN IMPORT LOOP ───────────────────────────────────────────────
$failed  = @()     # accumulates names of modules that failed at any step
$aborted = $false  # set to $true when a CRITICAL module fails

foreach ($mod in $modules.Keys) {

    # If a critical module failed, skip the rest of the run entirely.
    # Continuing would produce misleading errors since the dependency is missing.
    if ($aborted) {
        Write-Host "`n[SKIP] $mod — skipped due to earlier critical module failure." -ForegroundColor DarkGray
        $failed += $mod
        continue
    }

    $isCritical = $modules[$mod]
    Write-Host "`n[MODULE] $mod$(if ($isCritical) { ' (CRITICAL)' })" -ForegroundColor Cyan

    # ── Step 1: Download .nupkg from PSGallery to local temp folder ────────
    # PSGallery returns the latest version when no version number is in the URL.
    # A .nupkg is structurally identical to a .zip — Azure Automation accepts both.
    # $tempDir resolves correctly on both Windows (C:\...\Temp) and Linux (/tmp).
    $localPath = Join-Path $tempDir "$mod.zip"

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

    # ── Step 2: Upload to the private staging container ────────────────────
    # Writes ONLY to 'module-staging'. No other container is referenced here.
    # Your $web container and all dashboard blobs are completely untouched.
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
        Write-Host "  ❌ Blob upload failed: $_" -ForegroundColor Red
        $failed += $mod
        if ($isCritical) { $aborted = $true }
        Remove-Item $localPath -ErrorAction SilentlyContinue
        continue
    }

    # ── Step 3: Generate a 1-hour read-only SAS URL ────────────────────────
    # -Permission r = read only. The token cannot write, delete, or list.
    # Azure Automation fetches the blob immediately on import submission,
    # so 1 hour is far more than sufficient. Token auto-expires regardless.
    $sasUrl = New-AzStorageBlobSASToken `
                  -Container  $stagingContainer `
                  -Blob       "$mod.zip" `
                  -Context    $ctx `
                  -Permission r `
                  -ExpiryTime (Get-Date).AddHours(1) `
                  -FullUri    # returns full https://... URL, not just the token string

    # ── Step 4: Submit the import to the 7.4 runtime via REST API ──────────
    # WHY REST and not New-AzAutomationModule?
    # New-AzAutomationModule has a hardcoded ValidateSet of '5.1','7.2' for
    # -RuntimeVersion. Passing '7.4' throws a parameter validation error.
    # The REST API /runtimeEnvironments/{name}/packages has no such restriction.
    #
    # This PUT call only affects the exact $runtimeName URI path.
    # Your 7.2 runtime lives under a different resource path and is not touched.
    Write-Host "  Submitting to runtime '$runtimeName'..."

    $importUri = "https://management.azure.com/subscriptions/$subscriptionId" +
                 "/resourceGroups/$rg" +
                 "/providers/Microsoft.Automation/automationAccounts/$aa" +
                 "/runtimeEnvironments/$runtimeName/packages/$mod" +
                 "?api-version=$apiVersion"

    $body = @{
        properties = @{
            contentLink = @{
                uri = $sasUrl    # Azure Automation downloads from here immediately
            }
        }
    } | ConvertTo-Json -Depth 5

    $resp = Invoke-AzRestMethod -Uri $importUri -Method PUT -Payload $body

    # 200 = updated existing module, 201 = created new, 202 = accepted (async)
    if ($resp.StatusCode -notin 200, 201, 202) {
        $errDetail = ($resp.Content | ConvertFrom-Json).error.message
        Write-Host "  ❌ Submission failed (HTTP $($resp.StatusCode)): $errDetail" -ForegroundColor Red
        $failed += $mod
        if ($isCritical) { $aborted = $true }
        Remove-Item $localPath -ErrorAction SilentlyContinue
        continue
    }

    # ── Step 5: Poll until module is Available ─────────────────────────────
    # Must wait for "Succeeded" before importing the next module.
    # Dependent modules (e.g. Az.Storage needs Az.Accounts fully provisioned)
    # will fail silently if their base dependency is still in "Creating" state.
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

    # ── Step 6: Remove the local temp file ────────────────────────────────
    # Cleans up your local temp folder (Windows or Linux). This only touches
    # the file just downloaded — no other local files are affected.
    Remove-Item $localPath -ErrorAction SilentlyContinue
}
#endregion


#region ── CLEANUP ────────────────────────────────────────────────────────
# All modules have definitively succeeded or failed by this point.
# Safe to remove the staging blobs and container now.
# Only 'module-staging' is affected — no other container is referenced.
Write-Host "`n[CLEANUP] Removing staging blobs..." -ForegroundColor Cyan

Get-AzStorageBlob -Container $stagingContainer `
                   -Context $ctx `
                   -ErrorAction SilentlyContinue |
    Remove-AzStorageBlob -Force -ErrorAction SilentlyContinue

Remove-AzStorageContainer -Name $stagingContainer `
                            -Context $ctx `
                            -Force `
                            -ErrorAction SilentlyContinue

Write-Host "[CLEANUP] Staging container '$stagingContainer' removed."
#endregion


#region ── SUMMARY ────────────────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════" -ForegroundColor Cyan

if ($failed.Count -eq 0) {
    Write-Host "  ✅ ALL $($modules.Count) MODULES IMPORTED SUCCESSFULLY" -ForegroundColor Green
    Write-Host "`n  Next step: test your runbook" -ForegroundColor Green
    Write-Host "  Automation Account → Runbooks → your runbook → Test Pane → Start" -ForegroundColor Green
}
else {
    $successCount = $modules.Count - $failed.Count
    Write-Host "  ⚠️  COMPLETED WITH ERRORS" -ForegroundColor Yellow
    Write-Host "  Succeeded : $successCount / $($modules.Count)" -ForegroundColor Green
    Write-Host "  Failed    : $($failed.Count) / $($modules.Count)" -ForegroundColor Red
    $failed | ForEach-Object { Write-Host "    ✗ $_" -ForegroundColor Red }

    if ($aborted) {
        Write-Host "`n  ⛔ Run was aborted early — a CRITICAL module failed." -ForegroundColor Red
        Write-Host "  Resolve the critical module error first, then re-run" -ForegroundColor Yellow
        Write-Host "  with only the failed modules listed in `$modules." -ForegroundColor Yellow
    }
    else {
        Write-Host "`n  To retry: remove successful modules from `$modules" -ForegroundColor Yellow
        Write-Host "  in the Config region and re-run." -ForegroundColor Yellow
    }
}

Write-Host "══════════════════════════════════════════════════`n" -ForegroundColor Cyan
#endregion
