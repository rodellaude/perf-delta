# Perf-Delta — Performance Observability & Reporting Platform

**Perf-Delta** is a **100% pure Node.js + DuckDB + React** performance testing analytics platform for **JMeter** and **NeoLoad** results. It ingests raw CSV results directly into an embedded **DuckDB Vault** (`Data/Performance_Vault.db`) in under a second, serves a **Cyber-Slate** live web dashboard over a **single LAN-accessible port (`:8080`)**, and exports lightweight, self-contained **offline Static HTML reports** directly from the browser.

---

## Key Features
- **Lightweight Single Runtime:** Runs purely on **Node.js 20+ LTS** with an embedded **DuckDB** database — no external DB server or extra runtimes needed.
- **Single-Port LAN Server (`:8080`):** Express serves both the built React UI (`dashboard-ui/dist`) and the DuckDB REST API (`/api/*`) on one port (`http://localhost:8080` and `http://<your-IP>:8080`).
- **Grafana-Style Read-Only Sharing & Admin RBAC:**
  - Clients/stakeholders open the URL directly in **Read-Only Viewer** mode (zero login wall).
  - Admins sign in (`scrypt` password hashing in git-ignored `secrets.yaml` + `HttpOnly` session cookies) to unlock **Settings**, **DB Explorer**, **Run Registration/Deletion**, and **AI Summary Generation**.
  - 1-click **`Share`** button copies the exact URL (`run`, `base`, `tab`, `range`, and multi-select filters).
- **Sub-Second Native DuckDB CSV Ingestion:** Upload CSVs directly in **Settings → Manage Runs** (drag-and-drop or server folder path) or run `.\register.ps1` from CLI/CI.
- **Full-Stack Analytics:**
  - **Overview:** Executive Summary (0 ms deterministic + Admin-persisted **Google Gemini / Planit Amplify** AI summary in DuckDB), Apdex distribution, 4 KPIs with Baseline Δ, synchronized Concurrency/Throughput & Latency charts with Copy PNG.
  - **Applications → Scenarios → Transactions:** Macro-to-Micro drilldown with SLA thresholds, longest-prefix overrides, and Baseline P95 Δ.
  - **Compare vs Base & Multi-Run Historical Trends:** Build-over-build P95/TPS/Apdex/Error trend charts, configurable build anchor dropdown (`Compare vs`), drift sensitivity (`±5%` / `±10%` / `±20%`), and Scenario/Transaction Drift Table.
  - **Multi-Select Include / Exclude Global Filters:** Filter by Apps, Scenarios, or Transactions and recalculate every view live.
  - **Errors & Diagnostics, Glossary, and Read-Only DuckDB SQL Explorer.**
- **Instant Pure-JS Static HTML Export (`HTML` button):** Downloads a self-contained offline `.html` report (`~80–150 KB`) with collapsible sidebar, Dark/Light toggle, inline SVG charts, Copy PNG, interactive tables, Trends, and Glossary.

---

## Architecture Decision: Why Node.js + DuckDB Over R

Perf-Delta originally used an R + RMarkdown/Pandoc pipeline (`.engine/engine.R`) for CSV registration and static report rendering. We migrated 100% of ingestion, aggregation, and visualization to **Node.js + DuckDB + React** for five practical engineering reasons:

| Dimension | Legacy R / RMarkdown Pipeline | Current Node.js + DuckDB + React |
|---|---|---|
| **CSV Registration & Aggregation** | Loaded full CSVs into R RAM via `vroom` + `dbWriteTable` (~15s+ per run). | Streams directly into DuckDB's native C++ `read_csv_auto(...)` engine and builds all 6 `agg_*` tables in **< 1 second** (`~830 ms` for 68k rows) with minimal memory overhead. |
| **Interactive Visuals & Filtering** | Pre-baked static charts; changing scope or SLA thresholds required re-rendering the entire report. | Live React + Recharts charts with instant multi-select **Include / Exclude** filters, **Historical Trends**, **DB Explorer**, and live YAML-backed **Settings**. |
| **Offline Static HTML Export** | Spawned R + Pandoc/Quarto (~15–25s, `~6.3 MB` HTML files). | Pure-TypeScript in-browser generator exports a complete offline `.html` report in **< 200 ms** (`~80–150 KB`) reflecting your exact active filters and saved AI summary. |
| **Single-Runtime Portability** | Required R 4.x, 20 R packages (`RLibs/`), Pandoc, and Quarto; prone to DuckDB storage format mismatches between R and Node drivers. | **Single prerequisite (Node.js 20+ LTS)** — both ingestion and querying share the exact same `@duckdb/node-api` driver, eliminating storage version conflicts. |
| **Team & Client Collaboration** | Manual CLI execution and emailed HTML files only. | Single-port LAN server (`:8080`) with **Read-Only Viewer** sharing, **Admin Login**, Web UI **Drag-and-Drop CSV Upload**, and 1-click **`Share`** URLs. |

