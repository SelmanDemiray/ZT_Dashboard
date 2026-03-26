param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"


function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","DEBUG")]
        [string]$Level = "INFO"
    )
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$ts][$Level] $Message"
}


$today      = (Get-Date).ToString("yyyy-MM-dd")
$dateString = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$script:ErrorLog = [System.Collections.ArrayList]::new()


# ─── Hybrid Worker Environment Setup ──────────────────────────────────────────
$standardPaths = @(
    "C:\ProgramData\ZtModules",
    "C:\Program Files\PowerShell\Modules",
    "C:\Program Files\WindowsPowerShell\Modules"
)
foreach ($sp in $standardPaths) {
    if ((Test-Path $sp) -and ($env:PSModulePath -notmatch [regex]::Escape($sp))) {
        $env:PSModulePath = "$sp;$env:PSModulePath"
    }
}


# ─── Module Validation ────────────────────────────────────────────────────────
$requiredModules = @("Az.Accounts", "Az.ResourceGraph")
foreach ($mod in $requiredModules) {
    if (-not (Get-Module -Name $mod -ListAvailable)) {
        Write-Log "Required module '$mod' not found. Attempting import..." "WARN"
        Import-Module $mod -ErrorAction SilentlyContinue
    } else {
        Import-Module $mod -ErrorAction SilentlyContinue
    }
}


# ─── Storage Token / Blob Helpers ─────────────────────────────────────────────
$script:StorageBearerToken      = $null
$script:StorageTokenExpiry      = [int64]0
$script:StorageAccountNameCache = $null


function Get-StorageAccessToken {
    if (-not [string]::IsNullOrWhiteSpace($script:uamiClientId)) {
        $uri = "http://169.254.169.254/metadata/identity/oauth2/token" +
               "?api-version=2018-02-01" +
               "&resource=$([uri]::EscapeDataString('https://storage.azure.com/'))" +
               "&client_id=$([uri]::EscapeDataString($script:uamiClientId))"

        $oldProxy = [System.Net.WebRequest]::DefaultWebProxy
        [System.Net.WebRequest]::DefaultWebProxy = $null
        try {
            if ($PSVersionTable.PSVersion.Major -ge 6) {
                $t = Invoke-RestMethod -Method GET -Uri $uri -Headers @{ Metadata = "true" } `
                         -TimeoutSec 15 -NoProxy -ErrorAction Stop
            } else {
                $t = Invoke-RestMethod -Method GET -Uri $uri -Headers @{ Metadata = "true" } `
                         -TimeoutSec 15 -ErrorAction Stop
            }
        } finally {
            [System.Net.WebRequest]::DefaultWebProxy = $oldProxy
        }
        return @{ access_token = [string]$t.access_token; expires_on = [string]$t.expires_on }
    }
    else {
        $secTok   = Get-AzAccessToken -ResourceUrl "https://storage.azure.com/" -AsSecureString -ErrorAction Stop
        $plain    = [System.Net.NetworkCredential]::new('', $secTok.Token).Password
        $expEpoch = $secTok.ExpiresOn.ToUnixTimeSeconds().ToString()
        return @{ access_token = $plain; expires_on = $expEpoch }
    }
}


function Ensure-StorageTokenFresh {
    $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ([string]::IsNullOrWhiteSpace($script:StorageBearerToken) -or
        ($nowEpoch + 300) -ge $script:StorageTokenExpiry) {
        Write-Log "Refreshing storage Bearer token..."
        $t = Get-StorageAccessToken
        $script:StorageBearerToken = [string]$t.access_token
        $script:StorageTokenExpiry = [int64]$t.expires_on
        Write-Log "Storage token refreshed."
    }
}


function Download-JsonBlob {
    param(
        [Parameter(Mandatory)][string]$BlobPath,
        [Parameter(Mandatory)][string]$Container
    )
    if ([string]::IsNullOrWhiteSpace($script:StorageAccountNameCache)) {
        throw "StorageAccountNameCache not set."
    }
    Ensure-StorageTokenFresh

    $uri = "https://$($script:StorageAccountNameCache).blob.core.windows.net/$Container/$BlobPath"
    $headers = [ordered]@{
        Authorization  = "Bearer $script:StorageBearerToken"
        "x-ms-version" = "2020-04-08"
        "x-ms-date"    = [DateTime]::UtcNow.ToString("R")
    }

    try {
        $response = Invoke-RestMethod -Method GET -Uri $uri -Headers $headers -TimeoutSec 120 -ErrorAction Stop
        Write-Log " [DOWNLOAD OK] $BlobPath"
        return $response
    }
    catch {
        $sc = $null; try { $sc = [int]$_.Exception.Response.StatusCode } catch {}
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
    if ([string]::IsNullOrWhiteSpace($script:StorageAccountNameCache)) {
        throw "StorageAccountNameCache not set."
    }
    Ensure-StorageTokenFresh

    try {
        $json  = $Data | ConvertTo-Json -Depth 20 -Compress
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)

        $uri = "https://$($script:StorageAccountNameCache).blob.core.windows.net/$Container/$BlobPath"
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
        $sc = $null; try { $sc = [int]$_.Exception.Response.StatusCode } catch {}
        Write-Log " [UPLOAD FAIL] $BlobPath (HTTP $sc) -- $($_.Exception.Message)" "ERROR"
        throw "Storage write failed (HTTP $sc): $($_.Exception.Message)"
    }
}


function Ensure-AzSessionFresh {
    param([int]$RefreshIfExpiringInMinutes = 10)
    try {
        $tok      = Get-AzAccessToken -ResourceUrl "https://management.azure.com/" -ErrorAction Stop
        $minsLeft = ($tok.ExpiresOn.UtcDateTime - (Get-Date).ToUniversalTime()).TotalMinutes
        if ($minsLeft -le $RefreshIfExpiringInMinutes) {
            Write-Log "Az token expiring soon ($([math]::Round($minsLeft,1)) min) -- reconnecting..." "WARN"
            Connect-AzAccount -Identity -AccountId $script:uamiClientId -Tenant $targetTenantId -Force | Out-Null
        }
    }
    catch {
        Write-Log "Could not validate Az session -- forcing reconnect: $_" "WARN"
        Connect-AzAccount -Identity -AccountId $script:uamiClientId -Tenant $targetTenantId -Force | Out-Null
    }
}


