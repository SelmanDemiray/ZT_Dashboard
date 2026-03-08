<#
.SYNOPSIS
    Azure Automation Runbook — Zero Trust Dashboard daily data collection.

.DESCRIPTION
    Runs the ZeroTrustAssessment PowerShell module, collects Azure Policy,
    Defender for Cloud, and Governance data via Azure Resource Graph / REST,
    then uploads well-structured JSON files to the $web static-website
    Blob container so the React front-end can consume them.

    Designed to run daily at 06:00 AM via an Azure Automation Schedule.

.NOTES
    Prerequisites (one-time setup):
      1. Azure Automation Account with a System-Assigned Managed Identity.
      2. Grant the Managed Identity:
         - "Global Reader" on Entra ID (for Invoke-ZtAssessment / MS Graph).
         - "Reader" on every Azure subscription in the tenant (the
           runbook auto-discovers all accessible subscriptions).
         - "Storage Blob Data Contributor" on the storage account that
           hosts the $web container.
      3. Import these modules into the Automation Account (Runtime 7.2+):
         - Az.Accounts, Az.Storage, Az.ResourceGraph, Az.Security
         - Microsoft.Graph.Authentication, Microsoft.Graph.Identity.DirectoryManagement
         - Microsoft.Graph.Users, Microsoft.Graph.Groups, Microsoft.Graph.Applications
         - Microsoft.Graph.DeviceManagement
         - ZeroTrustAssessment  (from PSGallery)
         - PSFramework
      4. Create these Automation Variables (encrypted where noted):
         - AuthMethod                  (string)     'AppRegistration' (preferred) or 'ManagedIdentity'
         - TargetTenantId              (string)     Entra tenant to assess
         - StorageAccountName          (string)     e.g. "ztdashboardsa"
         - BlobContainerName           (string)     usually "$web"
         (If AuthMethod is 'AppRegistration', also create):
         - AppClientId                 (string)     Client ID of your Entra App
         - AppClientSecret             (string)     Client Secret of your Entra App (ENCRYPTED)
         (All Azure Subscriptions AND the Storage Account location are intelligently AUTO-DISCOVERED via Resource Graph)
      5. Link this runbook to a Daily Schedule (06:00 AM your timezone).
#>

param()

#region ── 0. Strict mode & helpers ───────────────────────────────────────
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$InformationPreference = "Continue"
$today = (Get-Date).ToString("yyyy-MM-dd")

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Output "[$ts][$Level] $Message"
}
#endregion


#region ── 1. Read Automation Variables ────────────────────────────────────
Write-Log "Reading Automation Variables..."

$authMethod          = Get-AutomationVariable -Name "AuthMethod" -ErrorAction SilentlyContinue
if (-not $authMethod) { $authMethod = "AppRegistration" } # Default to AppReg

$storageAccountName  = Get-AutomationVariable -Name "StorageAccountName"
$containerName       = Get-AutomationVariable -Name "BlobContainerName"
$targetTenantId      = Get-AutomationVariable -Name "TargetTenantId"

Write-Log "Auth Method: $authMethod"
Write-Log "Storage: $storageAccountName / container: $containerName"
Write-Log "Tenant:  $targetTenantId"
#endregion


#region ── 2. Authenticate (Dual Support) ──────────────────────────────────
if ($authMethod -eq 'ManagedIdentity') {
    Write-Log "Connecting to Azure & Graph via System-Assigned Managed Identity..."
    Connect-AzAccount -Identity | Out-Null
    Connect-MgGraph -Identity -TenantId $targetTenantId -NoWelcome | Out-Null
}
elseif ($authMethod -eq 'AppRegistration') {
    Write-Log "Connecting to Azure & Graph via App Registration..."
    $appClientId     = Get-AutomationVariable -Name "AppClientId"
    $appClientSecret = Get-AutomationVariable -Name "AppClientSecret"

    $secureSecret = ConvertTo-SecureString $appClientSecret -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($appClientId, $secureSecret)

    # Azure RM App Registration connection
    Connect-AzAccount -ServicePrincipal -Credential $cred -Tenant $targetTenantId | Out-Null

    # Graph App Registration connection
    Connect-MgGraph -ClientId $appClientId -TenantId $targetTenantId -ClientSecret $secureSecret -NoWelcome | Out-Null
}
else {
    throw "Invalid AuthMethod variable. Use 'ManagedIdentity' or 'AppRegistration'."
}
#endregion


#region ── 2b. Auto-discover all subscriptions in the tenant ───────────────
Write-Log "Auto-discovering subscriptions..."
$allSubs = Get-AzSubscription -TenantId $targetTenantId -ErrorAction Stop |
           Where-Object { $_.State -eq 'Enabled' }
