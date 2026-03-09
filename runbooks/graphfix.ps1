https://www.powershellgallery.com/api/v2/package/Az.Accounts
https://www.powershellgallery.com/api/v2/package/Az.Storage
https://www.powershellgallery.com/api/v2/package/Az.ResourceGraph
https://www.powershellgallery.com/api/v2/package/Az.Security




https://www.powershellgallery.com/api/v2/package/Microsoft.Graph.Authentication
https://www.powershellgallery.com/api/v2/package/Microsoft.Graph.Identity.DirectoryManagement
https://www.powershellgallery.com/api/v2/package/Microsoft.Graph.Users
https://www.powershellgallery.com/api/v2/package/Microsoft.Graph.Groups
https://www.powershellgallery.com/api/v2/package/Microsoft.Graph.Applications
https://www.powershellgallery.com/api/v2/package/Microsoft.Graph.DeviceManagement




https://www.powershellgallery.com/api/v2/package/PSFramework
https://www.powershellgallery.com/api/v2/package/ZeroTrustAssessment





$aa = "YourAutomationAccountName"
$rg = "YourResourceGroupName"
$rt = "YourPS74RuntimeEnvironmentName"

$modules = @(
    "Az.Accounts", "Az.Storage", "Az.ResourceGraph", "Az.Security",
    "Microsoft.Graph.Authentication", "Microsoft.Graph.Identity.DirectoryManagement",
    "Microsoft.Graph.Users", "Microsoft.Graph.Groups", "Microsoft.Graph.Applications",
    "Microsoft.Graph.DeviceManagement", "PSFramework", "ZeroTrustAssessment"
)

foreach ($mod in $modules) {
    Write-Host "Importing $mod..." -ForegroundColor Cyan
    New-AzAutomationModule `
        -AutomationAccountName $aa `
        -ResourceGroupName $rg `
        -Name $mod `
        -ContentLinkUri "https://www.powershellgallery.com/api/v2/package/$mod" `
        -RuntimeVersion '7.4'
    Start-Sleep -Seconds 5
}
Write-Host "All submitted. Monitor status in portal." -ForegroundColor Green
