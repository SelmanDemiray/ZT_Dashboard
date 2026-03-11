<#
.SYNOPSIS
    Azure Automation Hybrid Runbook — Zero Trust Dashboard daily data collection.

.DESCRIPTION
    This is the HYBRID WORKER version of the ZeroTrustAssessment data collection
    runbook. It runs on an Azure VM registered as a Hybrid Runbook Worker, which
    removes the 100 MB module size limit imposed by the Azure Automation sandbox.

    The ZeroTrustAssessment module is installed locally on the VM via
    Install-Module (see Setup-HybridWorkerModules.ps1), so it can be any size.

    Functional behavior is identical to the cloud version:
      • Authenticates via Managed Identity or App Registration
      • Runs ZeroTrustAssessment to produce the assessment JSON
      • Collects Azure Policy, Defender for Cloud, and Governance data
      • Uploads structured JSON files to a storage account for the React dashboard

    KEY DIFFERENCES FROM CLOUD VERSION:
      • Stage 0 validates that all required modules are installed locally
      • Prints Hybrid Worker diagnostics (hostname, PS version, worker group)
      • Modules are loaded from the VM's local module path, not Azure Automation runtime
      • No 100 MB module size limit

.NOTES
    Prerequisites (one-time setup):
      1. Azure VM registered as a Hybrid Runbook Worker (see HYBRID-DEPLOYMENT.md)
      2. All modules installed locally on the VM via Setup-HybridWorkerModules.ps1
      3. Permissions:
         - 'Reader' on every subscription in the tenant (Azure RBAC)
         - 'Storage Blob Data Contributor' on the storage account (Azure RBAC)
         - 'Global Reader' in Entra ID (for ZeroTrustAssessment / MS Graph)
      4. Automation Variables (same as cloud version):
         - AuthMethod, TargetTenantId, StorageAccountName, BlobContainerName
         - If AppRegistration: AppClientId, AppClientSecret (encrypted)
      5. Runbook schedule set to "Run on: Hybrid Worker" targeting your HRW group.

.TROUBLESHOOTING
    "Module XYZ not found"
      → RDP into the VM, open pwsh AS ADMINISTRATOR, run:
        Install-Module -Name XYZ -Scope AllUsers -Force
      → Or re-run Setup-HybridWorkerModules.ps1 as admin.

    "Failed to authenticate using Managed Identity"
      → On a Hybrid Worker, Connect-AzAccount -Identity uses the VM's
        Managed Identity, not the Automation Account's. Assign roles to
        the VM's identity in Azure Portal → VM → Identity.

    "No enabled subscriptions found"
      → The VM's identity (or App Registration) lacks 'Reader' RBAC
        on subscriptions. Assign via IAM on each subscription.

    "ZeroTrustAssessmentReport.json was not generated"
      → The identity needs 'Global Reader' in Entra ID for Graph queries.
        Check Entra ID → Roles and Administrators.
#>

param()

#region ── 0. Strict mode, preferences & helpers ──────────────────────────
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"
$today = (Get-Date).ToString("yyyy-MM-dd")

# ── Write-Log ──────────────────────────────────────────────────────────────
function Write-Log {
    param(
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","DEBUG")]
        [string]$Level = "INFO"
    )
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Output "[$ts][$Level] $Message"
}

# ── Write-DiagnosticError ──────────────────────────────────────────────────
function Write-DiagnosticError {
    param(
        [string]$Context,
        [string]$Message,
        [string]$Detail     = "",
        [string]$Resolution = ""
    )
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
    Write-Log "FATAL ERROR in: $Context"                        "ERROR"
    Write-Log "Problem  : $Message"                             "ERROR"
    if ($Detail)     { Write-Log "Detail   : $Detail"           "ERROR" }
    if ($Resolution) { Write-Log "Fix      : $Resolution"       "ERROR" }
    Write-Log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" "ERROR"
}
#endregion


#region ── 0a. Hybrid Worker Diagnostics ──────────────────────────────────
# The Automation Hybrid Worker service sometimes overrides PSModulePath.
# We explicitly re-inject the standard AllUsers module paths here.
$standardPaths = @("C:\Program Files\PowerShell\Modules", "C:\Program Files\WindowsPowerShell\Modules")
foreach ($sp in $standardPaths) {
    if ((Test-Path $sp) -and ($env:PSModulePath -notmatch [regex]::Escape($sp))) {
        $env:PSModulePath = "$sp;$env:PSModulePath"
    }
}

