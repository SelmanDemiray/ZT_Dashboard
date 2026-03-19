param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR")]
        [string]$Level = "INFO"
    )
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Write-Host "[$ts][$Level] $Message"
}

# Variable cache
$script:StorageBearerToken = $null
$script:StorageTokenExpiry = [int64]0
$script:StorageAccountNameCache = $null

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
        Write-Log "Required module $mod is not found. Attempting to import..." "WARN"
        try { Import-Module $mod -ErrorAction Stop } catch {
            Write-Log "Failed to find or import $mod. Ensure it is installed on the Hybrid Worker." "ERROR"
            throw "Missing module: $mod"
        }
    } else {
        Import-Module $mod -ErrorAction SilentlyContinue
    }
}

# ─── Auth Helpers ────────────────────────────────────────────────────────────

# ── Clear inherited MSI/IDENTITY env vars ──
# Automation Accounts inject environment variables that redirect Azure.Identity
# to a restricted internal endpoint that doesn't always support UAMI selection.
# Unsetting them forces the SDK to fall back to the VM's direct IMDS endpoint.
$msiEnvVars = @('IDENTITY_ENDPOINT','IDENTITY_HEADER','MSI_ENDPOINT','MSI_SECRET')
foreach ($v in $msiEnvVars) {
    if ($null -ne [System.Environment]::GetEnvironmentVariable($v)) {
        Write-Log "  Clearing inherited MSI env var: $v" "WARN"
        [System.Environment]::SetEnvironmentVariable($v, $null)
    }
}

# ── Clear stale Az contexts ──
# Hybrid Workers can reuse stale Az context/token caches between runs.
try { Disable-AzContextAutosave -Scope Process | Out-Null } catch {}
try { Disconnect-AzAccount -Scope Process -ErrorAction SilentlyContinue | Out-Null } catch {}
try { Clear-AzContext -Scope Process -Force -ErrorAction SilentlyContinue } catch {}
try { Clear-AzContext -Scope CurrentUser -Force -ErrorAction SilentlyContinue } catch {}

function Ensure-AzSessionFresh {
    param(
        [int]$RefreshIfExpiringInMinutes = 10
    )
    try {
        $tok = Get-AzAccessToken -ResourceUrl "https://management.azure.com/" -ErrorAction Stop
        $minsLeft = ($tok.ExpiresOn.UtcDateTime - (Get-Date).ToUniversalTime()).TotalMinutes
        if ($minsLeft -le $RefreshIfExpiringInMinutes) {
            Write-Log "Az token expiring soon -- reconnecting..." "WARN"
            Connect-AzAccount -Identity -AccountId $script:uamiClientId -Tenant $targetTenantId -Force | Out-Null
        }
    } catch {
        Write-Log "Could not validate Az session -- forcing reconnect: $_" "WARN"
        Connect-AzAccount -Identity -AccountId $script:uamiClientId -Tenant $targetTenantId -Force | Out-Null
    }
}

function Get-ImdsToken {
    param(
        [Parameter(Mandatory)][string]$Resource,
        [Parameter(Mandatory)][string]$ClientId,
        [int]$TimeoutSec = 15
    )
    $uri = "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=$([uri]::EscapeDataString($Resource))&client_id=$([uri]::EscapeDataString($ClientId))"
    Write-Log "Requesting IMDS token for $Resource"
    
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        return Invoke-RestMethod -Method GET -Uri $uri -Headers @{ Metadata = "true" } -TimeoutSec $TimeoutSec -NoProxy -ErrorAction Stop
    } else {
        $savedProxy = [System.Net.WebRequest]::DefaultWebProxy
        [System.Net.WebRequest]::DefaultWebProxy = $null
        try {
            return Invoke-RestMethod -Method GET -Uri $uri -Headers @{ Metadata = "true" } -TimeoutSec $TimeoutSec -ErrorAction Stop
        } finally {
            [System.Net.WebRequest]::DefaultWebProxy = $savedProxy
        }
    }
}

