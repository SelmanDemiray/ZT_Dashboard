# Zero Trust Dashboard — Build & Deploy Guide

## Architecture

```
┌─────────────────────────┐     ┌────────────────────────────────────┐
│  Azure Automation        │     │  Storage Account                   │
│  Runbook (daily)         │     │                                    │
│  - ZT Assessment         │────▶│  $web container (static host)      │
│  - Policy/Defender/Gov   │     │   index.html (frontend app)        │
│  - tenant-index.json     │     │                                    │
│  - error-log.json        │     │   assessments/ (live data)         │
│                          │     │     tenant-index.json              │
│                          │     │     report-data.json               │
│                          │     │     {tenant}/{sub}/{date}/         │
│                          │     │       zero-trust.json              │
│                          │     │       policy-compliance.json       │
│                          │     │       defender-recs.json           │
│                          │     │       governance.json              │
│                          │     │     error-log.json                 │
│                          │     │     logs/{date}/error-log.json     │
└─────────────────────────┘     └────────────────────────────────────┘
```

The frontend is a React app compiled into a **single `index.html`** file (via `vite-plugin-singlefile`). It's served from Azure Static Web Hosting (`$web` container).

Because the runbook also uploads live JSON data directly into the `$web` container, the frontend architecture is incredibly simple: **no CORS configuration is needed** (it's same-origin) and **no SAS token is needed** (the static web endpoint makes the data publicly readable to the frontend).

---

## Prerequisites

- **Node.js** 18+ and **npm** installed
- **Azure CLI** (`az`) or **AzCopy** installed
- Storage account with Static website hosting enabled
- A successful ZT Runbook execution to populate the `assessments/` folder

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
# Since your BlobContainerName is "$web", the frontend and data are
# co-located. Set this to your static website Primary Endpoint URL.
# Find it in: Azure Portal > Storage Account > Static website
VITE_BLOB_BASE_URL="https://securityposturestorage1.z13.web.core.windows.net"
VITE_BLOB_SAS_TOKEN=""
```

---

## Step 3: Build the Single-File HTML

```powershell
cd e:\test5\zerotrustassessment\src\report
npm run build
```

This produces `dist/index.html` — a self-contained HTML file with all JS/CSS inlined.

---

## Step 4: Enable Static Website Hosting (If not already enabled)

1. Azure Portal → Storage Account → **Static website** → **Enabled**
2. Set **Index document name** to `index.html`
3. Note the **Primary endpoint** URL.

---

## Step 5: Upload to `$web` Container

```powershell
az storage blob upload `
    --account-name YOUR_STORAGE_ACCOUNT `
    --container-name '$web' `
    --name index.html `
    --file .\dist\index.html `
    --content-type "text/html" `
    --overwrite
```

---

## Step 6: Verify

1. Open your static website URL in a browser
2. Open DevTools → Network tab
3. Verify these requests succeed (HTTP 200 without SAS tokens):
   - `assessments/tenant-index.json`
   - `assessments/{tenantId}/{subId}/{date}/zero-trust.json`
4. Navigate to the **Trends** page — charts should populate with snapshot data
5. Check `assessments/error-log.json` for any runbook issues

---

## Updating the Dashboard

After each runbook run (daily), the `$web` data is automatically updated. **No rebuild is needed** — the frontend fetches live data on each page load.

You only need to rebuild and re-upload `index.html` when you change frontend code (React components, styles, etc.).

---

## Checking the Error Log

If the runbook fails or shows partial data, check the error log directly via the browser:
`https://securityposturestorage1.z13.web.core.windows.net/assessments/error-log.json`

Historical logs are at `assessments/logs/{YYYY-MM-DD}/error-log.json`.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page | Wrong `$web` upload or missing index.html | Re-upload with `content-type: text/html` |
| "Select a tenant" message | `tenant-index.json` missing | Run the runbook at least once |
| Overview Cards show "No data" | Wrong container URL in `.env` | Update `VITE_BLOB_BASE_URL`, rebuild, reupload |
| Sankey diagrams empty | Sign-in logs not available | Expected — M365 app-only auth cannot read interactive sign-in logs. Check error log |
| Trends page empty | Only 1 date in `tenant-index.json` | Run the runbook on multiple days to accumulate dates |