Write-Log "═══ HYBRID WORKER DIAGNOSTICS ═══"
Write-Log "  Hostname     : $($env:COMPUTERNAME)"
Write-Log "  PS Version   : $($PSVersionTable.PSVersion)"
Write-Log "  OS           : $([System.Runtime.InteropServices.RuntimeInformation]::OSDescription)"
Write-Log "  Date         : $today"
Write-Log "  Temp Path    : $($env:TEMP)"
Write-Log "  Module Paths : $($env:PSModulePath -replace ';', '; ')"
Write-Log "═══════════════════════════════════"
#endregion


#region ── 0b. Validate Local Module Availability ─────────────────────────
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
    $found = Get-Module -Name $mod -ListAvailable | Sort-Object Version -Descending | Select-Object -First 1
    if ($found) {
        Write-Log "  ✅ $mod ($($found.Version))"
    }
    else {
        Write-Log "  ❌ $mod — NOT FOUND" "ERROR"
        $missingModules += $mod
    }
}

if ($missingModules.Count -gt 0) {
    Write-DiagnosticError `
        -Context    "Stage 0 — Module validation" `
        -Message    "$($missingModules.Count) required module(s) are not installed on this Hybrid Worker VM." `
        -Detail     "Missing: $($missingModules -join ', ')" `
        -Resolution "RDP into the VM, open pwsh (PowerShell 7.x) AS ADMINISTRATOR, and run: Install-Module -Name <module> -Scope AllUsers -Force. Or re-run Setup-HybridWorkerModules.ps1 as Admin."
    throw "Missing modules: $($missingModules -join ', '). See Setup-HybridWorkerModules.ps1."
}

Write-Log "All $($requiredModules.Count) modules available."
#endregion


#region ── 1. Read Automation Variables ───────────────────────────────────
Write-Log "━━━ STAGE 1: Reading Automation Variables ━━━"

$authMethod = Get-AutomationVariable -Name "AuthMethod" -ErrorAction SilentlyContinue
if (-not $authMethod) {
    Write-Log "AuthMethod variable not found — defaulting to 'AppRegistration'." "WARN"
    Write-Log "To suppress this warning: create an Automation Variable named 'AuthMethod'." "WARN"
    $authMethod = "AppRegistration"
}

try {
    $storageAccountName = Get-AutomationVariable -Name "StorageAccountName" -ErrorAction Stop
    $containerName      = Get-AutomationVariable -Name "BlobContainerName"  -ErrorAction Stop
    $targetTenantId     = Get-AutomationVariable -Name "TargetTenantId"     -ErrorAction Stop
}
catch {
    Write-DiagnosticError `
        -Context    "Stage 1 — Reading core Automation Variables" `
        -Message    "One or more required Automation Variables are missing." `
        -Detail     $_.Exception.Message `
        -Resolution "Ensure these variables exist in Automation Account > Shared Resources > Variables: StorageAccountName, BlobContainerName, TargetTenantId."
    throw $_
}

Write-Log "Auth Method      : $authMethod"
Write-Log "Storage Account  : $storageAccountName"
Write-Log "Blob Container   : $containerName"
Write-Log "Target Tenant    : $targetTenantId"
#endregion


#region ── 2. Authenticate ────────────────────────────────────────────────
Write-Log "━━━ STAGE 2: Authenticating ━━━"

