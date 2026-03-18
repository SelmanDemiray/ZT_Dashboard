param()

#region ── 0. Strict mode, preferences & helpers ──────────────────────────

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"
$today = (Get-Date).ToString("yyyy-MM-dd")

# ── Error log accumulator ─────────────────────────────────────────────
# Collects non-fatal errors from every stage. Uploaded to blob at the end
# so you can inspect what failed, where, and why, without the runbook crashing.
$script:ErrorLog = [System.Collections.ArrayList]::new()

function Add-ErrorLogEntry {
    param(
        [string]$Stage,
        [string]$Component,
        [string]$Message,
        [string]$Detail     = "",
        [string]$Resolution = "",
        [string]$Severity   = "WARN"   # WARN | ERROR | SKIP
    )
    $entry = [ordered]@{
        timestamp  = (Get-Date).ToString('o')
        stage      = $Stage
        component  = $Component
        severity   = $Severity
        message    = $Message
        detail     = $Detail
        resolution = $Resolution
    }
    [void]$script:ErrorLog.Add($entry)
    Write-Log "  [$Severity] $Component -- $Message" $( if ($Severity -eq 'ERROR') { 'ERROR' } else { 'WARN' } )
}

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","DEBUG")]
        [string]$Level = "INFO"
    )
    $ts = (Get-Date).ToString("HH:mm:ss")
    # Write-Host targets the Information stream — never captured by variable assignment.
    Write-Host "[$ts][$Level] $Message"
}

function Write-DiagnosticError {
    param(
        [string]$Context,
        [string]$Message,
        [string]$Detail     = "",
        [string]$Resolution = ""
    )
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
    Write-Log "FATAL ERROR in: $Context"                        "ERROR"
    Write-Log "Problem : $Message"                              "ERROR"
    if ($Detail)     { Write-Log "Detail  : $Detail"      "ERROR" }
    if ($Resolution) { Write-Log "Fix     : $Resolution"  "ERROR" }
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
}

#endregion

#region ── 0a. Upload helper — REST-based, bypasses Az.Storage SDK token path ──
#
# ROOT CAUSE OF PREVIOUS FAILURE:
#   New-AzStorageContext -UseConnectedAccount internally asks Az.Accounts for a
#   storage-scoped token. When the Hybrid Worker Agent's IDENTITY_ENDPOINT env var
#   was still cached by the Azure.Identity SDK (even after clearing it), the SDK
#   sent the UAMI client_id to the Automation Account's internal token endpoint,
#   which does not support UAMI selection and returned:
#     "Access token authenticator failed to retrieve access token for resource '<storageaccname>'"
#   The resource string was resolved as the storage account name rather than the
#   correct URI (https://storage.azure.com/) because the credential was in a
#   broken/static state.
#
# FIX:
#   Acquire the storage Bearer token from IMDS directly (same path as ARM/Graph
#   tokens) and call the Azure Blob REST API with an explicit Authorization header.
#   Az.Storage and its SDK token path are bypassed entirely.
#
# TOKEN CACHE:
#   $script:StorageBearerToken / $script:StorageTokenExpiry are seeded in Stage 2
#   from the preflight IMDS token and lazily refreshed inside Upload-JsonBlob when
#   within 5 minutes of expiry.  This prevents 401s during long Stage 7 runs
#   across many subscriptions (~1-hour token lifetime).

# ── Module-level storage cache ────────────────────────────────────────────
# Declared here (before any function that references them) so Set-StrictMode
# -Version Latest never throws "variable not set" if the function is reached
# before Stage 3 initialises them.
$script:StorageBearerToken      = $null
$script:StorageTokenExpiry      = [int64]0
$script:StorageAccountNameCache = $null

# ── Get-StorageAccessToken ────────────────────────────────────────────────
# Returns @{ access_token = "..."; expires_on = "<unix-epoch-string>" }
# using the correct mechanism for each auth path:
#   UAMI path           -> raw IMDS call (bypasses Az.Accounts SDK entirely)
#   AppRegistration path -> Get-AzAccessToken (no IMDS available for SPs)
#
# $script:uamiClientId is set to $null in Stage 1 for AppRegistration and to
# the actual GUID for ManagedIdentity. The null/empty check routes correctly.
function Get-StorageAccessToken {
    if (-not [string]::IsNullOrWhiteSpace($script:uamiClientId)) {
        # UAMI path: raw IMDS call, no SDK involvement
        $t = Get-ImdsToken -Resource "https://storage.azure.com/" -ClientId $script:uamiClientId
        return @{
            access_token = [string]$t.access_token
            expires_on   = [string]$t.expires_on   # unix-epoch string from IMDS
        }
    }
    else {
        # AppRegistration path: rely on the Az.Accounts session established in Stage 2.
        # -AsSecureString avoids the deprecation warning on Az.Accounts 3.x+.
        $secTok   = Get-AzAccessToken -ResourceUrl "https://storage.azure.com/" `
                        -AsSecureString -ErrorAction Stop
        $plain    = [System.Net.NetworkCredential]::new('', $secTok.Token).Password
        # DateTimeOffset.ToUnixTimeSeconds() is available on .NET 4.6+ / .NET Core
        $expEpoch = $secTok.ExpiresOn.ToUnixTimeSeconds().ToString()
        return @{
            access_token = $plain
            expires_on   = $expEpoch
        }
    }
}

# ── Upload-JsonBlob ───────────────────────────────────────────────────────
# Serialises $Data to JSON and PUTs it to the Azure Blob REST API.
# Az.Storage's Set-AzStorageBlobContent is NOT used — it triggered the broken
# SDK token path described above.
#
# -ThrowOnFailure : pass this for the Stage 3 write probe so a storage failure
#                   stops the runbook immediately rather than logging a WARN and
#                   continuing with broken storage access. All Stage 6/7 upload
#                   calls omit the flag so a single blob failure is non-fatal.
function Upload-JsonBlob {
    param(
        [Parameter(Mandatory)][string]$BlobPath,
        [Parameter(Mandatory)][object]$Data,
        $StorageContext,                        # kept for call-site compatibility; unused
        [Parameter(Mandatory)][string]$Container,
        [switch]$ThrowOnFailure
    )

    # Guard: if Stage 3 has not yet cached the account name the URI would be malformed.
    if ([string]::IsNullOrWhiteSpace($script:StorageAccountNameCache)) {
        $msg = "Upload-JsonBlob called before StorageAccountNameCache was set (Stage 3 incomplete)."
        if ($ThrowOnFailure) { throw $msg }
        Write-Log " [UPLOAD SKIP] $BlobPath -- $msg" "WARN"
        return
    }

    # Refresh token when missing or expiring within 5 minutes
    $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ([string]::IsNullOrWhiteSpace($script:StorageBearerToken) -or
        ($nowEpoch + 300) -ge $script:StorageTokenExpiry) {
        Write-Log "  [Storage] Refreshing storage Bearer token..."
        try {
            $t = Get-StorageAccessToken
            $script:StorageBearerToken = [string]$t.access_token
            $script:StorageTokenExpiry = [int64]$t.expires_on
            Write-Log "  [Storage] Token refreshed. Expires: $([DateTimeOffset]::FromUnixTimeSeconds($script:StorageTokenExpiry).UtcDateTime) UTC"
        }
        catch {
            # Token refresh failure is always fatal -- without a token no upload can succeed
            $errMsg = "Storage token refresh failed: $($_.Exception.Message)"
            if ($ThrowOnFailure) { throw $errMsg }
            Write-Log "  [Storage] $errMsg" "ERROR"
            Write-Log "  [UPLOAD SKIP] $BlobPath -- no valid Bearer token." "WARN"
            return
        }
    }

    try {
        $json  = $Data | ConvertTo-Json -Depth 20 -Compress
        $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($json)

        # Build URI via concatenation to avoid PS 5.1 string-interpolation edge
        # cases with special characters like '?' or '&'.
        $uri = "https://" + $script:StorageAccountNameCache +
               ".blob.core.windows.net/" + $Container + "/" + $BlobPath

        $headers = [ordered]@{
            Authorization    = "Bearer $script:StorageBearerToken"
            "x-ms-version"   = "2020-04-08"
            "x-ms-date"      = [DateTime]::UtcNow.ToString("R")
            "x-ms-blob-type" = "BlockBlob"
            "Content-Type"   = "application/json; charset=utf-8"
        }

        Invoke-RestMethod -Method PUT -Uri $uri -Headers $headers -Body $bytes `
            -TimeoutSec 120 -ErrorAction Stop | Out-Null

        Write-Log " [UPLOAD OK] $BlobPath ($($bytes.Length) bytes)"
    }
    catch {
        $sc = $null
        try { $sc = [int]$_.Exception.Response.StatusCode } catch { }
        $errMsg = " [UPLOAD FAIL] $BlobPath (HTTP $sc) -- $($_.Exception.Message)"
        $hint   = " Hint: Verify 'Storage Blob Data Contributor' is assigned to the UAMI on storage account '$script:StorageAccountNameCache'."
        if ($ThrowOnFailure) {
            Write-Log $errMsg "ERROR"
            Write-Log $hint   "ERROR"
            throw "Storage write failed (HTTP $sc): $($_.Exception.Message)"
        }
        else {
            Write-Log $errMsg "WARN"
            Write-Log $hint   "WARN"
        }
    }
}

#endregion

#region ── 0b. UAMI diagnostic helpers ─────────────────────────────────────

function Write-MiDiagnostic {
    param(
        [Parameter(Mandatory)][string]$Code,
        [Parameter(Mandatory)][string]$Context,
        [Parameter(Mandatory)][string]$Message,
        [string]$Detail     = "",
        [string]$Resolution = ""
    )
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
    Write-Log "[$Code] $Context"          "ERROR"
    Write-Log "Problem : $Message"        "ERROR"
    if ($Detail)     { Write-Log "Detail  : $Detail"     "ERROR" }
    if ($Resolution) { Write-Log "Fix     : $Resolution" "ERROR" }
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
}

function Test-IsGuid {
    param([string]$Value)
    $out = [guid]::Empty
    return [guid]::TryParse($Value, [ref]$out)
}

# ── ConvertFrom-JwtPayload ────────────────────────────────────────────────
# Decodes the payload section of a JWT and returns a PSCustomObject.
# Returns $null on any parse error -- callers must null-check before using.
#
# IMPORTANT: Always use Get-JwtClaim to read properties from the returned object
# rather than accessing them directly (e.g. $jwt.someField). Under
# Set-StrictMode -Version Latest on PS 5.1, accessing a property that does not
# exist on a PSCustomObject throws a terminating error. Get-JwtClaim guards
# against this with a PSObject.Properties check.
function ConvertFrom-JwtPayload {
    param([Parameter(Mandatory)][string]$Jwt)
    try {
        $parts = $Jwt.Split('.')
        if ($parts.Count -lt 2) { return $null }
        $payload = $parts[1].Replace('-', '+').Replace('_', '/')
        switch ($payload.Length % 4) {
            2 { $payload += '==' }
            3 { $payload += '='  }
        }
        $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload))
        return ($json | ConvertFrom-Json)
    }
    catch { return $null }
}

# ── Get-JwtClaim ──────────────────────────────────────────────────────────
# Safe property accessor for PSCustomObjects returned by ConvertFrom-JwtPayload.
# On PS 5.1 with Set-StrictMode -Version Latest, $obj.missingProperty throws a
# terminating error. This function uses PSObject.Properties to check first.
# Returns $Default (empty string) if the object is $null or the claim is absent.
function Get-JwtClaim {
    param(
        $JwtObject,
        [string]$Claim,
        [string]$Default = ""
    )
    if ($null -eq $JwtObject) { return $Default }
    if ($JwtObject.PSObject.Properties.Name -contains $Claim) {
        $v = $JwtObject.$Claim
        if ($null -ne $v) { return [string]$v }
    }
    return $Default
}

