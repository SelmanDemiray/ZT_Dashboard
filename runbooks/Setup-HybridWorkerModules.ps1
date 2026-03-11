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
    # Uses a globally readable path so the Hybrid Worker SYSTEM account can see them AND
    # Install-Module's strict UAC Admin checks are avoided.
    [string]$CustomModulePath = "C:\ProgramData\ZtModules"
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

# ── Ensure VC++ Redistributable is installed ────────────────────────────
Write-Host "`n[PREREQ] Checking for Microsoft Visual C++ Redistributable..." -ForegroundColor Cyan
$vcInstalled = Get-ChildItem -Path HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall, HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall -ErrorAction SilentlyContinue |
               Get-ItemProperty | Where-Object { $_.DisplayName -match "Microsoft Visual C\+\+ 2015-2022 Redistributable" }

if (-not $vcInstalled) {
    Write-Host "  ⚠️  Visual C++ Redistributable is missing." -ForegroundColor Yellow
    Write-Host "  Downloading and installing VC_redist.x64.exe silently... " -NoNewline
    $vcDownloadUrl = "https://aka.ms/vs/17/release/vc_redist.x64.exe"
    $vcInstallerPath = Join-Path $env:TEMP "vc_redist.x64.exe"

    try {
        Invoke-WebRequest -Uri $vcDownloadUrl -OutFile $vcInstallerPath
        $process = Start-Process -FilePath $vcInstallerPath -ArgumentList "/install /quiet /norestart" -Wait -PassThru
        if ($process.ExitCode -eq 0 -or $process.ExitCode -eq 3010) {
            Write-Host "✅ Done." -ForegroundColor Green
            if ($process.ExitCode -eq 3010) {
                Write-Host "  ⚠️  A reboot is technically required to complete the VC++ installation." -ForegroundColor Yellow
            }
        } else {
            Write-Host "❌ Failed (Exit Code: $($process.ExitCode))" -ForegroundColor Red
            Write-Host "     Please install manually: $vcDownloadUrl" -ForegroundColor Red
        }
    }
    catch {
        Write-Host "❌ Download or installation failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    finally {
        if (Test-Path $vcInstallerPath) { Remove-Item $vcInstallerPath -Force }
    }
} else {
    Write-Host "  ✅ Visual C++ Redistributable is already installed." -ForegroundColor Green
}

# ── Install modules ─────────────────────────────────────────────────────
Write-Host "`n[INSTALL] Installing $($requiredModules.Count) modules...`n" -ForegroundColor Cyan

if (-not (Test-Path $CustomModulePath)) {
    Write-Host "  Creating module directory: $CustomModulePath" -ForegroundColor DarkGray
    New-Item -ItemType Directory -Path $CustomModulePath -Force | Out-Null
}

$failed  = @()
$success = @()

foreach ($mod in $requiredModules) {
    Write-Host "  Downloading $mod..." -NoNewline
    try {
        Save-Module -Name $mod -Path $CustomModulePath -Force -ErrorAction Stop
        Write-Host " ✅" -ForegroundColor Green
        $success += $mod
    }
    catch {
        Write-Host " ❌ $($_.Exception.Message)" -ForegroundColor Red
        $failed += $mod
    }
}

# ── Validation ──────────────────────────────────────────────────────────
$env:PSModulePath = "$CustomModulePath;$env:PSModulePath"
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

# ── Environment Variables ───────────────────────────────────────────────
Write-Host "`n[ENV] Configuring Azure Automation Environment Variables...`n" -ForegroundColor Cyan
$psPath = Join-Path $PSHOME "pwsh.exe"
try {
    [Environment]::SetEnvironmentVariable("POWERSHELL_7_4_PATH", $psPath, "Machine")
    Write-Host "  ✅ Set POWERSHELL_7_4_PATH = $psPath (Machine Scope)" -ForegroundColor Green

    [Environment]::SetEnvironmentVariable("POWERSHELL_7_2_PATH", $psPath, "Machine")
    Write-Host "  ✅ Set POWERSHELL_7_2_PATH = $psPath (Machine Scope)" -ForegroundColor Green

    Write-Host "`n  ⚠️  IMPORTANT: YOU MUST RESTART THIS VM (or the Hybrid Worker service)" -ForegroundColor Yellow
    Write-Host "      for the Hybrid Worker Agent to detect these new variables!" -ForegroundColor Yellow
}
catch {
    Write-Host "  ❌ Failed to set environment variables. Are you running as Administrator?" -ForegroundColor Red
    Write-Host "     Error: $($_.Exception.Message)" -ForegroundColor Red
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
    Write-Host "    Save-Module -Name <module> -Path $CustomModulePath -Force" -ForegroundColor Yellow
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
