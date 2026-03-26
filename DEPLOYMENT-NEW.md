# Zero Trust Assessment - Azure App Service Migration Guide

This guide walks you through migrating the React frontend from a Storage Account Static Website to a private **Azure App Service (Linux Web App)**, utilizing **Private Endpoints** and **Azure Key Vault**.

## Prerequisites
- The existing Runbooks and Hybrid Worker remain unchanged.
- The existing Storage Account will be retained for data, but its public access will be disabled.
- Ensure you have a Virtual Network (VNet) where your Hybrid Worker resides and where users connect via VPN/ExpressRoute.

---

## Step 1: Secure the Storage Account

1. Navigate to your existing **Storage Account** in the Azure Portal.
2. Go to **Networking** in the left menu.
3. Under the **Firewalls and virtual networks** (or Public access) tab, change **Public network access** to **Disabled**. Click **Save**.
4. Switch to the **Private endpoint connections** tab and click **+ Private endpoint**.
   - **Name**: `pe-zt-storage-blob`
   - **Target sub-resource**: `blob`
   - **Virtual Network**: Select your existing VNet and a dedicated Subnet (e.g., `snet-endpoints`).
   - **Private DNS integration**: Ensure "Integrate with private DNS zone" is **Yes** (`privatelink.blob.core.windows.net`).
5. Disable the **Static website** feature under Data Management, as it's no longer needed.
6. **CORS Configuration**: Since the React app will now be hosted on a different domain (`your-webapp.azurewebsites.net`), go to **Resource sharing (CORS)** under Settings.
   - **Allowed origins**: `https://<your-webapp-name>.azurewebsites.net` (or `*` for internal testing).
   - **Allowed methods**: GET, OPTIONS
   - **Allowed headers**: `*`
   - **Max age**: `86400`

---

## Step 2: Create and Secure Azure Key Vault

1. Search for **Key Vaults** in the portal and click **Create**.
2. **Name**: `kv-zt-dashboard`
3. **Pricing tier**: Standard
4. On the **Networking** tab:
   - Choose **Disable public access**.
   - Create a **Private endpoint** associated with your VNet (`privatelink.vaultcore.azure.net`).
5. On the **Access configuration** tab, choose **Azure role-based access control (RBAC)**.
6. Click **Review + create** and then **Create**.
7. Once created, go to **Access control (IAM)** -> **Add role assignment** -> Assign yourself the **Key Vault Secrets Officer** role so you can create secrets.
8. Go to **Secrets** and add any sensitive values you need (e.g., SAS tokens, backend API keys).

---

## Step 3: Create the Azure App Service (Linux Web App)

1. Search for **App Services** and click **Create -> Web App**.
2. **Basics Tab**:
   - **Name**: `zt-dashboard-webapp` (This must be globally unique).
   - **Publish**: Code
   - **Runtime stack**: Node 20 LTS
   - **Operating System**: Linux
   - **App Service Plan**: Create a new Linux plan (e.g., Basic B1 or Standard S1).
3. **Networking Tab**:
   - **Enable network injection**: **Off** (We'll configure this after creation).
   - **Enable public access**: **Off** (We'll configure Private Endpoints).
4. Click **Review + create** and then **Create**.

---

## Step 4: Configure App Service Networking

Now we lock down the Web App and allow it to reach the Storage Account and Key Vault.

1. Go to your newly created **App Service** -> **Networking**.
2. **Inbound Traffic**:
   - Click on **Private endpoints**.
   - Click **Add** -> **Express**.
   - Name it `pe-zt-webapp`.
   - Place it in your VNet (`privatelink.azurewebsites.net`).
   - Go back to the App Service Networking page. Under **Access restriction**, ensure public access is fully **Disabled**.
3. **Outbound Traffic (VNet Integration)**:
   - Click on **VNet integration**.
   - Click **Add VNet** and select your VNet and a subnet (must be an empty subnet delegated to `Microsoft.Web/serverFarms`).
   - This allows the App Service to route traffic to the private IP of your Storage Account and Key Vault.

---

## Step 5: Configure Managed Identity and Key Vault Access

1. In the App Service menu, go to **Identity** -> **System assigned** and turn the Status to **On**. Save.
2. Go back to your **Key Vault** -> **Access control (IAM)** -> **Add role assignment**.
3. Assign the **Key Vault Secrets User** role to the App Service Managed Identity you just turned on.

---

## Step 6: Configure App Settings & Build Variables

We need to provide Oryx (the build engine) with instructions and environment variables.

1. In the App Service menu, go to **Environment variables** (or **Configuration**).
2. Add the following **App settings**:
   - `SCM_DO_BUILD_DURING_DEPLOYMENT`: `true` (Tells Azure to build the React app).
   - `SCM_COMMAND_IDLE_TIMEOUT`: `1200` (Optional/recommended for NPM builds).
   - `PROJECT`: `src/report` (Tells Oryx where the `package.json` is located).
   - `VITE_BLOB_BASE_URL`: The new private endpoint URL of your Storage Account blob container.
   - `VITE_BLOB_SAS_TOKEN`: `@Microsoft.KeyVault(SecretUri=https://kv-zt-dashboard.vault.azure.net/secrets/YourSecretName/)` (If you need a SAS token).
   - `VITE_ENTRA_CLIENT_ID`: Your new App Registration Client ID for the React Frontend.
   - `VITE_ENTRA_TENANT_ID`: Your Entra ID Tenant ID.
3. Save the Configuration. Azure will restart the app.

---

## Step 7: Entra ID Authentication Setup (App Registration)

To allow users to log in to the React app with their Entra ID accounts:
1. Go to **Microsoft Entra ID** -> **App registrations** -> **New registration**.
2. **Name**: `zt-dashboard-frontend`
3. **Supported account types**: Accounts in this organizational directory only.
4. **Redirect URI (SPA)**: Select `Single-page application (SPA)` and enter your Private Endpoint URL (e.g., `https://zt-dashboard-webapp.azurewebsites.net`).
5. Click **Register**. Note down the **Application (client) ID** and **Directory (tenant) ID**.
6. Put these values in the `VITE_ENTRA_CLIENT_ID` and `VITE_ENTRA_TENANT_ID` App Settings (Step 6).

---

## Step 8: Connect GitHub Deployment

1. Make sure your local React frontend code modifications (the addition of the `start` script and `serve` dependency) are committed and pushed to your GitHub repository.
2. In the App Service, go to **Deployment Center**.
3. **Source**: GitHub.
4. Authorize Azure to access your GitHub account.
5. Select your organization, repository, and branch.
6. **Authentication Type**: Ensure the build provider is set to **App Service Build Service**, NOT GitHub Actions.
7. Click **Save**.

Azure will immediately trigger a pull from GitHub. Oryx will detect the Node.js project in `src/report`, inject your `VITE_` variables into the environment, run `npm install`, and then execute `npm run build` followed by `npm start` (which we modified to host the static output).

## Accessing the Dashboard
Because the App Service has disabled public access, you **cannot** visit the `.azurewebsites.net` URL from the public internet. 

While connected to your corporate VPN or ExpressRoute, visit `https://zt-dashboard-webapp.azurewebsites.net`. Your private DNS zone will resolve this to the internal IP of the Private Endpoint automatically.