$targetSubscriptionIds = @($allSubs | ForEach-Object { $_.Id })

if ($targetSubscriptionIds.Count -eq 0) {
    throw "No enabled subscriptions found in tenant $targetTenantId. Check Managed Identity permissions."
}

Write-Log "Found $($targetSubscriptionIds.Count) subscriptions:"
foreach ($s in $allSubs) {
    Write-Log "  • $($s.Name) ($($s.Id))"
}
#endregion


#region ── 3. Auto-discover Storage Account & Connect to Blob ─────────────
Write-Log "Auto-discovering subscription & resource group for Storage Account '$storageAccountName'..."

$storageAcctQuery = "Resources | where type =~ 'microsoft.storage/storageaccounts' and name =~ '$storageAccountName' | project subscriptionId, resourceGroup"
$storageAcctResult = Search-AzGraph -Query $storageAcctQuery -First 1 -ErrorAction Stop

if (-not $storageAcctResult -or $storageAcctResult.Data.Count -eq 0) {
    throw "Could not find storage account '$storageAccountName' via Azure Resource Graph. Ensure Identity has Reader access to it."
}

$azureSubscriptionId = $storageAcctResult.Data[0].subscriptionId
$storageAccountRG    = $storageAcctResult.Data[0].resourceGroup

Write-Log "Found Storage Account in Subscription: $azureSubscriptionId (RG: $storageAccountRG)"

# Set context to the discovered storage account subscription
Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null

Write-Log "Obtaining Storage context..."
$storageAccount = Get-AzStorageAccount -ResourceGroupName $storageAccountRG -Name $storageAccountName
$ctx = $storageAccount.Context
#endregion


#region ── 4. Run Zero Trust Assessment (generates ZeroTrustAssessmentReport.json) ─
Write-Log "Running Invoke-ZtAssessment..."

$reportPath = Join-Path $env:TEMP "ZTReport-$today"
if (Test-Path $reportPath) { Remove-Item -Path $reportPath -Recurse -Force }

# Connect the ZT module to the same graph session
Connect-ZtAssessment

Invoke-ZtAssessment -Path $reportPath -Days 30 -DisableTelemetry

$reportJsonPath = Join-Path $reportPath "zt-export" "ZeroTrustAssessmentReport.json"
if (-not (Test-Path $reportJsonPath)) {
    throw "ZeroTrustAssessmentReport.json was not generated at $reportJsonPath"
}

$reportJson = Get-Content -Path $reportJsonPath -Raw | ConvertFrom-Json
Write-Log "Assessment complete. Tenant: $($reportJson.TenantName)"
#endregion