if ($authMethod -eq 'ManagedIdentity') {
    Write-Log "Auth method: Managed Identity (VM's System-Assigned Identity)"
    Write-Log "NOTE: On a Hybrid Worker, -Identity uses the VM's MI, not the Automation Account's."
    try {
        Connect-AzAccount -Identity | Out-Null
        Write-Log "Connect-AzAccount (Managed Identity) — OK"
    }
    catch {
        Write-DiagnosticError `
            -Context    "Stage 2 — Connect-AzAccount (ManagedIdentity)" `
            -Message    "Failed to authenticate to Azure using the VM's Managed Identity." `
            -Detail     $_.Exception.Message `
            -Resolution "Verify the VM has a System-Assigned Managed Identity enabled (VM > Identity tab). Assign 'Reader' role to the VM's MI on target subscriptions."
        throw $_
    }

    try {
        Connect-MgGraph -Identity -TenantId $targetTenantId -NoWelcome | Out-Null
        Write-Log "Connect-MgGraph (Managed Identity) — OK"
    }
    catch {
        Write-DiagnosticError `
            -Context    "Stage 2 — Connect-MgGraph (ManagedIdentity)" `
            -Message    "Failed to authenticate to Microsoft Graph using the VM's Managed Identity." `
            -Detail     $_.Exception.Message `
            -Resolution "Assign 'Global Reader' role to the VM's Managed Identity in Entra ID > Roles and Administrators."
        throw $_
    }
}
elseif ($authMethod -eq 'AppRegistration') {
    Write-Log "Auth method: App Registration (Service Principal)"

    try {
        $appClientId     = Get-AutomationVariable -Name "AppClientId"     -ErrorAction Stop
        $appClientSecret = Get-AutomationVariable -Name "AppClientSecret" -ErrorAction Stop
    }
    catch {
        Write-DiagnosticError `
            -Context    "Stage 2 — Reading AppRegistration Variables" `
            -Message    "AppClientId or AppClientSecret Automation Variables are missing." `
            -Detail     $_.Exception.Message `
            -Resolution "Create both variables in Automation Account > Variables. Mark AppClientSecret as Encrypted."
        throw $_
    }

    Write-Log "App Client ID: $appClientId"

    $secureSecret = ConvertTo-SecureString $appClientSecret -AsPlainText -Force
    $cred         = New-Object System.Management.Automation.PSCredential($appClientId, $secureSecret)

    try {
        Connect-AzAccount -ServicePrincipal -Credential $cred -Tenant $targetTenantId | Out-Null
        Write-Log "Connect-AzAccount (App Registration) — OK"
    }
    catch {
        Write-DiagnosticError `
            -Context    "Stage 2 — Connect-AzAccount (AppRegistration)" `
            -Message    "Failed to authenticate to Azure using the App Registration credentials." `
            -Detail     $_.Exception.Message `
            -Resolution "Verify AppClientId and AppClientSecret are correct. Check the secret has not expired."
        throw $_
    }

    try {
        Connect-MgGraph -ClientSecretCredential $cred -TenantId $targetTenantId -NoWelcome | Out-Null
        Write-Log "Connect-MgGraph (App Registration) — OK"
    }
    catch {
        Write-DiagnosticError `
            -Context    "Stage 2 — Connect-MgGraph (AppRegistration)" `
            -Message    "Azure auth succeeded but Microsoft Graph auth failed." `
            -Detail     $_.Exception.Message `
            -Resolution "Assign 'Global Reader' role to the App Registration's service principal in Entra ID."
        throw $_
    }
}
else {
    Write-DiagnosticError `
        -Context    "Stage 2 — Auth method validation" `
        -Message    "AuthMethod variable has an unrecognised value: '$authMethod'." `
        -Resolution "Update the AuthMethod Automation Variable to either 'AppRegistration' or 'ManagedIdentity' (case-sensitive)."
    throw "Invalid AuthMethod: '$authMethod'."
}
#endregion


#region ── 2b. Discover subscriptions ────────────────────────────────────
Write-Log "━━━ STAGE 2b: Discovering Subscriptions ━━━"

try {
    $allSubs = Get-AzSubscription -TenantId $targetTenantId -ErrorAction Stop |
               Where-Object { $_.State -eq 'Enabled' }
}
catch {
    Write-DiagnosticError `
        -Context    "Stage 2b — Get-AzSubscription" `
        -Message    "Failed to list subscriptions. The identity may lack permission." `
        -Detail     $_.Exception.Message `
        -Resolution "Assign 'Reader' role to the identity at Management Group or subscription level."
    throw $_
}

$targetSubscriptionIds = @($allSubs | ForEach-Object { $_.Id })

if ($targetSubscriptionIds.Count -eq 0) {
    $rbacMsg = if ($authMethod -eq 'AppRegistration') {
        "The App Registration service principal '$appClientId' has no 'Reader' RBAC role " +
        "assigned on any subscription in tenant '$targetTenantId'. " +
        "Fix: Azure Portal > Subscriptions > Access Control (IAM) > Add role assignment > Reader."
    } else {
        "The VM's Managed Identity has no 'Reader' RBAC role assigned on any subscription. " +
        "Fix: Azure Portal > Subscriptions > Access Control (IAM) > Add role assignment > Reader > " +
        "assign to the VM's Managed Identity (search by VM name)."
    }

    Write-DiagnosticError `
        -Context    "Stage 2b — Subscription discovery" `
        -Message    "No enabled subscriptions found in tenant '$targetTenantId'." `
        -Resolution $rbacMsg
    throw "No enabled subscriptions found in tenant '$targetTenantId'. $rbacMsg"
}

Write-Log "Found $($targetSubscriptionIds.Count) enabled subscription(s):"
foreach ($s in $allSubs) {
    Write-Log "  • $($s.Name) [$($s.Id)]"
}
#endregion


#region ── 3. Discover Storage Account ───────────────────────────────────
Write-Log "━━━ STAGE 3: Discovering Storage Account '$storageAccountName' ━━━"

$storageAcctQuery = @"
Resources
| where type =~ 'microsoft.storage/storageaccounts'
| where name =~ '$storageAccountName'
| project subscriptionId, resourceGroup, name
"@