function Get-StorageAccessToken {
    if (-not [string]::IsNullOrWhiteSpace($script:uamiClientId)) {
        $t = Get-ImdsToken -Resource "https://storage.azure.com/" -ClientId $script:uamiClientId
        return @{ access_token = [string]$t.access_token;  expires_on = [string]$t.expires_on }
    } else {
        $secTok = Get-AzAccessToken -ResourceUrl "https://storage.azure.com/" -AsSecureString -ErrorAction Stop
        $plain = [System.Net.NetworkCredential]::new('', $secTok.Token).Password
        $expEpoch = $secTok.ExpiresOn.ToUnixTimeSeconds().ToString()
        return @{ access_token = $plain; expires_on = $expEpoch }
    }
}

function Upload-JsonBlob {
    param(
        [Parameter(Mandatory)][string]$BlobPath,
        [Parameter(Mandatory)][object]$Data,
        [Parameter(Mandatory)][string]$Container
    )

    $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ([string]::IsNullOrWhiteSpace($script:StorageBearerToken) -or ($nowEpoch + 300) -ge $script:StorageTokenExpiry) {
        $t = Get-StorageAccessToken
        $script:StorageBearerToken = [string]$t.access_token
        $script:StorageTokenExpiry = [int64]$t.expires_on
    }

    $json  = $Data | ConvertTo-Json -Depth 20 -Compress
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)
    $uri   = "https://" + $script:StorageAccountNameCache + ".blob.core.windows.net/" + $Container + "/" + $BlobPath

    $headers = [ordered]@{
        Authorization    = "Bearer $script:StorageBearerToken"
        "x-ms-version"   = "2020-04-08"
        "x-ms-date"      = [DateTime]::UtcNow.ToString("R")
        "x-ms-blob-type" = "BlockBlob"
        "Content-Type"   = "application/json; charset=utf-8"
    }

    Invoke-RestMethod -Method PUT -Uri $uri -Headers $headers -Body $bytes -TimeoutSec 120 -ErrorAction Stop | Out-Null
    Write-Log "Uploaded $BlobPath ($($bytes.Length) bytes)"
}

# ─── Main Execution ────────────────────────────────────────────────────────────

Write-Log "Starting Update-PolicyNamesMapping runbook..."

try {
    $script:uamiClientId   = Get-AutomationVariable -Name "UserAssignedManagedIdentityClientId"
    $targetTenantId        = Get-AutomationVariable -Name "TargetTenantId"
    $targetContainer       = Get-AutomationVariable -Name "BlobContainerName"
    $script:StorageAccountNameCache = Get-AutomationVariable -Name "StorageAccountName"
} catch {
    Write-Log "Failed to retrieve required Automation Variables. Variables not found or error: $_" "ERROR"
    throw
}

Write-Log "Authenticating to Azure with UAMI..."
try {
    $oldWarningPreference = $WarningPreference
    $WarningPreference = 'SilentlyContinue'
    Connect-AzAccount -Identity -AccountId $script:uamiClientId -Tenant $targetTenantId -Force | Out-Null
    $WarningPreference = $oldWarningPreference
    
    # Ensure session is fresh (fixes 'token expiry' errors on Hybrid Workers)
    Ensure-AzSessionFresh
} catch {
    $WarningPreference = $oldWarningPreference
    Write-Log "Connect-AzAccount failed: $_" "ERROR"
    throw
}

if ([string]::IsNullOrWhiteSpace($targetTenantId)) {
    Write-Log "Tenant ID variable is missing or empty. Cannot discover subscriptions." "ERROR"
    throw "TargetTenantId is required for subscription discovery."
}

Write-Log "Discovering subscriptions for tenant $targetTenantId..."
try {
    $allSubs = @(Get-AzSubscription -TenantId $targetTenantId -ErrorAction Stop | Where-Object { $_.State -eq 'Enabled' })
} catch {
    Write-Log "Failed to list subscriptions for tenant $targetTenantId. Error: $_" "ERROR"
    throw
}
Write-Log "Found $($allSubs.Count) enabled subscription(s)."

$mapping = [ordered]@{
    policies = @{}
    policySets = @{}
}

