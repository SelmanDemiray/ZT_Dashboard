param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"
$today = (Get-Date).ToString("yyyy-MM-dd")

$script:ErrorLog = [System.Collections.ArrayList]::new()

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","DEBUG")]
        [string]$Level = "INFO"
    )
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$ts][$Level] $Message"
}

# Module-level storage cache
$script:StorageBearerToken      = $null
$script:StorageTokenExpiry      = [int64]0
$script:StorageAccountNameCache = $null

function Get-StorageAccessToken {
    if (-not [string]::IsNullOrWhiteSpace($script:uamiClientId)) {
        # UAMI path: raw IMDS call, no SDK involvement
        $uri = "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=$([uri]::EscapeDataString('https://storage.azure.com/'))&client_id=$([uri]::EscapeDataString($script:uamiClientId))"
        $oldProxy = [System.Net.WebRequest]::DefaultWebProxy
        [System.Net.WebRequest]::DefaultWebProxy = $null
        try {
            if ($PSVersionTable.PSVersion.Major -ge 6) {
                $t = Invoke-RestMethod -Method GET -Uri $uri -Headers @{ Metadata = "true" } -TimeoutSec 15 -NoProxy -ErrorAction Stop
            } else {
                $t = Invoke-RestMethod -Method GET -Uri $uri -Headers @{ Metadata = "true" } -TimeoutSec 15 -ErrorAction Stop
            }
        } finally {
            [System.Net.WebRequest]::DefaultWebProxy = $oldProxy
        }

        return @{
            access_token = [string]$t.access_token
            expires_on   = [string]$t.expires_on
        }
    }
    else {
        # AppRegistration path
        $secTok   = Get-AzAccessToken -ResourceUrl "https://storage.azure.com/" -AsSecureString -ErrorAction Stop
        $plain    = [System.Net.NetworkCredential]::new('', $secTok.Token).Password
        $expEpoch = $secTok.ExpiresOn.ToUnixTimeSeconds().ToString()
        return @{
            access_token = $plain
            expires_on   = $expEpoch
        }
    }
}

function Ensure-StorageTokenFresh {
    $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ([string]::IsNullOrWhiteSpace($script:StorageBearerToken) -or ($nowEpoch + 300) -ge $script:StorageTokenExpiry) {
        Write-Log "Refreshing storage Bearer token..."
        $t = Get-StorageAccessToken
        $script:StorageBearerToken = [string]$t.access_token
        $script:StorageTokenExpiry = [int64]$t.expires_on
        Write-Log "Token refreshed."
    }
}

function Download-JsonBlob {
    param(
        [Parameter(Mandatory)][string]$BlobPath,
        [Parameter(Mandatory)][string]$Container
    )
    if ([string]::IsNullOrWhiteSpace($script:StorageAccountNameCache)) { throw "StorageAccountNameCache not set." }
    Ensure-StorageTokenFresh

    $uri = "https://" + $script:StorageAccountNameCache + ".blob.core.windows.net/" + $Container + "/" + $BlobPath
    $headers = [ordered]@{
        Authorization    = "Bearer $script:StorageBearerToken"
        "x-ms-version"   = "2020-04-08"
        "x-ms-date"      = [DateTime]::UtcNow.ToString("R")
    }

    try {
        $response = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers -TimeoutSec 120 -ErrorAction Stop
        Write-Log " [DOWNLOAD OK] $BlobPath"
        return $response
    }
    catch {
        $sc = $null; try { $sc = [int]$_.Exception.Response.StatusCode } catch { }
        Write-Log " [DOWNLOAD FAIL] $BlobPath (HTTP $sc) -- $($_.Exception.Message)" "WARN"
        return $null
    }
}