# ── Write-ProxyDiagnostic ─────────────────────────────────────────────────
# Logs what proxy (if any) would be used for a given URI, helping diagnose
# whether a system proxy is intercepting the link-local IMDS request.
function Write-ProxyDiagnostic {
    param([string]$Uri)
    try {
        $proxyUri = [System.Net.WebRequest]::DefaultWebProxy.GetProxy([uri]$Uri)
        if ($proxyUri -and $proxyUri.Host -and $proxyUri.ToString() -ne $Uri) {
            Write-Log "   Proxy for $Uri : $proxyUri  <- PROXY DETECTED. This will BLOCK IMDS. Bypassing." "WARN"
        }
        else {
            Write-Log "   Proxy for $Uri : (none -- direct connection)"
        }
    }
    catch {
        Write-Log "   Proxy detection failed: $($_.Exception.Message)" "WARN"
    }
    $envProxy   = $env:HTTP_PROXY
    $envNoProxy = $env:NO_PROXY
    if ($envProxy)   { Write-Log "   HTTP_PROXY env var : $envProxy"   "WARN" }
    if ($envNoProxy) { Write-Log "   NO_PROXY env var   : $envNoProxy" }
}

# ── Test-ImdsReachable ────────────────────────────────────────────────────
# Tests whether 169.254.169.254:80 is reachable at TCP level BEFORE attempting
# an HTTP token request. If this fails, Invoke-RestMethod will hang regardless
# of -TimeoutSec because the TCP handshake never completes.
function Test-ImdsReachable {
    param([int]$TimeoutMs = 3000)
    Write-Log "   Testing TCP connectivity to 169.254.169.254:80 (timeout ${TimeoutMs}ms)..."
    try {
        $tcp       = New-Object System.Net.Sockets.TcpClient
        $iar       = $tcp.BeginConnect("169.254.169.254", 80, $null, $null)
        $connected = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($connected -and $tcp.Connected) {
            $tcp.EndConnect($iar)
            $tcp.Close()
            Write-Log "   TCP to IMDS 169.254.169.254:80 -- reachable OK"
            return $true
        }
        else {
            try { $tcp.Close() } catch { }
            Write-Log "   TCP to IMDS 169.254.169.254:80 -- NOT reachable within ${TimeoutMs}ms" "WARN"
            Write-Log "   IMDS is blocked by a firewall, NSG, or this VM is not in Azure." "WARN"
            return $false
        }
    }
    catch {
        Write-Log "   TCP connectivity test failed: $($_.Exception.Message)" "WARN"
        return $false
    }
}

