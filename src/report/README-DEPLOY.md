# Zero Trust Dashboard — Build & Deploy Guide

## Architecture

```
┌─────────────────────────┐     ┌──────────────────────────────┐
│  Azure Automation        │     │  Storage Account              │
│  Runbook (daily)         │     │                              │
│  - ZT Assessment         │────▶│  DATA container (e.g. ztdata) │
│  - Policy/Defender/Gov   │     │   assessments/                │
│  - tenant-index.json     │     │     tenant-index.json         │
│  - error-log.json        │     │     report-data.json          │
│                          │     │     {tenant}/{sub}/{date}/    │
│                          │     │       zero-trust.json         │
│                          │     │       policy-compliance.json  │
│                          │     │       defender-recs.json      │
│                          │     │       governance.json         │
│                          │     │     error-log.json            │
│                          │     │     logs/{date}/error-log.json│
└─────────────────────────┘     │                              │
                                │  $web container (static host) │
                                │   index.html                  │
                                └──────────────────────────────┘
```

The frontend is a React app compiled into a **single `index.html`** file (via `vite-plugin-singlefile`). It's served from Azure Static Web Hosting (`$web` container) and fetches live data from the data container via SAS token.

---

## Prerequisites

- **Node.js** 18+ and **npm** installed
- **Azure CLI** (`az`) or **AzCopy** installed
- Storage account with:
  - Static website hosting enabled
  - A data container (e.g. `ztdata`) where the runbook uploads JSON
  - CORS rules configured (see below)

---

## Step 1: Install Dependencies

```powershell
cd e:\test5\zerotrustassessment\src\report
npm install
```

---

## Step 2: Configure Environment

Edit `.env` in `src/report/`:

```env
# Replace with YOUR actual values
VITE_BLOB_BASE_URL="https://YOUR_STORAGE_ACCOUNT.blob.core.windows.net/YOUR_DATA_CONTAINER"
VITE_BLOB_SAS_TOKEN="?sv=2022-11-02&ss=b&srt=o&sp=r&se=2027-01-01&st=2026-01-01&spr=https&sig=YOUR_SIG"
```

### Generate a Read-Only SAS Token

```powershell
az storage container generate-sas `
    --account-name YOUR_STORAGE_ACCOUNT `
    --name YOUR_DATA_CONTAINER `
    --permissions r `
    --expiry 2027-01-01 `
    --output tsv
```

Prefix the output with `?` and paste it as `VITE_BLOB_SAS_TOKEN`.

---

## Step 3: Build the Single-File HTML

```powershell
cd e:\test5\zerotrustassessment\src\report
npm run build
```

This produces `dist/index.html` — a self-contained HTML file with all JS/CSS inlined.

> **Note:** The build uses `vite-plugin-singlefile` configured in `vite.config.ts`. The SAS token and blob URL are baked into the build at compile time via Vite's env variable system.

---

## Step 4: Upload to `$web` Container

### Option A: Azure CLI

```powershell
az storage blob upload `
    --account-name YOUR_STORAGE_ACCOUNT `
    --container-name '$web' `
    --name index.html `
    --file .\dist\index.html `
    --content-type "text/html" `
    --overwrite
```

### Option B: AzCopy

```powershell
azcopy copy ".\dist\index.html" `
    "https://YOUR_STORAGE_ACCOUNT.blob.core.windows.net/`$web/index.html?YOUR_SAS_TOKEN" `
    --content-type "text/html"
```

### Option C: Azure Portal

1. Go to Storage Account → Containers → `$web`
2. Upload `dist/index.html`
3. Set Content-Type header to `text/html`

---

## Step 5: Enable Static Website Hosting

1. Azure Portal → Storage Account → **Static website** → **Enabled**
2. Set **Index document name** to `index.html`
3. Note the **Primary endpoint** URL (e.g., `https://youraccount.z13.web.core.windows.net/`)

---

## Step 6: Configure CORS

Since the frontend (`$web`) fetches JSON from the data container, you need CORS:

```powershell
az storage cors add `
    --account-name YOUR_STORAGE_ACCOUNT `
    --services blob `
    --origins "https://YOUR_STORAGE_ACCOUNT.z13.web.core.windows.net" `
    --methods GET HEAD `
    --allowed-headers "*" `
    --exposed-headers "*" `
    --max-age 3600
```

> Replace `z13` with your actual region code (shown in the static website primary endpoint).

---

## Step 7: Verify

1. Open the static website URL in a browser
2. Open DevTools → Network tab
3. Verify these requests succeed (HTTP 200):
   - `assessments/tenant-index.json` — loaded on page mount
   - `assessments/{tenantId}/{subId}/{date}/zero-trust.json` — Overview Cards
   - `assessments/{tenantId}/{subId}/{date}/policy-compliance.json`
   - `assessments/{tenantId}/{subId}/{date}/defender-recs.json`
   - `assessments/{tenantId}/{subId}/{date}/governance.json`
4. Navigate to the **Trends** page — charts should populate with snapshot data
5. Check `assessments/error-log.json` for any runbook issues

---

## Updating the Dashboard

After each runbook run (daily), the data container is automatically updated. **No rebuild is needed** — the frontend fetches live data from blob on each page load.

You only need to rebuild and re-upload `index.html` when:
- You change frontend code (React components, styles, etc.)
- You update the SAS token (expired)
- You change the storage account URL

### Quick Rebuild & Deploy Script

```powershell
cd e:\test5\zerotrustassessment\src\report
npm run build
az storage blob upload `
    --account-name YOUR_STORAGE_ACCOUNT `
    --container-name '$web' `
    --name index.html `
    --file .\dist\index.html `
    --content-type "text/html" `
    --overwrite
Write-Host "✅ Deployed to static website!"
```

---

## Checking the Error Log

After each runbook run, check `assessments/error-log.json` in the data container:

```powershell
# Quick view with Azure CLI
az storage blob download `
    --account-name YOUR_STORAGE_ACCOUNT `
    --container-name YOUR_DATA_CONTAINER `
    --name "assessments/error-log.json" `
    --file - | ConvertFrom-Json | ConvertTo-Json -Depth 5
```

Historical logs are also available at `assessments/logs/{YYYY-MM-DD}/error-log.json`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page | Wrong `$web` upload or missing index.html | Re-upload with `content-type: text/html` |
| "Select a tenant" message | `tenant-index.json` missing | Run the runbook at least once |
| CORS error in DevTools | Missing CORS rule on storage account | Run the `az storage cors add` command above |
| Overview Cards show "No data" | SAS token expired or wrong container URL | Regenerate SAS token, update `.env`, rebuild |
| Sankey diagrams empty | Sign-in logs not available (app-only auth) | Expected — this data requires delegated auth. Check `error-log.json` for SKIP entries |
| Trends page empty | Only 1 date in `tenant-index.json` | Run the runbook on multiple days to accumulate dates |
