# Deploying the Zero Trust Dashboard Data Collector

This guide explains how to properly deploy the `Invoke-ZTDashboardDataCollection.ps1` runbook into an Azure Automation Account. The runbook is responsible for pulling your daily Azure Policy, Defender for Cloud, Governance, and Zero Trust data and storing it securely where your React frontend dashboard can read it.

The runbook natively supports two types of authentication: **App Registrations** (Service Principals) and **System-Assigned Managed Identity**.

---

## 1. Prerequisites (Storage Account)

Before configuring the runbook, you need a place to store the JSON data.

1. Create a General Purpose v2 Storage Account in Azure.
2. Under **Data management**, select **Static website** and enable it.
3. Set the Index document to `index.html`. This automatically creates a `$web` container.
4. *Your React build files will eventually go into this `$web` container, and the runbook will also push its JSON files here automatically.*

---

## 2. Authentication Setup

Choose **one** of the following methods for your runbook to authenticate.

### Option A: App Registration (Recommended for cross-tenant or local testing)
If you require granular permissions or are testing locally, use an App Registration.

1. Go to **Microsoft Entra ID** -> **App registrations** -> **New registration**.
2. Name it (e.g., `ZTDashboard-DataCollector`) and click **Register**.
3. Copy your **Application (client) ID**.
4. Go to **Certificates & secrets** -> **New client secret**.
5. Give it an expiration date, click add, and **copy the Secret Value immediately**.
6. Go to **API permissions** -> **Add a permission** -> **Microsoft Graph** -> **Application permissions**.
7. Add the following:
   - `Directory.Read.All`
   - `Policy.Read.All`
   - `SecurityEvents.Read.All`
   - `Reports.Read.All`
8. Click **Grant admin consent** for your tenant.
9. Go to the Azure subscriptions you want to scan, select **Access control (IAM) -> Add role assignment**, and grant your new App Registration the **Reader** role.
10. Go to your Storage Account, select **Access control (IAM)**, and grant your App Registration the **Storage Blob Data Contributor** role.

### Option B: Managed Identity (Recommended for simplicity)
If you want Azure to handle credentials entirely in the background securely:

1. In your **Azure Automation Account**, go to **Account Settings > Identity** -> Turn on **System assigned**.
2. Note the *Object (principal) ID*.
3. **Assign Azure Permissions:**
   - Grant the identity the `Reader` role on all target Subscriptions.
   - Grant the identity the `Storage Blob Data Contributor` role on the Storage Account.
4. **Assign API Permissions:**
   - Go to Entra ID -> *Roles and administrators*.
   - Assign the Managed Identity the **Global Reader** or **Security Reader** role directly. *(You cannot assign granular Microsoft Graph API permissions to a Managed Identity via the Azure Portal GUI without PowerShell).*

---

## 3. Automation Account Configuration

### A. Required Modules
In your Azure Automation Account, ensure the PowerShell runtime is **7.2 or higher**.
Go to **Shared Resources > Modules** and ensure the following are installed:
- `Az.Accounts`
- `Az.Storage`
- `Az.ResourceGraph`
- `Az.Security`
- `Microsoft.Graph.Authentication`
- `ZeroTrustAssessment`

### B. Automation Variables
Create the following String variables under **Shared Resources > Variables**:

*Note: The script intelligently auto-discovers your storage account subscription and resource group via Resource Graph. You only need to provide the names below.*

1. **`AuthMethod`** -> Set to `AppRegistration` or `ManagedIdentity`
2. **`TargetTenantId`** -> Your Entra ID Tenant ID
3. **`StorageAccountName`** -> Name of your Storage Account (e.g., `ztdashboardsa`)
4. **`BlobContainerName`** -> `$web`

**If using App Registration (`AuthMethod = AppRegistration`), you must also add:**
5. **`AppClientId`** -> Your Application (client) ID
6. **`AppClientSecret`** -> Your Client Secret string. **Crucial:** You must toggle *Encrypted = Yes* when creating this variable.

---

## 4. Run the Script

1. Create a new PowerShell runbook.
2. Paste the contents of `Invoke-ZTDashboardDataCollection.ps1`.
3. Link it to a Schedule (e.g., Daily at `06:00 AM`).

The script will automatically authenticate, find your Subscriptions, scan them, find your Storage account, and upload the data.

### Notes on Output Structure
The runbook will push exactly 5 JSON files into the `$web` container:
- `assessments/report-data.json` (The base ZT overview)
- `assessments/[TenantID]/[SubID]/[Date]/zero-trust.json`
- `assessments/[TenantID]/[SubID]/[Date]/policy-compliance.json`
- `assessments/[TenantID]/[SubID]/[Date]/defender-recs.json`
- `assessments/[TenantID]/[SubID]/[Date]/governance.json`

**Frontend Trick:** The script also perfectly duplicates those 4 lower files into an `assessments/[TenantID]/[SubID]/latest/` directory. This allows your React dashboard to immediately pull static, real-time files without parsing historic indexes first. All historic daily data is kept permanently for audits.