# ── Get-ImdsToken ─────────────────────────────────────────────────────────
# Fetches an OAuth token from the Azure Instance Metadata Service.
#
# ROOT CAUSE OF PREVIOUS 10-MINUTE HANG:
#   On Windows, Invoke-RestMethod respects the system WinHTTP/WinINet proxy.
#   Enterprise proxies route 169.254.169.254 through the proxy, which cannot
#   reach link-local addresses, so the request hangs for the PROXY's own timeout
#   (typically 2-10 min), completely ignoring -TimeoutSec.
#
# FIX:
#   PS 6+ : use the native -NoProxy switch.
#   PS 5.1: temporarily null [System.Net.WebRequest]::DefaultWebProxy so this
#           call bypasses proxy entirely, then restore it in a finally block.
function Get-ImdsToken {
    param(
        [Parameter(Mandatory)][string]$Resource,
        [Parameter(Mandatory)][string]$ClientId,
        [int]$TimeoutSec = 15
    )

    $uri = "http://169.254.169.254/metadata/identity/oauth2/token" +
           "?api-version=2018-02-01" +
           "&resource=$([uri]::EscapeDataString($Resource))" +
           "&client_id=$([uri]::EscapeDataString($ClientId))"

    Write-Log "   IMDS URI   : $uri"
    Write-Log "   Timeout    : ${TimeoutSec}s"
    Write-Log "   PS version : $($PSVersionTable.PSVersion)"

    Write-ProxyDiagnostic -Uri "http://169.254.169.254/"

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $response = $null

        if ($PSVersionTable.PSVersion.Major -ge 6) {
            Write-Log "   Using -NoProxy (PS 6+) to bypass system proxy for IMDS..."
            $response = Invoke-RestMethod -Method GET -Uri $uri `
                -Headers @{ Metadata = "true" } `
                -TimeoutSec $TimeoutSec `
                -NoProxy `
                -ErrorAction Stop
        }
        else {
            Write-Log "   Bypassing system proxy via DefaultWebProxy=null (PS 5.1)..."
            $savedProxy = [System.Net.WebRequest]::DefaultWebProxy
            [System.Net.WebRequest]::DefaultWebProxy = $null
            try {
                $response = Invoke-RestMethod -Method GET -Uri $uri `
                    -Headers @{ Metadata = "true" } `
                    -TimeoutSec $TimeoutSec `
                    -ErrorAction Stop
            }
            finally {
                # Always restore the proxy -- even on error or Ctrl-C
                [System.Net.WebRequest]::DefaultWebProxy = $savedProxy
            }
        }

        $stopwatch.Stop()
        Write-Log "   IMDS responded in $($stopwatch.ElapsedMilliseconds)ms OK"
        return $response
    }
    catch {
        $stopwatch.Stop()
        Write-Log "   IMDS call failed after $($stopwatch.ElapsedMilliseconds)ms" "WARN"

        $statusCode = $null
        $rawBody    = $null
        $detail     = $_.Exception.Message

        try {
            $resp = $_.Exception.Response
            if ($resp) {
                $statusCode = [int]$resp.StatusCode
                $reader     = New-Object System.IO.StreamReader($resp.GetResponseStream())
                $rawBody    = $reader.ReadToEnd()
                $reader.Dispose()
            }
        }
        catch { }

        $ex = New-Object System.Exception(
            "IMDS token request failed. StatusCode=$statusCode; Body=$rawBody; Message=$detail")
        if ($null -ne $statusCode) { $ex.Data["StatusCode"]   = $statusCode }
        if ($rawBody)              { $ex.Data["ResponseBody"] = $rawBody    }
        throw $ex
    }
}

function Resolve-ImdsFailure {
    param(
        [string]$Stage,
        [System.Exception]$Exception,
        [string]$ClientId
    )
    $statusCode = $null
    $body       = $null
    try { $statusCode = $Exception.Data["StatusCode"]   } catch { }
    try { $body       = $Exception.Data["ResponseBody"] } catch { }
    $bodyText = [string]$body
    $msg      = [string]$Exception.Message

    if ($statusCode -eq 400 -and $bodyText -match 'Identity not found') {
        Write-MiDiagnostic -Code "MI-UAMI-004" -Context $Stage `
            -Message "The UAMI is not attached to this Hybrid Worker VM." `
            -Detail "ClientId=$ClientId; IMDS status=400; Body=$bodyText" `
            -Resolution "VM > Identity > User assigned > Add the UAMI. Confirm the Client ID in the Automation Variable matches."
        throw $Exception
    }
    elseif ($statusCode -eq 400 -and $bodyText -match 'invalid_resource') {
        Write-MiDiagnostic -Code "MI-UAMI-005" -Context $Stage `
            -Message "IMDS rejected the resource URI." `
            -Detail "Status=400; Body=$bodyText" `
            -Resolution "Resource must be https://management.azure.com/, https://graph.microsoft.com/, or https://storage.azure.com/"
        throw $Exception
    }
    elseif ($statusCode -eq 403) {
        Write-MiDiagnostic -Code "MI-UAMI-006" -Context $Stage `
            -Message "IMDS returned 403 -- VM cannot access the Instance Metadata Service." `
            -Detail "Status=403; Body=$bodyText; Message=$msg" `
            -Resolution "Check nothing on the VM blocks 169.254.169.254 (proxy, firewall, NSG, EDR, custom route). IMDS must be a direct local call -- it cannot go through a proxy."
        throw $Exception
    }
    elseif ($statusCode -eq 404 -or $statusCode -eq 410) {
        Write-MiDiagnostic -Code "MI-UAMI-007" -Context $Stage `
            -Message "IMDS is temporarily unavailable or refreshing." `
            -Detail "Status=$statusCode; Body=$bodyText" `
            -Resolution "Retry in a few seconds. If persistent, restart the VM or check Azure host health."
        throw $Exception
    }
    elseif ($statusCode -eq 429) {
        Write-MiDiagnostic -Code "MI-UAMI-008" -Context $Stage `
            -Message "IMDS throttled the token request." `
            -Detail "Status=429; Body=$bodyText" `
            -Resolution "Cache tokens and retry with backoff. The runbook already caches tokens -- check if something else on the VM is hammering IMDS."
        throw $Exception
    }
    elseif ($null -ne $statusCode -and $statusCode -ge 500) {
        Write-MiDiagnostic -Code "MI-UAMI-009" -Context $Stage `
            -Message "Azure IMDS returned a server-side error." `
            -Detail "Status=$statusCode; Body=$bodyText" `
            -Resolution "Retry later. Check Azure platform health at https://status.azure.com"
        throw $Exception
    }
    else {
        Write-MiDiagnostic -Code "MI-UAMI-010" -Context $Stage `
            -Message "Unexpected IMDS failure." `
            -Detail $msg `
            -Resolution "Check VM identity assignment, IMDS reachability (no proxy!), and Client ID correctness."
        throw $Exception
    }
}

# ── Test-UserAssignedManagedIdentity ──────────────────────────────────────
# Runs all UAMI pre-flight checks and returns all three tokens so Stage 2 can
# seed caches without issuing any additional IMDS round-trips.
# Returns: @{ ArmToken = ...; GraphToken = ...; StorageToken = ... }
function Test-UserAssignedManagedIdentity {
    param(
        [Parameter(Mandatory)][string]$ClientId,
        [Parameter(Mandatory)][string]$TenantId
    )

    Write-Log "=== UAMI PRE-FLIGHT DIAGNOSTICS ==="

    # ── Input validation ──────────────────────────────────────────────────
    if ([string]::IsNullOrWhiteSpace($ClientId)) {
        Write-MiDiagnostic -Code "MI-UAMI-001" -Context "UAMI validation" `
            -Message "Automation Variable 'UserAssignedManagedIdentityClientId' is missing or empty." `
            -Resolution "Create Automation Variable 'UserAssignedManagedIdentityClientId' set to the UAMI Client ID GUID."
        throw "Missing Automation Variable: UserAssignedManagedIdentityClientId"
    }
    if (-not (Test-IsGuid $ClientId)) {
        Write-MiDiagnostic -Code "MI-UAMI-002" -Context "UAMI validation" `
            -Message "The UAMI Client ID is not a valid GUID." `
            -Detail "Value='$ClientId'" `
            -Resolution "Use the Client ID GUID of the user-assigned managed identity, not the display name or resource ID."
        throw "Invalid UAMI Client ID format: $ClientId"
    }
    if (-not (Test-IsGuid $TenantId)) {
        Write-MiDiagnostic -Code "MI-UAMI-003" -Context "Tenant validation" `
            -Message "TargetTenantId is not a valid GUID." `
            -Detail "Value='$TenantId'" `
            -Resolution "Set Automation Variable 'TargetTenantId' to the Azure/Entra tenant GUID."
        throw "Invalid TargetTenantId format: $TenantId"
    }

    Write-Log " UAMI Client ID : $ClientId"
    Write-Log " Target Tenant  : $TenantId"

    # ── Module capability checks ──────────────────────────────────────────
    $azCmd = Get-Command Connect-AzAccount -ErrorAction SilentlyContinue
    if (-not $azCmd) {
        Write-MiDiagnostic -Code "MI-UAMI-011" -Context "Az.Accounts capability check" `
            -Message "Connect-AzAccount not found." `
            -Resolution "Install Az.Accounts on the Hybrid Worker VM: Save-Module Az.Accounts -Path C:\ProgramData\ZtModules"
        throw "Connect-AzAccount not found"
    }
    if (-not $azCmd.Parameters.ContainsKey("AccountId")) {
        Write-MiDiagnostic -Code "MI-UAMI-012" -Context "Az.Accounts capability check" `
            -Message "This Az.Accounts version does not support -AccountId (required for UAMI sign-in)." `
            -Detail "Installed command does not expose parameter: AccountId" `
            -Resolution "Update Az.Accounts: Install-Module Az.Accounts -Force -AllowClobber"
        throw "Az.Accounts is too old for UAMI sign-in"
    }
    $mgCmd = Get-Command Connect-MgGraph -ErrorAction SilentlyContinue
    if (-not $mgCmd) {
        Write-MiDiagnostic -Code "MI-UAMI-013" -Context "Graph SDK capability check" `
            -Message "Connect-MgGraph not found." `
            -Resolution "Install Microsoft.Graph.Authentication on the Hybrid Worker VM."
        throw "Connect-MgGraph not found"
    }
    if (-not $mgCmd.Parameters.ContainsKey("ClientId")) {
        Write-MiDiagnostic -Code "MI-UAMI-014" -Context "Graph SDK capability check" `
            -Message "This Microsoft.Graph.Authentication version does not support -ClientId (required for UAMI)." `
            -Detail "Installed command does not expose parameter: ClientId" `
            -Resolution "Update Microsoft.Graph.Authentication: Install-Module Microsoft.Graph.Authentication -Force -AllowClobber"
        throw "Microsoft Graph module is too old for UAMI sign-in"
    }

    # ── IMDS pre-flight: proxy + TCP reachability ─────────────────────────
    Write-Log " [IMDS Pre-check] Checking proxy and network before IMDS calls..."
    Write-Log "  VM hostname    : $($env:COMPUTERNAME)"
    Write-Log "  PS version     : $($PSVersionTable.PSVersion)"

    try {
        $defaultProxy = [System.Net.WebRequest]::DefaultWebProxy
        if ($null -eq $defaultProxy) {
            Write-Log "  DefaultWebProxy : null (no proxy set)"
        }
        else {
            $testUri       = [uri]"http://169.254.169.254/"
            $resolvedProxy = $defaultProxy.GetProxy($testUri)
            if ($resolvedProxy.ToString() -eq $testUri.ToString()) {
                Write-Log "  DefaultWebProxy : bypassed for 169.254.169.254 (direct)"
            }
            else {
                Write-Log "  DefaultWebProxy : $resolvedProxy  <- PROXY ACTIVE -- will be bypassed for all IMDS calls" "WARN"
                Write-Log "  NOTE: This proxy is the most likely cause of past IMDS hangs." "WARN"
            }
        }
    }
    catch { Write-Log "  DefaultWebProxy check failed: $($_.Exception.Message)" "WARN" }

    $httpProxy  = [System.Environment]::GetEnvironmentVariable("HTTP_PROXY")
    $noProxy    = [System.Environment]::GetEnvironmentVariable("NO_PROXY")
    if ($httpProxy) { Write-Log "  HTTP_PROXY env  : $httpProxy" "WARN" }
    if ($noProxy)   { Write-Log "  NO_PROXY env    : $noProxy" }

    $imdsReachable = Test-ImdsReachable -TimeoutMs 3000
    if (-not $imdsReachable) {
        Write-MiDiagnostic -Code "MI-UAMI-030" -Context "IMDS TCP reachability" `
            -Message "Cannot reach 169.254.169.254:80 at TCP level. IMDS is blocked." `
            -Detail "TCP connect to 169.254.169.254:80 timed out after 3 seconds." `
            -Resolution "1. Ensure this is an Azure VM (not on-premises). 2. Check NSG/firewall rules -- nothing should block outbound to 169.254.169.254:80. 3. Check for custom UDRs that blackhole 169.254.169.254. 4. Confirm the HybridWorkerAgent service is running."
        throw "IMDS 169.254.169.254:80 is not reachable -- cannot acquire managed identity tokens."
    }

    # ── Test 1: ARM token ─────────────────────────────────────────────────
    Write-Log " [UAMI Test 1] Requesting ARM token from IMDS..."
    $armToken = $null
    try {
        $armToken = Get-ImdsToken -Resource "https://management.azure.com/" -ClientId $ClientId
    }
    catch {
        Resolve-ImdsFailure -Stage "UAMI ARM token test" -Exception $_.Exception -ClientId $ClientId
    }

    if (-not $armToken -or -not $armToken.access_token) {
        Write-MiDiagnostic -Code "MI-UAMI-015" -Context "UAMI ARM token test" `
            -Message "IMDS returned a response but no access_token for ARM." `
            -Detail ($armToken | ConvertTo-Json -Depth 5) `
            -Resolution "Confirm the UAMI is assigned to the VM and the Client ID is correct."
        throw "ARM token missing from IMDS response"
    }

    $armJwt = ConvertFrom-JwtPayload -Jwt $armToken.access_token
    Write-Log "  ARM token acquired OK"
    if ($armJwt) {
        # Use Get-JwtClaim for ALL property access to be safe under PS 5.1 StrictMode.
        # Directly accessing a missing property on a PSCustomObject throws on PS 5.1
        # with Set-StrictMode -Version Latest; Get-JwtClaim uses PSObject.Properties
        # to check before reading, returning an empty string when absent.
        Write-Log "   ARM appid     : $(Get-JwtClaim $armJwt 'appid')"
        Write-Log "   ARM oid       : $(Get-JwtClaim $armJwt 'oid')"
        Write-Log "   ARM tid       : $(Get-JwtClaim $armJwt 'tid')"
        Write-Log "   ARM aud       : $(Get-JwtClaim $armJwt 'aud')"
        $armXmsMirid = Get-JwtClaim $armJwt 'xms_mirid'
        if ($armXmsMirid) {
            Write-Log "   ARM xms_mirid : $armXmsMirid"
        }
        else {
            Write-Log "   ARM xms_mirid : <not present in token>" "WARN"
        }
        $armExpStr = Get-JwtClaim $armJwt 'exp'
        if ($armExpStr) {
            Write-Log "   ARM exp (UTC) : $([DateTimeOffset]::FromUnixTimeSeconds([int64]$armExpStr).UtcDateTime)"
        }
    }

    $armAppId = Get-JwtClaim $armJwt 'appid'
    $armTid   = Get-JwtClaim $armJwt 'tid'

    if ($armJwt -and $armAppId -and ($armAppId -ne $ClientId)) {
        Write-MiDiagnostic -Code "MI-UAMI-016" -Context "UAMI ARM token validation" `
            -Message "ARM token was issued for a different managed identity." `
            -Detail "Requested ClientId=$ClientId; Token appid=$armAppId" `
            -Resolution "Confirm the correct UAMI Client ID is in the Automation Variable."
        throw "ARM token appid mismatch"
    }
    if ($armJwt -and $armTid -and ($armTid -ne $TenantId)) {
        Write-MiDiagnostic -Code "MI-UAMI-017" -Context "UAMI ARM token validation" `
            -Message "ARM token tenant does not match TargetTenantId." `
            -Detail "Token tid=$armTid; TargetTenantId=$TenantId" `
            -Resolution "Ensure TargetTenantId matches the tenant where the UAMI lives."
        throw "ARM token tenant mismatch"
    }

    # ── Test 2: Graph token ───────────────────────────────────────────────
    Write-Log " [UAMI Test 2] Requesting Microsoft Graph token from IMDS..."
    $graphToken = $null
    try {
        $graphToken = Get-ImdsToken -Resource "https://graph.microsoft.com/" -ClientId $ClientId
    }
    catch {
        Resolve-ImdsFailure -Stage "UAMI Graph token test" -Exception $_.Exception -ClientId $ClientId
    }

    if (-not $graphToken -or -not $graphToken.access_token) {
        Write-MiDiagnostic -Code "MI-UAMI-018" -Context "UAMI Graph token test" `
            -Message "IMDS returned a response but no access_token for Graph." `
            -Detail ($graphToken | ConvertTo-Json -Depth 5) `
            -Resolution "Confirm the UAMI is assigned to the VM."
        throw "Graph token missing from IMDS response"
    }

    $graphJwt = ConvertFrom-JwtPayload -Jwt $graphToken.access_token
    Write-Log "  Graph token acquired OK"
    if ($graphJwt) {
        Write-Log "   Graph appid     : $(Get-JwtClaim $graphJwt 'appid')"
        Write-Log "   Graph oid       : $(Get-JwtClaim $graphJwt 'oid')"
        Write-Log "   Graph tid       : $(Get-JwtClaim $graphJwt 'tid')"
        Write-Log "   Graph aud       : $(Get-JwtClaim $graphJwt 'aud')"
        $graphXmsMirid = Get-JwtClaim $graphJwt 'xms_mirid'
        if ($graphXmsMirid) {
            Write-Log "   Graph xms_mirid : $graphXmsMirid"
        }
        else {
            Write-Log "   Graph xms_mirid : <not present in token>" "WARN"
        }
        $graphExpStr = Get-JwtClaim $graphJwt 'exp'
        if ($graphExpStr) {
            Write-Log "   Graph exp (UTC) : $([DateTimeOffset]::FromUnixTimeSeconds([int64]$graphExpStr).UtcDateTime)"
        }
    }

    $graphAppId = Get-JwtClaim $graphJwt 'appid'
    $graphTid   = Get-JwtClaim $graphJwt 'tid'

    if ($graphJwt -and $graphAppId -and ($graphAppId -ne $ClientId)) {
        Write-MiDiagnostic -Code "MI-UAMI-019" -Context "UAMI Graph token validation" `
            -Message "Graph token was issued for a different managed identity." `
            -Detail "Requested ClientId=$ClientId; Token appid=$graphAppId" `
            -Resolution "Confirm the correct UAMI Client ID is in the Automation Variable."
        throw "Graph token appid mismatch"
    }
    if ($graphJwt -and $graphTid -and ($graphTid -ne $TenantId)) {
        Write-MiDiagnostic -Code "MI-UAMI-020" -Context "UAMI Graph token validation" `
            -Message "Graph token tenant does not match TargetTenantId." `
            -Detail "Token tid=$graphTid; TargetTenantId=$TenantId" `
            -Resolution "Ensure TargetTenantId matches the tenant where the UAMI lives."
        throw "Graph token tenant mismatch"
    }

    # ── Test 3: Live Graph API probe ──────────────────────────────────────
    Write-Log " [UAMI Test 3] Probing Graph API /organization with the IMDS token..."
    $sw3 = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $orgResult = Invoke-RestMethod `
            -Uri        "https://graph.microsoft.com/v1.0/organization?`$select=id,displayName" `
            -Headers    @{ Authorization = "Bearer $($graphToken.access_token)" } `
            -Method     GET `
            -TimeoutSec 30 `
            -ErrorAction Stop
        $sw3.Stop()
        Write-Log "  Graph /organization responded in $($sw3.ElapsedMilliseconds)ms"
        if ($orgResult.value -and $orgResult.value.Count -gt 0) {
            Write-Log "  Graph API probe OK : $($orgResult.value[0].displayName) [$($orgResult.value[0].id)]"
        }
        else {
            Write-Log "  Graph API probe returned no org objects." "WARN"
        }
    }
    catch {
        $sw3.Stop()
        Write-MiDiagnostic -Code "MI-UAMI-021" -Context "UAMI Graph API probe" `
            -Message "A Graph token was acquired but a simple Graph API call failed after $($sw3.ElapsedMilliseconds)ms." `
            -Detail $_.Exception.Message `
            -Resolution "The UAMI likely lacks required Graph application permissions or admin consent. Ensure Global Reader is assigned in Entra ID."
        throw $_
    }

    # ── Test 4: Storage token ─────────────────────────────────────────────
    Write-Log " [UAMI Test 4] Requesting Storage token (https://storage.azure.com/) from IMDS..."
    $storageToken = $null
    try {
        $storageToken = Get-ImdsToken -Resource "https://storage.azure.com/" -ClientId $ClientId
    }
    catch {
        Resolve-ImdsFailure -Stage "UAMI Storage token test" -Exception $_.Exception -ClientId $ClientId
    }

    if (-not $storageToken -or -not $storageToken.access_token) {
        Write-MiDiagnostic -Code "MI-UAMI-025" -Context "UAMI Storage token test" `
            -Message "IMDS returned a response but no access_token for https://storage.azure.com/." `
            -Detail ($storageToken | ConvertTo-Json -Depth 5) `
            -Resolution "Confirm the UAMI is assigned to the VM and has 'Storage Blob Data Contributor' on the storage account."
        throw "Storage token missing from IMDS response"
    }

    $stJwt = ConvertFrom-JwtPayload -Jwt $storageToken.access_token
    Write-Log "  Storage token acquired OK"
    if ($stJwt) {
        # Get-JwtClaim guards against PS 5.1 StrictMode property-not-found throw
        $stAppId = Get-JwtClaim $stJwt 'appid'
        $stAud   = Get-JwtClaim $stJwt 'aud'
        $stExp   = Get-JwtClaim $stJwt 'exp'
        if ($stAppId) { Write-Log "   Storage appid     : $stAppId" }
        if ($stAud)   { Write-Log "   Storage aud       : $stAud" }
        if ($stExp)   { Write-Log "   Storage exp (UTC) : $([DateTimeOffset]::FromUnixTimeSeconds([int64]$stExp).UtcDateTime)" }
    }

    Write-Log "=== UAMI PRE-FLIGHT DIAGNOSTICS PASSED ==="

    # Return all three tokens so Stage 2 can seed caches without extra IMDS calls
    return @{
        ArmToken     = $armToken
        GraphToken   = $graphToken
        StorageToken = $storageToken
    }
}

#endregion

#region ── 0c. Hybrid Worker environment diagnostics ───────────────────────

# The Hybrid Worker service sometimes strips standard module paths from PSModulePath.
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

Write-Log "=== HYBRID WORKER DIAGNOSTICS ==="
Write-Log " Hostname     : $($env:COMPUTERNAME)"
Write-Log " PS Version   : $($PSVersionTable.PSVersion)"
Write-Log " OS           : $([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
Write-Log " Date         : $today"
Write-Log " Temp Path    : $($env:TEMP)"
Write-Log " UserProfile  : $($env:USERPROFILE)"
Write-Log " Module Paths : $($env:PSModulePath -replace ';', '; ')"
Write-Log "=================================="

#endregion

#region ── STAGE 0: Validate local modules ────────────────────────────────

Write-Log "--- STAGE 0: Validating local modules ---"

$requiredModules = @(
    "Az.Accounts",
    "Az.Storage",
    "Az.ResourceGraph",
    "Az.Security",
    "Az.PolicyInsights",          # required for Get-AzPolicyState fallback in Stage 7b
    "Microsoft.Graph.Authentication",
    "Microsoft.Graph.Identity.DirectoryManagement",
    "Microsoft.Graph.Users",
    "Microsoft.Graph.Groups",
    "Microsoft.Graph.Applications",
    "Microsoft.Graph.DeviceManagement",
    "PSFramework",
    "ZeroTrustAssessment"
)

$missingModules = @()
foreach ($mod in $requiredModules) {
    $found = Get-Module -Name $mod -ListAvailable |
        Sort-Object Version -Descending | Select-Object -First 1
    if ($found) {
        Write-Log " [OK] $mod ($($found.Version))"
    }
    else {
        Write-Log " [MISSING] $mod -- NOT FOUND" "ERROR"
        $missingModules += $mod
    }
}

if ($missingModules.Count -gt 0) {
    Write-DiagnosticError `
        -Context "Stage 0 -- Module validation" `
        -Message "$($missingModules.Count) required module(s) are not installed on this Hybrid Worker VM." `
        -Detail "Missing: $($missingModules -join ', ')" `
        -Resolution "RDP into the VM, open pwsh and run: Save-Module -Name <module> -Path C:\ProgramData\ZtModules -Force"
    throw "Missing modules: $($missingModules -join ', ')"
}
Write-Log "All $($requiredModules.Count) modules found."

#endregion

#region ── STAGE 1: Read Automation Variables ─────────────────────────────

Write-Log "--- STAGE 1: Reading Automation Variables ---"

$authMethod = Get-AutomationVariable -Name "AuthMethod" -ErrorAction SilentlyContinue
if (-not $authMethod) {
    Write-Log "AuthMethod variable not found -- defaulting to 'ManagedIdentity'." "WARN"
    Write-Log "To suppress this warning: create Automation Variable 'AuthMethod' = 'ManagedIdentity'." "WARN"
    $authMethod = "ManagedIdentity"
}
Write-Log " AuthMethod : $authMethod"

try {
    $storageAccountName = Get-AutomationVariable -Name "StorageAccountName" -ErrorAction Stop
    $containerName      = Get-AutomationVariable -Name "BlobContainerName"  -ErrorAction Stop
    $targetTenantId     = Get-AutomationVariable -Name "TargetTenantId"     -ErrorAction Stop
}
catch {
    Write-DiagnosticError `
        -Context "Stage 1 -- Reading core Automation Variables" `
        -Message "One or more required Automation Variables are missing." `
        -Detail $_.Exception.Message `
        -Resolution "Ensure these exist in Automation Account > Shared Resources > Variables: StorageAccountName, BlobContainerName, TargetTenantId."
    throw $_
}

Write-Log " StorageAccountName : $storageAccountName"
Write-Log " BlobContainerName  : $containerName"
Write-Log " TargetTenantId     : $targetTenantId"

# Declared at script scope here so Get-StorageAccessToken can reference it as
# $script:uamiClientId from any call depth. Set to $null initially; overwritten
# below for ManagedIdentity path. AppRegistration path leaves it $null, which
# routes Get-StorageAccessToken to the Get-AzAccessToken branch.
$uamiClientId = $null

if ($authMethod -eq 'ManagedIdentity') {
    $uamiClientId = Get-AutomationVariable -Name "UserAssignedManagedIdentityClientId" -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($uamiClientId)) {
        Write-MiDiagnostic `
            -Code "MI-UAMI-001" `
            -Context "Stage 1 -- Reading Automation Variables" `
            -Message "AuthMethod='ManagedIdentity' but 'UserAssignedManagedIdentityClientId' variable is missing." `
            -Resolution "Create Automation Variable 'UserAssignedManagedIdentityClientId' = the UAMI Client ID GUID."
        throw "Missing required Automation Variable: UserAssignedManagedIdentityClientId"
    }
    Write-Log " UAMI Client ID     : $uamiClientId"
}

