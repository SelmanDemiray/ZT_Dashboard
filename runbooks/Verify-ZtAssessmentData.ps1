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
    Write-Log "Report data missing or invalid format. Skipping Graph App-Only fixes." "WARN"
}
else {
    $missingLog  = @()
    $dataUpdated = $false

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
                Write-Log " -> Call failed for '$propName': $msg" "ERROR"
                $missingLog += [ordered]@{ Timestamp = $dateString; Component = $propName; Endpoint = $endpoint; Error = $msg }
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
}


# ───────────────────────────────────────────────────────────────────────────────
# PART 2: UPDATE POLICY NAMES MAPPING (ARG Policy Metadata Fetch)
# ───────────────────────────────────────────────────────────────────────────────
Write-Log "--- PART 2: Updating Policy Names Mapping ---"

Write-Log "Discovering Azure subscriptions..."
try {
    $allSubs = @(Get-AzSubscription -TenantId $targetTenantId -ErrorAction Stop |
                 Where-Object { $_.State -eq 'Enabled' })
    Write-Log "Found $($allSubs.Count) enabled subscription(s)."
}
catch {
    Write-Log "Failed to list subscriptions for tenant '$targetTenantId': $_" "ERROR"
    throw
}

# FIX #1: Collect subscription IDs for ARG scope — without this ARG returns
# incomplete or zero results without throwing, causing silent lookup failures.
$subIds = @($allSubs | Select-Object -ExpandProperty Id)

$mapping = [ordered]@{ policies = @{}; policySets = @{} }


# ── Policy Definitions via ARG ─────────────────────────────────────────────────
Write-Log "Fetching Policy Definitions via Azure Resource Graph..."
try {
    Ensure-AzSessionFresh
    $policyRows = @()
    $pSkipToken = $null
    do {
        $pParams = @{
            Query        = "policyresources | where type =~ 'microsoft.authorization/policydefinitions' | project id, name, displayName = properties.displayName"
            First        = 1000
            Subscription = $subIds      # FIX #1 applied
            ErrorAction  = 'Stop'
        }
        if ($pSkipToken) { $pParams['SkipToken'] = $pSkipToken }

        $pResults   = Search-AzGraph @pParams
        $pPage      = @(if ($pResults.PSObject.Properties.Name -contains 'Data') { $pResults.Data } else { $pResults })
        $policyRows += $pPage
        $pSkipToken = if ($pResults.PSObject.Properties.Name -contains 'SkipToken') { $pResults.SkipToken } else { $null }
    } while ($pSkipToken)

    foreach ($pol in $policyRows) {
        # FIX #4: safe null-guard on JToken displayName before ToString()
        $displayName = Get-SafeDisplayName $pol.displayName
        if ($null -ne $displayName) {
            $mapping.policies[$pol.name.ToString().ToLower()] = $displayName
            $mapping.policies[$pol.id.ToString().ToLower()]   = $displayName
        }
    }
    Write-Log "ARG: mapped $($mapping.policies.Keys.Count) Policy Definition entries."
}
catch {
    Write-Log "ARG policy query failed -- falling back to Get-AzPolicyDefinition: $_" "WARN"
    foreach ($sub in $allSubs) {
        try {
            Set-AzContext -SubscriptionId $sub.Id -ErrorAction SilentlyContinue | Out-Null
            $policies = @(Get-AzPolicyDefinition -ErrorAction SilentlyContinue)
            foreach ($pol in $policies) {
                $dn = Get-SafeDisplayName $pol.Properties.DisplayName
                if ($null -ne $dn) {
                    $mapping.policies[$pol.Name.ToLower()]       = $dn
                    $mapping.policies[$pol.ResourceId.ToLower()] = $dn
                }
            }
        } catch {}
    }
}


# ── Policy Set Definitions via ARG ────────────────────────────────────────────
Write-Log "Fetching Policy Set Definitions via Azure Resource Graph..."
try {
    Ensure-AzSessionFresh
    $setRows    = @()
    $sSkipToken = $null
    do {
        $sParams = @{
            Query        = "policyresources | where type =~ 'microsoft.authorization/policysetdefinitions' | project id, name, displayName = properties.displayName"
            First        = 1000
            Subscription = $subIds      # FIX #1 applied
            ErrorAction  = 'Stop'
        }
        if ($sSkipToken) { $sParams['SkipToken'] = $sSkipToken }

        $sResults   = Search-AzGraph @sParams
        $sPage      = @(if ($sResults.PSObject.Properties.Name -contains 'Data') { $sResults.Data } else { $sResults })
        $setRows   += $sPage
        $sSkipToken = if ($sResults.PSObject.Properties.Name -contains 'SkipToken') { $sResults.SkipToken } else { $null }
    } while ($sSkipToken)

    foreach ($set in $setRows) {
        $displayName = Get-SafeDisplayName $set.displayName
        if ($null -ne $displayName) {
            $mapping.policySets[$set.name.ToString().ToLower()] = $displayName
            $mapping.policySets[$set.id.ToString().ToLower()]   = $displayName
        }
    }
    Write-Log "ARG: mapped $($mapping.policySets.Keys.Count) Policy Set entries."
}
catch {
    Write-Log "ARG policy-set query failed -- falling back to Get-AzPolicySetDefinition: $_" "WARN"
    foreach ($sub in $allSubs) {
        try {
            Set-AzContext -SubscriptionId $sub.Id -ErrorAction SilentlyContinue | Out-Null
            $sets = @(Get-AzPolicySetDefinition -ErrorAction SilentlyContinue)
            foreach ($set in $sets) {
                $dn = Get-SafeDisplayName $set.Properties.DisplayName
                if ($null -ne $dn) {
                    $mapping.policySets[$set.Name.ToLower()]       = $dn
                    $mapping.policySets[$set.ResourceId.ToLower()] = $dn
                }
            }
        } catch {}
    }
}