#region ── 5. Helper — upload JSON to blob ────────────────────────────────
function Upload-JsonBlob {
    param(
        [Parameter(Mandatory)][string]$BlobPath,
        [Parameter(Mandatory)][object]$Data,
        [Parameter(Mandatory)]$StorageContext,
        [Parameter(Mandatory)][string]$Container
    )
    $json = $Data | ConvertTo-Json -Depth 20 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $ms = [System.IO.MemoryStream]::new($bytes)
    try {
        Set-AzStorageBlobContent `
            -Container $Container `
            -Blob $BlobPath `
            -BlobType Block `
            -Stream $ms `
            -ContentType "application/json" `
            -Context $StorageContext `
            -Force | Out-Null
        Write-Log "  [OK] Uploaded: $BlobPath ($($bytes.Length) bytes)"
    }
    finally {
        $ms.Dispose()
    }
}
#endregion


#region ── 6. Upload the full assessment report as report-data.json ────────
# This is used by the Dashboard page (reportData import)
Upload-JsonBlob `
    -BlobPath "assessments/report-data.json" `
    -Data $reportJson `
    -StorageContext $ctx `
    -Container $containerName

Write-Log "Full assessment report uploaded."
#endregion


#region ── 7. Collect and upload per-subscription snapshot data ────────────
# For each subscription: query Azure Policy, Defender, Governance data
# and produce the 4 JSON files the OverviewCards + Trends pages expect.

foreach ($subId in $targetSubscriptionIds) {
    Write-Log "Processing subscription: $subId"
    $blobBasePath = "assessments/$targetTenantId/$subId/$today"
    $blobLatestPath = "assessments/$targetTenantId/$subId/latest"

    #───────────────────────────────────────────────────────────────────
    # 7a. ZERO TRUST snapshot
    #───────────────────────────────────────────────────────────────────
    Write-Log "  Collecting Zero Trust data..."

    $pillars = @()
    $checks  = @()

    # Build pillar summaries from the assessment report
    $pillarNames = @("Identity", "Devices", "Data", "Network")
    foreach ($pName in $pillarNames) {
        $pillarTests = $reportJson.Tests | Where-Object { $_.TestPillar -eq $pName }
        if (-not $pillarTests -or $pillarTests.Count -eq 0) { continue }

        $totalChecks = $pillarTests.Count
        $passed = ($pillarTests | Where-Object { $_.TestStatus -eq "Passed" }).Count
        $failed = $totalChecks - $passed
        $score = if ($totalChecks -gt 0) { [math]::Round(($passed / $totalChecks) * 100, 1) } else { 0 }

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
                id          = $t.TestId
                name        = $t.TestTitle
                pillar      = $pName
                area        = if ($t.TestCategory) { $t.TestCategory } else { $pName }
                status      = $status
                risk        = $risk
                description = if ($t.TestDescription) { $t.TestDescription.Substring(0, [math]::Min(500, $t.TestDescription.Length)) } else { "" }
                remediation = ""
                learnMoreUrl = ""
                score       = if ($status -eq "passed") { 100 } else { 0 }
                weight      = 1
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

    Upload-JsonBlob -BlobPath "$blobBasePath/zero-trust.json" `
                    -Data $ztSnapshot -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/zero-trust.json" `
                    -Data $ztSnapshot -StorageContext $ctx -Container $containerName

    #───────────────────────────────────────────────────────────────────
    # 7b. POLICY COMPLIANCE via Azure Resource Graph
    #───────────────────────────────────────────────────────────────────
    Write-Log "  Collecting Policy Compliance data..."

    $policyQuery = @"
PolicyResources
| where type == 'microsoft.policyinsights/policystates'
| where subscriptionId == '$subId'
| where properties.complianceState != ''
| extend initiativeId      = tostring(properties.policySetDefinitionId),
         initiativeName    = tostring(properties.policySetDefinitionName),
         complianceState   = tostring(properties.complianceState),
         resourceId        = tostring(properties.resourceId),
         resourceName      = tostring(split(properties.resourceId, '/')[-1]),
         resourceType      = tostring(properties.resourceType),
         resourceGroup     = tostring(properties.resourceGroup),
         policyDefId       = tostring(properties.policyDefinitionId),
         policyName        = tostring(properties.policyDefinitionName),
         policyAssignId    = tostring(properties.policyAssignmentId)
| summarize compliantCount     = countif(complianceState == 'Compliant'),
            nonCompliantCount  = countif(complianceState == 'NonCompliant'),
            exemptCount        = countif(complianceState == 'Exempt'),
            totalPolicies      = dcount(policyDefId)
            by initiativeId, initiativeName, policyAssignId
| project initiativeId, initiativeName, policyAssignId,
          compliantCount, nonCompliantCount, exemptCount, totalPolicies
| order by nonCompliantCount desc
| take 100
"@

    $initiatives = @()
    try {
        $policyResults = Search-AzGraph -Query $policyQuery -Subscription $subId -ErrorAction Stop
        foreach ($row in $policyResults.Data) {
            $initiativeType = if ($row.initiativeId -like "*/providers/Microsoft.Authorization/policySetDefinitions/*") { "builtin" } else { "custom" }
            $initiatives += [ordered]@{
                id               = $row.initiativeId
                name             = if ($row.initiativeName) { $row.initiativeName } else { "Unnamed Initiative" }
                type             = $initiativeType
                assignmentId     = $row.policyAssignId
                subscriptionId   = $subId
                compliantCount   = [int]$row.compliantCount
                nonCompliantCount = [int]$row.nonCompliantCount
                exemptCount      = [int]$row.exemptCount
                totalPolicies    = [int]$row.totalPolicies
                resources        = @()
            }
        }
    }
    catch {
        Write-Log "  [WARN] Policy query failed: $($_.Exception.Message)" "WARN"
    }

    # If no Resource Graph results, create a minimal entry from policy states
    if ($initiatives.Count -eq 0) {
        try {
            $policyStates = Get-AzPolicyState -SubscriptionId $subId -Top 200 -ErrorAction Stop
            $grouped = $policyStates | Group-Object { $_.PolicySetDefinitionId }
            foreach ($g in $grouped) {
                if (-not $g.Name) { continue }
                $compliant = ($g.Group | Where-Object { $_.ComplianceState -eq "Compliant" }).Count
                $nonCompliant = ($g.Group | Where-Object { $_.ComplianceState -eq "NonCompliant" }).Count
                $exempt = ($g.Group | Where-Object { $_.ComplianceState -eq "Exempt" }).Count

                $initiatives += [ordered]@{
                    id               = $g.Name
                    name             = ($g.Group | Select-Object -First 1).PolicySetDefinitionName
                    type             = "builtin"
                    assignmentId     = ($g.Group | Select-Object -First 1).PolicyAssignmentId
                    subscriptionId   = $subId
                    compliantCount   = $compliant
                    nonCompliantCount = $nonCompliant
                    exemptCount      = $exempt
                    totalPolicies    = ($g.Group | Select-Object -Unique PolicyDefinitionId).Count
                    resources        = @()
                }
            }
        }
        catch {
            Write-Log "  [WARN] Policy states fallback failed: $($_.Exception.Message)" "WARN"
        }
    }

    # Get detailed non-compliant resources (top 200)
    if ($initiatives.Count -gt 0) {
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
            foreach ($r in $ncResources.Data) {
                $matchInit = $initiatives | Where-Object { $_.id -eq $r.initiativeId } | Select-Object -First 1
                if ($matchInit) {
                    $matchInit.resources += [ordered]@{
                        resourceId     = $r.resourceId
                        resourceName   = $r.resourceName
                        resourceType   = $r.resourceType
                        resourceGroup  = $r.resourceGroup
                        subscriptionId = $subId
                        state          = "NonCompliant"
                        failingPolicies = @(
                            [ordered]@{
                                id          = $r.policyDefId
                                name        = if ($r.policyName) { $r.policyName } else { "Unknown Policy" }
                                description = ""
                            }
                        )
                    }
                }
            }
        }
        catch {
            Write-Log "  [WARN] Non-compliant resources query failed: $($_.Exception.Message)" "WARN"
        }
    }

    $policyCompliance = [ordered]@{
        runDate     = $today
        initiatives = $initiatives
    }

    Upload-JsonBlob -BlobPath "$blobBasePath/policy-compliance.json" `
                    -Data $policyCompliance -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/policy-compliance.json" `
                    -Data $policyCompliance -StorageContext $ctx -Container $containerName

    #───────────────────────────────────────────────────────────────────
    # 7c. DEFENDER FOR CLOUD RECOMMENDATIONS
    #───────────────────────────────────────────────────────────────────
    Write-Log "  Collecting Defender for Cloud recommendations..."

    $recommendations = @()
    try {
        Set-AzContext -SubscriptionId $subId | Out-Null

        $assessments = Get-AzSecurityAssessment -ErrorAction Stop | Select-Object -First 500
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

        # Restore context to storage subscription
        Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    }
    catch {
        Write-Log "  [WARN] Defender recommendations failed: $($_.Exception.Message)" "WARN"
        # Restore context
        Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction SilentlyContinue | Out-Null
    }

    $defenderRecs = [ordered]@{
        runDate         = $today
        recommendations = $recommendations
    }

    Upload-JsonBlob -BlobPath "$blobBasePath/defender-recs.json" `
                    -Data $defenderRecs -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/defender-recs.json" `
                    -Data $defenderRecs -StorageContext $ctx -Container $containerName

    #───────────────────────────────────────────────────────────────────
    # 7d. GOVERNANCE RULES (Defender for Cloud governance)
    #───────────────────────────────────────────────────────────────────
    Write-Log "  Collecting Governance data..."

    $govRules = @()
    try {
        Set-AzContext -SubscriptionId $subId | Out-Null

        # Query governance assignments via REST
        $token = (Get-AzAccessToken -ResourceUrl "https://management.azure.com").Token
        $govUri = "https://management.azure.com/subscriptions/$subId/providers/Microsoft.Security/governanceRules?api-version=2022-01-01-preview"
        $headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }

        try {
            $govResponse = Invoke-RestMethod -Uri $govUri -Headers $headers -Method Get -ErrorAction Stop
            foreach ($rule in $govResponse.value) {
                $props = $rule.properties

                $status = "notStarted"
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
            Write-Log "  [WARN] Governance rules API failed: $($_.Exception.Message)" "WARN"
        }

        Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    }
    catch {
        Write-Log "  [WARN] Governance data collection failed: $($_.Exception.Message)" "WARN"
        Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction SilentlyContinue | Out-Null
    }

    $governance = [ordered]@{
        runDate = $today
        rules   = $govRules
    }

    Upload-JsonBlob -BlobPath "$blobBasePath/governance.json" `
                    -Data $governance -StorageContext $ctx -Container $containerName
    Upload-JsonBlob -BlobPath "$blobLatestPath/governance.json" `
                    -Data $governance -StorageContext $ctx -Container $containerName

    Write-Log "  ✅ Subscription $subId complete."
}
#endregion