#endregion

#region ── STAGE 2: Authenticate ──────────────────────────────────────────

Write-Log "--- STAGE 2: Authenticating ---"

# Suppress WAM / interactive auth prompts that would hang a non-interactive runbook
Write-Log "Suppressing WAM and interactive auth prompts..."
$env:AZURE_IDENTITY_DISABLE_INTERACTIVEBROWSERCREDENTIAL = "true"
$env:AZURE_IDENTITY_DISABLE_MULTITENANTAUTH              = "true"
$env:AZURE_IDENTITY_DISABLE_VISUALSTUDIOCREDENTIAL       = "true"
$env:AZURE_IDENTITY_DISABLE_SHAREDTOKENCACHECREDENTIAL   = "true"

if ($authMethod -eq 'ManagedIdentity') {

    Write-Log "Auth method : Managed Identity (UAMI on Hybrid Worker VM via IMDS)"
    Write-Log "NOTE: On a Hybrid Worker, MI tokens come from the VM's IMDS (169.254.169.254), not the Automation Account."

    # ── Clear Hybrid Worker Agent MSI environment variables ──────────────
    # ROOT CAUSE FIX: The Hybrid Worker Agent injects IDENTITY_ENDPOINT (and related
    # vars) as process-level env vars pointing to the Automation Account's own
    # internal token service. The Azure Identity SDK honours those vars and sends
    # the UAMI client_id to that endpoint -- which returns an error because the
    # Automation endpoint does not support UAMI selection by client_id.
    #
    # Our Get-ImdsToken calls bypass the SDK entirely (raw HTTP to 169.254.169.254)
    # so they succeed regardless. But Connect-AzAccount uses the SDK internally,
    # which would hit the Automation endpoint instead of IMDS without this cleanup.
    #
    # Fix: unset these vars BEFORE Connect-AzAccount so the SDK falls back to
    # direct IMDS, which the pre-flight has already proven works for this UAMI.
    $msiEnvVars = @('IDENTITY_ENDPOINT','IDENTITY_HEADER','MSI_ENDPOINT','MSI_SECRET')
    foreach ($v in $msiEnvVars) {
        $current = [System.Environment]::GetEnvironmentVariable($v)
        if ($null -ne $current) {
            Write-Log "  Clearing inherited MSI env var: $v (was redirecting Azure.Identity away from IMDS)" "WARN"
            [System.Environment]::SetEnvironmentVariable($v, $null)
        }
    }
    Write-Log "  MSI env-var cleanup done -- Azure.Identity will now use VM IMDS directly."

    # Run preflight diagnostics -- returns all three tokens (ARM, Graph, Storage).
    # NOTE: MSI env vars must be cleared BEFORE this call so Test-UserAssignedManagedIdentity
    # runs its IMDS checks in the same environment that Connect-AzAccount will see.
    $preflightTokens = Test-UserAssignedManagedIdentity -ClientId $uamiClientId -TenantId $targetTenantId
    $armToken     = $preflightTokens.ArmToken
    $graphToken   = $preflightTokens.GraphToken
    $storageToken = $preflightTokens.StorageToken

    # Seed the storage token cache. Upload-JsonBlob refreshes lazily when
    # within 5 minutes of expiry, so no extra IMDS calls until the token nears expiry.
    $script:StorageBearerToken = [string]$storageToken.access_token
    $script:StorageTokenExpiry = [int64]$storageToken.expires_on
    Write-Log "  Storage token cache seeded. Expires: $([DateTimeOffset]::FromUnixTimeSeconds($script:StorageTokenExpiry).UtcDateTime) UTC"

    # ── Connect-AzAccount ─────────────────────────────────────────────────
    # Use -Identity -AccountId, NOT -AccessToken.
    # -AccessToken creates a static single-resource session that cannot acquire
    # tokens for other resources (e.g. storage, Key Vault). -Identity -AccountId
    # registers the UAMI as a live ManagedServiceIdentity credential so Az.Accounts
    # calls IMDS on-demand for whatever resource it needs.
    Write-Log "Calling Connect-AzAccount -Identity -AccountId (live UAMI credential)..."
    try {
        Connect-AzAccount `
            -Identity  `
            -AccountId $uamiClientId `
            -Tenant    $targetTenantId | Out-Null
        Write-Log "Connect-AzAccount (UAMI) -- OK"
    }
    catch {
        Write-MiDiagnostic -Code "MI-UAMI-022" -Context "Stage 2 -- Connect-AzAccount" `
            -Message "Failed to authenticate to Azure with the UAMI." `
            -Detail $_.Exception.Message `
            -Resolution "Confirm the UAMI is attached to the Hybrid Worker VM (VM > Identity > User assigned), the Client ID is correct, and IMDS is reachable (no proxy blocking 169.254.169.254)."
        throw $_
    }

    # ── Connect-MgGraph ───────────────────────────────────────────────────
    #   -Identity -ClientId registers ManagedIdentityCredential inside the
    #   Graph SDK.  Azure.Identity calls IMDS on-demand and transparently
    #   refreshes the token before expiry — no manual handling needed.
    #
    #   -ContextScope Process isolates this session from any persisted
    #   CurrentUser token cache on the Hybrid Worker VM, preventing
    #   cross-run interference.
    #
    # PREREQUISITE (already met):
    #   MSI env vars (IDENTITY_ENDPOINT, MSI_ENDPOINT, etc.) were cleared
    #   above (lines 934-941), forcing Azure.Identity to use VM IMDS
    #   directly instead of the Automation Account's token endpoint.
    Write-Log "Calling Connect-MgGraph -Identity -ClientId (live UAMI credential with auto-refresh)..."
    try {
        Connect-MgGraph -Identity -ClientId $uamiClientId -ContextScope Process -NoWelcome | Out-Null
        Write-Log "Connect-MgGraph (UAMI) -- OK"
    }
    catch {
        Write-MiDiagnostic -Code "MI-UAMI-023" -Context "Stage 2 -- Connect-MgGraph" `
            -Message "Failed to connect to Microsoft Graph using the UAMI identity credential." `
            -Detail $_.Exception.Message `
            -Resolution "Confirm the UAMI has the required Graph application permissions with admin consent."
        throw $_
    }

}
elseif ($authMethod -eq 'AppRegistration') {

    Write-Log "Auth method : App Registration (Service Principal)"
    try {
        $appClientId     = Get-AutomationVariable -Name "AppClientId"     -ErrorAction Stop
        $appClientSecret = Get-AutomationVariable -Name "AppClientSecret" -ErrorAction Stop
    }
    catch {
        Write-DiagnosticError `
            -Context "Stage 2 -- Reading AppRegistration Variables" `
            -Message "AppClientId or AppClientSecret Automation Variables are missing." `
            -Detail $_.Exception.Message `
            -Resolution "Create both in Automation Account > Variables. Mark AppClientSecret as Encrypted."
        throw $_
    }
    Write-Log " App Client ID : $appClientId"

    $secureSecret = ConvertTo-SecureString $appClientSecret -AsPlainText -Force
    $cred         = New-Object System.Management.Automation.PSCredential($appClientId, $secureSecret)

    try {
        Connect-AzAccount -ServicePrincipal -Credential $cred -Tenant $targetTenantId | Out-Null
        Write-Log "Connect-AzAccount (App Registration) -- OK"
    }
    catch {
        Write-DiagnosticError `
            -Context "Stage 2 -- Connect-AzAccount" `
            -Message "Failed to authenticate to Azure using Service Principal." `
            -Detail $_.Exception.Message `
            -Resolution "Ensure AppClientId and AppClientSecret are valid and have not expired."
        throw $_
    }

    try {
        Connect-MgGraph -ClientSecretCredential $cred -TenantId $targetTenantId -NoWelcome -ContextScope Process | Out-Null
        Write-Log "Connect-MgGraph (App Registration) -- OK"
    }
    catch {
        Write-DiagnosticError `
            -Context "Stage 2 -- Connect-MgGraph (AppRegistration)" `
            -Message "Azure auth succeeded but Microsoft Graph token bootstrap failed." `
            -Detail $_.Exception.Message `
            -Resolution "Ensure AppClientId has the required App Roles assigned in Entra ID."
        throw $_
    }

    # AppRegistration: no preflight storage token -- Get-StorageAccessToken will
    # call Get-AzAccessToken on first upload attempt. $uamiClientId is already $null
    # so Get-StorageAccessToken routes to the AppRegistration branch automatically.
    $script:StorageBearerToken = $null
    $script:StorageTokenExpiry = [int64]0
    Write-Log " AppRegistration path -- storage token acquired via Get-AzAccessToken on first upload."

}
else {
    Write-DiagnosticError `
        -Context "Stage 2 -- Auth method validation" `
        -Message "AuthMethod has an unrecognised value: '$authMethod'." `
        -Resolution "Set the AuthMethod Automation Variable to 'ManagedIdentity' or 'AppRegistration' (case-sensitive)."
    throw "Invalid AuthMethod: '$authMethod'."
}

#endregion

#region ── STAGE 2b: Discover subscriptions ───────────────────────────────

Write-Log "--- STAGE 2b: Discovering Subscriptions ---"

try {
    $allSubs = @(Get-AzSubscription -TenantId $targetTenantId -ErrorAction Stop |
        Where-Object { $_.State -eq 'Enabled' })
}
catch {
    Write-DiagnosticError `
        -Context "Stage 2b -- Get-AzSubscription" `
        -Message "Failed to list subscriptions -- identity may lack permission." `
        -Detail $_.Exception.Message `
        -Resolution "Assign 'Reader' to the identity at Management Group or subscription scope."
    throw $_
}

$targetSubscriptionIds = @($allSubs | ForEach-Object { $_.Id })

if ($targetSubscriptionIds.Count -eq 0) {
    $rbacMsg = if ($authMethod -eq 'AppRegistration') {
        "The App Registration service principal has no 'Reader' RBAC on any subscription in tenant '$targetTenantId'."
    }
    else {
        "The UAMI has no 'Reader' RBAC on any subscription in tenant '$targetTenantId'."
    }
    Write-DiagnosticError `
        -Context "Stage 2b -- Subscription discovery" `
        -Message "No enabled subscriptions found in tenant '$targetTenantId'." `
        -Detail "$rbacMsg  Fix: Azure Portal > Subscriptions > IAM > Add role assignment > Reader."
    throw "No enabled subscriptions found. $rbacMsg"
}

Write-Log "Found $($targetSubscriptionIds.Count) enabled subscription(s):"
foreach ($s in $allSubs) { Write-Log " * $($s.Name) [$($s.Id)]" }

#endregion

#region ── STAGE 2c: Pre-flight permission validation ─────────────────────

Write-Log "--- STAGE 2c: Pre-flight Permission Checks ---"
Write-Log "Validating permissions before the long-running assessment..."

$requiredGraphScopes = @(
    'AuditLog.Read.All'
    'CrossTenantInformation.ReadBasic.All'
    'DeviceManagementApps.Read.All'
    'DeviceManagementConfiguration.Read.All'
    'DeviceManagementManagedDevices.Read.All'
    'DeviceManagementRBAC.Read.All'
    'DeviceManagementServiceConfig.Read.All'
    'Directory.Read.All'
    'DirectoryRecommendations.Read.All'
    'EntitlementManagement.Read.All'
    'IdentityRiskEvent.Read.All'
    'IdentityRiskyUser.Read.All'
    'Policy.Read.All'
    'Policy.Read.ConditionalAccess'
    'Policy.Read.PermissionGrant'
    'PrivilegedAccess.Read.AzureAD'
    'Reports.Read.All'
    'RoleManagement.Read.All'
    'UserAuthenticationMethod.Read.All'
)

# ── Check 1: Graph permissions ────────────────────────────────────────────
Write-Log " [Check 1] Validating Microsoft Graph permissions..."
try {
    $mgContext = Get-MgContext -ErrorAction Stop
    if (-not $mgContext) { throw "No active Microsoft Graph session found." }
    Write-Log "  Graph context: AuthType=$($mgContext.AuthType), TenantId=$($mgContext.TenantId), ClientId=$($mgContext.ClientId)"

    if ($mgContext.AuthType -ne 'Delegated') {
        Write-Log "  App-only auth -- checking appRoleAssignments on the service principal..."
        try {
            $clientId         = $mgContext.ClientId
            $spLookupUri      = "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq '$clientId'&`$select=id,displayName,appId"
            $graphSpLookupUri = "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq '00000003-0000-0000-c000-000000000000'&`$select=id,appRoles"

            $spResult = Invoke-MgGraphRequest -Uri $spLookupUri -Method GET -ErrorAction Stop
            if (-not $spResult.value -or $spResult.value.Count -eq 0) {
                throw "Service principal not found for appId '$clientId'."
            }
            $spId          = $spResult.value[0].id
            $spDisplayName = $spResult.value[0].displayName
            if (-not $spId) { throw "Service principal ID was empty for appId '$clientId'." }
            Write-Log "  Service principal: $spDisplayName [$spId]"

            $graphSpResult = Invoke-MgGraphRequest -Uri $graphSpLookupUri -Method GET -ErrorAction Stop
            if (-not $graphSpResult.value -or $graphSpResult.value.Count -eq 0) {
                throw "Microsoft Graph service principal not found."
            }
            $graphSpId     = $graphSpResult.value[0].id
            $graphAppRoles = $graphSpResult.value[0].appRoles
            if (-not $graphSpId) { throw "Microsoft Graph service principal ID was empty." }

            # $filter with a bare GUID works for the resourceId GUID field in Graph API
            $roleAssignmentsUri = "https://graph.microsoft.com/v1.0/servicePrincipals/$spId/appRoleAssignments" +
                                  "?`$filter=resourceId eq $graphSpId&`$top=200"
            $roleAssignments    = Invoke-MgGraphRequest -Uri $roleAssignmentsUri -Method GET -ErrorAction Stop

            $roleIdToName = @{}
            foreach ($role in $graphAppRoles) { $roleIdToName[$role.id] = $role.value }

            $grantedScopes = @()
            foreach ($assignment in $roleAssignments.value) {
                $roleName = $roleIdToName[$assignment.appRoleId]
                if ($roleName) { $grantedScopes += $roleName }
            }
            $grantedScopes = @($grantedScopes | Sort-Object -Unique)
            $missingScopes = @($requiredGraphScopes | Where-Object { $grantedScopes -notcontains $_ })

            if ($missingScopes.Count -gt 0) {
                $entraUrl       = "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/$clientId/isMSAApp~/false"
                $principalLabel = if ($authMethod -eq 'ManagedIdentity') { "UAMI service principal" } else { "App Registration service principal" }
                Write-DiagnosticError `
                    -Context "Stage 2c -- Graph API permissions" `
                    -Message "$($missingScopes.Count) required Graph Application permission(s) NOT granted to this $principalLabel." `
                    -Detail "Missing: $($missingScopes -join ', ')" `
                    -Resolution "In Entra ID add the missing Graph Application permissions, grant admin consent, wait 5 min, re-run. Reference: $entraUrl"
                throw "Pre-flight failed: $($missingScopes.Count) missing Graph permission(s): $($missingScopes -join ', ')"
            }
            Write-Log "  OK: All $($requiredGraphScopes.Count) required Graph permissions are granted ($($grantedScopes.Count) total granted)."
        }
        catch {
            if ($_.Exception.Message -like '*Pre-flight failed*') { throw $_ }
            Write-Log "  [WARN] Could not enumerate appRoleAssignments (non-fatal): $($_.Exception.Message)" "WARN"
            Write-Log "  Falling back to Graph data probe to verify access..." "WARN"
        }
    }
    else {
        $currentScopes = $mgContext.Scopes
        $missingScopes = @($requiredGraphScopes | Where-Object { $currentScopes -notcontains $_ })
        if ($missingScopes.Count -gt 0) {
            Write-DiagnosticError `
                -Context "Stage 2c -- Graph API scopes (Delegated)" `
                -Message "$($missingScopes.Count) required Graph scope(s) missing from the current session." `
                -Detail "Missing: $($missingScopes -join ', ')" `
                -Resolution "Re-authenticate with the required scopes: Connect-MgGraph -Scopes (Get-ZtGraphScope)"
            throw "Pre-flight failed: $($missingScopes.Count) missing Graph scope(s)."
        }
        Write-Log "  OK: All $($requiredGraphScopes.Count) required Graph scopes present."
    }
}
catch {
    if ($_.Exception.Message -like '*Pre-flight failed*') { throw $_ }
    Write-DiagnosticError `
        -Context "Stage 2c -- Graph context validation" `
        -Message "Failed to validate Microsoft Graph session." `
        -Detail $_.Exception.Message `
        -Resolution "Check that Stage 2 authentication completed successfully."
    throw $_
}

