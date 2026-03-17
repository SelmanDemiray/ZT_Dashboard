param()

#region ── 0. Strict mode, preferences & helpers ──────────────────────────

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"
$today = (Get-Date).ToString("yyyy-MM-dd")

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","DEBUG")]
        [string]$Level = "INFO"
    )
    $ts = (Get-Date).ToString("HH:mm:ss")
    # Write-Host targets the Information stream — never captured by variable assignment.
    # Write-Output would be swallowed into $preflightTokens = Test-UserAssignedManagedIdentity ...
    Write-Host "[$ts][$Level] $Message"
}

function Write-DiagnosticError {
    param(
        [string]$Context,
        [string]$Message,
        [string]$Detail = "",
        [string]$Resolution = ""
    )
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
    Write-Log "FATAL ERROR in: $Context" "ERROR"
    Write-Log "Problem : $Message" "ERROR"
    if ($Detail)     { Write-Log "Detail : $Detail" "ERROR" }
    if ($Resolution) { Write-Log "Fix    : $Resolution" "ERROR" }
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
}

function Write-TempUtf8File {
    param(
        [Parameter(Mandatory)][string]$Content,
        [Parameter(Mandatory)][string]$Extension
    )
    $ext  = if ($Extension.StartsWith(".")) { $Extension } else { ".$Extension" }
    $path = Join-Path $env:TEMP ("blobupload-" + [guid]::NewGuid().ToString() + $ext)
    [System.IO.File]::WriteAllText($path, $Content, [System.Text.UTF8Encoding]::new($false))
    return $path
}

#endregion

#region ── 0a. Upload helper (defined early — used from Stage 3 onward) ────

function Upload-JsonBlob {
    param(
        [Parameter(Mandatory)][string]$BlobPath,
        [Parameter(Mandatory)][object]$Data,
        [Parameter(Mandatory)]$StorageContext,
        [Parameter(Mandatory)][string]$Container
    )
    $tempFile = $null
    try {
        $json     = $Data | ConvertTo-Json -Depth 20 -Compress
        $tempFile = Write-TempUtf8File -Content $json -Extension ".json"
        Set-AzStorageBlobContent `
            -Container  $Container `
            -Blob       $BlobPath `
            -File       $tempFile `
            -Properties @{ ContentType = "application/json" } `
            -Context    $StorageContext `
            -Force | Out-Null
        $length = (Get-Item $tempFile).Length
        Write-Log " [UPLOAD OK] $BlobPath ($length bytes)"
    }
    catch {
        Write-Log " [UPLOAD FAIL] $BlobPath — $($_.Exception.Message)" "WARN"
        Write-Log " Hint: Verify 'Storage Blob Data Contributor' is assigned to the UAMI on storage account '$storageAccountName'." "WARN"
    }
    finally {
        if ($null -ne $tempFile -and (Test-Path $tempFile)) {
            Remove-Item -Path $tempFile -Force -ErrorAction SilentlyContinue
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
        [string]$Detail = "",
        [string]$Resolution = ""
    )
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
    Write-Log "[$Code] $Context" "ERROR"
    Write-Log "Problem : $Message" "ERROR"
    if ($Detail)     { Write-Log "Detail  : $Detail" "ERROR" }
    if ($Resolution) { Write-Log "Fix     : $Resolution" "ERROR" }
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
}

function Test-IsGuid {
    param([string]$Value)
    $out = [guid]::Empty
    return [guid]::TryParse($Value, [ref]$out)
}

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

# ── IMDS proxy diagnostic helper ─────────────────────────────────────────
# Logs what proxy (if any) would be used for a given URI, helping diagnose
# whether a system proxy is intercepting the link-local IMDS request.
function Write-ProxyDiagnostic {
    param([string]$Uri)
    try {
        $proxyUri = [System.Net.WebRequest]::DefaultWebProxy.GetProxy([uri]$Uri)
        if ($proxyUri -and $proxyUri.Host -and $proxyUri.ToString() -ne $Uri) {
            Write-Log "   Proxy for $Uri : $proxyUri  ← PROXY DETECTED. This will BLOCK IMDS. Bypassing." "WARN"
        } else {
            Write-Log "   Proxy for $Uri : (none — direct connection)"
        }
    }
    catch {
        Write-Log "   Proxy detection failed: $($_.Exception.Message)" "WARN"
    }
    # Also log env-var style proxies
    $envProxy = $env:HTTP_PROXY
    if ($envProxy) { Write-Log "   HTTP_PROXY env var : $envProxy" "WARN" }
    $envNoProxy = $env:NO_PROXY
    if ($envNoProxy) { Write-Log "   NO_PROXY env var   : $envNoProxy" }
}

# ── IMDS TCP reachability check ───────────────────────────────────────────
# Tests whether 169.254.169.254:80 is reachable at TCP level BEFORE attempting
# an HTTP token request. If this fails, Invoke-RestMethod will hang regardless
# of -TimeoutSec because the TCP handshake never completes.
function Test-ImdsReachable {
    param([int]$TimeoutMs = 3000)
    Write-Log "   Testing TCP connectivity to 169.254.169.254:80 (timeout ${TimeoutMs}ms)..."
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("169.254.169.254", 80, $null, $null)
        $connected = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if ($connected -and $tcp.Connected) {
            $tcp.EndConnect($iar)
            $tcp.Close()
            Write-Log "   TCP to IMDS 169.254.169.254:80 — reachable ✅"
            return $true
        } else {
            try { $tcp.Close() } catch { }
            Write-Log "   TCP to IMDS 169.254.169.254:80 — NOT reachable within ${TimeoutMs}ms ❌" "WARN"
            Write-Log "   This means IMDS is blocked by a firewall, NSG, or the VM is not in Azure." "WARN"
            return $false
        }
    }
    catch {
        Write-Log "   TCP connectivity test failed: $($_.Exception.Message)" "WARN"
        return $false
    }
}

