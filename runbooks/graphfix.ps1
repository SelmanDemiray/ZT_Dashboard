$automationAccount = "YourAutomationAccountName"
$resourceGroup     = "YourResourceGroupName"
$moduleVersion     = "2.25.0"

$graphModules = @(
    "Microsoft.Graph.Authentication",
    "Microsoft.Graph.Identity.DirectoryManagement",
    "Microsoft.Graph.Users",
    "Microsoft.Graph.Groups",
    "Microsoft.Graph.Applications",
    "Microsoft.Graph.DeviceManagement"
)

foreach ($mod in $graphModules) {
    Write-Host "Importing $mod @ $moduleVersion..."
    New-AzAutomationModule `
        -AutomationAccountName $automationAccount `
        -ResourceGroupName $resourceGroup `
        -Name $mod `
        -ContentLinkUri "https://www.powershellgallery.com/api/v2/package/$mod/$moduleVersion" `
        -RuntimeVersion '7.2'
}