# ── Check 2: Graph data probe ─────────────────────────────────────────────
Write-Log " [Check 2] Probing Graph /organization..."
try {
    $probeResult = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/organization" -Method GET -ErrorAction Stop
    if (-not $probeResult.value -or $probeResult.value.Count -eq 0) {
        throw "Graph returned empty organization data."
    }
    Write-Log " OK: Graph probe succeeded -- Organization: $($probeResult.value[0].displayName)"
}
catch {
    Write-DiagnosticError `
        -Context "Stage 2c -- Graph data probe" `
        -Message "Authenticated to Graph but cannot read tenant data." `
        -Detail $_.Exception.Message `
        -Resolution "Identity may lack Directory.Read.All, admin consent, or Global Reader role in Entra."
    throw $_
}

Write-Log " Pre-flight checks passed."

#endregion

#region ── STAGE 3: Connect to storage account ────────────────────────────
#
# CHANGE FROM PREVIOUS VERSION:
#   All Az.Storage SDK calls (New-AzStorageContext -UseConnectedAccount,
#   Set-AzStorageBlobContent) have been removed. Storage interaction now uses
#   the Azure Blob REST API directly with a Bearer token sourced from IMDS.
#   This eliminates the Az.Accounts SDK token-path failure that produced:
#     "Access token authenticator failed to retrieve access token for resource '<storageaccname>'"
#
# $ctx is retained as $null so all Upload-JsonBlob call sites that pass
# -StorageContext $ctx compile without changes. The parameter is accepted but
# ignored inside Upload-JsonBlob.

