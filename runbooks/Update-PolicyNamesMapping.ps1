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

# ─── Auth Helpers ────────────────────────────────────────────────────────────
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
    $targetContainer       = Get-AutomationVariable -Name "TargetStorageContainer"
    $storageAccountId      = Get-AutomationVariable -Name "TargetStorageAccountId" 

    # Extract storage account name from Resource ID
    # e.g., /subscriptions/.../resourceGroups/.../providers/Microsoft.Storage/storageAccounts/mystorage
    $script:StorageAccountNameCache = ($storageAccountId -split '/')[-1]
} catch {
    Write-Log "Failed to retrieve required Automation Variables. Error: $_" "ERROR"
    throw
}

Write-Log "Authenticating to Azure with UAMI..."
try {
    Connect-AzAccount -Identity -AccountId $script:uamiClientId -Tenant $targetTenantId -Force | Out-Null
} catch {
    Write-Log "Connect-AzAccount failed: $_" "ERROR"
    throw
}

$mapping = [ordered]@{
    policies = @{}
    policySets = @{}
}

Write-Log "Fetching Policy Definitions via ARG..."
try {
    # Using Azure Resource Graph is typically the most efficient way to get all policies across the tenant
    $query = "policyresources | where type =~ 'microsoft.authorization/policydefinitions' | project id, name, displayName = properties.displayName"
    $policyResults = Search-AzGraph -Query $query -First 5000
    
    foreach ($pol in $policyResults) {
        # The id used is typically the GUID name or the full resource ID.
        # Ensure we record both the short name and ID just in case.
        # We will use the 'name' (GUID) as key since that's what usually shows up in alerts/reports as policy ID.
        $policyId = $pol.name.ToString().ToLower()
        $displayName = $pol.displayName.ToString()
        if (-not [string]::IsNullOrWhiteSpace($displayName)) {
            $mapping.policies[$policyId] = $displayName
            # Also map by full ID for safety
            $mapping.policies[$pol.id.ToString().ToLower()] = $displayName
        }
    }
    Write-Log "Mapped $($mapping.policies.Keys.Count) Policy Definitions."
} catch {
    # Fallback to Get-AzPolicyDefinition if ARG fails/is not available
    Write-Log "ARG query failed, falling back to Get-AzPolicyDefinition: $_" "WARN"
    $policies = Get-AzPolicyDefinition
    foreach ($pol in $policies) {
        $policyId = $pol.Name.ToLower()
        $mapping.policies[$policyId] = $pol.Properties.DisplayName
        $mapping.policies[$pol.ResourceId.ToLower()] = $pol.Properties.DisplayName
    }
}

Write-Log "Fetching Policy Set Definitions (Initiatives)..."
try {
    $querySets = "policyresources | where type =~ 'microsoft.authorization/policysetdefinitions' | project id, name, displayName = properties.displayName"
    $setResults = Search-AzGraph -Query $querySets -First 5000
    
    foreach ($set in $setResults) {
        $setId = $set.name.ToString().ToLower()
        $displayName = $set.displayName.ToString()
        if (-not [string]::IsNullOrWhiteSpace($displayName)) {
            $mapping.policySets[$setId] = $displayName
            $mapping.policySets[$set.id.ToString().ToLower()] = $displayName
        }
    }
    Write-Log "Mapped $($mapping.policySets.Keys.Count) Policy Sets."
} catch {
    Write-Log "ARG query for sets failed, falling back to Get-AzPolicySetDefinition: $_" "WARN"
    $sets = Get-AzPolicySetDefinition
    foreach ($set in $sets) {
        $setId = $set.Name.ToLower()
        $mapping.policySets[$setId] = $set.Properties.DisplayName
        $mapping.policySets[$set.ResourceId.ToLower()] = $set.Properties.DisplayName
    }
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
