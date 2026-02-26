$base = "public/mock/tenant-001"
$subs = @("sub-001","sub-002")
$dates = @("2025-07-01","2025-08-01","2025-09-01","2025-10-01","2025-11-01","2025-12-01")

# Score progressions for sub-001 (improving) and sub-002 (lagging)
$ztScores = @{
    "sub-001" = @(62, 66, 70, 74, 78, 82)
    "sub-002" = @(55, 57, 56, 60, 63, 65)
}

$pillars = @("Identity","Devices","Apps","Network","Infrastructure","Data")

foreach ($sub in $subs) {
    for ($i = 0; $i -lt $dates.Count; $i++) {
        $date = $dates[$i]
        $dir = "$base/$sub/$date"
        New-Item -ItemType Directory -Path $dir -Force | Out-Null

        $score = $ztScores[$sub][$i]
        $passed = [math]::Round($score * 0.45)
        $failed = 45 - $passed

        # ─── zero-trust.json ────────────────────────────────────
        $pillarsJson = ($pillars | ForEach-Object {
            $ps = [math]::Round($score + (Get-Random -Minimum -8 -Maximum 9))
            $ps = [math]::Max(30, [math]::Min(100, $ps))
            $pc = [math]::Round($ps * 0.08)
            $fc = 8 - $pc
            "    { `"name`": `"$_`", `"score`": $ps, `"totalChecks`": 8, `"passed`": $pc, `"failed`": $fc }"
        }) -join ",`n"

        $checksJson = @()
        for ($c = 1; $c -le 12; $c++) {
            $pillar = $pillars[($c - 1) % 6]
            $status = if ($c -le $passed) { "passed" } elseif ($c -eq ($passed + 1)) { "investigate" } else { "failed" }
            $risk = if ($c -le 3) { "high" } elseif ($c -le 6) { "medium" } else { "low" }
            $checksJson += "    { `"id`": `"CHK-$c`", `"name`": `"Check $c`", `"pillar`": `"$pillar`", `"area`": `"Area-$c`", `"status`": `"$status`", `"risk`": `"$risk`", `"description`": `"Check $c desc`", `"remediation`": `"Fix $c`", `"learnMoreUrl`": `"https://learn.microsoft.com`", `"score`": $(if ($status -eq 'passed') { 10 } else { 0 }), `"weight`": 10 }"
        }
        $checksStr = $checksJson -join ",`n"

        $ztJson = @"
{
  "tenantId": "tenant-001",
  "tenantName": "Contoso Corp",
  "runDate": "$date",
  "overallScore": $score,
  "pillars": [
$pillarsJson
  ],
  "checks": [
$checksStr
  ]
}
"@
        Set-Content -Path "$dir/zero-trust.json" -Value $ztJson -Encoding UTF8

        # ─── policy-compliance.json ─────────────────────────────
        $nc = [math]::Max(1, 15 - $i * 2)
        $comp = 30 + $i * 3
        $exempt = 3

        $resJson = @()
        for ($r = 1; $r -le ($nc + $comp); $r++) {
            $rg = if ($sub -eq "sub-001") { @("rg-web","rg-data","rg-compute")[$r % 3] } else { @("rg-dev-web","rg-dev-data")[$r % 2] }
            $st = if ($r -le $comp) { "Compliant" } else { "NonCompliant" }
            $fp = if ($st -eq "NonCompliant") { "[{ `"id`": `"pol-1`", `"name`": `"Require HTTPS`", `"description`": `"Enforce HTTPS on storage`" }]" } else { "[]" }
            $resJson += "        { `"resourceId`": `"res-$sub-$r`", `"resourceName`": `"resource-$r`", `"resourceType`": `"Microsoft.Storage/storageAccounts`", `"resourceGroup`": `"$rg`", `"subscriptionId`": `"$sub`", `"state`": `"$st`", `"failingPolicies`": $fp }"
        }
        $resStr = $resJson -join ",`n"

        $pcJson = @"
{
  "runDate": "$date",
  "initiatives": [
    {
      "id": "init-1",
      "name": "Azure Security Benchmark",
      "type": "builtin",
      "assignmentId": "assign-1",
      "subscriptionId": "$sub",
      "compliantCount": $comp,
      "nonCompliantCount": $nc,
      "exemptCount": $exempt,
      "totalPolicies": 50,
      "resources": [
$resStr
      ]
    }
  ]
}
"@
        Set-Content -Path "$dir/policy-compliance.json" -Value $pcJson -Encoding UTF8

        # ─── defender-recs.json ─────────────────────────────────
        $critCount = [math]::Max(0, 4 - $i)
        $highCount = [math]::Max(1, 6 - $i)
        $medCount = 3
        $lowCount = 2

        $recJson = @()
        $rid = 1
        foreach ($sev in @("critical","high","medium","low")) {
            $cnt = switch ($sev) { "critical" { $critCount } "high" { $highCount } "medium" { $medCount } "low" { $lowCount } }
            for ($rc = 0; $rc -lt $cnt; $rc++) {
                $recJson += "    { `"id`": `"rec-$rid`", `"name`": `"Rec $rid`", `"description`": `"$sev recommendation $rid`", `"severity`": `"$sev`", `"category`": `"Security`", `"subscriptionId`": `"$sub`", `"resourceCount`": $(Get-Random -Minimum 1 -Maximum 5), `"hasAttackPath`": $(if ($sev -eq 'critical') { 'true' } else { 'false' }), `"affectedResources`": [{ `"id`": `"res-$sub-$rid`", `"name`": `"resource-$rid`", `"type`": `"Microsoft.Compute/virtualMachines`", `"resourceGroup`": `"rg-web`" }], `"remediation`": `"Apply fix $rid`", `"learnMoreUrl`": `"https://learn.microsoft.com`", `"governanceAssignmentId`": `"`" }"
                $rid++
            }
        }
        $recStr = $recJson -join ",`n"

        $drJson = @"
{
  "runDate": "$date",
  "recommendations": [
$recStr
  ]
}
"@
        Set-Content -Path "$dir/defender-recs.json" -Value $drJson -Encoding UTF8

        # ─── governance.json ────────────────────────────────────
        $ruleJson = @()
        $statuses = @("completed","inProgress","notStarted","overdue","completed","inProgress","notStarted","completed")
        for ($g = 1; $g -le 8; $g++) {
            $st = $statuses[($g - 1 + $i) % $statuses.Count]
            $pct = switch ($st) { "completed" { 100 } "inProgress" { $(30 + $i * 10) } "notStarted" { 0 } "overdue" { $(10 + $i * 5) } }
            $due = "2025-12-31"
            $ruleJson += "    { `"id`": `"gov-$g`", `"name`": `"Rule $g`", `"owner`": `"Admin`", `"ownerEmail`": `"admin@contoso.com`", `"dueDate`": `"$due`", `"subscriptionId`": `"$sub`", `"status`": `"$st`", `"completionPercentage`": $pct, `"linkedRecommendationIds`": [`"rec-$g`"], `"linkedPolicyIds`": [`"pol-1`"], `"description`": `"Governance rule $g`", `"completionCriteria`": [{ `"description`": `"Criteria $g`", `"completed`": $(if ($st -eq 'completed') { 'true' } else { 'false' }) }] }"
        }
        $ruleStr = $ruleJson -join ",`n"

        $govJson = @"
{
  "runDate": "$date",
  "rules": [
$ruleStr
  ]
}
"@
        Set-Content -Path "$dir/governance.json" -Value $govJson -Encoding UTF8
    }
}

Write-Host "Mock data generated successfully"