try {
    $storageAcctResult = Search-AzGraph -Query $storageAcctQuery -First 1 -ErrorAction Stop
}
catch {
    Write-DiagnosticError `
        -Context    "Stage 3 — Search-AzGraph for storage account" `
        -Message    "Azure Resource Graph query failed." `
        -Detail     $_.Exception.Message `
        -Resolution "Confirm Az.ResourceGraph module is installed. Confirm the identity has 'Reader' on the subscription containing the storage account."
    throw $_
}

if (-not $storageAcctResult -or $storageAcctResult.Data.Count -eq 0) {
    Write-DiagnosticError `
        -Context    "Stage 3 — Storage account lookup" `
        -Message    "Storage account '$storageAccountName' was not found via Azure Resource Graph." `
        -Resolution "1. Verify StorageAccountName variable is spelled correctly. " +
                    "2. Confirm the identity has 'Reader' on the subscription containing the storage account."
    throw "Storage account '$storageAccountName' not found."
}

$azureSubscriptionId = $storageAcctResult.Data[0].subscriptionId
$storageAccountRG    = $storageAcctResult.Data[0].resourceGroup
Write-Log "Found storage account in sub: $azureSubscriptionId (RG: $storageAccountRG)"

try {
    Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    $storageAccountObj = Get-AzStorageAccount -ResourceGroupName $storageAccountRG -Name $storageAccountName -ErrorAction Stop
    $ctx               = $storageAccountObj.Context
    Write-Log "Storage context obtained — OK"
}
catch {
    Write-DiagnosticError `
        -Context    "Stage 3 — Get-AzStorageAccount" `
        -Message    "Found the storage account but could not retrieve its context." `
        -Detail     $_.Exception.Message `
        -Resolution "Assign 'Storage Blob Data Contributor' to the identity on the storage account."
    throw $_
}
#endregion


#region ── 4. Run Zero Trust Assessment ───────────────────────────────────
Write-Log "━━━ STAGE 4: Running Zero Trust Assessment ━━━"

$reportPath = Join-Path $env:TEMP "ZTReport-$today"
if (Test-Path $reportPath) {
    Write-Log "Removing stale report folder from previous run..."
    Remove-Item -Path $reportPath -Recurse -Force
}

try {
    Write-Log "Connecting ZeroTrustAssessment module to current Graph session..."
    Connect-ZtAssessment
    Write-Log "Connect-ZtAssessment — OK"
}
catch {
    Write-DiagnosticError `
        -Context    "Stage 4 — Connect-ZtAssessment" `
        -Message    "Failed to connect the ZeroTrustAssessment module." `
        -Detail     $_.Exception.Message `
        -Resolution "1. Verify ZeroTrustAssessment module is installed (Get-Module -ListAvailable ZeroTrustAssessment). " +
                    "2. Verify Connect-MgGraph succeeded in Stage 2. " +
                    "3. Verify the identity has 'Global Reader' in Entra ID."
    throw $_
}

try {
    Write-Log "Running Invoke-ZtAssessment (Path: $reportPath, Days: 30)..."
    Invoke-ZtAssessment -Path $reportPath -Days 30 -DisableTelemetry
    Write-Log "Invoke-ZtAssessment — completed"
}
catch {
    Write-DiagnosticError `
        -Context    "Stage 4 — Invoke-ZtAssessment" `
        -Message    "The Zero Trust Assessment cmdlet threw an error." `
        -Detail     $_.Exception.Message `
        -Resolution "1. Check the identity has 'Global Reader' in Entra ID. " +
                    "2. Check Microsoft.Graph.* modules are installed. " +
                    "3. If first run, check Entra ID > Enterprise Applications for consent."
    throw $_
}

$reportJsonPath = Join-Path $reportPath "zt-export" "ZeroTrustAssessmentReport.json"
if (-not (Test-Path $reportJsonPath)) {
    Write-DiagnosticError `
        -Context    "Stage 4 — Report JSON validation" `
        -Message    "Invoke-ZtAssessment completed but the expected JSON output was not found." `
        -Detail     "Expected path: $reportJsonPath" `
        -Resolution "1. Check the temp folder contents. 2. Module version may have changed the output path."
    throw "ZeroTrustAssessmentReport.json not found at: $reportJsonPath"
}

try {
    $reportJson = Get-Content -Path $reportJsonPath -Raw -ErrorAction Stop | ConvertFrom-Json
    Write-Log "Assessment complete — Tenant: $($reportJson.TenantName)"
    Write-Log "Tests in report: $($reportJson.Tests.Count)"
}
catch {
    Write-DiagnosticError `
        -Context    "Stage 4 — Parse assessment JSON" `
        -Message    "Report JSON file exists but could not be parsed." `
        -Detail     $_.Exception.Message `
        -Resolution "The JSON file may be corrupt or empty. Check available disk space on the VM."
    throw $_
}
#endregion


#region ── 5. Upload helper ───────────────────────────────────────────────
function Upload-JsonBlob {
    param(
        [Parameter(Mandatory)][string]$BlobPath,
        [Parameter(Mandatory)][object]$Data,
        [Parameter(Mandatory)]$StorageContext,
        [Parameter(Mandatory)][string]$Container
    )

    try {
        $json  = $Data | ConvertTo-Json -Depth 20 -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $ms    = [System.IO.MemoryStream]::new($bytes)

        try {
            Set-AzStorageBlobContent `
                -Container   $Container `
                -Blob        $BlobPath `
                -BlobType    Block `
                -Stream      $ms `
                -ContentType "application/json" `
                -Context     $StorageContext `
                -Force | Out-Null

            Write-Log "  [UPLOAD OK] $BlobPath ($($bytes.Length) bytes)"
        }
        finally {
            $ms.Dispose()
        }
    }
    catch {
        Write-Log "  [UPLOAD FAIL] $BlobPath — $($_.Exception.Message)" "WARN"
        Write-Log "  Resolution: Verify 'Storage Blob Data Contributor' is assigned to the identity on storage account '$storageAccountName'." "WARN"
    }
}
#endregion