Write-Log "Fetching Policy Definitions via ARG..."
try {
    $policyRows = @()
    $pSkipToken = $null
    do {
        $pParams = @{
            Query       = "policyresources | where type =~ 'microsoft.authorization/policydefinitions' | project id, name, displayName = properties.displayName"
            First       = 1000
            ErrorAction = 'Stop'
        }
        if ($pSkipToken) { $pParams['SkipToken'] = $pSkipToken }
        
        $pResults = Search-AzGraph @pParams
        $pPage    = @(if ($pResults.PSObject.Properties.Name -contains 'Data') { $pResults.Data } else { $pResults })
        $policyRows += $pPage
        
        $pSkipToken = if ($pResults.PSObject.Properties.Name -contains 'SkipToken') { $pResults.SkipToken } else { $null }
    } while ($pSkipToken)
    
    foreach ($pol in $policyRows) {
        $policyId = $pol.name.ToString().ToLower()
        $displayName = $pol.displayName.ToString()
        if (-not [string]::IsNullOrWhiteSpace($displayName)) {
            $mapping.policies[$policyId] = $displayName
            $mapping.policies[$pol.id.ToString().ToLower()] = $displayName
        }
    }
    Write-Log "Mapped $($mapping.policies.Keys.Count) Policy Definitions (from $($policyRows.Count) rows)."
} catch {
    # Fallback to Get-AzPolicyDefinition if ARG fails/is not available
    Write-Log "ARG query failed, falling back to Get-AzPolicyDefinition (looping all subscriptions): $_" "WARN"
    foreach ($sub in $allSubs) {
        try {
            Set-AzContext -SubscriptionId $sub.Id -ErrorAction SilentlyContinue | Out-Null
            $policies = @(Get-AzPolicyDefinition -ErrorAction SilentlyContinue)
            foreach ($pol in $policies) {
                $policyId = $pol.Name.ToLower()
                $mapping.policies[$policyId] = $pol.Properties.DisplayName
                $mapping.policies[$pol.ResourceId.ToLower()] = $pol.Properties.DisplayName
            }
        } catch {
            Write-Log "Failed to fetch policies for subscription $($sub.Name)" "WARN"
        }
    }
}

Write-Log "Fetching Policy Set Definitions (Initiatives)..."
try {
    $setRows = @()
    $sSkipToken = $null
    do {
        $sParams = @{
            Query       = "policyresources | where type =~ 'microsoft.authorization/policysetdefinitions' | project id, name, displayName = properties.displayName"
            First       = 1000
            ErrorAction = 'Stop'
        }
        if ($sSkipToken) { $sParams['SkipToken'] = $sSkipToken }
        
        $sResults = Search-AzGraph @sParams
        $sPage    = @(if ($sResults.PSObject.Properties.Name -contains 'Data') { $sResults.Data } else { $sResults })
        $setRows += $sPage
        
        $sSkipToken = if ($sResults.PSObject.Properties.Name -contains 'SkipToken') { $sResults.SkipToken } else { $null }
    } while ($sSkipToken)
    
    foreach ($set in $setRows) {
        $setId = $set.name.ToString().ToLower()
        $displayName = $set.displayName.ToString()
        if (-not [string]::IsNullOrWhiteSpace($displayName)) {
            $mapping.policySets[$setId] = $displayName
            $mapping.policySets[$set.id.ToString().ToLower()] = $displayName
        }
    }
    Write-Log "Mapped $($mapping.policySets.Keys.Count) Policy Sets (from $($setRows.Count) rows)."
} catch {
    Write-Log "ARG query for sets failed, falling back to Get-AzPolicySetDefinition (looping all subscriptions): $_" "WARN"
    foreach ($sub in $allSubs) {
        try {
            Set-AzContext -SubscriptionId $sub.Id -ErrorAction SilentlyContinue | Out-Null
            $sets = Get-AzPolicySetDefinition -ErrorAction SilentlyContinue
            foreach ($set in $sets) {
                $setId = $set.Name.ToLower()
                $mapping.policySets[$setId] = $set.Properties.DisplayName
                $mapping.policySets[$set.ResourceId.ToLower()] = $set.Properties.DisplayName
            }
        } catch {
            Write-Log "Failed to fetch policy sets for subscription $($sub.Name)" "WARN"
        }
    }
}