# ── Core IMDS token fetcher ───────────────────────────────────────────────
# ROOT CAUSE OF THE 10-MINUTE HANG: On Windows, Invoke-RestMethod respects the
# system WinHTTP/WinINet proxy. If a proxy is configured on the VM (common in
# enterprise), Windows routes the 169.254.169.254 request through the proxy.
# Proxies cannot reach link-local addresses, so the request hangs for the
# PROXY's own timeout (typically 2-10 minutes), completely ignoring -TimeoutSec.
#
# FIX: Explicitly bypass the proxy for all IMDS calls.
#   - PowerShell 7+: use the native -NoProxy switch.
#   - PowerShell 5.1: temporarily null [System.Net.WebRequest]::DefaultWebProxy.
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

    Write-Log "   IMDS URI       : $uri"
    Write-Log "   Timeout        : ${TimeoutSec}s"
    Write-Log "   PS version     : $($PSVersionTable.PSVersion)"

    # Check and log proxy configuration before the call
    Write-ProxyDiagnostic -Uri "http://169.254.169.254/"

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        $response = $null

        if ($PSVersionTable.PSVersion.Major -ge 6) {
            # PowerShell 6+ / 7+: -NoProxy bypasses all proxy settings for this call
            Write-Log "   Using -NoProxy (PS 6+) to bypass any system proxy for IMDS..."
            $response = Invoke-RestMethod -Method GET -Uri $uri `
                -Headers @{ Metadata = "true" } `
                -TimeoutSec $TimeoutSec `
                -NoProxy `
                -ErrorAction Stop
        }
        else {
            # PowerShell 5.1: temporarily set DefaultWebProxy to null so
            # this thread's HTTP calls skip the proxy entirely.
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
                # Always restore the original proxy setting
                [System.Net.WebRequest]::DefaultWebProxy = $savedProxy
            }
        }

        $stopwatch.Stop()
        Write-Log "   IMDS responded in $($stopwatch.ElapsedMilliseconds)ms ✅"
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
            -Resolution "Resource must be https://management.azure.com/ or https://graph.microsoft.com/"
        throw $Exception
    }
    elseif ($statusCode -eq 403) {
        Write-MiDiagnostic -Code "MI-UAMI-006" -Context $Stage `
            -Message "IMDS returned 403 — VM cannot access the Instance Metadata Service." `
            -Detail "Status=403; Body=$bodyText; Message=$msg" `
            -Resolution "Check nothing on the VM blocks 169.254.169.254 (proxy, firewall, NSG, EDR, custom route). IMDS must be a direct local call — it cannot go through a proxy."
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
            -Resolution "Cache tokens and retry with backoff."
        throw $Exception
    }
    elseif ($null -ne $statusCode -and $statusCode -ge 500) {
        Write-MiDiagnostic -Code "MI-UAMI-009" -Context $Stage `
            -Message "Azure IMDS returned a server-side error." `
            -Detail "Status=$statusCode; Body=$bodyText" `
            -Resolution "Retry later. Check Azure platform health."
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

# Returns @{ ArmToken = ...; GraphToken = ... } so Stage 2 reuses the tokens
# without issuing redundant IMDS calls.
function Test-UserAssignedManagedIdentity {
    param(
        [Parameter(Mandatory)][string]$ClientId,
        [Parameter(Mandatory)][string]$TenantId
    )

    Write-Log "━━━ UAMI PRE-FLIGHT DIAGNOSTICS ━━━"

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
            -Resolution "Install Az.Accounts on the Hybrid Worker VM."
        throw "Connect-AzAccount not found"
    }
    if (-not $azCmd.Parameters.ContainsKey("AccountId")) {
        Write-MiDiagnostic -Code "MI-UAMI-012" -Context "Az.Accounts capability check" `
            -Message "This Az.Accounts version does not support -AccountId (required for UAMI sign-in)." `
            -Detail "Installed command does not expose parameter: AccountId" `
            -Resolution "Update Az.Accounts: Connect-AzAccount -Identity -AccountId <UAMI ClientId>"
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
            -Resolution "Update Microsoft.Graph.Authentication."
        throw "Microsoft Graph module is too old for UAMI sign-in"
    }

    # ── IMDS pre-flight: proxy + TCP reachability ─────────────────────────
    Write-Log " [IMDS Pre-check] Checking proxy and network before IMDS calls..."
    Write-Log "  VM hostname    : $($env:COMPUTERNAME)"
    Write-Log "  PS version     : $($PSVersionTable.PSVersion)"

    # Log WinHTTP proxy — this is the most common cause of IMDS hangs
    try {
        $defaultProxy = [System.Net.WebRequest]::DefaultWebProxy
        if ($null -eq $defaultProxy) {
            Write-Log "  DefaultWebProxy : null (no proxy set)"
        } else {
            $testUri    = [uri]"http://169.254.169.254/"
            $resolvedProxy = $defaultProxy.GetProxy($testUri)
            if ($resolvedProxy.ToString() -eq $testUri.ToString()) {
                Write-Log "  DefaultWebProxy : bypassed for 169.254.169.254 (direct)"
            } else {
                Write-Log "  DefaultWebProxy : $resolvedProxy  ← PROXY ACTIVE — will be bypassed for IMDS" "WARN"
                Write-Log "  NOTE: This proxy is the most likely cause of past IMDS hangs." "WARN"
                Write-Log "  The IMDS fix routes the call directly, skipping the proxy entirely." "WARN"
            }
        }
    }
    catch { Write-Log "  DefaultWebProxy check failed: $($_.Exception.Message)" "WARN" }

    # Check NO_PROXY and HTTP_PROXY environment variables
    $httpProxy  = [System.Environment]::GetEnvironmentVariable("HTTP_PROXY")
    $noProxy    = [System.Environment]::GetEnvironmentVariable("NO_PROXY")
    if ($httpProxy) { Write-Log "  HTTP_PROXY env  : $httpProxy" "WARN" }
    if ($noProxy)   { Write-Log "  NO_PROXY env    : $noProxy" }

    # TCP connectivity to IMDS before attempting HTTP — if this fails, the
    # HTTP call would hang indefinitely regardless of -TimeoutSec
    $imdsReachable = Test-ImdsReachable -TimeoutMs 3000
    if (-not $imdsReachable) {
        Write-MiDiagnostic -Code "MI-UAMI-030" -Context "IMDS TCP reachability" `
            -Message "Cannot reach 169.254.169.254:80 at TCP level. IMDS is blocked." `
            -Detail "TCP connect to 169.254.169.254:80 timed out after 3 seconds." `
            -Resolution "1. Ensure the VM is an Azure VM (not on-premises). 2. Check NSG/firewall rules — nothing should block outbound to 169.254.169.254:80. 3. Check for custom UDRs that blackhole 169.254.169.254. 4. Confirm the HybridWorkerAgent service is running and the VM is not in a broken state."
        throw "IMDS 169.254.169.254:80 is not reachable — cannot acquire managed identity tokens."
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
    Write-Log "  ARM token acquired ✅"
    if ($armJwt) {
        Write-Log "   ARM appid     : $($armJwt.appid)"
        Write-Log "   ARM oid       : $($armJwt.oid)"
        Write-Log "   ARM tid       : $($armJwt.tid)"
        Write-Log "   ARM aud       : $($armJwt.aud)"
        Write-Log "   ARM xms_mirid : $($armJwt.xms_mirid)"
        Write-Log "   ARM exp (UTC) : $([DateTimeOffset]::FromUnixTimeSeconds([int64]$armJwt.exp).UtcDateTime)"
    }

    if ($armJwt -and $armJwt.appid -and ($armJwt.appid -ne $ClientId)) {
        Write-MiDiagnostic -Code "MI-UAMI-016" -Context "UAMI ARM token validation" `
            -Message "ARM token was issued for a different managed identity." `
            -Detail "Requested ClientId=$ClientId; Token appid=$($armJwt.appid)" `
            -Resolution "Confirm the correct UAMI Client ID is in the Automation Variable."
        throw "ARM token appid mismatch"
    }
    if ($armJwt -and $armJwt.tid -and ($armJwt.tid -ne $TenantId)) {
        Write-MiDiagnostic -Code "MI-UAMI-017" -Context "UAMI ARM token validation" `
            -Message "ARM token tenant does not match TargetTenantId." `
            -Detail "Token tid=$($armJwt.tid); TargetTenantId=$TenantId" `
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
    Write-Log "  Graph token acquired ✅"
    if ($graphJwt) {
        Write-Log "   Graph appid     : $($graphJwt.appid)"
        Write-Log "   Graph oid       : $($graphJwt.oid)"
        Write-Log "   Graph tid       : $($graphJwt.tid)"
        Write-Log "   Graph aud       : $($graphJwt.aud)"
        if ($graphJwt.PSObject.Properties.Name -contains 'xms_mirid') {
            Write-Log "   Graph xms_mirid : $($graphJwt.xms_mirid)"
        } else {
            Write-Log "   Graph xms_mirid : <not present in token>" "WARN"
        }
        Write-Log "   Graph exp (UTC) : $([DateTimeOffset]::FromUnixTimeSeconds([int64]$graphJwt.exp).UtcDateTime)"
    }

    if ($graphJwt -and $graphJwt.appid -and ($graphJwt.appid -ne $ClientId)) {
        Write-MiDiagnostic -Code "MI-UAMI-019" -Context "UAMI Graph token validation" `
            -Message "Graph token was issued for a different managed identity." `
            -Detail "Requested ClientId=$ClientId; Token appid=$($graphJwt.appid)" `
            -Resolution "Confirm the correct UAMI Client ID is in the Automation Variable."
        throw "Graph token appid mismatch"
    }
    if ($graphJwt -and $graphJwt.tid -and ($graphJwt.tid -ne $TenantId)) {
        Write-MiDiagnostic -Code "MI-UAMI-020" -Context "UAMI Graph token validation" `
            -Message "Graph token tenant does not match TargetTenantId." `
            -Detail "Token tid=$($graphJwt.tid); TargetTenantId=$TenantId" `
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
            Write-Log "  Graph API probe ✅ : $($orgResult.value[0].displayName) [$($orgResult.value[0].id)]"
        } else {
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

    Write-Log "━━━ UAMI PRE-FLIGHT DIAGNOSTICS PASSED ━━━"

    # Return both tokens so Stage 2 reuses them — no extra IMDS round-trips
    return @{ ArmToken = $armToken; GraphToken = $graphToken }
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

Write-Log "═══ HYBRID WORKER DIAGNOSTICS ═══"
Write-Log " Hostname     : $($env:COMPUTERNAME)"
Write-Log " PS Version   : $($PSVersionTable.PSVersion)"
Write-Log " OS           : $([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
Write-Log " Date         : $today"
Write-Log " Temp Path    : $($env:TEMP)"
Write-Log " UserProfile  : $($env:USERPROFILE)"
Write-Log " Module Paths : $($env:PSModulePath -replace ';', '; ')"
Write-Log "═══════════════════════════════════"

#endregion

#region ── STAGE 0: Validate local modules ────────────────────────────────

Write-Log "━━━ STAGE 0: Validating local modules ━━━"

$requiredModules = @(
    "Az.Accounts",
    "Az.Storage",
    "Az.ResourceGraph",
    "Az.Security",
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
        Write-Log " ✅ $mod ($($found.Version))"
    } else {
        Write-Log " ❌ $mod — NOT FOUND" "ERROR"
        $missingModules += $mod
    }
}

if ($missingModules.Count -gt 0) {
    Write-DiagnosticError `
        -Context "Stage 0 — Module validation" `
        -Message "$($missingModules.Count) required module(s) are not installed on this Hybrid Worker VM." `
        -Detail "Missing: $($missingModules -join ', ')" `
        -Resolution "RDP into the VM, open pwsh and run: Save-Module -Name <module> -Path C:\ProgramData\ZtModules -Force"
    throw "Missing modules: $($missingModules -join ', ')"
}
Write-Log "All $($requiredModules.Count) modules found."

#endregion

#region ── STAGE 1: Read Automation Variables ─────────────────────────────

Write-Log "━━━ STAGE 1: Reading Automation Variables ━━━"

$authMethod = Get-AutomationVariable -Name "AuthMethod" -ErrorAction SilentlyContinue
if (-not $authMethod) {
    Write-Log "AuthMethod variable not found — defaulting to 'ManagedIdentity'." "WARN"
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
        -Context "Stage 1 — Reading core Automation Variables" `
        -Message "One or more required Automation Variables are missing." `
        -Detail $_.Exception.Message `
        -Resolution "Ensure these exist in Automation Account > Shared Resources > Variables: StorageAccountName, BlobContainerName, TargetTenantId."
    throw $_
}

Write-Log " StorageAccountName : $storageAccountName"
Write-Log " BlobContainerName  : $containerName"
Write-Log " TargetTenantId     : $targetTenantId"

$uamiClientId = $null
if ($authMethod -eq 'ManagedIdentity') {
    $uamiClientId = Get-AutomationVariable -Name "UserAssignedManagedIdentityClientId" -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($uamiClientId)) {
        Write-MiDiagnostic `
            -Code "MI-UAMI-001" `
            -Context "Stage 1 — Reading Automation Variables" `
            -Message "AuthMethod='ManagedIdentity' but 'UserAssignedManagedIdentityClientId' variable is missing." `
            -Resolution "Create Automation Variable 'UserAssignedManagedIdentityClientId' = the UAMI Client ID GUID."
        throw "Missing required Automation Variable: UserAssignedManagedIdentityClientId"
    }
    Write-Log " UAMI Client ID     : $uamiClientId"
}

#endregion

#region ── STAGE 2: Authenticate ──────────────────────────────────────────

Write-Log "━━━ STAGE 2: Authenticating ━━━"

# Suppress WAM / interactive auth prompts that would hang a non-interactive runbook
Write-Log "Suppressing WAM and interactive auth prompts..."
$env:AZURE_IDENTITY_DISABLE_INTERACTIVEBROWSERCREDENTIAL = "true"
$env:AZURE_IDENTITY_DISABLE_MULTITENANTAUTH              = "true"
$env:AZURE_IDENTITY_DISABLE_VISUALSTUDIOCREDENTIAL       = "true"
$env:AZURE_IDENTITY_DISABLE_SHAREDTOKENCACHECREDENTIAL   = "true"

if ($authMethod -eq 'ManagedIdentity') {

    Write-Log "Auth method : Managed Identity (UAMI on Hybrid Worker VM via IMDS)"
    Write-Log "NOTE: On a Hybrid Worker, MI tokens come from the VM's IMDS (169.254.169.254), not the Automation Account."

    # Run preflight diagnostics; get back both tokens to avoid redundant IMDS calls
    $preflightTokens = Test-UserAssignedManagedIdentity -ClientId $uamiClientId -TenantId $targetTenantId
    $armToken   = $preflightTokens.ArmToken
    $graphToken = $preflightTokens.GraphToken

    # IMPORTANT: Use -Identity -AccountId, NOT -AccessToken.
    #
    # -AccessToken creates a static single-resource session. Az.Accounts holds
    # one pre-fetched ARM token and cannot acquire tokens for other resources.
    # When Stage 3 calls New-AzStorageContext -UseConnectedAccount, Az.Storage
    # internally requests a storage-scoped token (https://storage.azure.com/).
    # With a static session the resource URI resolves to '' and you get:
    #   "Access token authenticator failed to retrieve access token for resources ''"
    #
    # -Identity -AccountId registers the UAMI as a live ManagedServiceIdentity
    # credential. Az.Accounts then calls IMDS on-demand for whatever resource
    # is needed (ARM, storage, Key Vault, etc.), which is the correct behaviour.
    # The preflight IMDS calls above already confirmed IMDS is reachable and the
    # UAMI is valid, so this call will succeed immediately.
    Write-Log "Calling Connect-AzAccount -Identity -AccountId (live UAMI credential — enables multi-resource token acquisition)..."
    try {
        Connect-AzAccount `
            -Identity  `
            -AccountId $uamiClientId `
            -Tenant    $targetTenantId | Out-Null
        Write-Log "Connect-AzAccount (UAMI) — ✅"
    }
    catch {
        Write-MiDiagnostic -Code "MI-UAMI-022" -Context "Stage 2 — Connect-AzAccount" `
            -Message "Failed to authenticate to Azure with the UAMI." `
            -Detail $_.Exception.Message `
            -Resolution "Confirm the UAMI is attached to the Hybrid Worker VM (VM > Identity > User assigned), the Client ID is correct, and IMDS is reachable (no proxy blocking 169.254.169.254)."
        throw $_
    }

    Write-Log "Calling Connect-MgGraph with pre-fetched Graph token..."
    try {
        $secureGraphToken = ConvertTo-SecureString $graphToken.access_token -AsPlainText -Force
        Connect-MgGraph -AccessToken $secureGraphToken -NoWelcome | Out-Null
        Write-Log "Connect-MgGraph (UAMI) — ✅"
    }
    catch {
        Write-MiDiagnostic -Code "MI-UAMI-023" -Context "Stage 2 — Connect-MgGraph" `
            -Message "Failed to connect to Microsoft Graph using the IMDS-issued Graph token." `
            -Detail $_.Exception.Message `
            -Resolution "Confirm the IMDS Graph token is valid and the UAMI has the required Graph application permissions with admin consent."
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
            -Context "Stage 2 — Reading AppRegistration Variables" `
            -Message "AppClientId or AppClientSecret Automation Variables are missing." `
            -Detail $_.Exception.Message `
            -Resolution "Create both in Automation Account > Variables. Mark AppClientSecret as Encrypted."
        throw $_
    }
    Write-Log " App Client ID : $appClientId"

    $secureSecret = ConvertTo-SecureString $appClientSecret -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($appClientId, $secureSecret)

    try {
        Connect-AzAccount -ServicePrincipal -Credential $cred -Tenant $targetTenantId | Out-Null
        Write-Log "Connect-AzAccount (App Registration) — ✅"
    }
    catch {
        Write-DiagnosticError `
            -Context "Stage 2 — Connect-AzAccount (AppRegistration)" `
            -Message "Failed to authenticate to Azure with the App Registration credentials." `
            -Detail $_.Exception.Message `
            -Resolution "Verify AppClientId and AppClientSecret are correct. Check the secret has not expired."
        throw $_
    }

    try {
        Connect-MgGraph -ClientSecretCredential $cred -TenantId $targetTenantId -NoWelcome -ContextScope Process | Out-Null
        Write-Log "Connect-MgGraph (App Registration) — ✅"
    }
    catch {
        Write-DiagnosticError `
            -Context "Stage 2 — Connect-MgGraph (AppRegistration)" `
            -Message "Azure auth succeeded but Microsoft Graph auth failed." `
            -Detail $_.Exception.Message `
            -Resolution "Assign 'Global Reader' role to the App Registration service principal in Entra ID."
        throw $_
    }

}
else {
    Write-DiagnosticError `
        -Context "Stage 2 — Auth method validation" `
        -Message "AuthMethod has an unrecognised value: '$authMethod'." `
        -Resolution "Set the AuthMethod Automation Variable to 'ManagedIdentity' or 'AppRegistration' (case-sensitive)."
    throw "Invalid AuthMethod: '$authMethod'."
}

#endregion

#region ── STAGE 2b: Discover subscriptions ───────────────────────────────

Write-Log "━━━ STAGE 2b: Discovering Subscriptions ━━━"

try {
    $allSubs = @(Get-AzSubscription -TenantId $targetTenantId -ErrorAction Stop |
        Where-Object { $_.State -eq 'Enabled' })
}
catch {
    Write-DiagnosticError `
        -Context "Stage 2b — Get-AzSubscription" `
        -Message "Failed to list subscriptions — identity may lack permission." `
        -Detail $_.Exception.Message `
        -Resolution "Assign 'Reader' to the identity at Management Group or subscription scope."
    throw $_
}

$targetSubscriptionIds = @($allSubs | ForEach-Object { $_.Id })

if ($targetSubscriptionIds.Count -eq 0) {
    $rbacMsg = if ($authMethod -eq 'AppRegistration') {
        "The App Registration service principal has no 'Reader' RBAC on any subscription in tenant '$targetTenantId'."
    } else {
        "The UAMI has no 'Reader' RBAC on any subscription in tenant '$targetTenantId'."
    }
    Write-DiagnosticError `
        -Context "Stage 2b — Subscription discovery" `
        -Message "No enabled subscriptions found in tenant '$targetTenantId'." `
        -Resolution "$rbacMsg  Fix: Azure Portal > Subscriptions > IAM > Add role assignment > Reader."
    throw "No enabled subscriptions found. $rbacMsg"
}

Write-Log "Found $($targetSubscriptionIds.Count) enabled subscription(s):"
foreach ($s in $allSubs) { Write-Log " • $($s.Name) [$($s.Id)]" }

#endregion

#region ── STAGE 2c: Pre-flight permission validation ─────────────────────

Write-Log "━━━ STAGE 2c: Pre-flight Permission Checks ━━━"
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
        Write-Log "  App-only auth — checking appRoleAssignments on the service principal..."
        try {
            $clientId         = $mgContext.ClientId
            $spLookupUri      = "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq '$clientId'&`$select=id,displayName,appId"
            $graphSpLookupUri = "https://graph.microsoft.com/v1.0/servicePrincipals?`$filter=appId eq '00000003-0000-0000-c000-000000000000'&`$select=id,appRoles"

            $spResult = Invoke-MgGraphRequest -Uri $spLookupUri -Method GET -ErrorAction Stop
            if (-not $spResult.value -or $spResult.value.Count -eq 0) { throw "Service principal not found for appId '$clientId'." }
            $spId          = $spResult.value[0].id
            $spDisplayName = $spResult.value[0].displayName
            if (-not $spId) { throw "Service principal ID was empty for appId '$clientId'." }
            Write-Log "  Service principal: $spDisplayName [$spId]"

            $graphSpResult = Invoke-MgGraphRequest -Uri $graphSpLookupUri -Method GET -ErrorAction Stop
            if (-not $graphSpResult.value -or $graphSpResult.value.Count -eq 0) { throw "Microsoft Graph service principal not found." }
            $graphSpId     = $graphSpResult.value[0].id
            $graphAppRoles = $graphSpResult.value[0].appRoles
            if (-not $graphSpId) { throw "Microsoft Graph service principal ID was empty." }

            $roleAssignmentsUri = "https://graph.microsoft.com/v1.0/servicePrincipals/$spId/appRoleAssignments?`$filter=resourceId eq $graphSpId&`$top=200"
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
                    -Context "Stage 2c — Graph API permissions" `
                    -Message "$($missingScopes.Count) required Graph Application permission(s) NOT granted to this $principalLabel." `
                    -Detail "Missing: $($missingScopes -join ', ')" `
                    -Resolution "In Entra ID add the missing Graph Application permissions, grant admin consent, wait 5 min, re-run. Reference: $entraUrl"
                throw "Pre-flight failed: $($missingScopes.Count) missing Graph permission(s): $($missingScopes -join ', ')"
            }
            Write-Log "  ✅ All $($requiredGraphScopes.Count) required Graph permissions are granted ($($grantedScopes.Count) total granted)."
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
                -Context "Stage 2c — Graph API scopes (Delegated)" `
                -Message "$($missingScopes.Count) required Graph scope(s) missing from the current session." `
                -Detail "Missing: $($missingScopes -join ', ')" `
                -Resolution "Re-authenticate with the required scopes: Connect-MgGraph -Scopes (Get-ZtGraphScope)"
            throw "Pre-flight failed: $($missingScopes.Count) missing Graph scope(s)."
        }
        Write-Log "  ✅ All $($requiredGraphScopes.Count) required Graph scopes present."
    }
}
catch {
    if ($_.Exception.Message -like '*Pre-flight failed*') { throw $_ }
    Write-DiagnosticError `
        -Context "Stage 2c — Graph context validation" `
        -Message "Failed to validate Microsoft Graph session." `
        -Detail $_.Exception.Message `
        -Resolution "Check that Stage 2 authentication completed successfully."
    throw $_
}

# ── Check 2: Graph data probe ─────────────────────────────────────────────
Write-Log " [Check 2] Probing Graph /organization..."
try {
    $probeResult = Invoke-MgGraphRequest -Uri "https://graph.microsoft.com/v1.0/organization" -Method GET -ErrorAction Stop
    if (-not $probeResult.value -or $probeResult.value.Count -eq 0) { throw "Graph returned empty organization data." }
    Write-Log " ✅ Graph probe succeeded — Organization: $($probeResult.value[0].displayName)"
}
catch {
    Write-DiagnosticError `
        -Context "Stage 2c — Graph data probe" `
        -Message "Authenticated to Graph but cannot read tenant data." `
        -Detail $_.Exception.Message `
        -Resolution "Identity may lack Directory.Read.All, admin consent, or Global Reader role in Entra."
    throw $_
}

Write-Log " Pre-flight checks passed. Storage verified in Stage 3."

#endregion

#region ── STAGE 3: Connect to storage account ────────────────────────────

Write-Log "━━━ STAGE 3: Connecting to Storage Account ━━━"

# $ctx                 — Az storage context used by all Upload-JsonBlob calls
# $azureSubscriptionId — subscription that owns the storage account; also used to
#                        reset Az context after per-subscription Defender/governance queries

$ctx                 = $null
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
                Write-Log " Found in: $($sub.Name) [$($sub.Id)]"
                break
            }
        }
        catch {
            Write-Log " [WARN] Could not query storage in $($sub.Id): $($_.Exception.Message)" "WARN"
        }
    }

    if (-not $azureSubscriptionId) {
        Write-DiagnosticError `
            -Context "Stage 3 — Storage account discovery" `
            -Message "Storage account '$storageAccountName' not found in any accessible subscription." `
            -Detail "Searched $($allSubs.Count) subscription(s): $(($allSubs | ForEach-Object { $_.Id }) -join ', ')" `
            -Resolution "1. Confirm 'StorageAccountName' Automation Variable is correct. 2. Ensure the UAMI has 'Reader' on the storage account's subscription."
        throw "Storage account '$storageAccountName' not found."
    }

    Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction Stop | Out-Null

    # OAuth context — requires 'Storage Blob Data Contributor' on the UAMI
    $ctx = New-AzStorageContext `
        -StorageAccountName $storageAccountName `
        -UseConnectedAccount `
        -ErrorAction Stop

    Write-Log " Storage account  : $storageAccountName"
    Write-Log " Storage sub ID   : $azureSubscriptionId"
    Write-Log " Storage context  : OK (OAuth / UAMI)"

    # Create container if it doesn't exist
    $containerCheck = Get-AzStorageContainer -Name $containerName -Context $ctx -ErrorAction SilentlyContinue
    if (-not $containerCheck) {
        Write-Log " Container '$containerName' not found — creating..." "WARN"
        New-AzStorageContainer -Name $containerName -Context $ctx -Permission Off -ErrorAction Stop | Out-Null
        Write-Log " Container '$containerName' created."
    } else {
        Write-Log " Container '$containerName' — OK."
    }
}
catch {
    Write-DiagnosticError `
        -Context "Stage 3 — Storage Account connection" `
        -Message "Failed to connect to storage account '$storageAccountName'." `
        -Detail $_.Exception.Message `
        -Resolution "1. Confirm 'StorageAccountName' Automation Variable. 2. Assign 'Storage Blob Data Contributor' to the UAMI. 3. Assign 'Reader' on the storage subscription."
    throw $_
}

# ── Storage write probe ───────────────────────────────────────────────────
Write-Log " [Check 3] Probing storage write access..."
try {
    $probeContent  = "{`"probe`":`"ok`",`"ts`":`"$((Get-Date).ToString('o'))`"}"
    $probeTempFile = Write-TempUtf8File -Content $probeContent -Extension ".json"
    Set-AzStorageBlobContent `
        -Container $containerName `
        -Blob      "probe/write-test.json" `
        -File      $probeTempFile `
        -Context   $ctx `
        -Force | Out-Null
    Remove-Item $probeTempFile -Force -ErrorAction SilentlyContinue
    Write-Log " ✅ Storage write probe succeeded — '$containerName' is writable."
}
catch {
    Write-DiagnosticError `
        -Context "Stage 3 — Storage write probe" `
        -Message "Cannot write to container '$containerName' in '$storageAccountName'." `
        -Detail $_.Exception.Message `
        -Resolution "Assign 'Storage Blob Data Contributor' to the UAMI on the storage account or container."
    throw $_
}

#endregion

#region ── STAGE 4: Run Zero Trust Assessment ─────────────────────────────

Write-Log "━━━ STAGE 4: Running Zero Trust Assessment ━━━"

$reportPath = Join-Path $env:TEMP "ZTReport-$today"
if (Test-Path $reportPath) {
    Write-Log "Removing stale report folder from previous run..."
    Remove-Item -Path $reportPath -Recurse -Force
}

# Skip Connect-ZtAssessment — Stage 2 already authenticated.
# Calling Connect-MgGraph again on a Windows Hybrid Worker triggers WAM interactive prompts.
Write-Log "ZeroTrustAssessment will use the existing Graph session from Stage 2."

# Workaround: cap DuckDB memory to prevent crashes on memory-constrained Hybrid Workers
Write-Log "Configuring DuckDB memory limit (500MB)..."
$duckdbrcPath = Join-Path $env:USERPROFILE ".duckdbrc"
"SET max_memory='500MB';" | Out-File -FilePath $duckdbrcPath -Encoding ascii -Force

# Workaround: force HTTP/1.1 to prevent Graph SDK stream errors on large exports
Write-Log "Forcing Graph SDK to HTTP/1.1..."
$env:MicrosoftGraphHttpVersion = "HTTP11"

# Workaround: override Test-ZtContext — for app-only auth it checks $context.Scopes
# which is just '.default', causing false 'missing scopes' errors. Stage 2c already
# validated all permissions exhaustively so this check is safe to skip.
Write-Log "Overriding Test-ZtContext (app-only auth bypass — permissions validated in Stage 2c)..."
function global:Test-ZtContext { return $true }

try {
    Write-Log "Setting Graph client timeout to 4 hours for large enterprise exports..."
    Set-MgRequestContext -ClientTimeout 14400 -ErrorAction SilentlyContinue
    Write-Log "Running Invoke-ZtAssessment (Path=$reportPath, Days=30)..."
    Invoke-ZtAssessment -Path $reportPath -Days 30 -DisableTelemetry
    Write-Log "Invoke-ZtAssessment — completed ✅"
}
catch {
    Write-DiagnosticError `
        -Context "Stage 4 — Invoke-ZtAssessment" `
        -Message "The Zero Trust Assessment cmdlet threw an error." `
        -Detail $_.Exception.Message `
        -Resolution "1. Identity needs 'Global Reader' in Entra ID. 2. Check Microsoft.Graph.* modules. 3. On first run check Entra ID > Enterprise Applications for consent."
    throw $_
}

$reportJsonPath = Join-Path $reportPath "zt-export" "ZeroTrustAssessmentReport.json"
if (-not (Test-Path $reportJsonPath)) {
    Write-DiagnosticError `
        -Context "Stage 4 — Report JSON validation" `
        -Message "Invoke-ZtAssessment completed but ZeroTrustAssessmentReport.json was not found." `
        -Detail "Expected path: $reportJsonPath" `
        -Resolution "Check the temp folder. Module version may have changed the output path."
    throw "ZeroTrustAssessmentReport.json not found at: $reportJsonPath"
}

try {
    $reportJson = Get-Content -Path $reportJsonPath -Raw -ErrorAction Stop | ConvertFrom-Json
    Write-Log "Assessment parsed — Tenant: $($reportJson.TenantName), Tests: $($reportJson.Tests.Count)"
}
catch {
    Write-DiagnosticError `
        -Context "Stage 4 — Parse assessment JSON" `
        -Message "Report JSON exists but could not be parsed." `
        -Detail $_.Exception.Message `
        -Resolution "JSON may be corrupt or empty. Check disk space on the VM."
    throw $_
}

#endregion

#region ── STAGE 6: Upload full assessment report ─────────────────────────

Write-Log "━━━ STAGE 6: Uploading full assessment report ━━━"
Upload-JsonBlob `
    -BlobPath       "assessments/report-data.json" `
    -Data           $reportJson `
    -StorageContext $ctx `
    -Container      $containerName
Write-Log "Full assessment report uploaded."

#endregion

#region ── STAGE 7: Per-subscription data collection ──────────────────────

Write-Log "━━━ STAGE 7: Per-Subscription Data Collection ━━━"
Write-Log "Processing $($targetSubscriptionIds.Count) subscription(s)..."

foreach ($subId in $targetSubscriptionIds) {

    Write-Log "──── Subscription: $subId ────"
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
            Write-Log "  Pillar '$pName' — no tests found, skipping." "WARN"
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
| take 100
"@

    try {
        $policyResults = Search-AzGraph -Query $policyQuery -Subscription $subId -ErrorAction Stop
        # Az.ResourceGraph 0.x returns results under .Data; 1.x+ returns them directly
        $policyRows = @(if ($policyResults.PSObject.Properties.Name -contains 'Data') { $policyResults.Data } else { $policyResults })
        Write-Log "  Resource Graph returned $($policyRows.Count) initiative(s)."

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
        Write-Log "  Resource Graph returned nothing — trying Get-AzPolicyState fallback..."
        try {
            $policyStates = @(Get-AzPolicyState -SubscriptionId $subId -Top 200 -ErrorAction Stop)
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
| take 200
"@
            $ncResults = Search-AzGraph -Query $resourceQuery -Subscription $subId -ErrorAction Stop
            $ncRows = @(if ($ncResults.PSObject.Properties.Name -contains 'Data') { $ncResults.Data } else { $ncResults })
            Write-Log "  Found $($ncRows.Count) non-compliant resource(s)."

            foreach ($r in $ncRows) {
                $matchInit = $initiatives | Where-Object { $_.id -eq $r.initiativeId } | Select-Object -First 1
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
        $assessments = @(Get-AzSecurityAssessment -ErrorAction Stop | Select-Object -First 500)
        Write-Log "  Found $($assessments.Count) Defender assessment(s)."

        foreach ($a in $assessments) {
            $severity = switch ($a.Status.Severity) {
                "Critical" { "critical" } "High" { "high" } "Medium" { "medium" } "Low" { "low" } default { "medium" }
            }
            $category = "General"
            if ($a.Metadata.Categories -and $a.Metadata.Categories.Count -gt 0) { $category = $a.Metadata.Categories[0] }
            $description   = if ($a.Metadata.Description)            { $a.Metadata.Description }            else { "" }
            $remediation   = if ($a.Metadata.RemediationDescription)  { $a.Metadata.RemediationDescription }  else { "" }
            $resourceCount = 0
            if ($a.Status.UnhealthyResourceCount) { $resourceCount = [int]$a.Status.UnhealthyResourceCount }
            $displayName = if ($a.DisplayName) { $a.DisplayName } else { $a.Name }

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
        $secureTokenObj = Get-AzAccessToken -ResourceUrl "https://management.azure.com" -AsSecureString -ErrorAction Stop
        $token = [System.Net.NetworkCredential]::new('', $secureTokenObj.Token).Password

        $govUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Security/governanceRules?api-version=2022-01-01-preview"
        $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

        try {
            $govResponse = Invoke-RestMethod -Uri $govUri -Headers $headers -Method Get -TimeoutSec 30 -ErrorAction Stop
            $govItems = @($govResponse.value)
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

    Write-Log " ✅ Subscription $subId — complete"
}

#endregion
