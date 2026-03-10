<#
.SYNOPSIS
    Installs all PowerShell modules required by the ZeroTrustAssessment
    hybrid runbook on the local machine (the Hybrid Worker VM).

.DESCRIPTION
    Run this script ONCE on your Azure VM after registering it as a
    Hybrid Runbook Worker.  It installs:

      1. ZeroTrustAssessment  (the main assessment engine — no size limit locally)
      2. Az.Accounts, Az.Storage, Az.ResourceGraph, Az.Security
      3. Microsoft.Graph.Authentication, .Identity.DirectoryManagement,
         .Users, .Groups, .Applications, .DeviceManagement
      4. PSFramework

    All modules are installed into the CurrentUser scope so no admin
    elevation is needed (PowerShell 7 resolves CurrentUser modules just
    fine for Hybrid Worker jobs).

.PREREQUISITES
    • PowerShell 7.4+  (run 'pwsh' — NOT 'powershell')
    • Outbound internet to powershellgallery.com

.NOTES
    Re-run this script any time you need to update modules to latest.
    It uses -Force so existing versions are overwritten cleanly.
#>

#Requires -Version 7.0

param(
    # Install scope — CurrentUser requires no admin; AllUsers does
    [ValidateSet("CurrentUser", "AllUsers")]
    [string]$Scope = "CurrentUser"
)

$ErrorActionPreference = "Stop"

# ── Module list ──────────────────────────────────────────────────────────
$requiredModules = @(
    # Core Azure
    "Az.Accounts",
    "Az.Storage",
    "Az.ResourceGraph",
    "Az.Security",

    # Microsoft Graph
    "Microsoft.Graph.Authentication",
    "Microsoft.Graph.Identity.DirectoryManagement",
    "Microsoft.Graph.Users",
    "Microsoft.Graph.Groups",
    "Microsoft.Graph.Applications",
    "Microsoft.Graph.DeviceManagement",

    # Supporting
    "PSFramework",

    # The big one — no size limit when installed locally
    "ZeroTrustAssessment"
)

# ── Ensure NuGet provider ───────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Hybrid Worker — Module Installer" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════════`n" -ForegroundColor Cyan

Write-Host "[SETUP] PowerShell version: $($PSVersionTable.PSVersion)" -ForegroundColor DarkGray
Write-Host "[SETUP] Install scope:      $Scope" -ForegroundColor DarkGray

if ($PSVersionTable.PSVersion.Major -lt 7) {
    Write-Host "`n  ❌ This script requires PowerShell 7.x (pwsh), not Windows PowerShell 5.1." -ForegroundColor Red
    Write-Host "     Run this in pwsh.exe, not powershell.exe.`n" -ForegroundColor Red
    throw "Wrong PowerShell version. Use pwsh."
}

# Trust PSGallery if not already
$gallery = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
if ($gallery -and $gallery.InstallationPolicy -ne "Trusted") {
    Write-Host "[SETUP] Trusting PSGallery..." -ForegroundColor DarkGray
    Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
}

# ── Install modules ─────────────────────────────────────────────────────
Write-Host "`n[INSTALL] Installing $($requiredModules.Count) modules...`n" -ForegroundColor Cyan

$failed  = @()
$success = @()

foreach ($mod in $requiredModules) {
    Write-Host "  Installing $mod..." -NoNewline
    try {
        Install-Module -Name $mod -Scope $Scope -Force -AllowClobber -SkipPublisherCheck -ErrorAction Stop
        $installed = Get-Module -Name $mod -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1
        Write-Host " ✅ ($($installed.Version))" -ForegroundColor Green
        $success += "$mod ($($installed.Version))"
    }
    catch {
        Write-Host " ❌ $($_.Exception.Message)" -ForegroundColor Red
        $failed += $mod
    }
}

# ── Validation ──────────────────────────────────────────────────────────
Write-Host "`n[VALIDATE] Checking all modules can be found...`n" -ForegroundColor Cyan

$allGood = $true
foreach ($mod in $requiredModules) {
    $found = Get-Module -Name $mod -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1
    if ($found) {
        Write-Host "  ✅ $mod → $($found.Version)" -ForegroundColor Green
    }
    else {
        Write-Host "  ❌ $mod → NOT FOUND" -ForegroundColor Red
        $allGood = $false
    }
}

# ── Summary ─────────────────────────────────────────────────────────────
Write-Host "`n══════════════════════════════════════════════════" -ForegroundColor Cyan

if ($failed.Count -gt 0) {
    Write-Host "  ⚠️  $($failed.Count) module(s) failed to install:" -ForegroundColor Yellow
    foreach ($f in $failed) {
        Write-Host "     • $f" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "  Try running manually:" -ForegroundColor Yellow
    Write-Host "    Install-Module -Name <module> -Scope $Scope -Force" -ForegroundColor Yellow
}
else {
    Write-Host "  ✅ All $($requiredModules.Count) modules installed successfully!" -ForegroundColor Green
}

Write-Host ""
Write-Host "  Next steps:" -ForegroundColor Cyan
Write-Host "    1. Go to Azure Portal → Automation Account → Runbooks" -ForegroundColor Cyan
Write-Host "    2. Import 'Invoke-ZTDashboardDataCollection-Hybrid.ps1'" -ForegroundColor Cyan
Write-Host "    3. Test Pane → Run on: Hybrid Worker → Start" -ForegroundColor Cyan
Write-Host "══════════════════════════════════════════════════`n" -ForegroundColor Cyan