function Invoke-WithRetry {
    param(
        [Parameter(Mandatory=$true)]
        [scriptblock]$Action,
        [int]$MaxRetries = 5,
        [int]$BaseSleep = 15
    )
    $attempt = 1
    while ($true) {
        try {
            return & $Action
        } catch {
            $msg = $_.Exception.Message
            # Safe 429 detection — guard against null Response and StatusCode access failures
            $is429 = $false
            if ($msg -match '429|Too Many Requests') { $is429 = $true }
            try {
                if (-not $is429 -and $null -ne $_.Exception.Response) {
                    $sc = $null
                    try { $sc = [int]$_.Exception.Response.StatusCode } catch {}
                    if ($sc -eq 429) { $is429 = $true }
                }
            } catch { <# ignore StatusCode access failures #> }

            if ($is429) {
                if ($attempt -ge $MaxRetries) { throw }
                
                $sleepSecs = $attempt * $BaseSleep
                # Safe Retry-After header access — HttpResponseHeaders is NOT a hashtable
                try {
                    if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.Headers) {
                        $retryAfterHeader = $null
                        try { $retryAfterHeader = $_.Exception.Response.Headers.RetryAfter } catch {}
                        if ($null -ne $retryAfterHeader -and $null -ne $retryAfterHeader.Delta) {
                            $retryAfter = [int]$retryAfterHeader.Delta.TotalSeconds
                            if ($retryAfter -gt 0 -and $retryAfter -lt 300) { $sleepSecs = $retryAfter + 5 }
                        }
                    }
                } catch { <# ignore header parse errors entirely #> }

                Write-Log "  [WARN] Rate limit (429) hit. Retrying in $sleepSecs seconds... (Attempt $attempt/$MaxRetries)" "WARN"
                Start-Sleep -Seconds $sleepSecs
                $attempt++
            } else {
                throw
            }
        }
    }
}


# ─── Safe ARG display-name extractor ──────────────────────────────────────────
# FIX #4: ARG returns properties.displayName as a JToken/dynamic type.
# Calling .ToString() on a null JToken throws; use this helper everywhere.
function Get-SafeDisplayName {
    param([object]$Value)
    if ($null -eq $Value -or $Value -is [System.DBNull]) { return $null }
    $s = $Value.ToString().Trim()
    if ([string]::IsNullOrWhiteSpace($s)) { return $null }
    return $s
}


# ─── Auth Initialization ───────────────────────────────────────────────────────
Write-Log "--- Initialization & Auth ---"
$authMethod = Get-AutomationVariable -Name "AuthMethod" -ErrorAction SilentlyContinue
if (-not $authMethod) { $authMethod = "ManagedIdentity" }

try {
    $script:StorageAccountNameCache = Get-AutomationVariable -Name "StorageAccountName" -ErrorAction Stop
    $containerName                  = Get-AutomationVariable -Name "BlobContainerName"  -ErrorAction Stop
    $targetTenantId                 = Get-AutomationVariable -Name "TargetTenantId"     -ErrorAction Stop
}
catch {
    Write-Log "Required Automation Variables (Storage/TargetTenant) are missing: $_" "ERROR"
    throw
}

$script:uamiClientId = $null

$msiEnvVars = @('IDENTITY_ENDPOINT','IDENTITY_HEADER','MSI_ENDPOINT','MSI_SECRET')
foreach ($v in $msiEnvVars) { [System.Environment]::SetEnvironmentVariable($v, $null) }

try { Disable-AzContextAutosave -Scope Process | Out-Null }           catch {}
try { Disconnect-AzAccount -Scope Process -ErrorAction SilentlyContinue | Out-Null } catch {}
try { Clear-AzContext -Scope Process      -Force -ErrorAction SilentlyContinue }     catch {}
try { Clear-AzContext -Scope CurrentUser  -Force -ErrorAction SilentlyContinue }     catch {}

if ($authMethod -eq 'ManagedIdentity') {
    $script:uamiClientId = Get-AutomationVariable -Name "UserAssignedManagedIdentityClientId" -ErrorAction Stop
    Write-Log "Logging in via Managed Identity (UAMI: $script:uamiClientId)..."
    Connect-AzAccount  -Identity -AccountId $script:uamiClientId -Tenant $targetTenantId -Force | Out-Null
    Connect-MgGraph    -Identity -ClientId  $script:uamiClientId -ContextScope Process -NoWelcome | Out-Null
}
else {
    Write-Log "Logging in via App Registration..."
    $appClientId     = Get-AutomationVariable -Name "AppClientId"     -ErrorAction Stop
    $appClientSecret = Get-AutomationVariable -Name "AppClientSecret" -ErrorAction Stop
    $secureSecret    = ConvertTo-SecureString $appClientSecret -AsPlainText -Force
    $cred            = New-Object System.Management.Automation.PSCredential($appClientId, $secureSecret)
    Connect-AzAccount -ServicePrincipal -Credential $cred -Tenant $targetTenantId -Force | Out-Null
    Connect-MgGraph   -ClientSecretCredential $cred -TenantId $targetTenantId -NoWelcome -ContextScope Process | Out-Null
}

try   { Ensure-AzSessionFresh }
catch { Write-Log "Connect-AzAccount validation failed: $_" "ERROR"; throw }


# ───────────────────────────────────────────────────────────────────────────────
# PART 1: VERIFY ZT ASSESSMENT DATA (Graph App-Only Data Fixes)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 1: Verifying Azure Assessment Data Missing Endpoints ---"

$reportPath = "assessments/report-data.json"
Write-Log "Downloading $reportPath..."
$reportData = Download-JsonBlob -BlobPath $reportPath -Container $containerName

if (-not $reportData -or -not $reportData.TenantInfo) {
    Write-Log "Report data missing or invalid format. Generating new skeleton report-data.json..." "WARN"
    
    $userCount = 0; $guestCount = 0; $groupCount = 0; $appCount = 0; $devCount = 0
    try {
        $uResp  = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/users?`$count=true" -Method GET -Headers @{ConsistencyLevel="eventual"} -ErrorAction SilentlyContinue
        if ($null -ne $uResp."@odata.count") { $userCount = [int]$uResp."@odata.count" }
        
        $gResp  = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/users?`$filter=userType eq 'Guest'&`$count=true" -Method GET -Headers @{ConsistencyLevel="eventual"} -ErrorAction SilentlyContinue
        if ($null -ne $gResp."@odata.count") { $guestCount = [int]$gResp."@odata.count" }
        
        $grResp = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/groups?`$count=true" -Method GET -Headers @{ConsistencyLevel="eventual"} -ErrorAction SilentlyContinue
        if ($null -ne $grResp."@odata.count") { $groupCount = [int]$grResp."@odata.count" }
        
        $aResp  = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/applications?`$count=true" -Method GET -Headers @{ConsistencyLevel="eventual"} -ErrorAction SilentlyContinue
        if ($null -ne $aResp."@odata.count") { $appCount = [int]$aResp."@odata.count" }
        
        $dResp  = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/devices?`$count=true" -Method GET -Headers @{ConsistencyLevel="eventual"} -ErrorAction SilentlyContinue
        if ($null -ne $dResp."@odata.count") { $devCount = [int]$dResp."@odata.count" }
    } catch {
        Write-Log "  [WARN] Graph API /v1.0 counts queried failed: $($_.Exception.Message)" "WARN"
    }

    $tenantOverview = [ordered]@{
        UserCount          = $userCount
        GuestCount         = $guestCount
        GroupCount         = $groupCount
        ApplicationCount   = $appCount
        DeviceCount        = $devCount
        ManagedDeviceCount = 0
    }

    $tInfo = [PSCustomObject]@{
        TenantOverview          = $tenantOverview
        DeviceOverview          = $null
        ConfigWindowsEnrollment = @()
        DeviceEnrollmentRestriction = @()
        DeviceCompliancePolicies = @()
        DeviceAppProtectionPolicies = @()
    }

    $reportData = [PSCustomObject]@{
        ExecutedAt        = (Get-Date).ToString("o")
        TenantId          = $targetTenantId
        TenantName        = "Verified Tenant"
        Domain            = ""
        Account           = ""
        CurrentVersion    = "1.0"
        LatestVersion     = "1.0"
        Tests             = @()
        TenantInfo        = $tInfo
        TestResultSummary = [ordered]@{
            StoragePassed=0;       StorageTotal=0;
            VmsContainersPassed=0; VmsContainersTotal=0;
            NetworksPassed=0;      NetworksTotal=0;
            FinOpsPassed=0;        FinOpsTotal=0;
        }
        EndOfJson         = "EndOfJson"
    }
    $dataUpdated = $true
}
else {
    $dataUpdated = $false
}

$missingLog  = @()


    $endpointsToCheck = @(
        @{ Key = "ConfigWindowsEnrollment";        Endpoint = "https://graph.microsoft.com/beta/policies/mobileDeviceManagementPolicies" },
        @{ Key = "DeviceEnrollmentRestriction";    Endpoint = "https://graph.microsoft.com/beta/deviceManagement/deviceEnrollmentConfigurations" },
        @{ Key = "DeviceCompliancePolicies";       Endpoint = "https://graph.microsoft.com/beta/deviceManagement/deviceCompliancePolicies" },
        @{ Key = "DeviceAppProtectionPolicies";    Endpoint = "https://graph.microsoft.com/beta/deviceAppManagement/managedAppPolicies" }
    )

    foreach ($item in $endpointsToCheck) {
        $propName = $item.Key
        $endpoint = $item.Endpoint

        $existingData = $null
        if ($reportData.TenantInfo.PSObject.Properties.Match($propName).Count -gt 0) {
            $existingData = $reportData.TenantInfo.$propName
        }

        $isEmpty = $false
        if ($null -eq $existingData) {
            $isEmpty = $true
        } elseif ($existingData -is [string] -and [string]::IsNullOrWhiteSpace($existingData)) {
            $isEmpty = $true
        } elseif ($existingData -is [System.Array] -or $existingData -is [System.Collections.ICollection]) {
            if ($existingData.Count -eq 0) { $isEmpty = $true }
        } elseif ($existingData -is [System.Management.Automation.PSCustomObject]) {
            if (@($existingData.PSObject.Properties).Count -eq 0) { $isEmpty = $true }
        } elseif ([string]::IsNullOrWhiteSpace($existingData.ToString())) {
            $isEmpty = $true
        }

        if ($isEmpty) {
            Write-Log "Data missing for '$propName'. Fetching via app-only Graph..." "WARN"
            try {
                $resp = Invoke-MgGraphRequest -Uri $endpoint -Method GET -ErrorAction Stop

                if ($resp.value -and $resp.value.Count -gt 0) {
                    Write-Log " -> Retrieved $($resp.value.Count) record(s). Populating '$propName'..."
                    if ($reportData.TenantInfo.PSObject.Properties.Match($propName).Count -eq 0) {
                        $reportData.TenantInfo | Add-Member -MemberType NoteProperty -Name $propName -Value $resp.value
                    } else {
                        $reportData.TenantInfo.$propName = $resp.value
                    }
                    $dataUpdated = $true
                } else {
                    Write-Log " -> API succeeded but returned empty data for '$propName'." "WARN"
                    $missingLog += [ordered]@{
                        Timestamp = $dateString; Component = $propName; Endpoint = $endpoint
                        Error     = "API returned successful HTTP response but empty data array."
                    }
                }
            }
            catch {
                $msg = $_.Exception.Message
                if ($msg -match '401|403|Unauthorized|Forbidden') {
                    Write-Log " -> Expected App-Only permission restriction for '$propName'. Skipping safely." "INFO"
                } else {
                    Write-Log " -> Call failed for '$propName': $msg" "WARN"
                    $missingLog += [ordered]@{ Timestamp = $dateString; Component = $propName; Endpoint = $endpoint; Error = $msg }
                }
            }
        } else {
            Write-Log "Data exists for '$propName'. Skipping."
        }
    }

    if ($missingLog.Count -gt 0) {
        Write-Log "Saving missing-endpoints report..."
        $missingReportPath = "assessments/verification/logs/$today/missing-endpoints.json"
        $missingReportData = [ordered]@{ RunDate = $today; Timestamp = $dateString; MissingEndpoints = $missingLog }

        $existingLog = Download-JsonBlob -BlobPath $missingReportPath -Container $containerName
        if ($existingLog -and $existingLog.MissingEndpoints) {
            $missingReportData.MissingEndpoints = @($existingLog.MissingEndpoints) + @($missingReportData.MissingEndpoints)
        }
        Upload-JsonBlob -BlobPath $missingReportPath -Data $missingReportData -Container $containerName
    }

    if ($dataUpdated) {
        Write-Log "Uploading updated report-data.json..."
        Upload-JsonBlob -BlobPath $reportPath -Data $reportData -Container $containerName
        Write-Log "Successfully updated $reportPath."
    }


# ───────────────────────────────────────────────────────────────────────────────
# PART 2: UPDATE POLICY NAMES MAPPING (ARM REST API)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 2: Updating Policy Names Mapping ---"

Write-Log "Discovering Azure subscriptions..."
try {
    Ensure-AzSessionFresh
    $allSubs = @(Get-AzSubscription -TenantId $targetTenantId -ErrorAction Stop |
                 Where-Object { $_.State -eq 'Enabled' })
    Write-Log "Found $($allSubs.Count) enabled subscription(s)."
}
catch {
    Write-Log "Failed to list subscriptions for tenant '$targetTenantId': $_" "ERROR"
    throw
}

$subIds = @($allSubs | Select-Object -ExpandProperty Id)

$mapping = [ordered]@{ policies = @{}; policySets = @{} }

try {
    Ensure-AzSessionFresh
    $secTok = Get-AzAccessToken -ResourceUrl "https://management.azure.com/" -AsSecureString -ErrorAction Stop
    $armTok = [System.Net.NetworkCredential]::new('', $secTok.Token).Password
    $headers = @{ Authorization = "Bearer $armTok" }

    function Fetch-ArmPolicies {
        param([string]$Uri, [string]$Type)
        try {
            $nextLink = $Uri
            while ($nextLink) {
                $resp = Invoke-RestMethod -Uri $nextLink -Headers $headers -Method GET -TimeoutSec 60 -ErrorAction Stop
                foreach ($item in $resp.value) {
                    $dn = Get-SafeDisplayName $item.properties.displayName
                    if ($null -ne $dn) {
                        if ($Type -eq 'policy') {
                            $mapping.policies[$item.name.ToLower()] = $dn
                            $mapping.policies[$item.id.ToLower()]   = $dn
                        } else {
                            $mapping.policySets[$item.name.ToLower()] = $dn
                            $mapping.policySets[$item.id.ToLower()]   = $dn
                        }
                    }
                }
                $nextLink = $null
                try { $nextLink = $resp.nextLink } catch {}
            }
        } catch {
            Write-Log "  [WARN] Failed to fetch REST API policies from $Uri : $($_.Exception.Message)" "WARN"
        }
    }

    Write-Log "Fetching Built-in Policy Definitions..."
    Fetch-ArmPolicies "https://management.azure.com/providers/Microsoft.Authorization/policyDefinitions?api-version=2021-06-01" 'policy'
    Write-Log "Fetching Built-in Policy Set Definitions..."
    Fetch-ArmPolicies "https://management.azure.com/providers/Microsoft.Authorization/policySetDefinitions?api-version=2021-06-01" 'set'

    foreach ($sub in $allSubs) {
        Write-Log "Fetching Custom Policies for subscription $($sub.Id)..."
        Fetch-ArmPolicies "https://management.azure.com/subscriptions/$($sub.Id)/providers/Microsoft.Authorization/policyDefinitions?api-version=2021-06-01" 'policy'
        Fetch-ArmPolicies "https://management.azure.com/subscriptions/$($sub.Id)/providers/Microsoft.Authorization/policySetDefinitions?api-version=2021-06-01" 'set'
    }

    $mgResp = Invoke-RestMethod -Uri "https://management.azure.com/providers/Microsoft.Management/managementGroups?api-version=2020-05-01" -Headers $headers -Method GET -ErrorAction SilentlyContinue
    if ($mgResp -and $mgResp.value) {
        foreach ($mg in $mgResp.value) {
            Fetch-ArmPolicies "https://management.azure.com/providers/Microsoft.Management/managementGroups/$($mg.name)/providers/Microsoft.Authorization/policyDefinitions?api-version=2021-06-01" 'policy'
            Fetch-ArmPolicies "https://management.azure.com/providers/Microsoft.Management/managementGroups/$($mg.name)/providers/Microsoft.Authorization/policySetDefinitions?api-version=2021-06-01" 'set'
        }
    }

    Write-Log "ARM REST API: mapped $($mapping.policies.Keys.Count) Policies and $($mapping.policySets.Keys.Count) Policy Sets."
}
catch {
    Write-Log "Failed to execute ARM REST API policy fetch: $_" "WARN"
}

# ── Build flat mapping ─────────────────────────────────────────────────────────
$flatMapping = [ordered]@{}
foreach ($key in $mapping.policies.Keys)    { $flatMapping[$key] = $mapping.policies[$key] }
foreach ($key in $mapping.policySets.Keys)  { $flatMapping[$key] = $mapping.policySets[$key] }

# ── Diagnostic verification before upload ─────────────────────────────────────
Write-Log "--- Diagnostic: flat mapping entry count = $($flatMapping.Keys.Count) ---"
if ($flatMapping.Keys.Count -eq 0) {
    Write-Log "WARNING: flatMapping is EMPTY. All frontend lookups will fall back to raw IDs." "WARN"
} else {
    $sampleKeys = @($flatMapping.Keys | Select-Object -First 5)
    foreach ($k in $sampleKeys) {
        Write-Log "  SAMPLE  '$k'  =>  '$($flatMapping[$k])'"
    }
}

$finalData = [ordered]@{
    lastUpdated = (Get-Date).ToString("o")
    mapping     = $flatMapping
}

$blobMapPath = "assessments/$targetTenantId/policy-mapping.json"
Write-Log "Uploading policy mapping --> container='$containerName'  path='$blobMapPath'"

try {
    Upload-JsonBlob -BlobPath $blobMapPath -Data $finalData -Container $containerName
    Write-Log "Policy mapping uploaded successfully ($($flatMapping.Keys.Count) entries)."
}
catch {
    Write-Log "Failed to upload policy mapping: $_" "ERROR"
    throw
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 3: STORAGE ACCOUNTS DATA COLLECTION (ARG)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 3: Collecting Storage Accounts Data ---"

try {
    Ensure-AzSessionFresh
    
    $storageQuery = @"
Resources
| where type =~ 'microsoft.storage/storageaccounts'
| extend tlsVersion = tostring(properties.minimumTlsVersion),
         publicNetworkAccess = tostring(properties.publicNetworkAccess),
         supportsHttpsTrafficOnly = tobool(properties.supportsHttpsTrafficOnly),
         networkAclsDefaultAction = tostring(properties.networkAcls.defaultAction),
         accountKind = tostring(kind),
         tier = tostring(sku.tier),
         redundancy = tostring(sku.name),
         accessTier = tostring(properties.accessTier),
         isEncrypted = tobool(properties.encryption.services.blob.enabled),
         createdDate = tostring(properties.creationTime)
| project id, name, resourceGroup, subscriptionId, location, tlsVersion, publicNetworkAccess, supportsHttpsTrafficOnly, networkAclsDefaultAction, accountKind, tier, redundancy, accessTier, isEncrypted, createdDate, tags
"@

    $saRows      = @()
    $saSkipToken = $null
    do {
        $saParams = @{
            Query        = $storageQuery
            First        = 1000
            Subscription = $subIds
            ErrorAction  = 'Stop'
        }
        if ($saSkipToken) { $saParams['SkipToken'] = $saSkipToken }

        $saResults = Search-AzGraph @saParams
        $saPage    = @(if ($saResults.PSObject.Properties.Name -contains 'Data') { $saResults.Data } else { $saResults })
        $saRows   += $saPage
        $saSkipToken = if ($saResults.PSObject.Properties.Name -contains 'SkipToken') { $saResults.SkipToken } else { $null }
    } while ($saSkipToken)

    Write-Log "ARG: found $($saRows.Count) Storage Accounts across $($subIds.Count) subscriptions."

    # Group by subscription and upload
    $saBySub = $saRows | Group-Object -Property subscriptionId
    
    # Process subscriptions that HAVE storage accounts
    $processedSubs = @()
    foreach ($group in $saBySub) {
        $subId = $group.Name
        if ([string]::IsNullOrWhiteSpace($subId)) { continue }
        $processedSubs += $subId.ToLower()
        
        $accounts = @()
        foreach ($row in $group.Group) {
            # ── Real metrics via Azure Monitor REST API ──
            $blobCap = 0; $fileCap = 0; $tableCap = 0; $queueCap = 0
            $txn30d = 0; $egressGB = 0; $ingressGB = 0
            try {
                $metricEnd   = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
                $metricStart = [DateTime]::UtcNow.AddDays(-28).ToString("yyyy-MM-ddTHH:mm:ssZ")
                # DO NOT uri-escape — ISO timestamps are already safe for query strings
                $tsUri       = "$metricStart/$metricEnd"

                $secToken    = Get-AzAccessToken -ResourceUrl "https://management.azure.com" -AsSecureString -ErrorAction Stop
                $armToken    = [System.Net.NetworkCredential]::new('', $secToken.Token).Password

                # Blob capacity (latest value)
                $capUri = "https://management.azure.com$($row.id)/blobServices/default/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=BlobCapacity&timespan=$tsUri&interval=P1D&aggregation=Average"
                $capResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $capUri -Headers @{Authorization="Bearer $armToken"} -Method GET -TimeoutSec 30 -ErrorAction Stop }
                if ($capResp.value -and $capResp.value[0].timeseries -and $capResp.value[0].timeseries[0].data) {
                    $lastVal = ($capResp.value[0].timeseries[0].data | Where-Object { $null -ne $_.average } | Select-Object -Last 1).average
                    if ($lastVal) { $blobCap = [math]::Round($lastVal / 1GB, 2) }
                }

                # Transactions (sum over 28d)
                $txnUri = "https://management.azure.com$($row.id)/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=Transactions&timespan=$tsUri&interval=P1D&aggregation=Total"
                $txnResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $txnUri -Headers @{Authorization="Bearer $armToken"} -Method GET -TimeoutSec 30 -ErrorAction Stop }
                if ($txnResp.value -and $txnResp.value[0].timeseries -and $txnResp.value[0].timeseries[0].data) {
                    $txn30d = ($txnResp.value[0].timeseries[0].data | ForEach-Object { $_.total } | Measure-Object -Sum).Sum
                    if ($null -eq $txn30d) { $txn30d = 0 }
                }

                # Egress (sum over 28d)
                $egUri = "https://management.azure.com$($row.id)/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=Egress&timespan=$tsUri&interval=P1D&aggregation=Total"
                $egResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $egUri -Headers @{Authorization="Bearer $armToken"} -Method GET -TimeoutSec 30 -ErrorAction Stop }
                if ($egResp.value -and $egResp.value[0].timeseries -and $egResp.value[0].timeseries[0].data) {
                    $egTotal = ($egResp.value[0].timeseries[0].data | ForEach-Object { $_.total } | Measure-Object -Sum).Sum
                    if ($egTotal) { $egressGB = [math]::Round($egTotal / 1GB, 2) }
                }

                # Ingress (sum over 28d)
                $igUri = "https://management.azure.com$($row.id)/providers/Microsoft.Insights/metrics?api-version=2018-01-01&metricnames=Ingress&timespan=$tsUri&interval=P1D&aggregation=Total"
                $igResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $igUri -Headers @{Authorization="Bearer $armToken"} -Method GET -TimeoutSec 30 -ErrorAction Stop }
                if ($igResp.value -and $igResp.value[0].timeseries -and $igResp.value[0].timeseries[0].data) {
                    $igTotal = ($igResp.value[0].timeseries[0].data | ForEach-Object { $_.total } | Measure-Object -Sum).Sum
                    if ($igTotal) { $ingressGB = [math]::Round($igTotal / 1GB, 2) }
                }
            }
            catch {
                Write-Log "  [WARN] Metrics fetch failed for $($row.name): $($_.Exception.Message)" "WARN"
            }

            $accounts += [ordered]@{
                id = $row.id
                name = $row.name
                subscriptionId = $row.subscriptionId
                subscriptionName = ($allSubs | Where-Object { $_.Id -eq $row.subscriptionId } | Select-Object -First 1).Name
                resourceGroup = $row.resourceGroup
                region = $row.location
                location = $row.location
                kind = $row.accountKind
                tier = $row.tier
                redundancy = $row.redundancy
                accessTier = if ([string]::IsNullOrEmpty($row.accessTier)) { 'Hot' } else { $row.accessTier }
                encryption = $row.isEncrypted
                httpsOnly = $row.supportsHttpsTrafficOnly
                blobCapacityGB = $blobCap
                fileCapacityGB = $fileCap
                tableCapacityGB = $tableCap
                queueCapacityGB = $queueCap
                monthlyCostUSD = 0
                transactions30d = [int64]$txn30d
                egressGB30d = $egressGB
                ingressGB30d = $ingressGB
                createdDate = $row.createdDate
                tags = if ($null -ne $row.tags) { $row.tags } else { @{} }
                tlsVersion = $row.tlsVersion
                publicNetworkAccess = $row.publicNetworkAccess
                supportsHttpsTrafficOnly = $row.supportsHttpsTrafficOnly
                networkAclsDefaultAction = $row.networkAclsDefaultAction
            }
        }
        
        $saData = [ordered]@{ runDate = $today; accounts = $accounts }
        
        $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
        $blobLatestPath = "assessments/$targetTenantId/$subId/latest"
        
        Upload-JsonBlob -BlobPath "$blobBasePath/storage-accounts.json"   -Data $saData -Container $containerName
        Upload-JsonBlob -BlobPath "$blobLatestPath/storage-accounts.json" -Data $saData -Container $containerName
    }
    
    # Process subscriptions that HAVE NO storage accounts (upload empty lists so UI clears old data)
    foreach ($subId in $subIds) {
        if ($processedSubs -notcontains $subId.ToLower()) {
            $saData = [ordered]@{ runDate = $today; accounts = @() }
            $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
            $blobLatestPath = "assessments/$targetTenantId/$subId/latest"
            
            try {
                Upload-JsonBlob -BlobPath "$blobBasePath/storage-accounts.json"   -Data $saData -Container $containerName
                Upload-JsonBlob -BlobPath "$blobLatestPath/storage-accounts.json" -Data $saData -Container $containerName
            } catch {}
        }
    }

}
catch {
    Write-Log "Failed to collect storage accounts: $_" "ERROR"
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 3b: POLICY COMPLIANCE DATA COLLECTION (Azure Policy)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 3b: Collecting Policy Compliance Data ---"
try {
    Ensure-AzSessionFresh
    $secTok = Get-AzAccessToken -ResourceUrl "https://management.azure.com/" -AsSecureString -ErrorAction Stop
    $armTok = [System.Net.NetworkCredential]::new('', $secTok.Token).Password
    $policyHeaders = @{ Authorization = "Bearer $armTok" }

    foreach ($subId in $subIds) {
        if ([string]::IsNullOrWhiteSpace($subId)) { continue }
        $subName = ($allSubs | Where-Object { $_.Id -eq $subId } | Select-Object -First 1).Name
        if (-not $subName) { $subName = "Subscription $($subId.Substring(0,8))" }

        $initiatives = @()
        try {
            # Get policy assignments for the subscription
            $assignUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Authorization/policyAssignments?api-version=2022-06-01"
            $assignResp = Invoke-RestMethod -Uri $assignUri -Headers $policyHeaders -Method GET -TimeoutSec 60 -ErrorAction Stop

            foreach ($assign in $assignResp.value) {
                $assignProps = $assign.properties
                $defId = $assignProps.policyDefinitionId
                $isInitiative = ($defId -match 'policySetDefinitions')

                # Get compliance state for this assignment
                $stateUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.PolicyInsights/policyStates/latest/summarize?api-version=2019-10-01&`$filter=policyAssignmentId eq '$($assign.id)'"
                $compliantCount = 0; $nonCompliantCount = 0; $exemptCount = 0; $totalPolicies = 1
                $resources = @()

                try {
                    Start-Sleep -Milliseconds 500
                    $stateResp = Invoke-RestMethod -Uri $stateUri -Headers $policyHeaders -Method POST -TimeoutSec 30 -ErrorAction Stop
                    if ($stateResp.value -and $stateResp.value.Count -gt 0) {
                        $summary = $stateResp.value[0].results
                        $totalResources = 0
                        if ($null -ne $summary) {
                            foreach ($qr in $summary.queryResultsTable.rows) {
                                # rows contain [complianceState, count]
                            }
                            # Use resourceDetails instead
                            $compliantCount = 0; $nonCompliantCount = 0
                            if ($summary.PSObject.Properties.Match('nonCompliantResources').Count -gt 0) {
                                $nonCompliantCount = [int]$summary.nonCompliantResources
                            }
                            if ($summary.PSObject.Properties.Match('compliantResources').Count -gt 0) {
                                $compliantCount = [int]$summary.compliantResources
                            }
                        }
                        if ($isInitiative -and $stateResp.value[0].PSObject.Properties.Match('policyDefinitions').Count -gt 0) {
                            $totalPolicies = @($stateResp.value[0].policyDefinitions).Count
                            if ($totalPolicies -eq 0) { $totalPolicies = 1 }
                        }
                    }
                } catch {
                    Write-Log "  [WARN] Policy state query failed for assignment $($assign.name): $($_.Exception.Message)" "WARN"
                }

                # Look up display name from mapping
                $displayName = $assignProps.displayName
                if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = $assign.name }

                $initiatives += [ordered]@{
                    id               = $assign.name
                    name             = $displayName
                    type             = if ($isInitiative) { 'builtin' } else { 'custom' }
                    assignmentId     = $assign.id
                    subscriptionId   = $subId
                    compliantCount   = $compliantCount
                    nonCompliantCount = $nonCompliantCount
                    exemptCount      = $exemptCount
                    totalPolicies    = $totalPolicies
                    resources        = $resources
                }
            }
        } catch {
            Write-Log "  [WARN] Policy assignments fetch failed for sub $subId : $($_.Exception.Message)" "WARN"
        }

        $policyData = [ordered]@{
            runDate     = $today
            initiatives = $initiatives
        }

        $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
        $blobLatestPath = "assessments/$targetTenantId/$subId/latest"
        Upload-JsonBlob -BlobPath "$blobBasePath/policy-compliance.json"   -Data $policyData -Container $containerName
        Upload-JsonBlob -BlobPath "$blobLatestPath/policy-compliance.json" -Data $policyData -Container $containerName
        Write-Log "Policy compliance uploaded for sub $subId ($($initiatives.Count) assignments)."
    }
} catch {
    Write-Log "Failed to collect policy compliance data: $_" "ERROR"
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 3c: ZERO TRUST POSTURE SCORE (Computed from Defender + Policy data)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 3c: Computing Zero Trust Posture Scores ---"
try {
    Ensure-AzSessionFresh
    $secTok = Get-AzAccessToken -ResourceUrl "https://management.azure.com/" -AsSecureString -ErrorAction Stop
    $armTok = [System.Net.NetworkCredential]::new('', $secTok.Token).Password

    foreach ($subId in $subIds) {
        if ([string]::IsNullOrWhiteSpace($subId)) { continue }
        $subName = ($allSubs | Where-Object { $_.Id -eq $subId } | Select-Object -First 1).Name

        # Get Secure Score from Microsoft Defender for Cloud
        $pillars = @()
        $checks = @()
        $overallScore = 0
        try {
            $ssUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Security/secureScores?api-version=2020-01-01"
            $ssResp = Invoke-RestMethod -Uri $ssUri -Headers @{Authorization="Bearer $armTok"} -Method GET -TimeoutSec 30 -ErrorAction Stop

            if ($ssResp.value -and $ssResp.value.Count -gt 0) {
                $ss = $ssResp.value[0].properties
                $currentScore = 0; $maxScore = 0
                try { $currentScore = [double]$ss.score.current } catch {}
                try { $maxScore = [double]$ss.score.max } catch {}
                $overallScore = if ($maxScore -gt 0) { [math]::Round(($currentScore / $maxScore) * 100, 1) } else { 0 }
            }

            # Get Secure Score controls for pillar breakdown
            $ctrlUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Security/secureScores/ascScore/secureScoreControls?api-version=2020-01-01&`$expand=definition"
            $ctrlResp = Invoke-RestMethod -Uri $ctrlUri -Headers @{Authorization="Bearer $armTok"} -Method GET -TimeoutSec 30 -ErrorAction Stop

            if ($ctrlResp.value) {
                # Group controls into ZT pillars
                $pillarMap = @{
                    'Identity'    = @('Manage access and permissions', 'Enable MFA', 'Secure management ports', 'Apply adaptive application control', 'Enable endpoint protection')
                    'Devices'     = @('Apply system updates', 'Remediate vulnerabilities', 'Enable endpoint protection', 'Install endpoint protection')
                    'Network'     = @('Restrict unauthorized network access', 'Protect applications against DDoS attacks', 'Enable endpoint protection')
                    'Data'        = @('Apply data classification', 'Encrypt data in transit', 'Enable auditing and logging')
                    'Applications' = @('Remediate security configurations', 'Apply adaptive application control')
                    'Infrastructure' = @('Remediate vulnerabilities', 'Apply system updates', 'Remediate security configurations')
                }
                $pillarScores = @{}
                foreach ($pillar in $pillarMap.Keys) {
                    $pillarScores[$pillar] = @{ passed = 0; total = 0; score = 0 }
                }

                foreach ($ctrl in $ctrlResp.value) {
                    $ctrlProps = $ctrl.properties
                    $ctrlName = ''
                    try { $ctrlName = $ctrlProps.displayName } catch {}
                    if ([string]::IsNullOrWhiteSpace($ctrlName)) {
                        try { $ctrlName = $ctrl.name } catch { $ctrlName = 'Unknown' }
                    }
                    $healthy = 0; $unhealthy = 0; $notApplicable = 0
                    try { $healthy = [int]$ctrlProps.healthyResourceCount } catch {}
                    try { $unhealthy = [int]$ctrlProps.unhealthyResourceCount } catch {}
                    try { $notApplicable = [int]$ctrlProps.notApplicableResourceCount } catch {}
                    $total = $healthy + $unhealthy

                    # Determine status
                    $status = if ($unhealthy -eq 0 -and $total -gt 0) { 'passed' }
                              elseif ($unhealthy -gt 0) { 'failed' }
                              else { 'notApplicable' }

                    $ctrlScore = 0
                    try { $ctrlScore = [double]$ctrlProps.score.current } catch {}
                    $ctrlMaxScore = 0
                    try { $ctrlMaxScore = [double]$ctrlProps.score.max } catch {}

                    # Assign to ZT pillars
                    $assignedPillar = 'Infrastructure'
                    foreach ($pillar in $pillarMap.Keys) {
                        foreach ($keyword in $pillarMap[$pillar]) {
                            if ($ctrlName -match [regex]::Escape($keyword)) {
                                $assignedPillar = $pillar
                                break
                            }
                        }
                    }

                    if (-not $pillarScores.ContainsKey($assignedPillar)) {
                        $pillarScores[$assignedPillar] = @{ passed = 0; total = 0; score = 0 }
                    }
                    $pillarScores[$assignedPillar].total++
                    if ($status -eq 'passed') { $pillarScores[$assignedPillar].passed++ }

                    $checks += [ordered]@{
                        id          = $ctrl.name
                        name        = $ctrlName
                        pillar      = $assignedPillar
                        area        = $assignedPillar
                        status      = $status
                        risk        = if ($unhealthy -gt 5) { 'high' } elseif ($unhealthy -gt 0) { 'medium' } else { 'low' }
                        description = "$ctrlName - $healthy healthy, $unhealthy unhealthy resources"
                        remediation = ''
                        learnMoreUrl = ''
                        score       = $ctrlScore
                        weight      = $ctrlMaxScore
                    }
                }

                foreach ($pillar in $pillarScores.Keys) {
                    $ps = $pillarScores[$pillar]
                    $pScore = if ($ps.total -gt 0) { [math]::Round(($ps.passed / $ps.total) * 100, 1) } else { 0 }
                    $pillars += [ordered]@{
                        name        = $pillar
                        score       = $pScore
                        totalChecks = $ps.total
                        passed      = $ps.passed
                        failed      = $ps.total - $ps.passed
                    }
                }
            }
        } catch {
            Write-Log "  [WARN] Secure score fetch failed for sub $subId : $($_.Exception.Message)" "WARN"
        }

        $ztData = [ordered]@{
            tenantId    = $targetTenantId
            tenantName  = if ($subName) { $subName } else { 'Tenant' }
            runDate     = $today
            overallScore = $overallScore
            pillars     = $pillars
            checks      = $checks
        }

        $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
        $blobLatestPath = "assessments/$targetTenantId/$subId/latest"
        Upload-JsonBlob -BlobPath "$blobBasePath/zero-trust.json"   -Data $ztData -Container $containerName
        Upload-JsonBlob -BlobPath "$blobLatestPath/zero-trust.json" -Data $ztData -Container $containerName
        Write-Log "Zero Trust scores uploaded for sub $subId (overall: $overallScore%, $($pillars.Count) pillars, $($checks.Count) checks)."
    }
} catch {
    Write-Log "Failed to compute Zero Trust posture: $_" "ERROR"
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 3d: GOVERNANCE ASSIGNMENTS COLLECTION
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 3d: Collecting Governance Data ---"
try {
    Ensure-AzSessionFresh
    $secTok = Get-AzAccessToken -ResourceUrl "https://management.azure.com/" -AsSecureString -ErrorAction Stop
    $armTok = [System.Net.NetworkCredential]::new('', $secTok.Token).Password

    foreach ($subId in $subIds) {
        if ([string]::IsNullOrWhiteSpace($subId)) { continue }

        $govRules = @()
        try {
            # Try governance rules API (Defender for Cloud)
            $govUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Security/governanceRules?api-version=2022-01-01-preview"
            $govResp = Invoke-RestMethod -Uri $govUri -Headers @{Authorization="Bearer $armTok"} -Method GET -TimeoutSec 30 -ErrorAction SilentlyContinue

            if ($govResp.value) {
                foreach ($rule in $govResp.value) {
                    $rProps = $rule.properties
                    $ownerEmail = ''
                    $owner = ''
                    try {
                        if ($rProps.ownerSource) {
                            $owner = if ($rProps.ownerSource.value) { $rProps.ownerSource.value } else { 'Unassigned' }
                        }
                    } catch { $owner = 'Unassigned' }

                    $dueDate = ''
                    try {
                        if ($rProps.remediationTimeframe) { $dueDate = $rProps.remediationTimeframe }
                    } catch {}

                    $govRules += [ordered]@{
                        id                       = $rule.name
                        name                     = if ($rProps.displayName) { $rProps.displayName } else { $rule.name }
                        owner                    = $owner
                        ownerEmail               = $ownerEmail
                        dueDate                  = $dueDate
                        subscriptionId           = $subId
                        status                   = 'inProgress'
                        completionPercentage     = 0
                        linkedRecommendationIds  = @()
                        linkedPolicyIds          = @()
                        description              = if ($rProps.description) { $rProps.description } else { '' }
                        completionCriteria       = @()
                    }
                }
            }
        } catch {
            Write-Log "  [WARN] Governance rules fetch failed for sub $subId : $($_.Exception.Message)" "WARN"
        }

        $govData = [ordered]@{
            runDate = $today
            rules   = $govRules
        }

        $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
        $blobLatestPath = "assessments/$targetTenantId/$subId/latest"
        Upload-JsonBlob -BlobPath "$blobBasePath/governance.json"   -Data $govData -Container $containerName
        Upload-JsonBlob -BlobPath "$blobLatestPath/governance.json" -Data $govData -Container $containerName
        Write-Log "Governance data uploaded for sub $subId ($($govRules.Count) rules)."
    }
} catch {
    Write-Log "Failed to collect governance data: $_" "ERROR"
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 4: FINOPS DATA COLLECTION (Real Azure Cost Management + Advisor)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 4: Collecting FinOps / Cost Data ---"

foreach ($subId in $subIds) {
    if ([string]::IsNullOrWhiteSpace($subId)) { continue }

    try {
        Ensure-AzSessionFresh
        Set-AzContext -SubscriptionId $subId -ErrorAction SilentlyContinue | Out-Null
        $secTok  = Get-AzAccessToken -ResourceUrl "https://management.azure.com" -AsSecureString -ErrorAction Stop
        $armTok  = [System.Net.NetworkCredential]::new('', $secTok.Token).Password
        $hdrs    = @{ Authorization = "Bearer $armTok"; "Content-Type" = "application/json" }

        $subName = ($allSubs | Where-Object { $_.Id -eq $subId } | Select-Object -First 1).Name
        if (-not $subName) { $subName = "Subscription $($subId.Substring(0,8))" }

        # ── Service costs: current month by ServiceName ──
        $serviceCosts  = @()
        $cmUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.CostManagement/query?api-version=2023-11-01"
        $curMonthStart = (Get-Date -Day 1).ToString("yyyy-MM-dd")
        $curMonthEnd   = (Get-Date).ToString("yyyy-MM-dd")
        $prevMonthStart = (Get-Date -Day 1).AddMonths(-1).ToString("yyyy-MM-dd")
        $prevMonthEnd   = ((Get-Date -Day 1).AddDays(-1)).ToString("yyyy-MM-dd")

        $colors = @('#3b82f6','#8b5cf6','#06b6d4','#f97316','#22c55e','#ec4899','#eab308','#14b8a6')
        $colorIdx = 0

        # Current month
        $cmBody = @{
            type = "ActualCost"
            timeframe = "Custom"
            timePeriod = @{ from = $curMonthStart; to = $curMonthEnd }
            dataset = @{
                granularity = "None"
                aggregation = @{ totalCost = @{ name = "Cost"; function = "Sum" } }
                grouping = @(@{ type = "Dimension"; name = "ServiceName" })
            }
        } | ConvertTo-Json -Depth 10

        $curCosts = @{}
        try {
            Start-Sleep -Seconds 5
            $cmResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $cmUri -Headers $hdrs -Method POST -Body $cmBody -TimeoutSec 60 -ErrorAction Stop }
            foreach ($row in $cmResp.properties.rows) {
                $svcName = $row[1]
                $cost    = [math]::Round($row[0], 2)
                if ($cost -gt 0) { $curCosts[$svcName] = $cost }
            }
            Write-Log "  Cost Management: $($curCosts.Count) services with costs this month."
        }
        catch {
            Write-Log "  [WARN] Cost Management current-month query failed: $($_.Exception.Message)" "WARN"
        }

        # Previous month
        $prevCosts = @{}
        try {
            Start-Sleep -Seconds 5
            $pmBody = @{
                type = "ActualCost"
                timeframe = "Custom"
                timePeriod = @{ from = $prevMonthStart; to = $prevMonthEnd }
                dataset = @{
                    granularity = "None"
                    aggregation = @{ totalCost = @{ name = "Cost"; function = "Sum" } }
                    grouping = @(@{ type = "Dimension"; name = "ServiceName" })
                }
            } | ConvertTo-Json -Depth 10
            $pmResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $cmUri -Headers $hdrs -Method POST -Body $pmBody -TimeoutSec 60 -ErrorAction Stop }
            foreach ($row in $pmResp.properties.rows) {
                $prevCosts[$row[1]] = [math]::Round($row[0], 2)
            }
        }
        catch {
            Write-Log "  [WARN] Cost Management previous-month query failed: $($_.Exception.Message)" "WARN"
        }

        foreach ($svc in ($curCosts.Keys | Sort-Object { $curCosts[$_] } -Descending | Select-Object -First 15)) {
            $cur  = $curCosts[$svc]
            $prev = if ($prevCosts.ContainsKey($svc)) { $prevCosts[$svc] } else { 0 }
            $trend = if ($prev -gt 0) { [math]::Round((($cur - $prev) / $prev) * 100, 1) } else { 0 }
            $serviceCosts += @{
                service       = $svc
                currentMonth  = $cur
                previousMonth = $prev
                trend         = $trend
                color         = $colors[$colorIdx % $colors.Count]
            }
            $colorIdx++
        }

        $totalCur  = ($curCosts.Values  | Measure-Object -Sum).Sum
        $totalPrev = ($prevCosts.Values | Measure-Object -Sum).Sum

        # ── Budget & Forecast ──
        $daysInMonth = [DateTime]::DaysInMonth((Get-Date).Year, (Get-Date).Month)
        $dayToday = (Get-Date).Day
        $subForecast = if ($dayToday -gt 0) { [math]::Round(($totalCur / $dayToday) * $daysInMonth, 2) } else { $totalCur }
        $subBudget = if ($totalPrev -gt 0) { $totalPrev } else { $totalCur }

        # ── Daily cost data (current month) ──
        $dailyCostData = @()
        try {
            Start-Sleep -Seconds 5
            $dBody = @{
                type = "ActualCost"
                timeframe = "Custom"
                timePeriod = @{ from = $curMonthStart; to = $curMonthEnd }
                dataset = @{
                    granularity = "Daily"
                    aggregation = @{ totalCost = @{ name = "Cost"; function = "Sum" } }
                }
            } | ConvertTo-Json -Depth 10
            $dResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $cmUri -Headers $hdrs -Method POST -Body $dBody -TimeoutSec 60 -ErrorAction Stop }
            foreach ($row in $dResp.properties.rows) {
                $rowStr = $row[1].ToString()
                $pDate = $null
                try {
                    if ($rowStr -match '^\d{8}$') { $pDate = [datetime]::ParseExact($rowStr, 'yyyyMMdd', $null) }
                    elseif ($rowStr -match '^\d{6}$') { $pDate = [datetime]::ParseExact($rowStr, 'yyyyMM', $null) }
                    else { $pDate = [datetime]::Parse($rowStr.Split('T')[0].Split(' ')[0]) }
                } catch { $pDate = Get-Date }
                $dailyCostData += @{
                    date   = $pDate.ToString("MMM dd")
                    cost   = [math]::Round($row[0], 2)
                    budget = [math]::Round(($subBudget / $daysInMonth), 2)
                }
            }
        }
        catch {
            Write-Log "  [WARN] Daily cost query failed: $($_.Exception.Message)" "WARN"
        }

        # ── Weekly cost data (from daily) ──
        $weeklyCostData = @()
        try {
            $startIndex = 0
            while ($startIndex -lt $dailyCostData.Count) {
                $endIndex = [math]::Min($startIndex + 6, $dailyCostData.Count - 1)
                $group = $dailyCostData[$startIndex..$endIndex]
                $wCost = ($group | Measure-Object -Property cost -Sum).Sum
                $firstDate = $group[0].date
                $lastDate  = $group[-1].date
                $weeklyCostData += @{
                    week   = "$firstDate - $lastDate"
                    actual = [math]::Round($wCost, 2)
                    budget = [math]::Round(($subBudget / 4.3), 2)
                }
                $startIndex += 7
            }
        } catch { }

        # ── Cost Anomalies (from daily) ──
        $costAnomalies = @()
        try {
            for ($i = 7; $i -lt $dailyCostData.Count; $i++) {
                $recentAvg = ($dailyCostData[($i-7)..($i-1)] | Measure-Object -Property cost -Average).Average
                $dayCost = $dailyCostData[$i].cost
                if ($recentAvg -gt 10 -and $dayCost -gt ($recentAvg * 1.5)) {
                    $sev = if ($dayCost -gt ($recentAvg * 2)) { "high" } else { "medium" }
                    $costAnomalies += @{
                        id           = [guid]::NewGuid().ToString()
                        service      = "Subscription Aggregate Spike"
                        date         = $dailyCostData[$i].date
                        expectedCost = [math]::Round($recentAvg, 2)
                        actualCost   = $dayCost
                        explanation  = "Daily spend spiked to `$$dayCost, exceeding the 7-day average of `$$([math]::Round($recentAvg, 2))."
                        severity     = $sev
                    }
                }
            }
        } catch { }

        # ── Monthly cost data (last 6 months) ──
        $monthlyCostData = @()
        try {
            Start-Sleep -Seconds 5
            $sixMonthsAgo = (Get-Date -Day 1).AddMonths(-5).ToString("yyyy-MM-dd")
            $mBody = @{
                type = "ActualCost"
                timeframe = "Custom"
                timePeriod = @{ from = $sixMonthsAgo; to = $curMonthEnd }
                dataset = @{
                    granularity = "Monthly"
                    aggregation = @{ totalCost = @{ name = "Cost"; function = "Sum" } }
                }
            } | ConvertTo-Json -Depth 10
            $mResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $cmUri -Headers $hdrs -Method POST -Body $mBody -TimeoutSec 60 -ErrorAction Stop }
            foreach ($row in $mResp.properties.rows) {
                $rowStr = $row[1].ToString()
                $monthDate = $null
                try {
                    if ($rowStr -match '^\d{8}$') { $monthDate = [datetime]::ParseExact($rowStr, 'yyyyMMdd', $null) }
                    elseif ($rowStr -match '^\d{6}$') { $monthDate = [datetime]::ParseExact($rowStr, 'yyyyMM', $null) }
                    else { $monthDate = [datetime]::Parse($rowStr.Split('T')[0].Split(' ')[0]) }
                } catch { $monthDate = Get-Date -Day 1 }
                $monthlyCostData += @{
                    month    = $monthDate.ToString("MMM yyyy")
                    actual   = [math]::Round($row[0], 2)
                    budget   = [math]::Round($subBudget, 2)
                    forecast = if ($monthDate.Month -eq (Get-Date).Month) { [math]::Round($subForecast, 2) } else { [math]::Round($row[0], 2) }
                }
            }
        }
        catch {
            Write-Log "  [WARN] Monthly cost query failed: $($_.Exception.Message)" "WARN"
        }

        # ── Team Costs (by Resource Group) ──
        $teamCosts = @()
        try {
            Start-Sleep -Seconds 5
            $rgBody = @{
                type = "ActualCost"
                timeframe = "Custom"
                timePeriod = @{ from = $curMonthStart; to = $curMonthEnd }
                dataset = @{
                    granularity = "None"
                    aggregation = @{ totalCost = @{ name = "Cost"; function = "Sum" } }
                    grouping = @(@{ type = "Dimension"; name = "ResourceGroupName" }, @{ type = "Dimension"; name = "MeterCategory" })
                }
            } | ConvertTo-Json -Depth 10
            $rgResp = Invoke-WithRetry -Action { Invoke-RestMethod -Uri $cmUri -Headers $hdrs -Method POST -Body $rgBody -TimeoutSec 60 -ErrorAction Stop }
            
            $rgMap = @{}
            foreach ($row in $rgResp.properties.rows) {
                $rgName = $row[1]; $meter = $row[2]; $cost = [double]$row[0]
                if ([string]::IsNullOrWhiteSpace($rgName)) { $rgName = "Unassigned" }
                if (-not $rgMap.ContainsKey($rgName)) {
                    $rgMap[$rgName] = @{ team = $rgName; compute = 0; storage = 0; networking = 0; databases = 0; other = 0; total = 0 }
                }
                $rgMap[$rgName].total += $cost
                if ($meter -match 'Compute|Virtual Machines') { $rgMap[$rgName].compute += $cost }
                elseif ($meter -match 'Storage') { $rgMap[$rgName].storage += $cost }
                elseif ($meter -match 'Network|Bandwidth') { $rgMap[$rgName].networking += $cost }
                elseif ($meter -match 'SQL|Database|Cosmos') { $rgMap[$rgName].databases += $cost }
                else { $rgMap[$rgName].other += $cost }
            }
            
            # Form array and pick top 15 RGs
            $teamCosts = @($rgMap.Values) | Sort-Object total -Descending | Select-Object -First 15
            foreach ($t in $teamCosts) {
                $t.compute = [math]::Round($t.compute, 2)
                $t.storage = [math]::Round($t.storage, 2)
                $t.networking = [math]::Round($t.networking, 2)
                $t.databases = [math]::Round($t.databases, 2)
                $t.other = [math]::Round($t.other, 2)
            }
        } catch {
            Write-Log "  [WARN] Team costs (RG) query failed: $($_.Exception.Message)" "WARN"
        }

        # ── Savings recommendations from Azure Advisor ──
        $savingsRecs = @()
        try {
            $advUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Advisor/recommendations?api-version=2023-01-01&`$filter=Category eq 'Cost'"
            $advResp = Invoke-RestMethod -Uri $advUri -Headers $hdrs -Method GET -TimeoutSec 30 -ErrorAction Stop
            $advItems = @($advResp.value)
            Write-Log "  Advisor: $($advItems.Count) cost recommendation(s)."
            foreach ($adv in $advItems) {
                $props = $adv.properties
                $savings = 0
                $savings = 0
                try { $savings = [math]::Round([double]$props.extendedProperties.savingsAmount, 2) } catch {}
                $savingsRecs += @{
                    id                  = $adv.name
                    title               = if ($props.shortDescription.solution) { $props.shortDescription.solution } else { $adv.name }
                    description         = if ($props.shortDescription.problem) { $props.shortDescription.problem } else { "" }
                    estimatedSavingsUSD = $savings
                    effort              = switch ($props.impact) { "High" { "Low" } "Medium" { "Medium" } "Low" { "High" } default { "Medium" } }
                    category            = if ($props.category) { $props.category } else { "Cost" }
                    resourceCount       = 1
                }
            }
        }
        catch {
            Write-Log "  [WARN] Advisor cost recommendations failed: $($_.Exception.Message)" "WARN"
        }

        $finopsData = [ordered]@{
            runDate                = $today
            serviceCosts           = $serviceCosts
            subscriptionCosts      = @(@{
                subscriptionId   = $subId
                subscriptionName = $subName
                currentMonth     = [math]::Round($totalCur, 2)
                budget           = [math]::Round($subBudget, 2)
                forecast         = [math]::Round($subForecast, 2)
            })
            teamCosts              = $teamCosts
            dailyCostData          = $dailyCostData
            weeklyCostData         = $weeklyCostData
            monthlyCostData        = $monthlyCostData
            costAnomalies          = $costAnomalies
            savingsRecommendations = $savingsRecs
        }

        $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
        $blobLatestPath = "assessments/$targetTenantId/$subId/latest"

        Upload-JsonBlob -BlobPath "$blobBasePath/finops.json"   -Data $finopsData -Container $containerName
        Upload-JsonBlob -BlobPath "$blobLatestPath/finops.json" -Data $finopsData -Container $containerName

        Write-Log "FinOps data uploaded for subscription $subId ($($serviceCosts.Count) services, $($savingsRecs.Count) savings recs)."
    }
    catch {
        Write-Log "Failed to collect/upload FinOps data for sub $subId : $_" "WARN"
    }
}
# ───────────────────────────────────────────────────────────────────────────────
# PART 5: VMs & CONTAINERS DATA COLLECTION (ARG)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 5: Collecting VMs & Containers Data ---"

try {
    Ensure-AzSessionFresh

    # ── Virtual Machines ──
    $vmQuery = @"
Resources
| where type =~ 'microsoft.compute/virtualmachines'
| extend powerState = tostring(properties.extended.instanceView.powerState.code),
         vmSize = tostring(properties.hardwareProfile.vmSize),
         osType = tostring(properties.storageProfile.osDisk.osType),
         osOffer = tostring(properties.storageProfile.imageReference.offer),
         osSku = tostring(properties.storageProfile.imageReference.sku),
         diskGB = toint(properties.storageProfile.osDisk.diskSizeGB),
         publicIpId = tostring(properties.networkProfile.networkInterfaces[0].id)
| project id, name, resourceGroup, subscriptionId, location,
          vmSize, osType, osOffer, osSku, powerState, diskGB, tags
"@

    $vmRows = @(); $vmSkip = $null
    do {
        $vmP = @{ Query = $vmQuery; First = 1000; Subscription = $subIds; ErrorAction = 'Stop' }
        if ($vmSkip) { $vmP['SkipToken'] = $vmSkip }
        $vmR = Search-AzGraph @vmP
        $vmRows += @(if ($vmR.PSObject.Properties.Name -contains 'Data') { $vmR.Data } else { $vmR })
        $vmSkip = if ($vmR.PSObject.Properties.Name -contains 'SkipToken') { $vmR.SkipToken } else { $null }
    } while ($vmSkip)

    Write-Log "ARG: found $($vmRows.Count) VMs."

    # ── AKS Clusters ──
    $aksQuery = @"
Resources
| where type =~ 'microsoft.containerservice/managedclusters'
| extend k8sVersion = tostring(properties.kubernetesVersion),
         nodeCount = toint(properties.agentPoolProfiles[0].count),
         powerState = tostring(properties.powerState.code),
         tier = tostring(sku.tier),
         networkPlugin = tostring(properties.networkProfile.networkPlugin)
| project id, name, resourceGroup, subscriptionId, location,
          k8sVersion, nodeCount, powerState, tier, networkPlugin, tags
"@

    $aksRows = @(); $aksSkip = $null
    do {
        $aksP = @{ Query = $aksQuery; First = 1000; Subscription = $subIds; ErrorAction = 'Stop' }
        if ($aksSkip) { $aksP['SkipToken'] = $aksSkip }
        $aksR = Search-AzGraph @aksP
        $aksRows += @(if ($aksR.PSObject.Properties.Name -contains 'Data') { $aksR.Data } else { $aksR })
        $aksSkip = if ($aksR.PSObject.Properties.Name -contains 'SkipToken') { $aksR.SkipToken } else { $null }
    } while ($aksSkip)

    Write-Log "ARG: found $($aksRows.Count) AKS clusters."

    # Group and upload per subscription
    $vmBySub  = $vmRows  | Group-Object -Property subscriptionId
    $aksBySub = $aksRows | Group-Object -Property subscriptionId

    foreach ($subId in $subIds) {
        $vms = @()
        $vmGroup = $vmBySub | Where-Object { $_.Name -eq $subId }
        if ($vmGroup) {
            foreach ($row in $vmGroup.Group) {
                $status = switch -Wildcard ($row.powerState) {
                    '*running*'      { 'Running' }
                    '*stopped*'      { 'Stopped' }
                    '*deallocated*'  { 'Deallocated' }
                    default          { 'Unknown' }
                }
                $sizeCategory = if ($row.vmSize -match '^Standard_([A-Z]+)') { "$($Matches[1])-Series" } else { 'Other' }
                $osDisplay = if ($row.osOffer) { "$($row.osOffer) $($row.osSku)" } else { $row.osType }

                $vms += [ordered]@{
                    id               = $row.id
                    name             = $row.name
                    subscriptionId   = $row.subscriptionId
                    subscriptionName = ($allSubs | Where-Object { $_.Id -eq $row.subscriptionId } | Select-Object -First 1).Name
                    resourceGroup    = $row.resourceGroup
                    region           = $row.location
                    size             = $row.vmSize
                    sizeCategory     = $sizeCategory
                    os               = $osDisplay
                    osType           = $row.osType
                    status           = $status
                    cpuPct           = 0
                    memoryPct        = 0
                    diskGB           = if ($row.diskGB) { $row.diskGB } else { 0 }
                    monthlyCostUSD   = 0
                    publicIp         = $null
                    tags             = if ($null -ne $row.tags) { $row.tags } else { @{} }
                }
            }
        }

        $clusters = @()
        $aksGroup = $aksBySub | Where-Object { $_.Name -eq $subId }
        if ($aksGroup) {
            foreach ($row in $aksGroup.Group) {
                $health = switch ($row.powerState) {
                    'Running' { 'Healthy' }
                    'Stopped' { 'Warning' }
                    default   { 'Unknown' }
                }
                $clusters += [ordered]@{
                    id               = $row.id
                    name             = $row.name
                    subscriptionId   = $row.subscriptionId
                    subscriptionName = ($allSubs | Where-Object { $_.Id -eq $row.subscriptionId } | Select-Object -First 1).Name
                    resourceGroup    = $row.resourceGroup
                    region           = $row.location
                    version          = $row.k8sVersion
                    nodeCount        = if ($row.nodeCount) { $row.nodeCount } else { 0 }
                    podCount         = 0
                    podCapacity      = 0
                    runningPods      = 0
                    pendingPods      = 0
                    failedPods       = 0
                    succeededPods    = 0
                    cpuUtilPct       = 0
                    memUtilPct       = 0
                    health           = $health
                    monthlyCostUSD   = 0
                    tags             = if ($null -ne $row.tags) { $row.tags } else { @{} }
                }
            }
        }

        $vcData = [ordered]@{
            runDate        = $today
            virtualMachines = $vms
            aksClusters    = $clusters
        }

        $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
        $blobLatestPath = "assessments/$targetTenantId/$subId/latest"

        Upload-JsonBlob -BlobPath "$blobBasePath/vms-containers.json"   -Data $vcData -Container $containerName
        Upload-JsonBlob -BlobPath "$blobLatestPath/vms-containers.json" -Data $vcData -Container $containerName
        Write-Log "VMs & Containers uploaded for sub $subId ($($vms.Count) VMs, $($clusters.Count) AKS)."
    }
}
catch {
    Write-Log "Failed to collect VMs & Containers: $_" "ERROR"
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 6: NETWORKS DATA COLLECTION (ARG)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 6: Collecting Networks Data ---"

try {
    Ensure-AzSessionFresh

    # ── Virtual Networks ──
    $vnetQuery = @"
Resources
| where type =~ 'microsoft.network/virtualnetworks'
| extend addressSpace = tostring(properties.addressSpace.addressPrefixes[0]),
         subnetCount = array_length(properties.subnets),
         ddosProtection = tobool(properties.enableDdosProtection),
         dnsServers = iff(array_length(properties.dhcpOptions.dnsServers) > 0,
                         strcat_array(properties.dhcpOptions.dnsServers, ', '), 'Azure DNS'),
         peerings = properties.virtualNetworkPeerings
| project id, name, resourceGroup, subscriptionId, location,
          addressSpace, subnetCount, ddosProtection, dnsServers, peerings, tags
"@

    $vnetRows = @(); $vnSkip = $null
    do {
        $vnP = @{ Query = $vnetQuery; First = 1000; Subscription = $subIds; ErrorAction = 'Stop' }
        if ($vnSkip) { $vnP['SkipToken'] = $vnSkip }
        $vnR = Search-AzGraph @vnP
        $vnetRows += @(if ($vnR.PSObject.Properties.Name -contains 'Data') { $vnR.Data } else { $vnR })
        $vnSkip = if ($vnR.PSObject.Properties.Name -contains 'SkipToken') { $vnR.SkipToken } else { $null }
    } while ($vnSkip)

    Write-Log "ARG: found $($vnetRows.Count) VNets."

    # ── NSGs ──
    $nsgQuery = @"
Resources
| where type =~ 'microsoft.network/networksecuritygroups'
| extend secRules = properties.securityRules,
         allowRules = array_length(properties.securityRules),
         subnetCount = array_length(properties.subnets),
         nicCount = array_length(properties.networkInterfaces)
| project id, name, resourceGroup, subscriptionId, location,
          allowRules, subnetCount, nicCount, tags
"@

    $nsgRows = @(); $nsgSkip = $null
    do {
        $nsgP = @{ Query = $nsgQuery; First = 1000; Subscription = $subIds; ErrorAction = 'Stop' }
        if ($nsgSkip) { $nsgP['SkipToken'] = $nsgSkip }
        $nsgR = Search-AzGraph @nsgP
        $nsgRows += @(if ($nsgR.PSObject.Properties.Name -contains 'Data') { $nsgR.Data } else { $nsgR })
        $nsgSkip = if ($nsgR.PSObject.Properties.Name -contains 'SkipToken') { $nsgR.SkipToken } else { $null }
    } while ($nsgSkip)

    Write-Log "ARG: found $($nsgRows.Count) NSGs."

    # ── Azure Firewalls ──
    $fwQuery = @"
Resources
| where type =~ 'microsoft.network/azurefirewalls'
| extend tier = tostring(sku.tier),
         fwStatus = tostring(properties.provisioningState),
         threatIntelMode = tostring(properties.threatIntelMode)
| project id, name, resourceGroup, subscriptionId, location,
          tier, fwStatus, threatIntelMode, tags
"@

    $fwRows = @(); $fwSkip = $null
    do {
        $fwP = @{ Query = $fwQuery; First = 1000; Subscription = $subIds; ErrorAction = 'Stop' }
        if ($fwSkip) { $fwP['SkipToken'] = $fwSkip }
        $fwR = Search-AzGraph @fwP
        $fwRows += @(if ($fwR.PSObject.Properties.Name -contains 'Data') { $fwR.Data } else { $fwR })
        $fwSkip = if ($fwR.PSObject.Properties.Name -contains 'SkipToken') { $fwR.SkipToken } else { $null }
    } while ($fwSkip)

    Write-Log "ARG: found $($fwRows.Count) Azure Firewalls."

    # ── Load Balancers ──
    $lbQuery = @"
Resources
| where type =~ 'microsoft.network/loadbalancers'
| extend sku = tostring(sku.name),
         lbType = iff(array_length(properties.frontendIPConfigurations) > 0
                      and isnotnull(properties.frontendIPConfigurations[0].properties.publicIPAddress),
                      'Public', 'Internal'),
         backendPools = array_length(properties.backendAddressPools),
         healthProbes = array_length(properties.probes),
         rules = array_length(properties.loadBalancingRules)
| project id, name, resourceGroup, subscriptionId, location,
          sku, lbType, backendPools, healthProbes, rules, tags
"@

    $lbRows = @(); $lbSkip = $null
    do {
        $lbP = @{ Query = $lbQuery; First = 1000; Subscription = $subIds; ErrorAction = 'Stop' }
        if ($lbSkip) { $lbP['SkipToken'] = $lbSkip }
        $lbR = Search-AzGraph @lbP
        $lbRows += @(if ($lbR.PSObject.Properties.Name -contains 'Data') { $lbR.Data } else { $lbR })
        $lbSkip = if ($lbR.PSObject.Properties.Name -contains 'SkipToken') { $lbR.SkipToken } else { $null }
    } while ($lbSkip)

    Write-Log "ARG: found $($lbRows.Count) Load Balancers."

    # Group and upload per subscription
    $vnetBySub = $vnetRows | Group-Object -Property subscriptionId
    $nsgBySub  = $nsgRows  | Group-Object -Property subscriptionId
    $fwBySub   = $fwRows   | Group-Object -Property subscriptionId
    $lbBySub   = $lbRows   | Group-Object -Property subscriptionId

    foreach ($subId in $subIds) {
        $vnets = @()
        $vg = $vnetBySub | Where-Object { $_.Name -eq $subId }
        if ($vg) {
            foreach ($row in $vg.Group) {
                $vnets += [ordered]@{
                    id              = $row.id
                    name            = $row.name
                    subscriptionId  = $row.subscriptionId
                    subscriptionName = ($allSubs | Where-Object { $_.Id -eq $row.subscriptionId } | Select-Object -First 1).Name
                    resourceGroup   = $row.resourceGroup
                    region          = $row.location
                    addressSpace    = if ($row.addressSpace) { $row.addressSpace } else { '' }
                    subnetCount     = if ($row.subnetCount) { [int]$row.subnetCount } else { 0 }
                    peeredWith      = if ($row.peerings) { @($row.peerings | ForEach-Object { $p = $_.properties.remoteVirtualNetwork.id; if ($p) { ($p -split '/')[-1] } }) } else { @() }
                    dnsServers      = if ($row.dnsServers) { $row.dnsServers } else { 'Azure DNS' }
                    ddosProtection  = [bool]$row.ddosProtection
                    tags            = if ($null -ne $row.tags) { $row.tags } else { @{} }
                }
            }
        }

        $nsgs = @()
        $ng = $nsgBySub | Where-Object { $_.Name -eq $subId }
        if ($ng) {
            foreach ($row in $ng.Group) {
                $highRiskPorts = @()
                $defaultDeny = $false
                if ($row.secRules) {
                    foreach ($rule in $row.secRules) {
                        $props = $rule.properties
                        if ($props.access -eq 'Allow' -and $props.direction -eq 'Inbound') {
                            $ports = @()
                            if ($props.destinationPortRange) { $ports += $props.destinationPortRange }
                            if ($props.destinationPortRanges) { foreach ($p in $props.destinationPortRanges) { $ports += $p } }
                            if ($props.sourceAddressPrefix -in @('*', 'Internet', '0.0.0.0/0')) {
                                foreach ($p in $ports) {
                                    if ($p -match '22|3389|\*') { $highRiskPorts += $p }
                                }
                            }
                        }
                        if ($props.access -eq 'Deny' -and $props.direction -eq 'Inbound' -and ($props.priority -ge 4000 -or $rule.name -match 'DenyAll')) {
                            $defaultDeny = $true
                        }
                    }
                }
                $highRiskPorts = @($highRiskPorts | Select-Object -Unique)

                $nsgs += [ordered]@{
                    id              = $row.id
                    name            = $row.name
                    subscriptionId  = $row.subscriptionId
                    resourceGroup   = $row.resourceGroup
                    region          = $row.location
                    allowRules      = if ($row.allowRules) { [int]$row.allowRules } else { 0 }
                    denyRules       = 0
                    subnetsAttached = if ($row.subnetCount) { [int]$row.subnetCount } else { 0 }
                    nicsAttached    = if ($row.nicCount) { [int]$row.nicCount } else { 0 }
                    highRiskPorts   = $highRiskPorts
                    defaultDeny     = $defaultDeny
                }
            }
        }

        $firewalls = @()
        $fg = $fwBySub | Where-Object { $_.Name -eq $subId }
        if ($fg) {
            foreach ($row in $fg.Group) {
                $firewalls += [ordered]@{
                    id               = $row.id
                    name             = $row.name
                    subscriptionId   = $row.subscriptionId
                    resourceGroup    = $row.resourceGroup
                    region           = $row.location
                    tier             = if ($row.tier) { $row.tier } else { 'Standard' }
                    status           = if ($row.fwStatus -eq 'Succeeded') { 'Running' } else { 'Stopped' }
                    ruleCollections  = 0
                    threatIntelMode  = if ($row.threatIntelMode) { $row.threatIntelMode } else { 'Off' }
                    monthlyCostUSD   = 0
                }
            }
        }

        $lbs = @()
        $lg = $lbBySub | Where-Object { $_.Name -eq $subId }
        if ($lg) {
            foreach ($row in $lg.Group) {
                $lbs += [ordered]@{
                    id            = $row.id
                    name          = $row.name
                    subscriptionId = $row.subscriptionId
                    resourceGroup = $row.resourceGroup
                    region        = $row.location
                    sku           = if ($row.sku) { $row.sku } else { 'Basic' }
                    type          = if ($row.lbType) { $row.lbType } else { 'Internal' }
                    backendPools  = if ($row.backendPools) { [int]$row.backendPools } else { 0 }
                    healthProbes  = if ($row.healthProbes) { [int]$row.healthProbes } else { 0 }
                    rules         = if ($row.rules) { [int]$row.rules } else { 0 }
                }
            }
        }

        $netData = [ordered]@{
            runDate       = $today
            vnets         = $vnets
            nsgs          = $nsgs
            firewalls     = $firewalls
            loadBalancers = $lbs
        }

        $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
        $blobLatestPath = "assessments/$targetTenantId/$subId/latest"

        Upload-JsonBlob -BlobPath "$blobBasePath/networks.json"   -Data $netData -Container $containerName
        Upload-JsonBlob -BlobPath "$blobLatestPath/networks.json" -Data $netData -Container $containerName
        Write-Log "Networks uploaded for sub $subId ($($vnets.Count) VNets, $($nsgs.Count) NSGs, $($firewalls.Count) FWs, $($lbs.Count) LBs)."
    }
}
catch {
    Write-Log "Failed to collect Networks data: $_" "ERROR"
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 5: DEFENDER RECOMMENDATIONS (Patching via ARM REST API)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 5: Verifying Defender Recommendations ---"

try {
    Ensure-AzSessionFresh
    $secTok = Get-AzAccessToken -ResourceUrl "https://management.azure.com/" -AsSecureString -ErrorAction Stop
    $armTok = [System.Net.NetworkCredential]::new('', $secTok.Token).Password

    foreach ($s in $subIds) {
        if ([string]::IsNullOrWhiteSpace($s)) { continue }
        
        $blobLatestPath = "assessments/$targetTenantId/$s/latest/defender-recs.json"
        $blobBasePath   = "assessments/$targetTenantId/$s/$today/defender-recs.json"

        Write-Log "  Collecting Defender recommendations for sub $s via REST API..."
        $apiRecs = @()
        try {
            $apiUrl = "https://management.azure.com/subscriptions/$s/providers/Microsoft.Security/assessments?api-version=2020-01-01"
            $apiResp = Invoke-WithRetry { Invoke-RestMethod -Uri $apiUrl -Headers @{ Authorization = "Bearer $armTok" } -Method GET -TimeoutSec 60 -ErrorAction Stop }
            
            if ($apiResp.value) {
                $unhealthy = @($apiResp.value | Where-Object { $_.properties.status.code -eq 'Unhealthy' })
                Write-Log "  Found $($unhealthy.Count) unhealthy recommendations for sub $s."
                
                $apiGrouped = $unhealthy | Group-Object -Property name
                foreach ($grp in $apiGrouped) {
                    $first = $grp.Group[0]
                    $props = $first.properties
                    $meta = $null; try { $meta = $props.metadata } catch {}
                    $severity = "low"; try { $severity = $meta.severity.ToString().ToLower() } catch {}
                    $category = "Compute"; try { if ($meta.categories.Count -gt 0) { $category = $meta.categories[0] } } catch {}
                    
                    $recName  = if ($props.PSObject.Properties.Match('displayName').Count -gt 0) { $props.displayName } else { $first.name }
                    
                    $affected = @()
                    foreach ($row in $grp.Group) {
                        $resDetails = if ($row.properties.PSObject.Properties.Match('resourceDetails').Count -gt 0) { $row.properties.resourceDetails } else { $null }
                        $resId = if ($resDetails -and $resDetails.PSObject.Properties.Match('Id').Count -gt 0) { $resDetails.Id } else { "" }
                        $resName = if ($resId) { ($resId -split '/')[-1] } else { "Unknown" }
                        $resType = "Unknown"
                        if ($resId -match '/providers/([^/]+/[^/]+)/') { $resType = $Matches[1] }
                        
                        $affected += [ordered]@{
                            id            = $resId
                            name          = $resName
                            type          = $resType
                            resourceGroup = ""
                        }
                    }
                    
                    $hasAttackPathVal = $false
                    try { if ($props.additionalData.hasAttackPaths) { $hasAttackPathVal = [bool]$props.additionalData.hasAttackPaths } } catch {}
                    $remediationVal = ""
                    try { $remediationVal = [string]$meta.remediationDescription } catch {}
                    $learnMoreUrlVal = ""
                    try { $learnMoreUrlVal = [string]$meta.customAssurance } catch {}
                    
                    $apiRecs += [ordered]@{
                        id                     = $first.name
                        name                   = $recName
                        description            = if ($meta -and $meta.PSObject.Properties.Match('description').Count -gt 0) { $meta.description } else { "" }
                        severity               = $severity
                        category               = $category
                        subscriptionId         = $s
                        resourceCount          = $grp.Group.Count
                        hasAttackPath          = $hasAttackPathVal
                        affectedResources      = $affected
                        remediation            = $remediationVal
                        learnMoreUrl           = $learnMoreUrlVal
                        governanceAssignmentId = ""
                    }
                }
            }
        } catch {
            Write-Log "  [WARN] Defender assessments API failed for sub $($s): $($_.Exception.Message)" "WARN"
        }
        
        $defDataObj = [ordered]@{ runDate = $today; recommendations = $apiRecs }
        try {
            Upload-JsonBlob -BlobPath $blobBasePath   -Data $defDataObj -Container $containerName
            Upload-JsonBlob -BlobPath $blobLatestPath -Data $defDataObj -Container $containerName
            Write-Log "Defender recs uploaded for sub $s ($($apiRecs.Count) recs)."
        } catch {
            Write-Log "  [WARN] Failed to upload Defender recs for sub $($s) - $($_.Exception.Message)" "WARN"
        }
    }
}
catch {
    Write-Log "Failed to collect Defender Recommendations data: $_" "ERROR"
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 5b: SYNCHRONIZE TRENDS HISTORY (Copy latest ZT, Policy, Governance)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 5b: Synchronizing Trends History ---"
try {
    foreach ($s in $subIds) {
        if ([string]::IsNullOrWhiteSpace($s)) { continue }
        
        $filesToSync = @("zero-trust.json", "policy-compliance.json", "governance.json")
        foreach ($file in $filesToSync) {
            $latestFile = "assessments/$targetTenantId/$s/latest/$file"
            $todayFile  = "assessments/$targetTenantId/$s/$today/$file"
            
            $data = Download-JsonBlob -BlobPath $latestFile -Container $containerName
            if ($null -ne $data) {
                # Update the runDate to today so trends graphs align perfectly
                if ($data.psobject.properties.match('runDate').Count -gt 0) {
                    $data.runDate = $today
                }
                Upload-JsonBlob -BlobPath $todayFile -Data $data -Container $containerName
            }
        }
    }
} catch {
    Write-Log "Failed to synchronize trends history: $_" "WARN"
}

# ───────────────────────────────────────────────────────────────────────────────
# PART 6: TENANT INDEX (For FinOps & Trends Date Navigation)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 6: Building tenant-index.json ---"
try {
    $tenantIndex = [ordered]@{
        tenants = @(
            [ordered]@{
                id   = $targetTenantId
                name = "Verified Tenant"
                subscriptions = @(
                    $allSubs | ForEach-Object {
                        [ordered]@{
                            id             = $_.Id
                            name           = $_.Name
                            resourceGroups = @()
                            dates          = @($today)
                        }
                    }
                )
            }
        )
    }

    $indexBlobPath = "assessments/tenant-index.json"
    $existingRaw   = Download-JsonBlob -BlobPath $indexBlobPath -Container $containerName

    if ($existingRaw -and $existingRaw.tenants) {
        foreach ($newTenant in $tenantIndex.tenants) {
            $oldTenant = $existingRaw.tenants | Where-Object { $_.id -eq $newTenant.id } | Select-Object -First 1
            if ($oldTenant) {
                # Preserve the original tenant name if available
                if ($oldTenant.name -and $oldTenant.name -ne "Unknown" -and $oldTenant.name -ne "Verified Tenant") {
                    $newTenant.name = $oldTenant.name
                }
                
                foreach ($newSub in $newTenant.subscriptions) {
                    $oldSub = $oldTenant.subscriptions | Where-Object { $_.id -eq $newSub.id } | Select-Object -First 1
                    if ($oldSub -and $oldSub.dates) {
                        $merged = @($oldSub.dates) + @($today) | Sort-Object -Unique | Select-Object -Last 90
                        $newSub.dates = @($merged)
                    }
                }
                $newSubIds  = @($newTenant.subscriptions | ForEach-Object { $_.id })
                $oldSubObjs = @($oldTenant.subscriptions)
                foreach ($oldSub in $oldSubObjs) {
                    if ($newSubIds -notcontains $oldSub.id) {
                        $newTenant.subscriptions += $oldSub
                    }
                }
            }
        }
    }

    Upload-JsonBlob -BlobPath $indexBlobPath -Data $tenantIndex -Container $containerName
    Write-Log "Successfully updated tenant-index.json."

} catch {
    Write-Log "Failed to build tenant-index.json: $_" "ERROR"
}

Write-Log "=== Unified Verification Runbook Complete ==="