#region ── 8. Build and upload tenant-index.json ──────────────────────────
Write-Log "Building tenant-index.json..."

# Read existing tenant-index to preserve historical dates
$existingIndex = $null
try {
    $existingBlob = Get-AzStorageBlobContent `
        -Container $containerName `
        -Blob "assessments/tenant-index.json" `
        -Context $ctx `
        -Destination (Join-Path $env:TEMP "tenant-index-existing.json") `
        -Force -ErrorAction Stop
    $existingJson = Get-Content (Join-Path $env:TEMP "tenant-index-existing.json") -Raw
    $existingIndex = $existingJson | ConvertFrom-Json
    Write-Log "  Found existing tenant-index.json - merging dates."
}
catch {
    Write-Log "  No existing tenant-index.json - creating fresh."
}

# Merge dates: keep last 90 days of history
$maxHistoryDays = 90
$cutoffDate = (Get-Date).AddDays(-$maxHistoryDays).ToString("yyyy-MM-dd")

$subscriptions = @()
foreach ($subId in $targetSubscriptionIds) {
    # Get subscription display name
    $subName = $subId
    try {
        $azSub = Get-AzSubscription -SubscriptionId $subId -ErrorAction Stop
        $subName = $azSub.Name
    }
    catch {
        Write-Log "  [WARN] Could not get subscription name for $subId" "WARN"
    }

    # Merge historical dates
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

    # Get resource groups in this subscription
    $resourceGroups = @()
    try {
        Set-AzContext -SubscriptionId $subId | Out-Null
        $rgs = Get-AzResourceGroup -ErrorAction Stop
        $resourceGroups = @($rgs | ForEach-Object { $_.ResourceGroupName })
        Set-AzContext -SubscriptionId $azureSubscriptionId | Out-Null
    }
    catch {
        Write-Log "  [WARN] Could not list resource groups for $subId" "WARN"
        Set-AzContext -SubscriptionId $azureSubscriptionId -ErrorAction SilentlyContinue | Out-Null
    }

    $allDates = @($historicalDates) + @($today) | Sort-Object -Unique

    $subscriptions += [ordered]@{
        id             = $subId
        name           = $subName
        resourceGroups = $resourceGroups
        dates          = $allDates
    }
}

$tenantIndex = [ordered]@{
    tenants = @(
        [ordered]@{
            id            = $targetTenantId
            name          = $reportJson.TenantName
            subscriptions = $subscriptions
        }
    )
}

Upload-JsonBlob -BlobPath "assessments/tenant-index.json" `
                -Data $tenantIndex -StorageContext $ctx -Container $containerName

Write-Log "tenant-index.json uploaded."
#endregion


#region ── 9. Upload the static report-data.js for the Dashboard ──────────
# The Dashboard imports reportData from config/report-data.ts which in the
# built app expects a window.__REPORT_DATA__ global or the hardcoded JSON.
# We upload the raw JSON so a build step or CDN rule can serve it.
Write-Log "Uploading static report data for Dashboard..."

# Also upload as the baked report config the built app expects
$reportDataJs = "window.__REPORT_DATA__ = $($reportJson | ConvertTo-Json -Depth 20 -Compress);"
$jsBytes = [System.Text.Encoding]::UTF8.GetBytes($reportDataJs)
$jsMs = [System.IO.MemoryStream]::new($jsBytes)
try {
    Set-AzStorageBlobContent `
        -Container $containerName `
        -Blob "config/report-data.js" `
        -BlobType Block `
        -Stream $jsMs `
        -ContentType "application/javascript" `
        -Context $ctx `
        -Force | Out-Null
    Write-Log "  [OK] Uploaded: config/report-data.js"
}
finally {
    $jsMs.Dispose()
}
#endregion


#region ── 10. Cleanup ────────────────────────────────────────────────────
Write-Log "Cleaning up temp files..."
if (Test-Path $reportPath) {
    Remove-Item -Path $reportPath -Recurse -Force -ErrorAction SilentlyContinue
}

Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null

Write-Log "═══════════════════════════════════════════════════════════"
Write-Log "[OK] Daily data collection complete!"
Write-Log "   Date:           $today"
Write-Log "   Tenant:         $($reportJson.TenantName) ($targetTenantId)"
Write-Log "   Subscriptions:  $($targetSubscriptionIds.Count)"
Write-Log "   Storage:        $storageAccountName / $containerName"
Write-Log "═══════════════════════════════════════════════════════════"
#endregion