Write-Log "Fetching Built-in Policies and Policy Sets..."
try {
    $builtInPolicies = Get-AzPolicyDefinition -Builtin -ErrorAction SilentlyContinue
    foreach ($pol in $builtInPolicies) {
        $mapping.policies[$pol.Name.ToLower()] = $pol.Properties.DisplayName
        $mapping.policies[$pol.ResourceId.ToLower()] = $pol.Properties.DisplayName
    }
    $builtInSets = Get-AzPolicySetDefinition -Builtin -ErrorAction SilentlyContinue
    foreach ($set in $builtInSets) {
        $mapping.policySets[$set.Name.ToLower()] = $set.Properties.DisplayName
        $mapping.policySets[$set.ResourceId.ToLower()] = $set.Properties.DisplayName
    }
    Write-Log "Successfully fetched built-in definitions."
} catch {
    Write-Log "Failed to fetch built-in policies/sets: $_" "WARN"
}

Write-Log "Fetching Custom Policies and Policy Sets from all accessible Management Groups..."
try {
    $mgs = Get-AzManagementGroup -ErrorAction SilentlyContinue
    foreach ($mg in $mgs) {
        try {
            $mgPolicies = Get-AzPolicyDefinition -ManagementGroupName $mg.Name -Custom -ErrorAction SilentlyContinue
            foreach ($pol in $mgPolicies) {
                $mapping.policies[$pol.Name.ToLower()] = $pol.Properties.DisplayName
                $mapping.policies[$pol.ResourceId.ToLower()] = $pol.Properties.DisplayName
            }
            $mgSets = Get-AzPolicySetDefinition -ManagementGroupName $mg.Name -Custom -ErrorAction SilentlyContinue
            foreach ($set in $mgSets) {
                $mapping.policySets[$set.Name.ToLower()] = $set.Properties.DisplayName
                $mapping.policySets[$set.ResourceId.ToLower()] = $set.Properties.DisplayName
            }
        } catch {}
    }
    Write-Log "Successfully fetched Management Group definitions."
} catch {
    Write-Log "Failed to list Management Groups: $_" "WARN"
}

Write-Log "Fetching Custom Policies and Policy Sets from all accessible Subscriptions explicitly..."
foreach ($sub in $allSubs) {
    try {
        Set-AzContext -SubscriptionId $sub.Id -ErrorAction SilentlyContinue | Out-Null
        $subPolicies = Get-AzPolicyDefinition -Custom -ErrorAction SilentlyContinue
        foreach ($pol in $subPolicies) {
            $mapping.policies[$pol.Name.ToLower()] = $pol.Properties.DisplayName
            $mapping.policies[$pol.ResourceId.ToLower()] = $pol.Properties.DisplayName
        }
        $subSets = Get-AzPolicySetDefinition -Custom -ErrorAction SilentlyContinue
        foreach ($set in $subSets) {
            $mapping.policySets[$set.Name.ToLower()] = $set.Properties.DisplayName
            $mapping.policySets[$set.ResourceId.ToLower()] = $set.Properties.DisplayName
        }
    } catch {}
}

# Merge all into one flat mapping object as well for easy frontend lookup
$flatMapping = @{}
foreach ($key in $mapping.policies.Keys) { $flatMapping[$key] = $mapping.policies[$key] }
foreach ($key in $mapping.policySets.Keys) { $flatMapping[$key] = $mapping.policySets[$key] }

$finalData = @{
    lastUpdated = (Get-Date).ToString("o")
    mapping = $flatMapping
}

$blobPath = "$targetTenantId/policy-mapping.json"
Write-Log "Uploading policy mapping to $blobPath"

try {
    Upload-JsonBlob -BlobPath $blobPath -Data $finalData -Container $targetContainer
    Write-Log "Runbook completed successfully."
} catch {
    Write-Log "Failed to upload blob: $_" "ERROR"
    throw
}
