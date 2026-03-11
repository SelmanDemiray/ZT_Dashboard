# Hybrid Runbook Worker Deployment Guide

> **Why Hybrid?** The `ZeroTrustAssessment` module (~150+ MB extracted) exceeds Azure Automation's 100 MB module import limit. A Hybrid Runbook Worker runs on your own Azure VM where modules are installed locally — **no size limit**.

---

## Architecture Overview

```
┌──────────────────────────┐        ┌──────────────────────────┐
│   Azure Automation       │        │   Azure VM (Hybrid       │
│   Account                │───────>│   Runbook Worker)        │
│                          │ trigger│                          │
│  • Runbook code          │        │  • PowerShell 7.4        │
│  • Schedule (daily 6AM)  │        │  • ZeroTrustAssessment   │
│  • Automation Variables  │        │    (installed locally,    │
│  • Hybrid Worker Group   │        │     no size limit)       │
│                          │        │  • All Az/Graph modules  │
└──────────────────────────┘        └──────────┬───────────────┘
                                               │
                                    ┌──────────▼───────────────┐
                                    │   Storage Account ($web) │
                                    │   • JSON data files      │
                                    │   • React dashboard      │
                                    └──────────────────────────┘
```

---

## Step 1: Create Your Azure VM

Create a Windows Server VM to act as the Hybrid Runbook Worker.

**Recommended specs:**
| Setting | Value |
|---|---|
| OS | Windows Server 2022 Datacenter |
| Size | Standard_B2ms (2 vCPU, 8 GB RAM) |
| Region | Same region as your Automation Account |
| Authentication | Your preference (password or SSH key) |
| Public IP | Not required (outbound internet only) |

> [!NOTE]
> The VM only needs **outbound internet** to reach Azure management endpoints and Microsoft Graph. It does not need a public IP or any inbound ports open.

### Networking Requirements

The VM must be able to reach these endpoints over HTTPS (port 443):
- `*.azure-automation.net` — Hybrid Worker agent communication
- `login.microsoftonline.com` — Authentication
- `graph.microsoft.com` — Microsoft Graph API
- `management.azure.com` — Azure Resource Manager
- `*.blob.core.windows.net` — Storage blob uploads

If using an NSG or firewall, ensure these are allowed outbound.

---

## Step 2: Register the VM as a Hybrid Runbook Worker

### 2a. Create a Hybrid Worker Group

1. Go to **Azure Portal** → your **Automation Account**
2. Under **Process Automation**, click **Hybrid worker groups**
3. Click **+ Create hybrid worker group**
4. Name it (e.g., `zt-hybrid-workers`)
5. Choose **Hybrid Workers** tab → **Add members** → select your VM
6. Click **Review + Create** → **Create**

> [!IMPORTANT]
> Azure uses the **extension-based** Hybrid Worker model (V2). The VM needs the `HybridWorker` extension, which Azure installs automatically when you add it to the group via the portal.

### 2b. Verify Registration

After a few minutes:
1. Go back to **Hybrid worker groups** → your group
2. The VM should show **Status: Ready**
3. If it shows "Not Ready", check that the VM is running and has outbound internet

---

## Step 3: Assign Permissions to the VM's Identity

The hybrid runbook runs under the VM's context. You need to assign permissions to either:
- **The VM's System-Assigned Managed Identity** (recommended), or
- **The same App Registration** you already use

### Option A: Managed Identity (Recommended)

1. Go to your **VM** → **Identity** → turn on **System assigned** → **Save**
2. Copy the **Object (principal) ID**
3. Assign these roles:

| Role | Scope | Purpose |
|---|---|---|
| **Reader** | All target subscriptions (or Management Group) | List subscriptions, query Resource Graph |
| **Storage Blob Data Contributor** | Storage Account | Upload JSON data files |
| **Global Reader** | Entra ID (Roles and Administrators) | ZeroTrustAssessment Graph queries |

### Option B: App Registration

Use the same App Registration from your current cloud runbook setup. No changes needed — the hybrid runbook reads `AppClientId` and `AppClientSecret` from Automation Variables just like before.

---

## Step 4: Install Modules on the VM

RDP into the VM (or use Azure Bastion / Run Command) and run the **`Setup-HybridWorkerModules.ps1`** script provided in this repo.

This script:
- Installs PowerShell 7.4 (if not already present)
- Installs all required modules for ZeroTrustAssessment
- Validates that everything loaded correctly
- Sets PowerShell environment variables (`POWERSHELL_7_4_PATH`) so Azure Automation can find the interpreter

> [!IMPORTANT]
> The script sets **System Environment Variables**. You must run it as **Administrator** and then **restart the VM** (or the Hybrid Worker service) before running your hybrid runbook.

```powershell
# From your local machine, or copy the script to the VM and run:
pwsh -File "C:\path\to\Setup-HybridWorkerModules.ps1"
```

Or run it manually step-by-step — full details are in the script header.

> [!WARNING]
> Run the script in **PowerShell 7.4** (`pwsh`), not Windows PowerShell 5.1 (`powershell`). Azure Automation's Hybrid Worker uses PS 7.x when you configure a PS 7.x runtime.