function Upload-JsonBlob {
    param(
        [Parameter(Mandatory)][string]$BlobPath,
        [Parameter(Mandatory)][object]$Data,
        [Parameter(Mandatory)][string]$Container
    )
    if ([string]::IsNullOrWhiteSpace($script:StorageAccountNameCache)) { throw "StorageAccountNameCache not set." }
    Ensure-StorageTokenFresh

    try {
        $json  = $Data | ConvertTo-Json -Depth 20 -Compress
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)

        $uri = "https://" + $script:StorageAccountNameCache + ".blob.core.windows.net/" + $Container + "/" + $BlobPath
        $headers = [ordered]@{
            Authorization    = "Bearer $script:StorageBearerToken"
            "x-ms-version"   = "2020-04-08"
            "x-ms-date"      = [DateTime]::UtcNow.ToString("R")
            "x-ms-blob-type" = "BlockBlob"
            "Content-Type"   = "application/json; charset=utf-8"
        }

        Invoke-RestMethod -Method PUT -Uri $uri -Headers $headers -Body $bytes -TimeoutSec 120 -ErrorAction Stop | Out-Null
        Write-Log " [UPLOAD OK] $BlobPath ($($bytes.Length) bytes)"
    }
    catch {
        $sc = $null; try { $sc = [int]$_.Exception.Response.StatusCode } catch { }
        Write-Log " [UPLOAD FAIL] $BlobPath (HTTP $sc) -- $($_.Exception.Message)" "ERROR"
        throw "Storage write failed (HTTP $sc): $($_.Exception.Message)"
    }
}

Write-Log "--- Initialization & Auth ---"
$authMethod = Get-AutomationVariable -Name "AuthMethod" -ErrorAction SilentlyContinue
if (-not $authMethod) { $authMethod = "ManagedIdentity" }
$storageAccountName = Get-AutomationVariable -Name "StorageAccountName" -ErrorAction Stop
$containerName      = Get-AutomationVariable -Name "BlobContainerName"  -ErrorAction Stop
$targetTenantId     = Get-AutomationVariable -Name "TargetTenantId"     -ErrorAction Stop

$script:uamiClientId = $null

if ($authMethod -eq 'ManagedIdentity') {
    $script:uamiClientId = Get-AutomationVariable -Name "UserAssignedManagedIdentityClientId" -ErrorAction Stop
    $msiEnvVars = @('IDENTITY_ENDPOINT','IDENTITY_HEADER','MSI_ENDPOINT','MSI_SECRET')
    foreach ($v in $msiEnvVars) { [System.Environment]::SetEnvironmentVariable($v, $null) }

    Write-Log "Logging in via Managed Identity..."
    Connect-AzAccount -Identity -AccountId $script:uamiClientId -Tenant $targetTenantId -Force | Out-Null
    Connect-MgGraph -Identity -ClientId $script:uamiClientId -ContextScope Process -NoWelcome | Out-Null
}
else {
    Write-Log "Logging in via App Registration..."
    $appClientId     = Get-AutomationVariable -Name "AppClientId"     -ErrorAction Stop
    $appClientSecret = Get-AutomationVariable -Name "AppClientSecret" -ErrorAction Stop
    $secureSecret = ConvertTo-SecureString $appClientSecret -AsPlainText -Force
    $cred         = New-Object System.Management.Automation.PSCredential($appClientId, $secureSecret)

    Connect-AzAccount -ServicePrincipal -Credential $cred -Tenant $targetTenantId -Force | Out-Null
    Connect-MgGraph -ClientSecretCredential $cred -TenantId $targetTenantId -NoWelcome -ContextScope Process | Out-Null
}

$script:StorageAccountNameCache = $storageAccountName

Write-Log "--- Verifying Azure Assessment Data ---"

# We read the master assessment report from Blob
$reportPath = "assessments/report-data.json"
Write-Log "Downloading $reportPath..."
$reportData = Download-JsonBlob -BlobPath $reportPath -Container $containerName

if (-not $reportData) {
    Write-Log "Could not read $reportPath from storage container $containerName. Exiting." "ERROR"
    exit
}

if (-not $reportData.TenantInfo) {
    Write-Log "Report data does not contain a TenantInfo section. Exiting." "ERROR"
    exit
}

$missingLog = @()
$dateString = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$dataUpdated = $false