# ── Built-in Definitions (tenant-wide, no sub context needed) ─────────────────
Write-Log "Fetching built-in Policy and PolicySet Definitions..."
try {
    $builtInPolicies = @(Get-AzPolicyDefinition -Builtin -ErrorAction SilentlyContinue)
    foreach ($pol in $builtInPolicies) {
        $dn = Get-SafeDisplayName $pol.Properties.DisplayName
        if ($null -ne $dn) {
            $mapping.policies[$pol.Name.ToLower()]       = $dn
            $mapping.policies[$pol.ResourceId.ToLower()] = $dn
        }
    }
    Write-Log "Built-in policies added: $($builtInPolicies.Count)"
}
catch { Write-Log "Built-in policy fetch failed (non-fatal): $_" "WARN" }

try {
    $builtInSets = @(Get-AzPolicySetDefinition -Builtin -ErrorAction SilentlyContinue)
    foreach ($set in $builtInSets) {
        $dn = Get-SafeDisplayName $set.Properties.DisplayName
        if ($null -ne $dn) {
            $mapping.policySets[$set.Name.ToLower()]       = $dn
            $mapping.policySets[$set.ResourceId.ToLower()] = $dn
        }
    }
    Write-Log "Built-in policy sets added: $($builtInSets.Count)"
}
catch { Write-Log "Built-in policy-set fetch failed (non-fatal): $_" "WARN" }


# ── Custom Definitions from Management Groups ──────────────────────────────────
Write-Log "Fetching custom Policy Definitions from Management Groups..."
try {
    $mgs = @(Get-AzManagementGroup -ErrorAction SilentlyContinue)
    foreach ($mg in $mgs) {
        try {
            $mgPolicies = @(Get-AzPolicyDefinition -ManagementGroupName $mg.Name -Custom -ErrorAction SilentlyContinue)
            foreach ($pol in $mgPolicies) {
                $dn = Get-SafeDisplayName $pol.Properties.DisplayName
                if ($null -ne $dn) {
                    $mapping.policies[$pol.Name.ToLower()]       = $dn
                    $mapping.policies[$pol.ResourceId.ToLower()] = $dn
                }
            }
            $mgSets = @(Get-AzPolicySetDefinition -ManagementGroupName $mg.Name -Custom -ErrorAction SilentlyContinue)
            foreach ($set in $mgSets) {
                $dn = Get-SafeDisplayName $set.Properties.DisplayName
                if ($null -ne $dn) {
                    $mapping.policySets[$set.Name.ToLower()]       = $dn
                    $mapping.policySets[$set.ResourceId.ToLower()] = $dn
                }
            }
        } catch {}
    }
}
catch { Write-Log "Management Group policy fetch failed (non-fatal): $_" "WARN" }


# ── Build flat mapping ─────────────────────────────────────────────────────────
# FIX #2 / #3: The blob is stored with a top-level `mapping` key.
# Every key is already lowercase. The frontend MUST access data.mapping[id.toLowerCase()].
# No mixed-case duplicates are needed if the frontend normalises on read.
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


# FIX #3: Structure is { lastUpdated, mapping: { <id>: <name> } }
# Frontend must read:  const name = data.mapping[policyId.toLowerCase()] ?? policyId
$finalData = [ordered]@{
    lastUpdated = (Get-Date).ToString("o")
    mapping     = $flatMapping
}

# FIX #5: Blob path includes tenant ID prefix — frontend must use the same path.
# Full blob URL: https://<storage>.blob.core.windows.net/<container>/<tenantId>/policy-mapping.json
$blobMapPath = "$targetTenantId/policy-mapping.json"
Write-Log "Uploading policy mapping --> container='$containerName'  path='$blobMapPath'"

try {
    Upload-JsonBlob -BlobPath $blobMapPath -Data $finalData -Container $containerName
    Write-Log "Policy mapping uploaded successfully ($($flatMapping.Keys.Count) entries)."
}
catch {
    Write-Log "Failed to upload policy mapping: $_" "ERROR"
    throw
}

Write-Log "=== Unified Verification Runbook Complete ==="