Write-Log "--- STAGE 3: Connecting to Storage Account ---"

$ctx                 = $null   # kept for call-site compatibility; not used
$azureSubscriptionId = $null

try {
    Write-Log " Searching '$storageAccountName' across $($allSubs.Count) subscription(s)..."
    foreach ($sub in $allSubs) {
        try {
            Set-AzContext -SubscriptionId $sub.Id -ErrorAction Stop | Out-Null
            $found = Get-AzStorageAccount -ErrorAction Stop |
                Where-Object { $_.StorageAccountName -eq $storageAccountName } |
                Select-Object -First 1
            if ($found) {
                $azureSubscriptionId = $sub.Id
                Write-Log " Found '$storageAccountName' in: $($sub.Name) [$($sub.Id)]"
                break
            }
        }
        catch {
            Write-Log " [WARN] Could not query storage in $($sub.Id): $($_.Exception.Message)" "WARN"
        }
    }

    if (-not $azureSubscriptionId) {
        Write-DiagnosticError `
            -Context "Stage 3 -- Storage account discovery" `
            -Message "Storage account '$storageAccountName' not found in any accessible subscription." `
            -Detail "Searched $($allSubs.Count) subscription(s): $(($allSubs | ForEach-Object { $_.Id }) -join ', ')" `
            -Resolution "1. Confirm 'StorageAccountName' Automation Variable is correct. 2. Ensure the UAMI has 'Reader' on the storage account's subscription."
        throw "Storage account '$storageAccountName' not found."
    }

    Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction Stop | Out-Null
    Write-Log " Storage account  : $storageAccountName"
    Write-Log " Storage sub ID   : $azureSubscriptionId"
    Write-Log " Storage context  : REST/Bearer (bypasses Az.Storage SDK token path)"

    # Cache the account name at script scope so Upload-JsonBlob can build correct
    # URIs without relying on the outer free variable $storageAccountName.
    $script:StorageAccountNameCache = $storageAccountName

    # ── Ensure container exists (REST, no Az.Storage SDK) ────────────────
    Write-Log " Checking container '$containerName' via REST..."

    # Ensure the Bearer token is fresh. Use Get-StorageAccessToken (handles both
    # UAMI and AppRegistration) rather than Get-ImdsToken directly.
    $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    if ([string]::IsNullOrWhiteSpace($script:StorageBearerToken) -or
        ($nowEpoch + 300) -ge $script:StorageTokenExpiry) {
        Write-Log "  Refreshing storage Bearer token before container check..."
        $t = Get-StorageAccessToken
        $script:StorageBearerToken = [string]$t.access_token
        $script:StorageTokenExpiry = [int64]$t.expires_on
    }

    # '?' concatenated outside the string avoids PS 5.1 backtick/query ambiguity
    $containerUri     = "https://" + $storageAccountName +
                        ".blob.core.windows.net/" + $containerName + "?restype=container"
    $containerHeaders = [ordered]@{
        Authorization  = "Bearer $script:StorageBearerToken"
        "x-ms-version" = "2020-04-08"
        "x-ms-date"    = [DateTime]::UtcNow.ToString("R")
    }

    try {
        Invoke-RestMethod -Method GET -Uri $containerUri -Headers $containerHeaders `
            -TimeoutSec 30 -ErrorAction Stop | Out-Null
        Write-Log " Container '$containerName' -- exists OK"
    }
    catch {
        $sc = $null
        try { $sc = [int]$_.Exception.Response.StatusCode } catch { }
        if ($sc -eq 404) {
            Write-Log " Container '$containerName' not found -- creating via REST..." "WARN"
            try {
                Invoke-RestMethod -Method PUT -Uri $containerUri -Headers $containerHeaders `
                    -TimeoutSec 30 -ErrorAction Stop | Out-Null
                Write-Log " Container '$containerName' created OK"
            }
            catch {
                Write-DiagnosticError `
                    -Context "Stage 3 -- Container creation" `
                    -Message "Failed to create container '$containerName' (HTTP PUT failed)." `
                    -Detail $_.Exception.Message `
                    -Resolution "Assign 'Storage Blob Data Contributor' to the UAMI on the storage account."
                throw $_
            }
        }
        else {
            Write-DiagnosticError `
                -Context "Stage 3 -- Container check" `
                -Message "Unexpected error checking container '$containerName' (HTTP $sc)." `
                -Detail $_.Exception.Message `
                -Resolution "Confirm the UAMI has 'Storage Blob Data Contributor' on the storage account."
            throw $_
        }
    }

    # ── Storage write probe ───────────────────────────────────────────────
    # -ThrowOnFailure stops the runbook immediately if the write fails, rather
    # than silently continuing with broken storage access.
    Write-Log " [Check 3] Probing storage write access via Blob REST API..."
    $probeData = [ordered]@{ probe = "ok"; ts = (Get-Date).ToString('o') }
    Upload-JsonBlob `
        -BlobPath       "probe/write-test.json" `
        -Data           $probeData `
        -StorageContext $null `
        -Container      $containerName `
        -ThrowOnFailure
    Write-Log " OK: Storage write probe succeeded -- '$containerName' is writable."
}
catch {
    Write-DiagnosticError `
        -Context "Stage 3 -- Storage Account connection" `
        -Message "Failed to connect to storage account '$storageAccountName'." `
        -Detail $_.Exception.Message `
        -Resolution "1. Confirm 'StorageAccountName' Automation Variable. 2. Assign 'Storage Blob Data Contributor' to the UAMI on the storage account. 3. Assign 'Reader' on the storage subscription."
    throw $_
}

#endregion

#region ── STAGE 4: Run Zero Trust Assessment ─────────────────────────────

Write-Log "--- STAGE 4: Running Zero Trust Assessment ---"

$reportPath = Join-Path $env:TEMP "ZTReport-$today"
if (Test-Path $reportPath) {
    Write-Log "Removing stale report folder from previous run..."
    Remove-Item -Path $reportPath -Recurse -Force
}

# Skip Connect-ZtAssessment -- Stage 2 already authenticated.
# Calling Connect-MgGraph again on a Windows Hybrid Worker triggers WAM interactive prompts.
Write-Log "ZeroTrustAssessment will reuse the existing Graph session from Stage 2."

# Workaround: cap DuckDB memory to prevent OOM crashes on memory-constrained VMs
Write-Log "Configuring DuckDB memory limit (500MB)..."
$duckdbrcPath = Join-Path $env:USERPROFILE ".duckdbrc"
"SET max_memory='500MB';" | Out-File -FilePath $duckdbrcPath -Encoding ascii -Force

# Workaround: force HTTP/1.1 to prevent Graph SDK stream errors on large tenant exports
Write-Log "Forcing Graph SDK to HTTP/1.1..."
$env:MicrosoftGraphHttpVersion = "HTTP11"

# Workaround: override Test-ZtContext -- for app-only auth it checks $context.Scopes
# which is just '.default', causing false 'missing scopes' errors. Stage 2c already
# validated all permissions exhaustively so this override is safe.
Write-Log "Overriding Test-ZtContext (app-only auth bypass -- permissions validated in Stage 2c)..."
function global:Test-ZtContext { return $true }

# ── Inject Resilient Wrapper into Module Scope ───────────────────────────
# Some specific API calls inside the generic `Add-ZtDeviceWindowsEnrollment`
# (specifically `Policies/MobileDeviceManagementPolicies`) are Delegated-only
# endpoints. If called with an App-only token (e.g. from a UAMI or SP), Microsoft
# Graph rejects them with an unrecoverable 401 Unauthorized.
#
# Because powerShell module functions execute inside an isolated SessionState,
# defining a `global:xyz` function in the runbook does NOT override internal
# module calls. Instead, we pull the module object and explicitly inject our
# 401-trapping try/catch wrapper directly into its internal `script:` scope,
# surgically intercepting just the failing function.
Write-Log "Injecting resilient Add-ZtDeviceWindowsEnrollment wrapper into ZeroTrustAssessment module scope..."
try {
    $ztModule = Get-Module ZeroTrustAssessment -ErrorAction SilentlyContinue
    if (-not $ztModule) { $ztModule = Import-Module ZeroTrustAssessment -PassThru -ErrorAction Stop }

    & $ztModule {
        # Rename the original function so we can wrap it
        Rename-Item -Path "Function:\Add-ZtDeviceWindowsEnrollment" -NewName "Add-ZtDeviceWindowsEnrollment_Original" -ErrorAction Stop
        
        function script:Add-ZtDeviceWindowsEnrollment {
            try {
                Add-ZtDeviceWindowsEnrollment_Original
            }
            catch {
                $msg = $_.Exception.Message
                if ($msg -match 'Unsupported app.only|Interactive_Required|delegated|401|403') {
                    Write-PSFMessage -Level Warning -Message "Delegated-only API skipped during app-only execution: Add-ZtDeviceWindowsEnrollment"
                }
                else {
                    Write-PSFMessage -Level Warning -Message "Unexpected error in Add-ZtDeviceWindowsEnrollment : $msg" -ErrorRecord $_
                }
            }
        }
    }
    Write-Log "  Module override injected successfully."
}
catch {
    Write-Log "Failed to inject resilient wrapper: $($_.Exception.Message)" "WARN"
}

# ── Ensure MgGraph session is usable before the long-running Invoke-ZtAssessment ──
# Belt-and-suspenders: verify the session can still talk to Graph.
Write-Log "Verifying Graph session before Stage 4..."
try {
    $preStage4Ctx = Get-MgContext -ErrorAction Stop
    if (-not $preStage4Ctx) { throw "No active Graph context." }
    # Quick probe to confirm actual API connectivity
    Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/organization?`$select=id" -Method GET -ErrorAction Stop | Out-Null
    Write-Log "  Graph session verified OK (AuthType=$($preStage4Ctx.AuthType))"
}
catch {
    Write-Log "  Graph session check failed: $($_.Exception.Message) - reconnecting..." "WARN"
    try {
        if ($authMethod -eq 'ManagedIdentity') {
            Connect-MgGraph -Identity -ClientId $uamiClientId -ContextScope Process -NoWelcome | Out-Null
            Write-Log "  Graph re-connected logging in via UAMI OK"
        }
        else {
            Connect-MgGraph -ClientSecretCredential $cred -TenantId $targetTenantId -NoWelcome -ContextScope Process | Out-Null
            Write-Log "  Graph re-connected logging in via App Registration OK"
        }
    }
    catch {
        Add-ErrorLogEntry -Stage 'Stage 4' -Component 'Graph session refresh' -Message "Failed to re-establish Graph session before assessment." -Detail $_.Exception.Message -Resolution "Check Identity permissions." -Severity 'ERROR'
    }
}

$stage4Success = $false
try {
    Write-Log "Setting Graph client timeout to 4 hours for large enterprise exports..."
    Set-MgRequestContext -ClientTimeout 14400 -ErrorAction SilentlyContinue
    Write-Log "Running Invoke-ZtAssessment (Path=$reportPath, Days=30)..."
    Invoke-ZtAssessment -Path $reportPath -Days 30 -DisableTelemetry
    Write-Log "Invoke-ZtAssessment -- completed OK"
}
catch {
    Add-ErrorLogEntry -Stage 'Stage 4' -Component 'Invoke-ZtAssessment' -Message "The Zero Trust Assessment cmdlet threw an error." -Detail $_.Exception.Message -Resolution "1. Identity needs 'Global Reader' in Entra ID. 2. Check Microsoft.Graph.* modules are up to date." -Severity 'ERROR'
    Write-Log "Stage 4 FAILED but continuing to upload whatever data is available..." "ERROR"
}