#region ── 6. Upload full assessment report ───────────────────────────────
Write-Log "━━━ STAGE 6: Uploading full assessment report ━━━"

Upload-JsonBlob `
    -BlobPath      "assessments/report-data.json" `
    -Data          $reportJson `
    -StorageContext $ctx `
    -Container     $containerName

Write-Log "Full assessment report uploaded."
#endregion


#region ── 7. Per-subscription data collection ────────────────────────────
Write-Log "━━━ STAGE 7: Per-Subscription Data Collection ━━━"
Write-Log "Processing $($targetSubscriptionIds.Count) subscription(s)..."

foreach ($subId in $targetSubscriptionIds) {
    Write-Log "──── Subscription: $subId ────"
    $blobBasePath   = "assessments/$targetTenantId/$subId/$today"
    $blobLatestPath = "assessments/$targetTenantId/$subId/latest"

    #── 7a. Zero Trust snapshot ──────────────────────────────────────────
    Write-Log "  [7a] Building Zero Trust snapshot..."

    $pillars = @()
    $checks  = @()

    $pillarNames = @("Identity", "Devices", "Data", "Network")
    foreach ($pName in $pillarNames) {
        $pillarTests = $reportJson.Tests | Where-Object { $_.TestPillar -eq $pName }
        if (-not $pillarTests -or $pillarTests.Count -eq 0) {
            Write-Log "    Pillar '$pName' — no tests found in report, skipping." "WARN"
            continue
        }

        $totalChecks = $pillarTests.Count
        $passed      = ($pillarTests | Where-Object { $_.TestStatus -eq "Passed" }).Count
        $failed      = $totalChecks - $passed
        $score       = if ($totalChecks -gt 0) { [math]::Round(($passed / $totalChecks) * 100, 1) } else { 0 }

        Write-Log "    Pillar '$pName': $passed/$totalChecks passed (score: $score)"

        $pillars += [ordered]@{
            name        = $pName
            score       = $score
            totalChecks = $totalChecks
            passed      = $passed
            failed      = $failed
        }

        foreach ($t in $pillarTests) {
            $status = switch ($t.TestStatus) {
                "Passed"  { "passed" }
                "Failed"  { "failed" }
                "Skipped" { "notApplicable" }
                default   { "investigate" }
            }
            $risk = switch ($t.TestRisk) {
                "High"   { "high" }
                "Medium" { "medium" }
                "Low"    { "low" }
                default  { "informational" }
            }

            $checks += [ordered]@{
                id           = $t.TestId
                name         = $t.TestTitle
                pillar       = $pName
                area         = if ($t.TestCategory) { $t.TestCategory } else { $pName }
                status       = $status
                risk         = $risk
                description  = if ($t.TestDescription) { $t.TestDescription.Substring(0, [math]::Min(500, $t.TestDescription.Length)) } else { "" }
                remediation  = ""
                learnMoreUrl = ""
                score        = if ($status -eq "passed") { 100 } else { 0 }
                weight       = 1
            }
        }
    }

    $overallScore = if ($pillars.Count -gt 0) {
        [math]::Round(($pillars | ForEach-Object { $_.score } | Measure-Object -Average).Average, 1)
    } else { 0 }

    $ztSnapshot = [ordered]@{
        tenantId     = $targetTenantId
        tenantName   = $reportJson.TenantName
        runDate      = $today
        overallScore = $overallScore
        pillars      = $pillars
        checks       = $checks
    }

    Upload-JsonBlob -BlobPath "$blobBasePath/zero-trust.json"  -Data $ztSnapshot -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/zero-trust.json" -Data $ztSnapshot -StorageContext $ctx -Container $containerName

    #── 7b. Policy Compliance ─────────────────────────────────────────────
    Write-Log "  [7b] Collecting Policy Compliance data..."

    $initiatives = @()
    $policyQuery = @"
PolicyResources
| where type == 'microsoft.policyinsights/policystates'
| where subscriptionId == '$subId'
| where properties.complianceState != ''
| extend initiativeId   = tostring(properties.policySetDefinitionId),
         initiativeName = tostring(properties.policySetDefinitionName),
         complianceState= tostring(properties.complianceState),
         policyDefId    = tostring(properties.policyDefinitionId),
         policyAssignId = tostring(properties.policyAssignmentId)
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
        Write-Log "    Resource Graph policy query returned $($policyResults.Data.Count) initiative(s)."

        foreach ($row in $policyResults.Data) {
            $initiativeType = if ($row.initiativeId -like "*/providers/Microsoft.Authorization/policySetDefinitions/*") { "builtin" } else { "custom" }
            $initiatives += [ordered]@{
                id                = $row.initiativeId
                name              = if ($row.initiativeName) { $row.initiativeName } else { "Unnamed Initiative" }
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
        Write-Log "    [WARN] Resource Graph policy query failed: $($_.Exception.Message)" "WARN"
    }

    # Fallback to direct policy state API if Resource Graph returned nothing
    if ($initiatives.Count -eq 0) {
        Write-Log "    Resource Graph returned no results — trying Get-AzPolicyState fallback..."
        try {
            $policyStates = Get-AzPolicyState -SubscriptionId $subId -Top 200 -ErrorAction Stop
            Write-Log "    Get-AzPolicyState returned $($policyStates.Count) state(s)."
            $grouped = $policyStates | Group-Object { $_.PolicySetDefinitionId }

            foreach ($g in $grouped) {
                if (-not $g.Name) { continue }
                $compliant    = ($g.Group | Where-Object { $_.ComplianceState -eq "Compliant" }).Count
                $nonCompliant = ($g.Group | Where-Object { $_.ComplianceState -eq "NonCompliant" }).Count
                $exempt       = ($g.Group | Where-Object { $_.ComplianceState -eq "Exempt" }).Count

                $initiatives += [ordered]@{
                    id                = $g.Name
                    name              = ($g.Group | Select-Object -First 1).PolicySetDefinitionName
                    type              = "builtin"
                    assignmentId      = ($g.Group | Select-Object -First 1).PolicyAssignmentId
                    subscriptionId    = $subId
                    compliantCount    = $compliant
                    nonCompliantCount = $nonCompliant
                    exemptCount       = $exempt
                    totalPolicies     = ($g.Group | Select-Object -ExpandProperty PolicyDefinitionId -Unique).Count
                    resources         = @()
                }
            }
        }
        catch {
            Write-Log "    [WARN] Get-AzPolicyState fallback also failed: $($_.Exception.Message)" "WARN"
            Write-Log "    [WARN] Policy data will be empty for this subscription." "WARN"
        }
    }

    # Fetch non-compliant resources and attach to initiatives
    if ($initiatives.Count -gt 0) {
        Write-Log "    Fetching non-compliant resource details..."
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
            $ncResources = Search-AzGraph -Query $resourceQuery -Subscription $subId -ErrorAction Stop
            Write-Log "    Found $($ncResources.Data.Count) non-compliant resource(s)."

            foreach ($r in $ncResources.Data) {
                $matchInit = $initiatives | Where-Object { $_.id -eq $r.initiativeId } | Select-Object -First 1
                if ($matchInit) {
                    $matchInit.resources += [ordered]@{
                        resourceId      = $r.resourceId
                        resourceName    = $r.resourceName
                        resourceType    = $r.resourceType
                        resourceGroup   = $r.resourceGroup
                        subscriptionId  = $subId
                        state           = "NonCompliant"
                        failingPolicies = @([ordered]@{
                            id          = $r.policyDefId
                            name        = if ($r.policyName) { $r.policyName } else { "Unknown Policy" }
                            description = ""
                        })
                    }
                }
            }
        }
        catch {
            Write-Log "    [WARN] Non-compliant resource query failed: $($_.Exception.Message)" "WARN"
        }
    }

    $policyCompliance = [ordered]@{ runDate = $today; initiatives = $initiatives }
    Upload-JsonBlob -BlobPath "$blobBasePath/policy-compliance.json"  -Data $policyCompliance -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/policy-compliance.json" -Data $policyCompliance -StorageContext $ctx -Container $containerName

    #── 7c. Defender for Cloud Recommendations ───────────────────────────
    Write-Log "  [7c] Collecting Defender for Cloud recommendations..."

    $recommendations = @()
    try {
        Set-AzContext -SubscriptionId $subId | Out-Null
        $assessments = Get-AzSecurityAssessment -ErrorAction Stop | Select-Object -First 500
        Write-Log "    Found $($assessments.Count) Defender assessment(s)."

        foreach ($a in $assessments) {
            $severity = switch ($a.Status.Severity) {
                "High"     { "high" }
                "Critical" { "critical" }
                "Medium"   { "medium" }
                "Low"      { "low" }
                default    { "medium" }
            }
            $category = if ($a.Metadata.Categories -and $a.Metadata.Categories.Count -gt 0) {
                $a.Metadata.Categories[0]
            } else { "General" }

            $recommendations += [ordered]@{
                id                     = $a.Name
                name                   = if ($a.DisplayName) { $a.DisplayName } else { $a.Name }
                description            = if ($a.Metadata.Description) { $a.Metadata.Description } else { "" }
                severity               = $severity
                category               = $category
                subscriptionId         = $subId
                resourceCount          = if ($a.Status.UnhealthyResourceCount) { [int]$a.Status.UnhealthyResourceCount } else { 0 }
                hasAttackPath          = $false
                affectedResources      = @()
                remediation            = if ($a.Metadata.RemediationDescription) { $a.Metadata.RemediationDescription } else { "" }
                learnMoreUrl           = ""
                governanceAssignmentId = ""
            }
        }

        Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    }
    catch {
        Write-Log "    [WARN] Defender recommendations failed: $($_.Exception.Message)" "WARN"
        Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction SilentlyContinue | Out-Null
    }

    $defenderRecs = [ordered]@{ runDate = $today; recommendations = $recommendations }
    Upload-JsonBlob -BlobPath "$blobBasePath/defender-recs.json"  -Data $defenderRecs -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/defender-recs.json" -Data $defenderRecs -StorageContext $ctx -Container $containerName

    #── 7d. Governance Rules ─────────────────────────────────────────────
    Write-Log "  [7d] Collecting Governance Rules..."

    $govRules = @()
    try {
        Set-AzContext -SubscriptionId $subId | Out-Null

        $token   = (Get-AzAccessToken -ResourceUrl "https://management.azure.com" -ErrorAction Stop).Token
        $govUri  = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Security/governanceRules?api-version=2022-01-01-preview"
        $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

        try {
            $govResponse = Invoke-RestMethod -Uri $govUri -Headers $headers -Method Get -ErrorAction Stop
            Write-Log "    Found $($govResponse.value.Count) governance rule(s)."

            foreach ($rule in $govResponse.value) {
                $props         = $rule.properties
                $status        = "notStarted"
                $completionPct = 0
                if ($props.isGracePeriod) { $status = "inProgress"; $completionPct = 50 }

                $govRules += [ordered]@{
                    id                      = $rule.id
                    name                    = $rule.name
                    owner                   = if ($props.ownerSource.value) { $props.ownerSource.value } else { "Unassigned" }
                    ownerEmail              = ""
                    dueDate                 = if ($props.governanceEmailNotification) { $today } else { "" }
                    subscriptionId          = $subId
                    status                  = $status
                    completionPercentage    = $completionPct
                    linkedRecommendationIds = @()
                    linkedPolicyIds         = @()
                    description             = if ($props.description) { $props.description } else { $rule.name }
                    completionCriteria      = @()
                }
            }
        }
        catch {
            Write-Log "    [WARN] Governance Rules REST call failed: $($_.Exception.Message)" "WARN"
        }

        Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    }
    catch {
        Write-Log "    [WARN] Governance stage failed: $($_.Exception.Message)" "WARN"
        Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction SilentlyContinue | Out-Null
    }

    $governance = [ordered]@{ runDate = $today; rules = $govRules }
    Upload-JsonBlob -BlobPath "$blobBasePath/governance.json"  -Data $governance -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/governance.json" -Data $governance -StorageContext $ctx -Container $containerName

    Write-Log "  ✅ Subscription $subId — complete"
}
#endregion


