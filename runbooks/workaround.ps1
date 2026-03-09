<#
.SYNOPSIS
    Strips ZeroTrustAssessment of bloat to get it under Azure Automation's
    100MB module size limit, then stages and imports it into your PS 7.4
    runtime environment automatically.

.WHAT IT REMOVES — safe to strip, never loaded by Azure Automation at runtime:
    - Non-Windows native runtimes  (linux, osx, unix, win-x86, win-arm)
    - Debug build output folders   (Debug\)
    - Legacy .NET Framework TFMs   (net45-net48, netstandard1.x)
    - PDB debug symbol files       (*.pdb)
    - XML IntelliSense doc files   (*.xml inside lib/bin/ref/runtimes only)
    - Syncfusion/report builder    (used for HTML output only — runbook uses JSON)

.WHAT IT KEEPS — everything needed for Invoke-ZtAssessment JSON output:
    - All .psm1 / .psd1 / .ps1 PowerShell files
    - win-x64 native runtime DLLs
    - netstandard2.x and net6+ assemblies
    - All module manifests and config files

.SAFETY:
    - Only touches $env:TEMP\ZTStrip  (local) and 'module-staging' blob (Azure)
    - Pre-check halts if 'module-staging' already has foreign content
    - Uses throw instead of exit so your PowerShell window stays open on error
    - Your $web container, existing blobs, 7.2 runtime, runbook code untouched

.NOTES
    Fill in the 5 config variables. Run in local PowerShell or Cloud Shell.
    Requires Connect-AzAccount to already be run (Cloud Shell handles this).
#>


#region ── CONFIG ─────────────────────────────────────────────────────────
$subscriptionId = "YOUR_SUBSCRIPTION_ID"
$rg             = "YOUR_RESOURCE_GROUP"
$aa             = "YOUR_AUTOMATION_ACCOUNT_NAME"
$runtimeName    = "YOUR_74_RUNTIME_ENV_NAME"
$storageAccount = "YOUR_STORAGE_ACCOUNT_NAME"
$apiVersion     = "2023-05-15-preview"

# Local working folder — wiped clean at the start and end of each run
$workDir        = Join-Path $env:TEMP "ZTStrip"

# Staging blob container — created by this script, deleted at end
$stagingContainer = "module-staging"
#endregion


#region ── HELPERS ────────────────────────────────────────────────────────
# Tracks how much was stripped for the final summary
$script:removedCount = 0
$script:removedBytes = 0

function Remove-StripTarget {
    <#
    .SYNOPSIS Removes a local file or folder and tracks the bytes saved. #>
    param(
        [string]$Path,
        [string]$Reason
    )
    if (-not (Test-Path $Path)) { return }

    # Measure bytes before deleting
    $bytes = if (Test-Path $Path -PathType Container) {
        (Get-ChildItem $Path -Recurse -File -ErrorAction SilentlyContinue |
         Measure-Object -Property Length -Sum).Sum
    } else {
        (Get-Item $Path).Length
    }

    Remove-Item $Path -Recurse -Force -ErrorAction SilentlyContinue
    $script:removedCount++
    $script:removedBytes += [long]$bytes
    $shortPath = $Path -replace [regex]::Escape($script:extractDir), '...'
    Write-Host "  🗑  [$Reason] $shortPath" -ForegroundColor DarkGray
}

# Path separator char for cross-platform regex (\ on Windows, / on Linux)
$sep = [regex]::Escape([IO.Path]::DirectorySeparatorChar)
#endregion


#region ── SETUP ──────────────────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ZeroTrustAssessment — Strip & Import for PS 7.4" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════════`n" -ForegroundColor Cyan

# Start with a clean working directory every run
if (Test-Path $workDir) {
    Write-Host "[SETUP] Cleaning previous run from $workDir..." -ForegroundColor DarkGray
    Remove-Item $workDir -Recurse -Force
}
New-Item -ItemType Directory -Path $workDir | Out-Null