$reportJsonPath = Join-Path $reportPath "zt-export" "ZeroTrustAssessmentReport.json"
$reportJson = $null
if (-not (Test-Path $reportJsonPath)) {
    Add-ErrorLogEntry -Stage 'Stage 4' -Component 'Report JSON validation' `
        -Message "ZeroTrustAssessmentReport.json was not found." `
        -Detail "Expected path: $reportJsonPath" `
        -Resolution "Check the TEMP folder on the VM." `
        -Severity 'ERROR'
}
else {
    try {
        $reportJson = Get-Content -Path $reportJsonPath -Raw -ErrorAction Stop | ConvertFrom-Json
        Write-Log "Assessment parsed -- Tenant: $($reportJson.TenantName), Tests: $($reportJson.Tests.Count)"
        $stage4Success = $true
    }
    catch {
        Add-ErrorLogEntry -Stage 'Stage 4' -Component 'Parse assessment JSON' `
            -Message "Report JSON exists but could not be parsed." `
            -Detail $_.Exception.Message `
            -Severity 'ERROR'
    }
}

#endregion

#region ── STAGE 6: Upload full assessment report ─────────────────────────

if ($reportJson) {
    Write-Log "--- STAGE 6: Uploading full assessment report ---"
    try {
        Upload-JsonBlob `
            -BlobPath       "assessments/report-data.json" `
            -Data           $reportJson `
            -StorageContext $ctx `
            -Container      $containerName
        Write-Log "Full assessment report uploaded."
    }
    catch {
        Add-ErrorLogEntry -Stage 'Stage 6' -Component 'Upload report-data.json' `
            -Message "Failed to upload full assessment report." `
            -Detail $_.Exception.Message -Severity 'ERROR'
    }
}
else {
    Write-Log "--- STAGE 6: SKIPPED (no report data from Stage 4) ---" "WARN"
}

#endregion

#region ── STAGE 6b: Build and upload tenant-index.json ────────────────────

Write-Log "--- STAGE 6b: Building tenant-index.json ---"
try {
    $tenantName = if ($reportJson) { $reportJson.TenantName } else { "Unknown" }

    $tenantIndex = [ordered]@{
        tenants = @(
            [ordered]@{
                id   = $targetTenantId
                name = $tenantName
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

    # Merge with existing tenant-index.json to accumulate dates across daily runs
    try {
        # Refresh token if needed before the read
        $nowEpoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        if ([string]::IsNullOrWhiteSpace($script:StorageBearerToken) -or
            ($nowEpoch + 300) -ge $script:StorageTokenExpiry) {
            $t = Get-StorageAccessToken
            $script:StorageBearerToken = [string]$t.access_token
            $script:StorageTokenExpiry = [int64]$t.expires_on
        }

        $indexBlobUri = "https://" + $storageAccountName +
                        ".blob.core.windows.net/" + $containerName +
                        "/assessments/tenant-index.json"
        $readHeaders  = [ordered]@{
            Authorization  = "Bearer $script:StorageBearerToken"
            "x-ms-version" = "2020-04-08"
            "x-ms-date"    = [DateTime]::UtcNow.ToString("R")
        }
        $existingRaw = Invoke-RestMethod -Method GET -Uri $indexBlobUri `
            -Headers $readHeaders -TimeoutSec 30 -ErrorAction Stop

        if ($existingRaw -and $existingRaw.tenants) {
            foreach ($newTenant in $tenantIndex.tenants) {
                $oldTenant = $existingRaw.tenants |
                    Where-Object { $_.id -eq $newTenant.id } | Select-Object -First 1
                if ($oldTenant) {
                    foreach ($newSub in $newTenant.subscriptions) {
                        $oldSub = $oldTenant.subscriptions |
                            Where-Object { $_.id -eq $newSub.id } | Select-Object -First 1
                        if ($oldSub -and $oldSub.dates) {
                            $merged = @($oldSub.dates) + @($today) |
                                Sort-Object -Unique | Select-Object -Last 90
                            $newSub.dates = @($merged)
                        }
                    }
                    # Preserve subscriptions from prior runs not in current run
                    $newSubIds = @($newTenant.subscriptions | ForEach-Object { $_.id })
                    foreach ($oldSub in $oldTenant.subscriptions) {
                        if ($newSubIds -notcontains $oldSub.id) {
                            $newTenant.subscriptions += $oldSub
                        }
                    }
                }
            }
            Write-Log "  Merged with existing tenant-index.json (accumulated dates)."
        }
    }
    catch {
        Write-Log "  No existing tenant-index.json -- creating fresh." "WARN"
    }

    Upload-JsonBlob `
        -BlobPath       "assessments/tenant-index.json" `
        -Data           $tenantIndex `
        -StorageContext $ctx `
        -Container      $containerName
    Write-Log "tenant-index.json uploaded."
}
catch {
    Add-ErrorLogEntry -Stage 'Stage 6b' -Component 'tenant-index.json' `
        -Message "Failed to build/upload tenant-index.json." `
        -Detail $_.Exception.Message -Severity 'ERROR'
}

#endregion

#region ── STAGE 7: Per-subscription data collection ──────────────────────

Write-Log "--- STAGE 7: Per-Subscription Data Collection ---"