---

## Prerequisites
- **Node.js 20+ LTS** (includes `npm`) — [nodejs.org](https://nodejs.org/)

---

## Quick Start

### 1. Start the Single-Port Live Server
```powershell
.\launch-dashboard.ps1
```
- Installs `node_modules` and builds `dashboard-ui/dist` automatically on first run.
- Prints both your local URL (`http://localhost:8080`) and LAN share URL (`http://<your-IP>:8080`).
- Optional flags:
  - `.\launch-dashboard.ps1 -Port 9000` — run on a custom port
  - `.\launch-dashboard.ps1 -Rebuild` — force rebuild of the React UI before starting
  - `.\launch-dashboard.ps1 -Dev` — 2-port Vite HMR mode (`:5173` + `:8080`) for active frontend development

### 2. First-Time Admin Setup
1. Open `http://localhost:8080` and click **Login** in the top-right corner.
2. Create your Admin password (stored salted & `scrypt`-hashed in git-ignored `secrets.yaml`).
3. Open **Settings** (bottom of the left rail) to configure **SLA Thresholds**, **AI Provider** (Google Gemini or Planit Amplify), **Label Exclusions**, and **Manage Runs**.

### 3. Register Test Runs (CSVs)
CSV files must follow the naming convention:
```text
<ProjectName>_<TestType>_<AppName>_<BuildId>_<Timestamp>.csv
# Example: ECAN_PeakLoad_ECan-UAT_10008_20261126.csv
```
- **Option A — Web UI (Recommended):** Sign in as Admin → **Settings → Manage Runs** → upload `.csv` files or enter a server folder path → click **Register Run**.
- **Option B — CLI / CI:**
  ```powershell
  .\register.ps1
  # Or non-interactive:
  .\register.ps1 -rawResultsFolder "C:\Projects\Reports\perf-delta\RawResults\10008" -toolType jmeter
  ```

---

## Project Layout
```text
perf-delta/
├── launch-dashboard.ps1          # Single-port LAN server launcher (:8080)
├── register.ps1                  # Pure-Node.js CSV registration CLI wrapper
├── config.yaml                   # Live workspace config (AI provider, prompt, exclusions, timezone)
├── secrets.yaml                  # Git-ignored secrets (Admin hash, Gemini key, Amplify token)
├── SLA/performance-sla.yaml      # SLA thresholds & per-transaction prefix overrides
├── Data/Performance_Vault.db     # Embedded DuckDB vault (raw + 6 agg_* tables + ai_summaries)
├── dashboard-api/
│   ├── server.js                 # Express API + static UI host + Auth/RBAC + DuckDB queries
│   ├── ingest.js                 # Native DuckDB read_csv_auto ingestion & agg_* builder
│   └── register-cli.js           # Standalone Node.js CLI for CI/terminal registration
└── dashboard-ui/                 # React 18 + TypeScript + Tailwind + Recharts Cyber-Slate UI
```

---

## REST API Reference

Base URL: `http://localhost:8080` (or `http://<your-IP>:8080`). Admin endpoints require an authenticated `HttpOnly` `perf_delta_session` cookie and return `401 Unauthorized` for Read-Only Viewers.

### Public / Read-Only Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Server health, DuckDB driver status, `hasAggTables` flag, and active SLA summary. |
| `GET` | `/api/runs` | Returns up to 25 registered Vault runs from pre-aggregated `agg_*` tables (`mode: "live-duckdb-agg"`). |
| `GET` | `/api/runs/:runId/timeseries` | Live filtered time-series buckets (`appMode`/`apps`, `scenarioMode`/`scenarios`, `endpointMode`/`endpoints` using `include`/`exclude`). |
| `GET` | `/api/ai-summary?scopeKey=...` | Fetches any Admin-persisted AI Executive Summary from DuckDB `ai_summaries` for the given scope. |
| `GET` | `/api/auth/status` | Returns `{ authenticated, username, setupRequired }` for the current browser session. |

### Authentication Endpoints
| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/api/auth/setup` | First-run only | Creates the initial Admin account (`scrypt` hash in `secrets.yaml`) when `admin_password_hash` is not set. |
| `POST` | `/api/auth/login` | Public | Verifies Admin credentials and sets a 12-hour sliding `HttpOnly` session cookie. |
| `POST` | `/api/auth/logout` | Public | Invalidates the current session token and returns the browser to Read-Only Viewer mode. |
| `POST` | `/api/auth/change-password` | **Admin** | Verifies current password and updates `admin_password_hash` in `secrets.yaml`. |

### Admin-Only Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/settings` | Reads `config.yaml`, `SLA/performance-sla.yaml`, and `secrets.yaml` (returns **masked-only** API keys). |
| `PUT` | `/api/settings` | Atomically updates `config.yaml`, `SLA/performance-sla.yaml`, and `secrets.yaml` while preserving untouched keys. |
| `POST` | `/api/settings/test-ai` | Tests live connectivity against the explicitly selected AI provider (**Google Gemini** or **Planit Amplify**). |
| `POST` | `/api/ai-summary` | Generates an AI Executive Summary via the active provider and persists it in DuckDB `ai_summaries`. |
| `DELETE` | `/api/ai-summary?scopeKey=...` | Deletes a persisted AI summary for the specified scope. |
| `POST` | `/api/runs/register` | Ingests CSVs via `multipart/form-data` (`files`, `toolType`) or JSON (`{ folderPath, toolType }`) and builds all 6 `agg_*` tables. |
| `DELETE` | `/api/runs/:runId` | Permanently deletes a run across `performance_history*`, all 6 `agg_*` tables, and `ai_summaries`, then runs `CHECKPOINT`. |
| `GET` | `/api/db/schema` | Returns all tables, row counts, and column types in `Data/Performance_Vault.db` (`READ_ONLY`). |
| `POST` | `/api/db/query` | Runs a single read-only DuckDB SQL query (`SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `EXPLAIN`, `SUMMARIZE`, `PRAGMA`) with row cap. |

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **Teammates can't open `http://<your-IP>:8080`** | Windows Defender Firewall is blocking inbound TCP `8080`. | Run once in an elevated PowerShell: `New-NetFirewallRule -DisplayName "Perf-Delta 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow` |
| **Port `8080` already in use** | Another local service is bound to `:8080`. | Start on another port: `.\launch-dashboard.ps1 -Port 8085` (avoid `:3001` on machines running `AMAgent.exe`). |
| **`Invalid CSV filename` during registration** | Filename doesn't have at least 4 underscore-separated segments. | Rename CSV to `<Project>_<TestType>_<App>_<BuildId>_<Timestamp>.csv` (e.g. `ECAN_PeakLoad_ECan-UAT_10008_20261126.csv`). |
| **`Run ID 'xxxx' already exists`** | That `BuildId` is already registered in `Performance_Vault.db`. | Sign in as Admin → **Settings → Manage Runs** → delete the existing run first, or use a new `BuildId`. |
| **AI Summary says key/token missing** | Active provider in **Settings → AI Executive Summary** has no saved credential. | Open **Settings → AI Executive Summary**, select **Google Gemini** or **Planit Amplify**, paste your key/token, click **Test Connection**, and **Save & Apply**. |
| **Forgot Admin password** | `admin_password_hash` is stored in git-ignored `secrets.yaml`. | Delete the `admin_password_hash` line in `secrets.yaml`, refresh `http://localhost:8080`, and click **Login** to run First-Time Admin Setup again. |
| **UI changes not visible on `:8080`** | Single-port mode serves the pre-built `dashboard-ui/dist/` bundle. | Run `.\launch-dashboard.ps1 -Rebuild` (or `.\launch-dashboard.ps1 -Dev` for Vite hot-reload during development). |

---

## Transferring to Another Machine
1. Install **Node.js 20+ LTS**.
2. Clone or copy this repository (copy `Data/Performance_Vault.db` and `secrets.yaml` if transferring existing runs/credentials).
3. Run `.\launch-dashboard.ps1` — everything bootstraps automatically.
