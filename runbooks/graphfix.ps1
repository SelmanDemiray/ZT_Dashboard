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





$subscriptionId = "YOUR_SUBSCRIPTION_ID"
$rg             = "YOUR_RESOURCE_GROUP"
$aa             = "YOUR_AUTOMATION_ACCOUNT"
$runtimeName    = "YOUR_74_RUNTIME_ENV_NAME"  # exact name you created in portal
$apiVersion     = "2023-05-15-preview"

# Get token context
Connect-AzAccount  # skip if already connected in Cloud Shell

$modules = @(
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

foreach ($mod in $modules) {
    $uri  = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$rg" +
            "/providers/Microsoft.Automation/automationAccounts/$aa" +
            "/runtimeEnvironments/$runtimeName/packages/$mod`?api-version=$apiVersion"

    $body = @{
        properties = @{
            contentLink = @{
                uri = "https://www.powershellgallery.com/api/v2/package/$mod"
            }
        }
    } | ConvertTo-Json -Depth 5

    $response = Invoke-AzRestMethod -Uri $uri -Method PUT -Payload $body

    if ($response.StatusCode -in 200, 201, 202) {
        Write-Host "[$mod] Submitted OK ($($response.StatusCode))" -ForegroundColor Green
    } else {
        Write-Host "[$mod] FAILED - $($response.StatusCode): $($response.Content)" -ForegroundColor Red
    }

    Start-Sleep -Seconds 3  # stagger to avoid throttling
}