if (-not $reportJson) {
    Write-Log "Stage 4 did not produce a report. Skipping Stage 7 (no test data to build snapshots from)." "WARN"
    Add-ErrorLogEntry -Stage 'Stage 7' -Component 'Pre-check' `
        -Message "Skipped entirely -- no report JSON available from Stage 4." `
        -Severity 'SKIP'
}
else {

Write-Log "Processing $($targetSubscriptionIds.Count) subscription(s)..."

foreach ($subId in $targetSubscriptionIds) {

    Write-Log "---- Subscription: $subId ----"
  try {
    $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
    $blobLatestPath = "assessments/$targetTenantId/$subId/latest"

    #── 7a. Zero Trust snapshot ──────────────────────────────────────────

    Write-Log " [7a] Building Zero Trust snapshot..."
    $pillars     = @()
    $checks      = @()
    $pillarNames = @("Identity", "Devices", "Data", "Network")

    foreach ($pName in $pillarNames) {
        $pillarTests = @($reportJson.Tests | Where-Object { $_.TestPillar -eq $pName })
        if ($pillarTests.Count -eq 0) {
            Write-Log "  Pillar '$pName' -- no tests found, skipping." "WARN"
            continue
        }
        $totalChecks = $pillarTests.Count
        $passed      = @($pillarTests | Where-Object { $_.TestStatus -eq "Passed" }).Count
        $failed      = $totalChecks - $passed
        $score       = if ($totalChecks -gt 0) { [math]::Round(($passed / $totalChecks) * 100, 1) } else { 0 }
        Write-Log "  Pillar '$pName': $passed/$totalChecks passed (score: $score)"

        $pillars += [ordered]@{
            name        = $pName
            score       = $score
            totalChecks = $totalChecks
            passed      = $passed
            failed      = $failed
        }

        foreach ($t in $pillarTests) {
            $status = switch ($t.TestStatus) {
                "Passed"  { "passed"        }
                "Failed"  { "failed"        }
                "Skipped" { "notApplicable" }
                default   { "investigate"   }
            }
            $risk = switch ($t.TestRisk) {
                "High"   { "high"          }
                "Medium" { "medium"        }
                "Low"    { "low"           }
                default  { "informational" }
            }
            $desc       = if ($t.TestDescription) { $t.TestDescription.Substring(0, [math]::Min(500, $t.TestDescription.Length)) } else { "" }
            $area       = if ($t.TestCategory)    { $t.TestCategory } else { $pName }
            $checkScore = if ($status -eq "passed") { 100 } else { 0 }

            $checks += [ordered]@{
                id           = $t.TestId
                name         = $t.TestTitle
                pillar       = $pName
                area         = $area
                status       = $status
                risk         = $risk
                description  = $desc
                remediation  = ""
                learnMoreUrl = ""
                score        = $checkScore
                weight       = 1
            }
        }
    }

    $overallScore = 0
    if ($pillars.Count -gt 0) {
        $avg = ($pillars | ForEach-Object { $_.score } | Measure-Object -Average).Average
        if ($null -ne $avg) { $overallScore = [math]::Round($avg, 1) }
    }

    $ztSnapshot = [ordered]@{
        tenantId     = $targetTenantId
        tenantName   = $reportJson.TenantName
        runDate      = $today
        overallScore = $overallScore
        pillars      = $pillars
        checks       = $checks
    }

    Upload-JsonBlob -BlobPath "$blobBasePath/zero-trust.json"   -Data $ztSnapshot -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/zero-trust.json" -Data $ztSnapshot -StorageContext $ctx -Container $containerName

    #── 7b. Policy Compliance ─────────────────────────────────────────────

    Write-Log " [7b] Collecting Policy Compliance data..."
    $initiatives = @()

    # NOTE: Resource Graph returns at most 1000 rows per call.
    # We paginate using $skipToken until all pages are exhausted so no
    # initiatives are silently dropped in large environments.
    $policyQuery = @"
PolicyResources
| where type == 'microsoft.policyinsights/policystates'
| where subscriptionId == '$subId'
| where properties.complianceState != ''
| extend initiativeId    = tostring(properties.policySetDefinitionId),
         initiativeName  = tostring(properties.policySetDefinitionName),
         complianceState = tostring(properties.complianceState),
         policyDefId     = tostring(properties.policyDefinitionId),
         policyAssignId  = tostring(properties.policyAssignmentId)
| summarize compliantCount    = countif(complianceState == 'Compliant'),
            nonCompliantCount = countif(complianceState == 'NonCompliant'),
            exemptCount       = countif(complianceState == 'Exempt'),
            totalPolicies     = dcount(policyDefId)
  by initiativeId, initiativeName, policyAssignId
| project initiativeId, initiativeName, policyAssignId,
          compliantCount, nonCompliantCount, exemptCount, totalPolicies
| order by nonCompliantCount desc
"@

    try {
        $skipToken  = $null
        $policyRows = @()
        do {
            $graphParams = @{
                Query        = $policyQuery
                Subscription = $subId
                ErrorAction  = 'Stop'
            }
            if ($skipToken) { $graphParams['SkipToken'] = $skipToken }

            $policyResults = Search-AzGraph @graphParams
            # Az.ResourceGraph 0.x returns results under .Data; 1.x+ returns them directly
            $pageRows  = @(if ($policyResults.PSObject.Properties.Name -contains 'Data') { $policyResults.Data } else { $policyResults })
            $policyRows += $pageRows

            # Retrieve the continuation token for the next page (null when done)
            $skipToken = $null
            if ($policyResults.PSObject.Properties.Name -contains 'SkipToken') {
                $skipToken = $policyResults.SkipToken
            }
        } while ($skipToken)

        Write-Log "  Resource Graph returned $($policyRows.Count) initiative(s) (paginated)."

        foreach ($row in $policyRows) {
            $initiativeType = if ($row.initiativeId -like "*/providers/Microsoft.Authorization/policySetDefinitions/*") { "builtin" } else { "custom" }
            $initiativeName = if ($row.initiativeName) { $row.initiativeName } else { "Unnamed Initiative" }
            $initiatives += [ordered]@{
                id                = $row.initiativeId
                name              = $initiativeName
                type              = $initiativeType
                assignmentId      = $row.policyAssignId
                subscriptionId    = $subId
                compliantCount    = [int]$row.compliantCount
                nonCompliantCount = [int]$row.nonCompliantCount
                exemptCount       = [int]$row.exemptCount
                totalPolicies     = [int]$row.totalPolicies
                resources         = @()
            }
        }
    }
    catch {
        Write-Log "  [WARN] Resource Graph policy query failed: $($_.Exception.Message)" "WARN"
    }

    if ($initiatives.Count -eq 0) {
        Write-Log "  Resource Graph returned nothing -- trying Get-AzPolicyState fallback..."
        try {
            # No -Top limit: retrieve all policy states for the subscription
            $policyStates = @(Get-AzPolicyState -SubscriptionId $subId -ErrorAction Stop)
            Write-Log "  Get-AzPolicyState returned $($policyStates.Count) state(s)."
            $grouped = $policyStates | Group-Object { $_.PolicySetDefinitionId }
            foreach ($g in $grouped) {
                if (-not $g.Name) { continue }
                $first         = $g.Group | Select-Object -First 1
                $compliant     = @($g.Group | Where-Object { $_.ComplianceState -eq "Compliant"    }).Count
                $nonCompliant  = @($g.Group | Where-Object { $_.ComplianceState -eq "NonCompliant" }).Count
                $exempt        = @($g.Group | Where-Object { $_.ComplianceState -eq "Exempt"       }).Count
                $totalPolicies = @($g.Group | Select-Object -ExpandProperty PolicyDefinitionId -Unique).Count
                $initiatives += [ordered]@{
                    id                = $g.Name
                    name              = $first.PolicySetDefinitionName
                    type              = "builtin"
                    assignmentId      = $first.PolicyAssignmentId
                    subscriptionId    = $subId
                    compliantCount    = $compliant
                    nonCompliantCount = $nonCompliant
                    exemptCount       = $exempt
                    totalPolicies     = $totalPolicies
                    resources         = @()
                }
            }
        }
        catch {
            Write-Log "  [WARN] Get-AzPolicyState fallback failed: $($_.Exception.Message)" "WARN"
            Write-Log "  [WARN] Policy data will be empty for subscription $subId." "WARN"
        }
    }

    if ($initiatives.Count -gt 0) {
        Write-Log "  Fetching non-compliant resource details..."
        try {
            # Paginate through all non-compliant resources -- no take cap.
        $resourceQuery = @"
PolicyResources
| where type == 'microsoft.policyinsights/policystates'
| where subscriptionId == '$subId'
| where properties.complianceState == 'NonCompliant'
| extend resourceId    = tostring(properties.resourceId),
         resourceName  = tostring(split(properties.resourceId, '/')[-1]),
         resourceType  = tostring(properties.resourceType),
         resourceGroup = tostring(properties.resourceGroup),
         policyDefId   = tostring(properties.policyDefinitionId),
         policyName    = tostring(properties.policyDefinitionName),
         initiativeId  = tostring(properties.policySetDefinitionId),
         state         = tostring(properties.complianceState)
| project resourceId, resourceName, resourceType, resourceGroup,
          subscriptionId, state, policyDefId, policyName, initiativeId
"@
            $ncSkipToken = $null
            $ncRows      = @()
            do {
                $ncParams = @{
                    Query        = $resourceQuery
                    Subscription = $subId
                    ErrorAction  = 'Stop'
                }
                if ($ncSkipToken) { $ncParams['SkipToken'] = $ncSkipToken }

                $ncResults  = Search-AzGraph @ncParams
                $ncPageRows = @(if ($ncResults.PSObject.Properties.Name -contains 'Data') { $ncResults.Data } else { $ncResults })
                $ncRows    += $ncPageRows

                $ncSkipToken = $null
                if ($ncResults.PSObject.Properties.Name -contains 'SkipToken') {
                    $ncSkipToken = $ncResults.SkipToken
                }
            } while ($ncSkipToken)

            Write-Log "  Found $($ncRows.Count) non-compliant resource(s) (paginated)."

            foreach ($r in $ncRows) {
                $matchInit  = $initiatives | Where-Object { $_.id -eq $r.initiativeId } | Select-Object -First 1
                if ($null -eq $matchInit) { continue }
                $policyName = if ($r.policyName) { $r.policyName } else { "Unknown Policy" }
                $matchInit.resources += [ordered]@{
                    resourceId      = $r.resourceId
                    resourceName    = $r.resourceName
                    resourceType    = $r.resourceType
                    resourceGroup   = $r.resourceGroup
                    subscriptionId  = $subId
                    state           = "NonCompliant"
                    failingPolicies = @([ordered]@{
                        id          = $r.policyDefId
                        name        = $policyName
                        description = ""
                    })
                }
            }
        }
        catch {
            Write-Log "  [WARN] Non-compliant resource query failed: $($_.Exception.Message)" "WARN"
        }
    }

    $policyCompliance = [ordered]@{ runDate = $today; initiatives = $initiatives }
    Upload-JsonBlob -BlobPath "$blobBasePath/policy-compliance.json"   -Data $policyCompliance -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/policy-compliance.json" -Data $policyCompliance -StorageContext $ctx -Container $containerName

    #── 7c. Defender for Cloud Recommendations ────────────────────────────

    Write-Log " [7c] Collecting Defender for Cloud recommendations..."
    $recommendations = @()
    try {
        Set-AzContext -SubscriptionId $subId | Out-Null
        # No Select-Object cap -- retrieve all Defender assessments for the subscription
        $assessments = @(Get-AzSecurityAssessment -ErrorAction Stop)
        Write-Log "  Found $($assessments.Count) Defender assessment(s)."

        foreach ($a in $assessments) {
            $severity = switch ($a.Status.Severity) {
                "Critical" { "critical" }
                "High"     { "high"     }
                "Medium"   { "medium"   }
                "Low"      { "low"      }
                default    { "medium"   }
            }
            $category = "General"
            if ($a.Metadata.Categories -and $a.Metadata.Categories.Count -gt 0) {
                $category = $a.Metadata.Categories[0]
            }
            $description   = if ($a.Metadata.Description)           { $a.Metadata.Description }           else { "" }
            $remediation   = if ($a.Metadata.RemediationDescription) { $a.Metadata.RemediationDescription } else { "" }
            $resourceCount = 0
            if ($a.Status.UnhealthyResourceCount) { $resourceCount = [int]$a.Status.UnhealthyResourceCount }
            $displayName   = if ($a.DisplayName) { $a.DisplayName } else { $a.Name }

            $recommendations += [ordered]@{
                id                     = $a.Name
                name                   = $displayName
                description            = $description
                severity               = $severity
                category               = $category
                subscriptionId         = $subId
                resourceCount          = $resourceCount
                hasAttackPath          = $false
                affectedResources      = @()
                remediation            = $remediation
                learnMoreUrl           = ""
                governanceAssignmentId = ""
            }
        }
        Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    }
    catch {
        Write-Log "  [WARN] Defender recommendations failed: $($_.Exception.Message)" "WARN"
        Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction SilentlyContinue | Out-Null
    }

    $defenderRecs = [ordered]@{ runDate = $today; recommendations = $recommendations }
    Upload-JsonBlob -BlobPath "$blobBasePath/defender-recs.json"   -Data $defenderRecs -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/defender-recs.json" -Data $defenderRecs -StorageContext $ctx -Container $containerName

    #── 7d. Governance Rules ───────────────────────────────────────────────

    Write-Log " [7d] Collecting Governance Rules..."
    $govRules = @()
    try {
        Set-AzContext -SubscriptionId $subId | Out-Null

        # Get-AzAccessToken .Token is deprecated in Az.Accounts 3.x+.
        # -AsSecureString + NetworkCredential works on all versions without warnings.
        $secureTokenObj = Get-AzAccessToken -ResourceUrl "https://management.azure.com" `
                              -AsSecureString -ErrorAction Stop
        $token = [System.Net.NetworkCredential]::new('', $secureTokenObj.Token).Password

        # String concatenation avoids PS 5.1 backtick/query-string edge cases
        $govUri     = "https://management.azure.com/subscriptions/" + $subId +
                      "/providers/Microsoft.Security/governanceRules?api-version=2022-01-01-preview"
        $govHeaders = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

        try {
            $govResponse = Invoke-RestMethod -Uri $govUri -Headers $govHeaders `
                -Method Get -TimeoutSec 30 -ErrorAction Stop
            $govItems    = @($govResponse.value)
            Write-Log "  Found $($govItems.Count) governance rule(s)."

            foreach ($rule in $govItems) {
                $props         = $rule.properties
                $status        = "notStarted"
                $completionPct = 0
                if ($props.isGracePeriod) { $status = "inProgress"; $completionPct = 50 }
                $owner       = if ($props.ownerSource -and $props.ownerSource.value) { $props.ownerSource.value } else { "Unassigned" }
                $dueDate     = if ($props.governanceEmailNotification) { $today } else { "" }
                $description = if ($props.description) { $props.description } else { $rule.name }

                $govRules += [ordered]@{
                    id                      = $rule.id
                    name                    = $rule.name
                    owner                   = $owner
                    ownerEmail              = ""
                    dueDate                 = $dueDate
                    subscriptionId          = $subId
                    status                  = $status
                    completionPercentage    = $completionPct
                    linkedRecommendationIds = @()
                    linkedPolicyIds         = @()
                    description             = $description
                    completionCriteria      = @()
                }
            }
        }
        catch {
            Write-Log "  [WARN] Governance Rules REST call failed: $($_.Exception.Message)" "WARN"
        }
        Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    }
    catch {
        Write-Log "  [WARN] Governance stage failed: $($_.Exception.Message)" "WARN"
        Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction SilentlyContinue | Out-Null
    }

    $governance = [ordered]@{ runDate = $today; rules = $govRules }
    Upload-JsonBlob -BlobPath "$blobBasePath/governance.json"   -Data $governance -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/governance.json" -Data $governance -StorageContext $ctx -Container $containerName

    Write-Log " OK: Subscription $subId -- complete"
  }
  catch {
    Add-ErrorLogEntry -Stage 'Stage 7' -Component "Subscription $subId" `
        -Message "Per-subscription data collection failed." `
        -Detail $_.Exception.Message -Severity 'ERROR'
    Write-Log " FAILED: Subscription $subId -- continuing with next." "ERROR"
  }
}

} # end else ($reportJson exists)

#region ── STAGE 8: Upload error log ───────────────────────────────────────

Write-Log "--- STAGE 8: Uploading error log ---"

$errorSummary = [ordered]@{
    runDate       = $today
    runTimestamp  = (Get-Date).ToString('o')
    totalErrors   = $script:ErrorLog.Count
    errorsByStage = @{}
    entries       = @($script:ErrorLog)
}

# Group errors by stage for quick scanning
foreach ($entry in $script:ErrorLog) {
    $stageName = $entry.stage
    if (-not $errorSummary.errorsByStage.ContainsKey($stageName)) {
        $errorSummary.errorsByStage[$stageName] = 0
    }
    $errorSummary.errorsByStage[$stageName]++
}

try {
    Upload-JsonBlob `
        -BlobPath       "assessments/error-log.json" `
        -Data           $errorSummary `
        -StorageContext $ctx `
        -Container      $containerName

    # Also upload a dated copy for historical tracking
    Upload-JsonBlob `
        -BlobPath       "assessments/logs/$today/error-log.json" `
        -Data           $errorSummary `
        -StorageContext $ctx `
        -Container      $containerName

    Write-Log "Error log uploaded ($($script:ErrorLog.Count) entries)."
}
catch {
    Write-Log "Failed to upload error log: $($_.Exception.Message)" "ERROR"
}

# Print summary
if ($script:ErrorLog.Count -gt 0) {
    Write-Log "+=================================================+" "WARN"
    Write-Log "|  RUNBOOK COMPLETED WITH $($script:ErrorLog.Count) ISSUE(S)              |" "WARN"
    Write-Log "+=================================================+" "WARN"
    foreach ($stage in $errorSummary.errorsByStage.Keys) {
        Write-Log "|  $stage : $($errorSummary.errorsByStage[$stage]) issue(s)" "WARN"
    }
    Write-Log "|  Check: assessments/error-log.json in blob      |" "WARN"
    Write-Log "+=================================================+" "WARN"
}
else {
    Write-Log "No errors recorded. Clean run!"
}

# Cleanup the background token refresher if it exists
if ($null -ne $powershellJob) {
    try {
        $powershellJob.Stop()
        $powershellJob.Dispose()
        $refresherRunspace.Close()
        $refresherRunspace.Dispose()
        Write-Log "Cleaned up background token refresher runspace."
    } catch {}
}

Write-Log "=== ALL STAGES COMPLETE ==="

#endregion