# Identify target fallback endpoints to check if data is completely empty/missing
$endpointsToCheck = @(
    @{
        Key      = "ConfigWindowsEnrollment"
        Endpoint = "https://graph.microsoft.com/beta/policies/mobileDeviceManagementPolicies"
        Method   = "GET"
    },
    @{
        Key      = "DeviceEnrollmentRestriction"
        Endpoint = "https://graph.microsoft.com/beta/deviceManagement/deviceEnrollmentConfigurations"
        Method   = "GET"
    },
    @{
        Key      = "DeviceCompliancePolicies"
        Endpoint = "https://graph.microsoft.com/beta/deviceManagement/deviceCompliancePolicies"
        Method   = "GET"
    },
    @{
        Key      = "DeviceAppProtectionPolicies"
        Endpoint = "https://graph.microsoft.com/beta/deviceAppManagement/managedAppPolicies"
        Method   = "GET"
    }
)

foreach ($item in $endpointsToCheck) {
    $propName = $item.Key
    $endpoint = $item.Endpoint

    # Check if data exists in the report
    $existingData = $null
    if ($reportData.TenantInfo.PSObject.Properties.Match($propName).Count -gt 0) {
        $existingData = $reportData.TenantInfo.$propName
    }

    $isEmpty = $false
    if ($null -eq $existingData) {
        $isEmpty = $true
    } elseif ($existingData -is [System.Collections.IEnumerable] -and $existingData.Count -eq 0) {
        $isEmpty = $true
    }

    if ($isEmpty) {
        Write-Log "Data missing for '$propName'. Preparing to fetch via app-only auth endpoint..." "WARN"
        try {
            Write-Log " -> Calling GET $endpoint"
            $resp = Invoke-MgGraphRequest -Uri $endpoint -Method GET -ErrorAction Stop
            
            # Check if valid data came back
            if ($resp.value -and $resp.value.Count -gt 0) {
                Write-Log " -> Successfully retrieved data! Populating $propName..."
                if ($reportData.TenantInfo.PSObject.Properties.Match($propName).Count -eq 0) {
                    $reportData.TenantInfo | Add-Member -MemberType NoteProperty -Name $propName -Value $resp.value
                } else {
                    $reportData.TenantInfo.$propName = $resp.value
                }
                $dataUpdated = $true
            } else {
                Write-Log " -> API call succeeded but returned empty data." "WARN"
                $missingLog += [ordered]@{
                    Timestamp = $dateString
                    Component = $propName
                    Endpoint  = $endpoint
                    Error     = "API returned successful HTTP response but empty data array."
                    Severity  = "INFO"
                }
            }
        }
        catch {
            $msg = $_.Exception.Message
            Write-Log " -> Call failed: $msg" "ERROR"
            $missingLog += [ordered]@{
                Timestamp = $dateString
                Component = $propName
                Endpoint  = $endpoint
                Error     = $msg
                Severity  = "ERROR"
            }
        }
    } else {
        Write-Log "Data exists for '$propName'. Skipping to avoid overwriting successful pulls."
    }
}

# Process the missing endpoints tracking
if ($missingLog.Count -gt 0) {
    Write-Log "--- Saving Missing Endpoints Report to /verification/logs ---"
    
    $missingReportPath = "assessments/verification/logs/$today/missing-endpoints.json"
    $missingReportData = [ordered]@{
        RunDate = $today
        Timestamp = $dateString
        MissingEndpoints = $missingLog
    }
    
    # Check if there is an existing log for today and merge to avoid overwriting previous failures
    $existingLog = Download-JsonBlob -BlobPath $missingReportPath -Container $containerName
    if ($existingLog -and $existingLog.MissingEndpoints) {
        Write-Log "Merging with existing missing-endpoints log for today."
        $mergedArr = @($existingLog.MissingEndpoints) + @($missingReportData.MissingEndpoints)
        $missingReportData.MissingEndpoints = $mergedArr
    }

    Upload-JsonBlob -BlobPath $missingReportPath -Data $missingReportData -Container $containerName
    Write-Log "Missing endpoints report uploaded successfully."
} else {
    Write-Log "No missing endpoint errors encountered during app-only sync."
}

# Update the main assessment data if changes were made
if ($dataUpdated) {
    Write-Log "--- Uploading Updated Report Data ---"
    Upload-JsonBlob -BlobPath $reportPath -Data $reportData -Container $containerName
    Write-Log "Successfully updated $reportPath with appended data."
} else {
    Write-Log "No new data was appended. $reportPath remains unchanged."
}

Write-Log "=== Runbook Complete ==="