---

## Step 5: Create Your Automation Variables

In your **Automation Account** → **Shared Resources** → **Variables**, create:

| Variable Name | Type | Value | Encrypted? |
|---|---|---|---|
| `AuthMethod` | String | `ManagedIdentity` or `AppRegistration` | No |
| `TargetTenantId` | String | Your Entra tenant ID | No |
| `StorageAccountName` | String | e.g., `ztdashboardsa` | No |
| `BlobContainerName` | String | `$web` | No |
| `AppClientId` | String | *(only if AppRegistration)* | No |
| `AppClientSecret` | String | *(only if AppRegistration)* | **Yes** |

> [!NOTE]
> If you already have these from your cloud runbook, they work as-is. The hybrid runbook reads the same variables.

---

## Step 6: Import and Configure the Hybrid Runbook

1. Go to **Automation Account** → **Runbooks** → **+ Create a runbook**
2. Name: `Invoke-ZTDashboardDataCollection-Hybrid`
3. Runbook type: **PowerShell**
4. Runtime version: **7.4**
5. Paste the contents of `Invoke-ZTDashboardDataCollection-Hybrid.ps1`
6. Click **Publish**

### Link to Schedule (targeting the Hybrid Worker Group)

1. Go to the runbook → **Schedules** → **Add a schedule**
2. Create a new schedule (e.g., Daily at 06:00 AM)
3. Under **Run Settings**, select **Run on: Hybrid Worker**
4. Select your Hybrid Worker Group (e.g., `zt-hybrid-workers`)
5. Click **OK**

---

## Step 7: Test the Runbook

1. Go to the runbook → **Test pane**
2. Under **Run Settings**, select **Hybrid Worker** → your group
3. Click **Start**
4. Monitor the output — it should print diagnostic info first, then proceed through stages 1–10

### Expected Output (first few lines)

```
[HH:mm:ss][INFO] ═══ HYBRID WORKER DIAGNOSTICS ═══
[HH:mm:ss][INFO]   Hostname     : YOUR-VM-NAME
[HH:mm:ss][INFO]   PS Version   : 7.4.x
[HH:mm:ss][INFO]   OS           : Microsoft Windows ...
[HH:mm:ss][INFO]   Worker Group : zt-hybrid-workers
[HH:mm:ss][INFO] ═══════════════════════════════════
[HH:mm:ss][INFO] ━━━ STAGE 0: Validating local modules ━━━
[HH:mm:ss][INFO]   ✅ ZeroTrustAssessment (v1.x.x)
[HH:mm:ss][INFO]   ✅ Az.Accounts (v3.x.x)
...
```

---

## Troubleshooting

### "Install the language interpreter and add the installation path..."
**Cause:** The Hybrid Worker service cannot find `pwsh.exe` because the system environment variables (`POWERSHELL_7_4_PATH`) are missing or the service hasn't loaded them yet.
**Fix:** Ensure you ran `Setup-HybridWorkerModules.ps1` as Administrator. **Restart the VM** or restart the Azure Automation Hybrid Worker service so it picks up the new environment variables.

### "ZeroTrustAssessment module not found"
**Cause:** Modules were installed in Windows PowerShell 5.1, not PowerShell 7.4.
**Fix:** RDP into the VM, open `pwsh` (not `powershell`), and run `Install-Module ZeroTrustAssessment -Force`.

### Runbook shows "Waiting" status forever
**Cause:** Hybrid Worker agent on the VM is not running or not registered.
**Fix:** On the VM, check the service: `Get-Service HybridWorkerService` (or check the extension health in the portal under VM → Extensions).

### "Failed to authenticate using Managed Identity"
**Cause:** The Managed Identity is configured on the Automation Account, not the VM, or the VM's MI lacks the required roles.
**Fix:** When using `AuthMethod = ManagedIdentity` on a Hybrid Worker, the `Connect-AzAccount -Identity` call uses the **VM's** Managed Identity, not the Automation Account's. Assign roles to the VM's identity, not the Automation Account's.

### "No enabled subscriptions found"
**Cause:** Same as cloud runbook — identity lacks `Reader` RBAC on subscriptions.
**Fix:** Assign `Reader` to the VM's Managed Identity (or App Registration) at subscription or Management Group level.

### "Connect-MgGraph failed"
**Cause:** The identity lacks `Global Reader` in Entra ID.
**Fix:** Go to **Entra ID** → **Roles and Administrators** → **Global Reader** → assign to the VM's Managed Identity or App Registration.

---

## Cost Considerations

| Resource | Estimated Cost |
|---|---|
| Standard_B2ms VM (runbook runs ~15-30 min/day) | ~$60/month if always-on |
| **Tip: Auto-shutdown** | Use Azure VM auto-shutdown + start schedule to only run during the runbook window |

To reduce costs, consider:
- **Auto-shutdown schedule**: VM → Auto-shutdown → set to turn off 1 hour after the runbook schedule
- **Start/Stop VMs v2**: Use the Azure Start/Stop VMs solution to start the VM before the runbook and stop it after
- **Spot VM**: For non-critical daily runs, use a Spot instance at ~60-90% discount