$script:extractDir = Join-Path $workDir "extracted"

Set-AzContext -SubscriptionId $subscriptionId | Out-Null
Write-Host "[SETUP] Working directory: $workDir"
Write-Host "[SETUP] Target runtime:    $runtimeName`n"
#endregion


#region ── STEP 1: DOWNLOAD ───────────────────────────────────────────────
Write-Host "[1/6] Downloading ZeroTrustAssessment from PSGallery..." -ForegroundColor Cyan

$rawZip = Join-Path $workDir "ZeroTrustAssessment-original.zip"

try {
    Invoke-WebRequest `
        -Uri     "https://www.powershellgallery.com/api/v2/package/ZeroTrustAssessment" `
        -OutFile $rawZip `
        -ErrorAction Stop
}
catch {
    throw "Download from PSGallery failed: $_"
}

$originalMB = [math]::Round((Get-Item $rawZip).Length / 1MB, 2)
Write-Host "  ✅ Downloaded — $originalMB MB" -ForegroundColor Yellow
#endregion


#region ── STEP 2: EXTRACT ────────────────────────────────────────────────
Write-Host "`n[2/6] Extracting package..." -ForegroundColor Cyan

New-Item -ItemType Directory -Path $script:extractDir | Out-Null
Expand-Archive -Path $rawZip -DestinationPath $script:extractDir -Force

Write-Host "  ✅ Extracted to: $script:extractDir"
#endregion


#region ── STEP 3: STRIP ──────────────────────────────────────────────────
Write-Host "`n[3/6] Stripping unnecessary content..." -ForegroundColor Cyan

# ── 3a. Non-Windows native runtime folders ─────────────────────────────
# nupkg structure places native binaries under:
#   lib\<tfm>\runtimes\<rid>\  OR  runtimes\<rid>\
# Azure Automation is Windows x64, so ONLY win-x64 and win are needed.
# Everything else (linux-x64, osx-x64, win-x86, win-arm64, etc.) is dead weight.

$nonWindowsRids = @('linux*', 'osx*', 'unix*', 'win-x86', 'win-arm*', 'win-arm64')

Get-ChildItem $script:extractDir -Recurse -Directory -ErrorAction SilentlyContinue |
Where-Object {
    # Must be inside a 'runtimes' parent folder (validated by path, not just name)
    $_.Parent.Name -eq 'runtimes' -and
    # And the RID folder itself must match a non-Windows pattern
    ($nonWindowsRids | Where-Object { $_.Name -like $_ }).Count -gt 0
} |
ForEach-Object {
    Remove-StripTarget -Path $_.FullName -Reason "Non-Windows RID"
}

# ── 3b. win-x86 anywhere (sometimes nested differently) ────────────────
Get-ChildItem $script:extractDir -Recurse -Directory -ErrorAction SilentlyContinue |
Where-Object { $_.Name -eq 'win-x86' } |
ForEach-Object {
    Remove-StripTarget -Path $_.FullName -Reason "win-x86 runtime"
}

# ── 3c. Debug build output folders ────────────────────────────────────
# Release builds are functionally identical and smaller.
# Debug folders are only useful when debugging in an IDE.
Get-ChildItem $script:extractDir -Recurse -Directory -ErrorAction SilentlyContinue |
Where-Object { $_.Name -eq 'Debug' } |
ForEach-Object {
    Remove-StripTarget -Path $_.FullName -Reason "Debug build output"
}

# ── 3d. Legacy .NET Framework TFM folders ─────────────────────────────
# PS 7.4 on Azure Automation runs on .NET 8.
# net45-net48 and netstandard1.x assemblies are never selected by the runtime.
$legacyTfms = @(
    'net45', 'net451', 'net452',
    'net46', 'net461', 'net462',
    'net47', 'net471', 'net472',
    'net48', 'net481',
    'netstandard1.0', 'netstandard1.1', 'netstandard1.2',
    'netstandard1.3', 'netstandard1.4', 'netstandard1.5', 'netstandard1.6'
)

Get-ChildItem $script:extractDir -Recurse -Directory -ErrorAction SilentlyContinue |
Where-Object { $_.Name -in $legacyTfms } |
ForEach-Object {
    Remove-StripTarget -Path $_.FullName -Reason "Legacy TFM"
}

# ── 3e. Syncfusion / report builder assets ────────────────────────────
# ZeroTrustAssessment bundles Syncfusion DLLs for HTML/Excel report output.
# The runbook uses Invoke-ZtAssessment which outputs JSON only — the HTML
# rendering pipeline (and these DLLs) are never invoked in a headless run.
# Safe to remove as long as you only consume the JSON output.
$reportPatterns = @('syncfusion*', 'boldreports*', 'telerik*', 'reportbuilder*')

# Folders
Get-ChildItem $script:extractDir -Recurse -Directory -ErrorAction SilentlyContinue |
Where-Object {
    $name = $_.Name.ToLower()
    $reportPatterns | Where-Object { $name -like $_.ToLower() }
} |
ForEach-Object {
    Remove-StripTarget -Path $_.FullName -Reason "Report builder folder"
}

# Individual DLL files (when not in their own folder)
Get-ChildItem $script:extractDir -Recurse -File -ErrorAction SilentlyContinue |
Where-Object {
    $name = $_.Name.ToLower()
    $reportPatterns | Where-Object { $name -like $_.ToLower() }
} |
ForEach-Object {
    Remove-StripTarget -Path $_.FullName -Reason "Report builder DLL"
}

# ── 3f. PDB debug symbol files ─────────────────────────────────────────
# Symbol files are used by debuggers to map compiled IL back to source.
# Never loaded at runtime under any circumstance. Unconditionally safe to remove.
Get-ChildItem $script:extractDir -Recurse -File -Filter "*.pdb" -ErrorAction SilentlyContinue |
ForEach-Object {
    Remove-StripTarget -Path $_.FullName -Reason "PDB symbol"
}

# ── 3g. XML IntelliSense documentation files ──────────────────────────
# .xml files that sit alongside .dll assemblies are IntelliSense doc files.
# They are NEVER loaded at runtime — only consumed by IDEs for autocomplete.
#
# SAFETY GUARD: Only strip XMLs inside assembly output folders (lib, bin, ref,
# runtimes). Never strip XMLs in the module root or data folders, which may
# be actual config/schema files that the module reads at runtime.
#
# FIX vs previous version: Use cross-platform path separator via $sep variable
# instead of hardcoded '\\' which silently fails on Linux/Cloud Shell.

Get-ChildItem $script:extractDir -Recurse -File -Filter "*.xml" -ErrorAction SilentlyContinue |
Where-Object {
    # Normalize to forward slashes for consistent matching on both OS
    $normalizedDir = $_.DirectoryName.Replace('\', '/')
    $normalizedDir -match "/(lib|bin|ref|runtimes)/"
} |
ForEach-Object {
    Remove-StripTarget -Path $_.FullName -Reason "XML doc file"
}

$removedMB = [math]::Round($script:removedBytes / 1MB, 2)
Write-Host "`n  Stripped $($script:removedCount) items — saved $removedMB MB" -ForegroundColor Green
#endregion


#region ── STEP 4: REPACK & SIZE CHECK ────────────────────────────────────
Write-Host "`n[4/6] Repacking stripped module..." -ForegroundColor Cyan

$strippedZip = Join-Path $workDir "ZeroTrustAssessment-stripped.zip"
Compress-Archive -Path "$script:extractDir\*" -DestinationPath $strippedZip -Force

$strippedMB = [math]::Round((Get-Item $strippedZip).Length / 1MB, 2)
$savedMB    = [math]::Round($originalMB - $strippedMB, 2)
$limitMB    = 100

Write-Host "  Original : $originalMB MB" -ForegroundColor Yellow
Write-Host "  Stripped : $strippedMB MB" -ForegroundColor $(if ($strippedMB -lt $limitMB) {"Green"} else {"Red"})
Write-Host "  Saved    : $savedMB MB"

if ($strippedMB -ge $limitMB) {
    # FIX vs previous version: use throw instead of exit 1
    # exit 1 closes the entire PowerShell window when run interactively.
    # throw keeps the window open and gives you the full error in context.
    throw ("Stripped module is still $strippedMB MB — over the $limitMB MB Azure Automation limit. " +
           "Stripping alone is not sufficient. You will need a Hybrid Worker. " +
           "Working files preserved at: $workDir")
}

Write-Host "  ✅ Under $limitMB MB — safe to import." -ForegroundColor Green
#endregion


#region ── STEP 5: SAFETY PRE-CHECK FOR STAGING CONTAINER ────────────────
Write-Host "`n[5/6] Checking storage and staging container..." -ForegroundColor Cyan

$ctx = (Get-AzStorageAccount -ResourceGroupName $rg -Name $storageAccount).Context

# FIX vs previous version: safety pre-check was missing entirely.
# If a container named 'module-staging' already exists with data that belongs
# to something else, the cleanup step at the end would delete it silently.
# This guard detects that and halts BEFORE making any Azure changes.
$existingContainer = Get-AzStorageContainer -Name $stagingContainer `
                                             -Context $ctx `
                                             -ErrorAction SilentlyContinue

if ($existingContainer) {
    $existingBlobs = Get-AzStorageBlob -Container $stagingContainer `
                                        -Context $ctx `
                                        -ErrorAction SilentlyContinue

    # Any blob that isn't a module zip is considered foreign (not ours)
    $foreignBlobs = @($existingBlobs | Where-Object { $_.Name -notlike "*.zip" })

    if ($foreignBlobs.Count -gt 0) {
        throw ("SAFETY HALT — '$stagingContainer' already exists in '$storageAccount' " +
               "with $($foreignBlobs.Count) blob(s) not created by this script: " +
               ($foreignBlobs.Name -join ', ') + ". " +
               "Rename `$stagingContainer in the Config region to something unused and re-run.")
    }

    Write-Host "  Container '$stagingContainer' exists (safe to reuse — contains only .zip files)."
}
else {
    New-AzStorageContainer -Name $stagingContainer -Context $ctx -Permission Off | Out-Null
    Write-Host "  Created private staging container '$stagingContainer'."
}

# Upload the stripped zip to the staging container
Write-Host "  Uploading stripped module to blob..."
Set-AzStorageBlobContent `
    -Container $stagingContainer `
    -Blob      "ZeroTrustAssessment.zip" `
    -File      $strippedZip `
    -Context   $ctx `
    -Force | Out-Null

Write-Host "  Uploaded ($strippedMB MB)."

# Generate a 1-hour read-only SAS URL
# -Permission r = read only — the token cannot write, delete, or list
$sasUrl = New-AzStorageBlobSASToken `
              -Container  $stagingContainer `
              -Blob       "ZeroTrustAssessment.zip" `
              -Context    $ctx `
              -Permission r `
              -ExpiryTime (Get-Date).AddHours(1) `
              -FullUri

# Submit the import to the 7.4 runtime via REST API
# New-AzAutomationModule -RuntimeVersion only accepts 5.1/7.2 (ValidateSet bug)
$importUri = "https://management.azure.com/subscriptions/$subscriptionId" +
             "/resourceGroups/$rg" +
             "/providers/Microsoft.Automation/automationAccounts/$aa" +
             "/runtimeEnvironments/$runtimeName/packages/ZeroTrustAssessment" +
             "?api-version=$apiVersion"

$body = @{
    properties = @{ contentLink = @{ uri = $sasUrl } }
} | ConvertTo-Json -Depth 5

Write-Host "  Submitting import to runtime '$runtimeName'..."
$resp = Invoke-AzRestMethod -Uri $importUri -Method PUT -Payload $body

if ($resp.StatusCode -notin 200, 201, 202) {
    $errDetail = ($resp.Content | ConvertFrom-Json).error.message
    throw "Import submission failed (HTTP $($resp.StatusCode)): $errDetail"
}

Write-Host "  ✅ Import submitted (HTTP $($resp.StatusCode))." -ForegroundColor Green
#endregion


#region ── STEP 6: POLL UNTIL AVAILABLE ───────────────────────────────────
Write-Host "`n[6/6] Waiting for module to become Available..." -ForegroundColor Cyan

# Pin context inside polling (prevents drift in multi-subscription sessions)
Set-AzContext -SubscriptionId $subscriptionId | Out-Null

$pollUri = "https://management.azure.com/subscriptions/$subscriptionId" +
           "/resourceGroups/$rg" +
           "/providers/Microsoft.Automation/automationAccounts/$aa" +
           "/runtimeEnvironments/$runtimeName/packages/ZeroTrustAssessment" +
           "?api-version=$apiVersion"

# FIX vs previous version: previous version used 'break' inside a switch to
# exit the while loop — but 'break' in a switch exits the SWITCH, not the loop.
# Now uses a clean $done flag so the exit condition is unambiguous.
$elapsed = 0
$timeout = 360
$done    = $false

while (-not $done -and $elapsed -lt $timeout) {
    $pollResp = Invoke-AzRestMethod -Uri $pollUri -Method GET
    $parsed   = $pollResp.Content | ConvertFrom-Json
    $state    = $parsed.properties.provisioningState

    switch ($state) {
        "Succeeded" {
            Write-Host "  ✅ ZeroTrustAssessment — Available" -ForegroundColor Green
            $done = $true
        }
        { $_ -in "Failed", "Canceled" } {
            $errMsg = $parsed.properties.error.message
            throw "Module import failed during provisioning: $errMsg"
        }
        default {
            Write-Host "  ⏳ $state ($elapsed`s elapsed)..." -ForegroundColor Yellow
            Start-Sleep -Seconds 15
            $elapsed += 15
        }
    }
}

if (-not $done) {
    Write-Host "  ⚠️  Timed out after $($timeout)s — check portal manually under:" -ForegroundColor Magenta
    Write-Host "      Automation Account → Runtime Environments → $runtimeName → Packages" -ForegroundColor Magenta
}
#endregion


#region ── CLEANUP ────────────────────────────────────────────────────────
Write-Host "`n[CLEANUP] Removing temp files and staging blob..." -ForegroundColor Cyan

# Remove local working directory (all files are in $env:TEMP\ZTStrip)
Remove-Item $workDir -Recurse -Force -ErrorAction SilentlyContinue

# Remove staging blob and container from Azure storage
# SAFE: only 'module-staging' is targeted — no other container is referenced
Get-AzStorageBlob -Container $stagingContainer -Context $ctx -ErrorAction SilentlyContinue |
    Remove-AzStorageBlob -Force -ErrorAction SilentlyContinue
Remove-AzStorageContainer -Name $stagingContainer -Context $ctx -Force -ErrorAction SilentlyContinue

Write-Host "[CLEANUP] Done."
#endregion


#region ── SUMMARY ────────────────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  ✅ ZeroTrustAssessment imported successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Original size : $originalMB MB" -ForegroundColor Yellow
Write-Host "  Final size    : $strippedMB MB" -ForegroundColor Green
Write-Host "  Space saved   : $savedMB MB" -ForegroundColor Green
Write-Host ""
Write-Host "  Next step: test your runbook" -ForegroundColor Cyan
Write-Host "  Automation Account → Runbooks → Test Pane → Start" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════════`n" -ForegroundColor Cyan
#endregion