#region ── 8. Build tenant-index.json ────────────────────────────────────
Write-Log "━━━ STAGE 8: Building tenant-index.json ━━━"

$existingIndex = $null
try {
    $existingBlob = Get-AzStorageBlobContent `
        -Container   $containerName `
        -Blob        "assessments/tenant-index.json" `
        -Context     $ctx `
        -Destination (Join-Path $env:TEMP "tenant-index-existing.json") `
        -Force -ErrorAction Stop
    $existingIndex = Get-Content (Join-Path $env:TEMP "tenant-index-existing.json") -Raw | ConvertFrom-Json
    Write-Log "  Found existing tenant-index.json — merging historical dates."
}
catch {
    Write-Log "  No existing tenant-index.json — creating fresh (first run or container was reset)."
}

$maxHistoryDays = 90
$cutoffDate     = (Get-Date).AddDays(-$maxHistoryDays).ToString("yyyy-MM-dd")
$subscriptions  = @()

foreach ($subId in $targetSubscriptionIds) {
    $subName = $subId
    try {
        $azSub   = Get-AzSubscription -SubscriptionId $subId -ErrorAction Stop
        $subName = $azSub.Name
    }
    catch {
        Write-Log "  [WARN] Could not retrieve name for subscription '$subId': $($_.Exception.Message)" "WARN"
    }

    $historicalDates = @()
    if ($existingIndex) {
        $existingTenant = $existingIndex.tenants | Where-Object { $_.id -eq $targetTenantId }
        if ($existingTenant) {
            $existingSub = $existingTenant.subscriptions | Where-Object { $_.id -eq $subId }
            if ($existingSub -and $existingSub.dates) {
                $historicalDates = @($existingSub.dates | Where-Object { $_ -ge $cutoffDate -and $_ -ne $today })
            }
        }
    }

    $resourceGroups = @()
    try {
        Set-AzContext -SubscriptionId $subId | Out-Null
        $resourceGroups = @(Get-AzResourceGroup -ErrorAction Stop | ForEach-Object { $_.ResourceGroupName })
        Write-Log "  Sub '$subName': $($resourceGroups.Count) resource group(s)"
        Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    }
    catch {
        Write-Log "  [WARN] Could not list resource groups for '$subId': $($_.Exception.Message)" "WARN"
        Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction SilentlyContinue | Out-Null
    }

    $subscriptions += [ordered]@{
        id             = $subId
        name           = $subName
        resourceGroups = $resourceGroups
        dates          = @(@($historicalDates) + @($today) | Sort-Object -Unique)
    }
}

$tenantIndex = [ordered]@{
    tenants = @([ordered]@{
        id            = $targetTenantId
        name          = $reportJson.TenantName
        subscriptions = $subscriptions
    })
}

Upload-JsonBlob -BlobPath "assessments/tenant-index.json" -Data $tenantIndex -StorageContext $ctx -Container $containerName
Write-Log "tenant-index.json uploaded."
#endregion


#region ── 9. Upload report-data.js for Dashboard ────────────────────────
Write-Log "━━━ STAGE 9: Uploading report-data.js ━━━"

try {
    $reportDataJs = "window.__REPORT_DATA__ = $($reportJson | ConvertTo-Json -Depth 20 -Compress);"
    $jsBytes      = [System.Text.Encoding]::UTF8.GetBytes($reportDataJs)
    $jsMs         = [System.IO.MemoryStream]::new($jsBytes)
    try {
        Set-AzStorageBlobContent `
            -Container   $containerName `
            -Blob        "config/report-data.js" `
            -BlobType    Block `
            -Stream      $jsMs `
            -ContentType "application/javascript" `
            -Context     $ctx `
            -Force | Out-Null
        Write-Log "  [UPLOAD OK] config/report-data.js ($($jsBytes.Length) bytes)"
    }
    finally {
        $jsMs.Dispose()
    }
}
catch {
    Write-Log "  [WARN] Failed to upload report-data.js: $($_.Exception.Message)" "WARN"
}
#endregion


#region ── 10. Cleanup ────────────────────────────────────────────────────
Write-Log "━━━ STAGE 10: Cleanup ━━━"

if (Test-Path $reportPath) {
    Remove-Item -Path $reportPath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Log "Temp report folder removed."
}

Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
Write-Log "Graph session disconnected."
#endregion


#region ── Final Summary ──────────────────────────────────────────────────
Write-Log "═══════════════════════════════════════════════════════════"
Write-Log "✅ Daily data collection COMPLETE (Hybrid Worker)"
Write-Log "   Date          : $today"
Write-Log "   Tenant        : $($reportJson.TenantName) ($targetTenantId)"
Write-Log "   Subscriptions : $($targetSubscriptionIds.Count)"
Write-Log "   Storage       : $storageAccountName / $containerName"
Write-Log "   Worker Host   : $($env:COMPUTERNAME)"
Write-Log "═══════════════════════════════════════════════════════════"
#endregion
