# Perf-Delta — Complete Usage Guide

Perf-Delta standardises on **Apache JMeter as its single canonical data schema and calculation engine**. It transforms raw performance test results from **JMeter**, **NeoLoad**, or other load testing tools into a unified **DuckDB vault** and delivers two complementary reporting modes:

1. **Static HTML Executive Report** — A self-contained, single-viewport interactive HTML dashboard comparing **two test runs (Current vs Base)** or evaluating a single run standalone, with executive narrative summaries, 2x2 KPI metrics, dynamic workload phase profiling (ramp-up, steady state, ramp-down), multi-application baseline comparisons, SLA evaluation, failure drilldown tables, and zero-lag interactive modals.
2. **Live Web Dashboard Server** — An interactive **Cyber-Slate** browser web app (`dashboard-ui`, React + Vite + Tailwind + Recharts on `:5173`) powered by a local REST API (`dashboard-api`, Node.js + Express + DuckDB on `:3001`) that queries the DuckDB vault live in read-only mode (with automatic offline JSON and mock fallbacks).

You do not need to know R or Node.js to operate it. Everything is driven by launcher scripts:
- **Static reports & vault registration:** `register.ps1` (Windows) / `launch.sh` (Linux/macOS; legacy `frontdoor.ps1`/`frontdoor.sh` aliases supported)
- **Live web dashboard:** `launch-dashboard.ps1` (Windows) or `npm` commands (Linux/macOS)

---

## Table of contents

1. [How the tool works](#1-how-the-tool-works)
2. [Technology stack & software reference](#2-technology-stack--software-reference)
3. [Prerequisites — installing R 4.6.0](#3-prerequisites--installing-r-460)
4. [Prerequisites — installing Pandoc & Quarto](#4-prerequisites--installing-pandoc--quarto)
5. [Prerequisites — installing Node.js (for Live Web Dashboard)](#5-prerequisites--installing-nodejs-for-live-web-dashboard)
6. [Getting the project & first run](#6-getting-the-project--first-run)
7. [Project layout](#7-project-layout)
8. [Configuration — `config.yaml`](#8-configuration--configyaml)
9. [CSV naming convention (mandatory)](#9-csv-naming-convention-mandatory)
10. [Registering results into the vault](#10-registering-results-into-the-vault)
11. [Generating a static HTML report](#11-generating-a-static-html-report)
12. [Running the Live Web Dashboard](#12-running-the-live-web-dashboard)
13. [Command-line (non-interactive) usage](#13-command-line-non-interactive-usage)
14. [Reading the report](#14-reading-the-report)
15. [SLA configuration](#15-sla-configuration)
16. [Chart visibility](#16-chart-visibility)
17. [AI Summary & Hybrid Architecture](#17-ai-summary--hybrid-architecture)
18. [Observations (editable notes in the report)](#18-observations-editable-notes-in-the-report)
19. [Maintaining the vault](#19-maintaining-the-vault)
20. [Transferring to another computer](#20-transferring-to-another-computer)
21. [Troubleshooting](#21-troubleshooting)
22. [Quick reference](#22-quick-reference)

---

## 1. How the tool works

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        MODE 1: Static HTML Report Engine                   │
└────────────────────────────────────────────────────────────────────────────┘
register.ps1 / launch.sh            interactive / CI launcher — locates Rscript
        │
        ▼
.engine/engine.R                  CLI dispatcher (--opMode = menu | register | report)
        │                         bootstraps 20 R packages into ./RLibs
        │                         resolves vault & output paths (local, absolute or UNC)
        │                         auto-detects Quarto CLI / Pandoc
        │
        ├── register ──► <database_path>                (DuckDB "vault": performance_history)
        │                Normalises columns into canonical JMeter schema
        │
        └── report   ──► .engine/dashboard.Rmd / .qmd   (Unified JMeter calculation engine)
                              ├── .engine/Dashboard/dash-executive-summary.Rmd
                              ├── .engine/Utilities/utils.R
                              └── .engine/Styles/{styles.css, cyber-slate.css}
                                        │
                                        ▼
                              <output_dir>/Performance_Report_<runs>_<timestamp>.html

┌────────────────────────────────────────────────────────────────────────────┐
│                        MODE 2: Live Web Dashboard Server                   │
└────────────────────────────────────────────────────────────────────────────┘
launch-dashboard.ps1              refreshes PATH, auto-installs npm deps, starts API + UI
        │
        ├──► dashboard-api/server.js   Express REST API (http://localhost:3001)
        │         ├── GET /api/health  (vault & driver status)
        │         └── GET /api/runs    (reads <database_path> via @duckdb/node-api,
        │                               falls back to dashboard-ui/public/vault-runs.json)
        │
        └──► dashboard-ui              React 18 + Vite + Tailwind + Recharts (http://localhost:5173)
                  └── proxies /api → :3001 (falls back to /vault-runs.json → mock data)

Optional offline bridge:
Rscript .engine/export_dashboard_data.R ──► dashboard-ui/public/vault-runs.json
```

The vault and the report folder can both live on a **shared network drive**, so a whole team
can register into and report from one central vault — see §8.

Three distinct workflows:

| Workflow | What it does | Repeatable? |
|---|---|---|
| **Register** | Reads every CSV in a folder, normalises columns into the canonical JMeter layout, and appends rows to the unified `performance_history` table under one **Run ID** | Once per Run ID (duplicates are rejected) |
| **Static Report** | Reads 1–2 registered runs back out of the vault (Current and optional Base) through a single unified calculation engine and renders a portable HTML dashboard | As often as you like |
| **Live Web Dashboard** | Serves live read-only DuckDB vault data over HTTP (`:3001`) into a real-time React/Recharts browser UI (`:5173`) with time-range slicing, endpoint drilldowns, and JSON export | Anytime |

Data is **only** read from the vault at report/dashboard time — the original CSVs are not needed again
once registered.

---

## 2. Technology stack & software reference

Use this table as your master reference when setting up Perf-Delta on a new computer.

### System software & runtimes

| Software | Role | Needed for | Recommended Version | Reference Machine Version |
|---|---|---|---|---|
| **R (64-bit `x64`)** | Runs `.engine/engine.R`, DuckDB ingestion, static HTML rendering, and `export_dashboard_data.R` | Static Reports & Vault | **4.6.0** (pinned) | `R 4.6.0 (2026-04-24 ucrt)` |
| **Pandoc** | Converts RMarkdown to self-contained HTML | Static Reports | **3.x** (latest) | `3.12.1` |
| **Quarto CLI** | Optional renderer auto-detected by `engine.R` for `.qmd` templates | Static Reports (optional) | **1.5+** (latest) | `1.10.19` |
| **Node.js & npm** | Runs `dashboard-api` Express server and `dashboard-ui` Vite dev/build server | Live Web Dashboard | **Node 20+ LTS** & npm 10+ | `Node v25.1.0` / `npm 11.6.2` |
| **Git** | Source control and cloning the repository | Both | Any recent 2.x | Installed |
| **PowerShell / Bash** | Runs `register.ps1`, `launch-dashboard.ps1`, `launch.sh` | Both | PowerShell 5.1+ / Bash | Built-in |
| **DuckDB** | Embedded analytical SQL vault (`Data/Performance_Vault.db`) | Both | Embedded via R `duckdb` & `@duckdb/node-api` (no standalone DB server required) | Embedded |

### Application libraries & frameworks

| Layer | Key Packages / Frameworks | Managed By |
|---|---|---|
| **R Static Engine** (`.engine/engine.R`) | `DBI`, `duckdb`, `vroom`, `dplyr`, `tidyr`, `purrr`, `readr`, `lubridate`, `stringr`, `scales`, `yaml`, `jsonlite`, `httr`, `knitr`, `rmarkdown`, `flexdashboard`, `htmltools`, `here`, `rlang`, `tools` | Auto-bootstrapped into `./RLibs` |
| **Live API Server** (`dashboard-api/`) | **Express** (`^4.21.2`), **@duckdb/node-api** (`^1.2.1-alpha.17`), **cors** (`^2.8.5`), **js-yaml** (`^4.1.0`) — ES Modules (`"type": "module"`) | `npm install` in `dashboard-api/` |
| **Live Web UI** (`dashboard-ui/`) | **React** (`^18.3.1`), **TypeScript** (`^5.6.3`), **Vite** (`^5.4.11`), **Tailwind CSS** (`^3.4.15`) + PostCSS/Autoprefixer, **Recharts** (`^2.13.3`), **Lucide React** (`^0.460.0`) | `npm install` in `dashboard-ui/` |

---

## 3. Prerequisites — installing R 4.6.0

The tool is built and validated against **R 4.6.0**. Newer 4.6.x point releases normally work,
but pin 4.6.0 if you want an environment identical to the reference one.

> On Windows the launcher auto-detects the **latest** R version found under
> `C:\Program Files\R\...\x64\Rscript.exe`. If you keep several versions installed, the newest
> one wins — uninstall newer versions (or put the R 4.6.0 `bin\x64` folder first on `PATH` and
> remove `C:\Program Files\R`) if you must force 4.6.0.

### Windows (primary supported platform)

1. Download the installer:
   <https://cran.r-project.org/bin/windows/base/old/4.6.0/R-4.6.0-win.exe>
   (the “old” folder is normal — it simply means a newer point release exists).
2. Run it as a user who can write to `C:\Program Files`.
3. Accept the defaults, in particular:
   - install destination `C:\Program Files\R\R-4.6.0`
   - **64-bit user installation** (the `x64` files are required — the launcher only looks for
     `Rscript.exe` under an `x64` folder)
   - leave “Save version number in registry” ticked
4. Verify from a **new** PowerShell window:

   ```powershell
   & "C:\Program Files\R\R-4.6.0\bin\x64\Rscript.exe" -e "R.version.string"
   # [1] "R version 4.6.0 ..."
   ```

   Adding R to `PATH` is optional — `frontdoor.ps1` finds it either way — but convenient:

   ```powershell
   [Environment]::SetEnvironmentVariable(
     "Path", $env:Path + ";C:\Program Files\R\R-4.6.0\bin\x64", "User")
   ```

**Rtools is not required.** `engine.R` installs packages with `type = "binary"` from
`cran.rstudio.com`, so nothing is compiled from source on Windows.

### macOS

```bash
# Apple silicon
curl -LO https://cran.r-project.org/bin/macosx/sonoma-arm64/base/R-4.6.0-arm64.pkg
sudo installer -pkg R-4.6.0-arm64.pkg -target /
# Intel: use https://cran.r-project.org/bin/macosx/big-sur-x86_64/base/R-4.6.0-x86_64.pkg
Rscript -e "R.version.string"
```

### Linux (Ubuntu/Debian, via the CRAN apt repo)

```bash
sudo apt-get update && sudo apt-get install -y --no-install-recommends \
     software-properties-common dirmngr gnupg curl
curl -fsSL https://cloud.r-project.org/bin/linux/ubuntu/marutter_pubkey.asc \
  | sudo tee /etc/apt/trusted.gpg.d/cran_ubuntu_key.asc
sudo add-apt-repository \
  "deb https://cloud.r-project.org/bin/linux/ubuntu $(lsb_release -cs)-cran40/"
sudo apt-get update && sudo apt-get install -y r-base r-base-dev
Rscript -e "R.version.string"
```

The apt repo tracks the newest release. To pin exactly 4.6.0, either use
[`rig`](https://github.com/r-lib/rig) (`rig add 4.6.0`) or build from source:
<https://cran.r-project.org/src/base/R-4/R-4.6.0.tar.gz>.

On Linux, R packages are compiled from source, so install the usual build headers first:

```bash
sudo apt-get install -y build-essential libcurl4-openssl-dev libssl-dev libxml2-dev \
     libfontconfig1-dev libharfbuzz-dev libfribidi-dev libfreetype6-dev \
     libpng-dev libtiff5-dev libjpeg-dev
```

---

## 4. Prerequisites — installing Pandoc & Quarto

`rmarkdown` shells out to **Pandoc** to build the static HTML report. Without it, rendering fails with
`pandoc version 1.12.3 or higher is required and was not found`. Install the **latest 3.x** release
(validated on `3.12.1`) system-wide — do not rely on the copy bundled with RStudio,
because the engine runs through `Rscript`, not RStudio.

### Windows

Installer: <https://github.com/jgm/pandoc/releases/latest> → `pandoc-<version>-windows-x86_64.msi`

```powershell
winget install --id JohnMacFarlane.Pandoc -e      # or run the .msi manually
```

Close and reopen PowerShell, then verify:

```powershell
pandoc --version      # e.g. pandoc 3.12.1
```

### macOS

```bash
brew install pandoc && pandoc --version
```

### Linux

```bash
# Latest .deb straight from GitHub (apt's version is often too old)
# Replace <version> with the latest release tag from https://github.com/jgm/pandoc/releases/latest
curl -LO https://github.com/jgm/pandoc/releases/download/3.12.1/pandoc-3.12.1-1-amd64.deb
sudo dpkg -i pandoc-3.12.1-1-amd64.deb
pandoc --version
```

### Confirming R can see Pandoc

```bash
Rscript -e "rmarkdown::pandoc_available(); rmarkdown::pandoc_version()"
```

If `pandoc --version` works in the shell but R cannot find it, point R at the folder
(the directory, not the executable):

```powershell
setx RSTUDIO_PANDOC "C:\Program Files\Pandoc"
```

`engine.R` also honours a **portable copy** at `RLibs/tools/pandoc/` — drop the extracted
pandoc binaries there and the engine uses them automatically without touching system `PATH`.
This is the recommended trick on locked-down machines where you cannot install software.

### Quarto CLI (optional)

`.engine/engine.R` also auto-detects **Quarto CLI** (validated on `1.10.19`) if you render `.qmd` templates. Install from <https://quarto.org/docs/get-started/> or via `winget install --id Posit.Quarto -e` (Windows) / `brew install --cask quarto` (macOS). If Quarto is not installed, `engine.R` uses RMarkdown + Pandoc automatically.

---

## 5. Prerequisites — installing Node.js (for Live Web Dashboard)

Required **only** if you want to run the **Live Web Dashboard Server** (`launch-dashboard.ps1`, `dashboard-api`, and `dashboard-ui`). Install **Node.js 20+ LTS** (includes `npm`; validated on Node `v25.1.0` / npm `11.6.2`).

### Windows

Installer: <https://nodejs.org/> (choose the **LTS** `.msi`), or via `winget`:

```powershell
winget install --id OpenJS.NodeJS.LTS -e
```

Close and reopen PowerShell, then verify:

```powershell
node -v     # v20.x+ (reference: v25.1.0)
npm -v      # 10.x+  (reference: 11.6.2)
```

*(Note: `launch-dashboard.ps1` automatically refreshes Windows `PATH` and checks `C:\Program Files\nodejs\` if Node was just installed.)*

### macOS

```bash
brew install node
node -v && npm -v
```

### Linux (Ubuntu/Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v && npm -v
```

---

## 6. Getting the project & first run

```bash
git clone https://github.com/rlaudeplanit/perf-delta.git
cd perf-delta
```

Then open `config.yaml` and check `database_path` and `output_dir` — the defaults are
`Data/Performance_Vault.db` and `Reports`, or you can point them at a shared network drive (see §8).

**Windows (Static Report & Vault Registration):** right-click `register.ps1` → *Run with PowerShell*, or from a PowerShell prompt
opened in the project root:

```powershell
cd C:\Tools\perf-delta
powershell -ExecutionPolicy Bypass -File .\register.ps1
```
*(Note: `frontdoor.ps1` is retained as a backwards-compatible alias.)*

**Windows (Live Web Dashboard Server):**

```powershell
cd C:\Tools\perf-delta
powershell -ExecutionPolicy Bypass -File .\launch-dashboard.ps1
```

**Linux/macOS (Static Report & Vault Registration):**

```bash
chmod +x launch.sh      # first time only
./launch.sh
```
*(Note: `frontdoor.sh` is retained as a backwards-compatible alias.)*

> ⚠️ **Always launch from the project root.** `engine.R` reads `config.yaml` from the *current
> working directory*, so running `Rscript .engine/engine.R` from elsewhere fails with
> `cannot open file 'config.yaml'`.

### First-run package bootstrap

- **R Engine (`register.ps1` / `launch.sh`):** On first launch `.engine/engine.R` creates `RLibs/` and installs any missing packages into it (the global R library is left untouched). Expect **2–5 minutes** the first time; later runs start in seconds. Core packages installed (20 total):

  ```
  yaml DBI duckdb lubridate readr knitr here rmarkdown flexdashboard
  rlang purrr tidyr scales dplyr vroom tools stringr htmltools jsonlite httr
  ```

- **Live Web Dashboard (`launch-dashboard.ps1`):** On first launch, if `dashboard-api/node_modules` or `dashboard-ui/node_modules` is missing, the launcher automatically runs `npm install` in each folder.

Behind a corporate proxy, set `http_proxy` / `https_proxy` (and `npm config set proxy ...`) before the first run, or copy a pre-populated `RLibs/` folder from a machine that already worked.

---

## 7. Project layout

```
perf-delta/
├── register.ps1                    # Primary Windows interactive / CI launcher (frontdoor.ps1 alias)
├── launch.sh                     # Primary Linux/macOS interactive / CI launcher (frontdoor.sh alias)
├── launch-dashboard.ps1          # Windows launcher for Live Web Dashboard (API :3001 + UI :5173)
├── config.yaml                   # Main configuration (version, theme, paths, timezone, SLA, exclusions, AI)
├── secrets.yaml                  # (you create this) Amplify API token — git-ignored
├── perf-delta.Rproj              # RStudio project; also the `here::here()` root anchor
├── perf-report-server.code-workspace # VS Code workspace file
├── Evidence/                     # (optional) Drop-zone for manual infra screenshots (<run_id>/*.png)
├── .engine/
│   ├── engine.R                  # Primary CLI dispatcher, Quarto/Rmd orchestrator
│   ├── dashboard.Rmd             # Master Flexdashboard / RMarkdown template
│   ├── dashboard.qmd             # Master Quarto engine template
│   ├── export_dashboard_data.R   # Non-destructive DuckDB → JSON exporter for offline UI fallback
│   ├── Dashboard/
│   │   └── dash-executive-summary.Rmd # High-density single-viewport dashboard & interactive modals
│   ├── Utilities/
│   │   └── utils.R               # Metrics, SLA, & hybrid AI calculation helpers
│   └── Styles/
│       ├── styles.css            # Light/dark viewport layout & modal styling
│       ├── cyber-slate.css       # Cyber-Slate dark theme stylesheet for static HTML reports
│       └── Planit_Icon_*.png     # Report brand icons
├── dashboard-api/                # Live DuckDB REST API (Node.js + Express + @duckdb/node-api)
│   ├── server.js                 # HTTP server (:3001) serving /api/health and /api/runs
│   └── package.json              # API dependencies (node_modules is git-ignored)
├── dashboard-ui/                 # Live Cyber-Slate Web App (React 18 + TypeScript + Vite + Tailwind + Recharts)
│   ├── index.html, vite.config.ts, tailwind.config.js, tsconfig.json
│   ├── package.json              # UI dependencies (node_modules is git-ignored)
│   ├── public/vault-runs.json    # Cached JSON fallback snapshot of vault runs
│   └── src/
│       ├── App.tsx               # Main dashboard shell, API loader, live-tick simulation & JSON export
│       ├── components/           # TopNavBar, KpiSummaryRow, TelemetryChartsRow, EndpointAndErrorsSection
│       ├── data/                 # mockPerformanceData.ts (built-in stress simulation fallback)
│       └── types/                # performance.ts TypeScript interfaces
├── SLA/performance-sla.yaml      # SLA thresholds & response time targets
├── RLibs/                        # Local isolated R package cache (git-ignored)
├── Data/Performance_Vault.db     # Default local DuckDB vault (git-ignored; may point elsewhere)
├── RawResults/                   # Suggested drop-zone for input CSVs (git-ignored)
├── Reports/                      # Default local HTML output (git-ignored; may point elsewhere)
└── check_db_head.R, check_rows.R, delete_by_runid.R   # vault maintenance helpers
```

`here::here()` resolves the project root from the `.Rproj` file (or a `.here` anchor file if
you add one). Keep the folder structure intact — child `.Rmd` files are referenced by relative
path from the root.

---

## 8. Configuration — `config.yaml`

| Key | Purpose | Notes |
|---|---|---|
| `params.project` | Report title project name | Leave `""` to auto-detect from the CSV filename / vault |
| `params.version` | Report version displayed in navbar | e.g. `"v2.0"`, `"1.0.1"` |
| `params.report_theme` | Static HTML report theme | `"cyber-slate"` (dark, default) or `"light"` |
| `rmd_template` | Path to the master template | **Do not change** (`.engine/dashboard.Rmd`) |
| `output_dir` | Where HTML reports go | Default `"Reports"`. Relative, absolute or UNC — see “Shared / network locations” below |
| `database_path` | DuckDB vault file | Default `"Data/Performance_Vault.db"`. Relative, absolute or UNC — see “Shared / network locations” below |
| `sla_file_path` | SLA definitions | Default `"SLA/performance-sla.yaml"`. Missing ⇒ SLA evaluation skipped |
| `evidence_dir` | Manual CPU/Memory screenshot directory | Optional folder (e.g. `Evidence/100002/*.png`) surfaced in Infrastructure modal |
| `ai_summary_enabled` | `"true"` / `"false"` | Toggles Amplify AI generation (with automatic deterministic fallback) |
| `ai_url`, `ai_model_id` | Amplify completion endpoint & model | Change only if your team uses a custom model/endpoint |
| `ai_prompt_template` | Prompt template for AI executive summary | Supports `{app_names}`, `{vu_actual}`, `{throughput}`, `{error_rate}`, `{latency}`, etc. |
| `timezone.source_timezone` | Raw timestamp timezone in DB | Default `"UTC"` (JMeter epoch is always UTC) |
| `timezone.display_timezone` | Display timezone for report dates/times | IANA name e.g. `"Pacific/Auckland"`, or `"local"` / `""` for machine timezone |
| `timezone.show_timezone_abbr` | Append timezone abbreviation | `true` / `false` (e.g. `NZDT`, `NZST`, `UTC`) |
| `label_exclusions` | List of labels excluded globally | Pacing samplers, think time, or debug samplers excluded before analysis (honoured by both Static Engine and Live API) |
| `tool_type` | Canonical engine | Always `"jmeter"` (canonical schema & calculation engine) |
| `tool_mappings.jmeter` / `.neoload` | Source-CSV column → canonical JMeter mapping | Maps external tool CSV headers to canonical JMeter columns at ingestion |
| `workload_profile.ramp_up` / `.steady_state` / `.ramp_down` | Workload phase overrides | Optional manual overrides; leave `""` to calculate dynamically from telemetry |
| `bin_size` | Time-bucket size in seconds for per-minute charts | Default `60` |
| `user_action_filter` | Regex of transactions to include | Default `.*` (all) |

> ⚠️ **The shipped `config.yaml` contains UNC placeholders** for `output_dir` and
> `database_path` (`//<host>/shared/Performance-JMeter/...`). Replace `<host>` with your real
> file server, or set them back to the local defaults `Reports` and
> `Data/Performance_Vault.db`, before first use — otherwise the first run fails trying to
> create a folder on a host that doesn't exist.

### Shared / network locations

`database_path` and `output_dir` are each resolved the same way:

| Value looks like | Example | Resolved to |
|---|---|---|
| UNC path | `//fileserver/shared/Performance-JMeter/database/Performance_Vault.db` | Used as-is (normalised to forward slashes) |
| Absolute Windows path | `D:/PerfData/Performance_Vault.db` | Used as-is |
| Absolute Linux/macOS path | `/mnt/perf/Performance_Vault.db` | Used as-is |
| Anything else (relative) | `Data/Performance_Vault.db` | Relative to the **project root** |

Both resolved paths are echoed at startup so you can confirm what was picked up:

```
>>> [DB] Vault path resolved to: //fileserver/shared/Performance-JMeter/database/Performance_Vault.db
>>> [REPORT] Output directory resolved to: //fileserver/shared/Performance-JMeter/reports
```

Pointing `database_path` at a share gives the whole team one central vault — sequence numbers,
duplicate-Run-ID protection and run history are then shared. Caveats:

- DuckDB takes an **exclusive write lock** during registration, so only one person can register
  at a time; reports (read-only) are unaffected.
- The account running the tool needs read/write on the share, and the share must be reachable
  by that exact UNC name (a mapped drive letter also works: `Z:/Performance-JMeter/...`).
- Registering over a slow VPN link is much slower than registering locally and copying the
  vault afterwards.

Report output precedence is `--outputFolder` → `output_dir` in `config.yaml` → `Reports/`.

### Column mappings — canonical JMeter schema normalization

Perf-Delta standardises on **Apache JMeter as the single canonical schema** across the entire pipeline. The registration step selects the source columns declared under the tool's mapping in `config.yaml` and normalises them into standard JMeter columns before writing to the unified `performance_history` table:

| Canonical JMeter Field | JMeter Source Header | NeoLoad Source Header | Normalization Behavior |
|---|---|---|---|
| `timestamp` | `timeStamp` (epoch ms) | `Time` / `Date` | Auto-detects epoch ms, epoch seconds, or ISO-8601 text (`YYYY-MM-DDTHH:MM:SS`) and stores as UTC `TIMESTAMP` |
| `elapsed` | `elapsed` | `Response time` / `Duration` | Numeric response duration in milliseconds |
| `label` | `label` | `Element` / `User Path Element` | Transaction or sampler name |
| `success` | `success` | `Success` | Normalised to boolean (`TRUE` / `FALSE`) |
| `responseCode` | `responseCode` | *(synthesised)* | Numeric HTTP code (`200` on success, `500` or error code on failure) |
| `responseMessage` | `responseMessage` | *(synthesised)* | Text status message (`OK` on success, failure description on error) |
| `thread_group` | *(derived)* | `User Path` | JMeter thread group name (extracted from `threadName`) or NeoLoad `User Path` |
| `threadName` | `threadName` | `Virtual User ID` | Standardised format: `<ThreadGroup> <VirtualUserID>` |
| `user_index` | *(derived)* | *(derived)* | Integer index of the virtual user for concurrency calculation |
| `allThreads` / `grpThreads` | `allThreads` / `grpThreads` | *(synthesised)* | Instantaneous thread count; used alongside distinct thread calculations |
| `dataType`, `bytes`, `sentBytes`, `Latency`, `Connect`, `IdleTime` | Native columns | *(defaults/elapsed)* | Populated with standard defaults if omitted by external tools |

Because all tools are transformed into the canonical JMeter layout at registration, downstream reporting, SQL queries, SLA evaluations, and executive charts operate on one single unified data model without tool-specific conditional branches.

---

## 9. CSV naming convention (mandatory)

Every CSV in the folder you register **must** be named:

```
<ProjectName>_<TestType>_<AppName>_<BuildId>_<Timestamp>.csv
```

Example:

```
ProjectXYZ_Sanity_DemoApp_123456_20260809-1027.csv
```

| Segment | Becomes | Notes |
|---|---|---|
| `ProjectName` | `project_name` | Overridden by `params.project` in `config.yaml` if set |
| `TestType` | `test_name` | e.g. `Sanity`, `Load`, `Soak` |
| `AppName` | `app_name` | **Per file** — several apps can share one run |
| `BuildId` | `run_id` | Must be **unique across the vault** and **identical for every CSV in the folder** |
| `Timestamp` | metadata | Free-form, e.g. `20260809-1027` |

Rules enforced by the engine:

- fewer than 5 underscore-separated segments ⇒ hard error naming the offending file;
- mixed `BuildId`s within one folder ⇒ hard error (register them as separate runs);
- a `BuildId` already in the vault ⇒ registration aborts (no silent duplicates).

Avoid underscores *inside* a segment — `My_Project_Sanity_App_123_ts.csv` parses as
project `My`, test `Project`, app `Sanity`.

> ℹ️ Older documentation described a `<Project>\<Test>\<Build>\` **folder** structure. That is
> obsolete: the current engine derives everything from the **filename**, and the folder path
> itself is irrelevant.

---

## 10. Registering results into the vault

1. Put all CSVs for one build in a single folder (e.g. `RawResults\ClientX\build-042\`).
2. Launch the front door → choose **2. Register Data**.
3. Choose the tool type — **1. JMeter** (default) or **2. NeoLoad**.
4. Paste the **full path** to the folder containing the CSVs.

The engine stitches the CSVs with `vroom`, renames the columns per the mapping, adds
`run_id`, `project_name`, `test_name`, `app_name`, `csv_filename`, `upload_time`, a derived
`thread_group` / `user_index`, and an auto-incrementing **`sequence_num`** (1, 2, 3 …) so you
can later refer to a run by a short number instead of the full Run ID.

Rows land in the unified **`performance_history`** table in DuckDB. Because all incoming test data is normalized into the canonical JMeter schema at ingestion, any registered runs across the vault can be reported on or compared directly against one another.

Successful output looks like:

```
>>> [REGISTER] project=ProjectXYZ | test=Sanity | unique apps=2 | run_id=123456
>>> [REGISTER] sequence_num=3
>>> [SUCCESS] Registered as Run ID '123456' (Sequence #3) in performance_history
```

---

## 11. Generating a static HTML report

1. Launch the launcher (`register.ps1` or `launch.sh`) → choose **1. Generate Report** (or just press Enter).
2. The engine prints the 10 most recent runs across the vault from `performance_history`:

   ```
   --------------- Recent Runs in Vault --------------
   [#4] Run ID: 1338-MarinaSands | Project: MSD | Test: Sociability | Registered: 2026-10-20 01:12:10
   [#3] Run ID: 750-Tarawera     | Project: MSD | Test: Sociability | Registered: 2026-10-20 01:11:33
   [#2] Run ID: 10003            | Project: ECAN | Test: PeakLoad   | Registered: 2026-10-28 19:45:09
   [#1] Run ID: 10001            | Project: ECAN | Test: PeakLoad   | Registered: 2026-10-28 19:43:19
   -----------------------------------------------------------
   ```

3. Enter the two run inputs — either the **Run ID** (e.g. `10003`) or the **Sequence #** (e.g. `2`):
   - **1. Current Run ID / Sequence # (Required):** The active performance test run under evaluation.
   - **2. Baseline Run ID / Sequence # (Optional):** The reference benchmark run to compare against. Press Enter to generate a standalone single-run report.
4. Optionally enter a **transaction label filter** — one or more comma-separated keywords.
   Each keyword is a *contains* match (case-sensitive, not a regex) and the keywords are
   OR-ed together, so `Login, Checkout` keeps every transaction whose label contains either
   word (`User_Login_Flow`, `Guest_Checkout`, …). Leave blank for all.

   The filter is pushed down into DuckDB as `label LIKE '%keyword%' OR …`, so it is applied
   before the data leaves the vault — a narrow filter makes big runs render much faster.
   If **nothing** matches, the render stops with an explicit error (see §21) instead of
   producing an empty report.

Output (in `output_dir`, `Reports/` by default):

```
Performance_Report_10001_vs_10003_20261029_1710.html
```

Single-run reports are named `Performance_Report_<runId>_<timestamp>.html`. The file is
fully self-contained — email it, archive it, open it in any browser, no server required.

---

## 12. Running the Live Web Dashboard

Alongside static HTML reports, Perf-Delta includes a live local web application (**Cyber-Slate UI**) backed by a **Node.js + Express + DuckDB REST API**. It queries the same `Data/Performance_Vault.db` vault configured in `config.yaml` (in read-only mode) and applies the same `label_exclusions` and `SLA/performance-sla.yaml` thresholds.

### Starting on Windows (one-command launcher)

From the project root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\launch-dashboard.ps1
```

What `launch-dashboard.ps1` does:
1. Refreshes Windows `PATH` (and checks `C:\Program Files\nodejs\`) so Node.js/npm is detected.
2. Automatically runs `npm install` in `dashboard-api/` and `dashboard-ui/` if `node_modules/` is missing.
3. Starts the live DuckDB API (`node server.js`) on **`http://localhost:3001`**.
4. Starts the Vite React dev server (`npm run dev`) on **`http://localhost:5173`** (with `/api` proxied to `:3001`).
5. Cleanly stops the API background process when you exit (`Ctrl+C`).

Open **`http://localhost:5173`** in your browser.

### Starting on Linux / macOS (manual two-terminal launch)

```bash
# Terminal 1 — Live DuckDB REST API (:3001)
cd dashboard-api
npm install          # first time only
npm start

# Terminal 2 — React + Vite UI (:5173)
cd dashboard-ui
npm install          # first time only
npm run dev
```

To change the API port, set `DASHBOARD_API_PORT` (default `3001`) and update the proxy target in `dashboard-ui/vite.config.ts`.

### API endpoints & 3-tier data fallback

| Endpoint | Purpose |
|---|---|
| `GET http://localhost:3001/api/health` | Returns JSON status: `duckdbDriverLoaded`, `vaultExists`, `vaultFile`, `timestamp` |
| `GET http://localhost:3001/api/runs` | Queries the 10 most recent runs from DuckDB (time series, endpoints, HTTP errors, assertion failures) |

The UI automatically resolves data in three tiers so it never crashes even without a live vault:
1. **Live DuckDB API (`/api/runs`)** — Queries `Data/Performance_Vault.db` directly via `@duckdb/node-api`.
2. **Cached JSON Snapshot (`dashboard-ui/public/vault-runs.json`)** — Used automatically if `@duckdb/node-api` cannot load, the vault file is missing, or `dashboard-api` is not running. Refresh this snapshot anytime from R:

   ```bash
   Rscript .engine/export_dashboard_data.R
   ```

3. **Built-in Mock Stress Simulation** — Built-in sample runs in `dashboard-ui/src/data/mockPerformanceData.ts` so the UI can always be previewed on a fresh machine.

### Production build (UI)

```bash
cd dashboard-ui
npm run build        # runs tsc && vite build → outputs to dashboard-ui/dist/
npm run preview      # previews the production bundle locally
```

---

## 13. Command-line (non-interactive) usage

Handy for CI/CD pipelines. Run these **from the project root**.

```bash
# List recent runs across the vault
Rscript .engine/engine.R --opMode=menu

# Register a folder of CSVs (specify active_tool to select column mapping from config.yaml)
Rscript .engine/engine.R --opMode=register \
        --rawResultsFolder="/full/path/to/build-042" --active_tool=jmeter

# Register NeoLoad CSVs (automatically normalises into canonical JMeter schema)
Rscript .engine/engine.R --opMode=register \
        --rawResultsFolder="/full/path/to/neoload-build" --active_tool=neoload

# Compare Current run vs Baseline run (tool-agnostic execution)
Rscript .engine/engine.R --opMode=report \
        --current=2 --base=1 --labelFilterParam="TRX"

# Standalone single-run report into a custom output folder
Rscript .engine/engine.R --opMode=report --current=123456 \
        --outputFolder="/mnt/share/perf-reports"
```

| Flag | Default | Meaning |
|---|---|---|
| `--opMode` | `report` | `menu`, `register` or `report` |
| `--rawResultsFolder` | `NONE` | Folder of CSVs (register mode) |
| `--current` | `NONE` | Current candidate Run ID or sequence number (Required for report mode) |
| `--base` (or `--baseline`) | `NONE` | Baseline benchmark Run ID or sequence number (Optional for standalone) |
| `--comp1` / `--comp2` | `NONE` | Legacy aliases: `--comp1` (base) and `--comp2` (current) |
| `--active_tool` | `jmeter` | In `register` mode, selects the mapping block in `config.yaml` (`jmeter` / `neoload`). Optional for `report` mode. |
| `--outputFolder` | `NONE` → `output_dir` from `config.yaml` → `Reports/` | Output directory; local, absolute or UNC, created if missing |
| `--labelFilterParam` | `NONE` | Comma-separated contains-match keywords, OR-ed together |
| `--ci` / `--fail-on-sla` | `FALSE` | Headless CI gate mode — exits non-zero if SLA evaluation fails |

Windows equivalents use the same flags (`engine.R` or `register.ps1` non-interactive parameters):

```powershell
& "C:\Program Files\R\R-4.6.0\bin\x64\Rscript.exe" --vanilla .engine\engine.R `
  "--opMode=report" "--current=2" "--base=1" "--labelFilterParam=NONE"
```

Exit codes: `0` on success, `1` when registration is rejected (no CSVs found, duplicate Run ID) or when `--ci` / `--fail-on-sla` detects an SLA failure.
Fatal validation problems (bad filename, missing folder, unknown run) raise an R error.

---

## 14. Reading the report

Perf-Delta v2.0 renders a **single-viewport (100vh) High-Density Executive Performance Dashboard** designed for executive briefings, engineering triage, and release sign-off. Everything is visible at a glance without page scrolling, backed by instant zero-lag modal drilldowns.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ ⚡ Report Title Navbar (Project, Scenario, v2.0 Badge, Date, Theme Toggle: ☀️/🌙)      │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Consolidated Status Bar: [✅ PASS / ❌ FAIL] | Run #100002 vs #100001 | Meta Info   │
├────────────────────────────────────────┬───────────────────────────────────────────────┤
│ ⚡ Executive Summary & Assessment       │ 2x2 Metric KPI Strip                          │
│ ├── Narrative (2 Paragraphs)           │ ├── Max Virtual Users  ├── Apps Passed TPS    │
│ └── 📋 Next Steps (3 Action Items)     │ ├── Scenarios Met RT   ├── Passed Error SLA   │
├────────────────────────────────────────┴───────────────────────────────────────────────┤
│ 2. 🏥 Application Health & Baseline Matrix (Requests, TPS, RT, Error %, SLA vs Base)   │
├────────────────────────────────────────┬───────────────────────────────────────────────┤
│ 3. 🧭 Scenario Breakdown (App Filter)  │ 4. 🔥 Top Response Time Breaches (Micro-bars) │
├────────────────────────────────────────┼───────────────────────────────────────────────┤
│ 5. ⚠️ Top Error Contributors (Pareto)  │ 6. ⚖️ Current vs Baseline Comparison Scorecard │
└────────────────────────────────────────┴───────────────────────────────────────────────┘
```

### Zone 1: Executive Assessment & 2x2 KPI Strip
- **Consolidated Top Status Bar** — Overall PASS/FAIL release gate verdict, Run IDs, start/end timestamps, test duration, peak concurrency, and optional `🖥 Infrastructure 🔍` button.
- **Executive Summary Callout (2-Column)**:
  - **Left (Narrative Synthesis)**: Paragraph 1 covers workload profile (duration, dynamically calculated ramp-up and steady state, max concurrent users, throughput, error rate, and baseline P95 latency improvement/regression). Workload phases are calculated dynamically from test telemetry and active thread boundaries across all application workloads. Paragraph 2 details SLA release criteria compliance, breach counts, worst-performing transaction vs SLA threshold, and impacted flow clusters.
  - **Right (📋 Next Steps)**: Dedicated action plan box with 3 targeted performance engineering recommendations (steady-state scoping validation, APM/server log triage for top bottlenecks, and re-test verification).
- **2x2 KPI Strip**:
  - `Max Virtual Users`: achieved concurrency vs target threshold.
  - `Apps Passed TPS SLA`: application count passing throughput gate with aggregate TPS.
  - `Scenarios Met RT SLA`: scenario count passing transaction-level response time criteria with current P95 ms.
  - `Scenarios Passed Error SLA`: scenarios compliant with error rate criteria.

### Zone 2: Application Health & Baseline Matrix
- Comprehensive multi-app scorecard comparing Current vs Baseline for Total Requests, Average Throughput, P95/P90 Response Time, Error Rate %, and Scenarios Met RT SLA.
- Inline delta badges (`▲` / `▼`) highlight performance trends; clicking `SLA Status 🔍` or `Scenarios Met RT SLA 🔍` opens instant modal deep-dives.

### Zone 3: Failure Analysis Grids
- **Scenario Breakdown**:
  - Per-scenario health table with interactive **App Filter Pills** (`All`, `App1`, `App2`) for multi-application runs.
  - Shows requests, throughput, scenario P95, transaction SLA compliance (`X of Y`), and error rate.
  - *Note:* In accordance with performance testing standards, SLA pass/fail status is rigorously evaluated against transaction-level thresholds, decoupling aggregate scenario P95 values from false SLA failures.
- **Top Response Time Breaches**:
  - Ranked list of the worst-performing transactions vs threshold with inline severity micro-bars, actual response time, SLA threshold, and % breach. Clicking any row opens the transaction drilldown modal.

### Zone 4: Error Pareto & Baseline Scorecard
- **Top Error Contributors**: Lists the highest error-producing transactions with error counts and proportional share micro-bars.
- **Current vs Baseline Comparison**: Metric-by-metric scorecard comparing Max Users, Aggregate Throughput, Error Rate %, P95 Response Time, TPS Pass Rate, Error SLA Pass Rate, and RT SLA Pass Rate.

### Interactive Zero-Lag Modals
Clicking any search icon (`🔍`) or navigation badge opens a responsive dialog without page reload:
1. **Executive Charts Modal (`📈 Executive Charts 🔍` / `📈 Compare vs Base` / `⭐ Apdex Experience`)**: Lightweight pure-SVG multi-view performance visualizer with application filter pills, **adaptive time-series bucketing** (`1s` / `10s` / `60s` intervals for short or long runs), and a **Copy Image** button on each chart card (copies as PNG to clipboard or downloads PNG):
   - **Executive 2x2 Grid**: 4 key performance cards (Response Time Timeline, Throughput Profile with VU Backdrop, Apdex User Experience & Performance Index, and Error Spike Timeline & Top 5 Pareto Share).
   - **Latency & Load Timelines**: Minute-by-minute response time and throughput vs baseline.
   - **Apdex User Experience & Performance Index**: Industry-standard Apdex rating (0.00 to 1.00) measuring user satisfaction evaluated against per-transaction target thresholds ($T$). Features horizontal stacked experience zones (🟢 Satisfied $\le T$, 🟡 Tolerating $T-4T$, 🔴 Frustrated $>4T$ or Error), Apdex score badge with standard rating (`Excellent`, `Good`, `Fair`, `Poor`, `Unacceptable`), run-over-run comparison, and an educational explainer box directly on the card with instant links to the Glossary modal. File uploads/downloads and custom endpoints are evaluated against their own specific SLA targets without false penalties.
   - **Scenario vs Baseline**: Transaction-stacked horizontal duration bars with drill-down to individual transactions.
   - **Error Timeline & Pareto**: Errors/min spikes and cumulative Pareto share distribution.
2. **SLA Evaluation Modal**: Detailed rule-by-rule audit for all run-level and application thresholds.
3. **Scenario Health Details Modal**: Deep breakdown per scenario and transaction flow.
4. **Transaction RT Breakdown Modal**: Complete transaction-level table with search, sorting, and delta vs baseline.
5. **HTTP Error Breakdown Modal**: Response code distribution and error payload messages.
6. **Infrastructure Evidence Modal**: Displays manual CPU, memory, and disk screenshots placed in `Evidence/<run_id>/`.
7. **Glossary & Methodology Modal**: Clear definitions of percentile calculations, formulas, and evaluation rules.

---

## 15. SLA configuration

Default file: `SLA/performance-sla.yaml` (path set by `sla_file_path`). Missing or blank ⇒ all
SLA logic is skipped and the report still renders.

### Run-level rules

```yaml
sla_rules:
  - metric: total_users          # total_users | error_rate | throughput
    label: "Virtual Users"
    operator: ">="               # <=  >=  <  >  ==
    threshold: 100
    description: "Optional free text"

  - metric: error_rate
    label: "Error Rate"
    operator: "<="
    threshold: 1.0
    unit: "%"

  - metric: throughput
    label: "Throughput"
    operator: ">="
    threshold: 10.0
    unit: "req/s"
```

Each rule is evaluated **per run**; a run passes overall only when every rule passes.

### Per-transaction response time SLA

```yaml
response_time_sla:
  metric: p95                  # p90 or p95
  unit: "ms"
  default_threshold: 3000      # applied to any transaction not overridden
  tolerance_pct: 5             # actual may exceed threshold by 5% and still pass
  overrides:
    - label: "Login"           # exact label match
      threshold: 1500
    - label: "Checkout"
      threshold: 5000
```

A transaction fails when `actual > threshold × (1 + tolerance_pct/100)`. Breaches are ranked by
`breach_pct` and surfaced in the Top Breaches card. Only list exceptions —
everything else inherits `default_threshold`.

---

## 16. Chart visibility

```yaml
charts:
  tpmVerticalStack: true
  rawScatterWebGL: false     # hides heavy charts if needed
```

Any key omitted from the block defaults to **shown**. Turning off heavy scatter charts is the quickest way to cut render time and HTML size on very large datasets.

---

## 17. AI Summary & Hybrid Architecture

Perf-Delta v2.0 features a **Hybrid Executive Summary Architecture** combining generative AI with a 100% reliable deterministic fallback engine:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Hybrid Generation Flow                          │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Check config.yaml (ai_summary_enabled) & secrets.yaml (token)       │
│                                                                        │
│ ┌───────────────────────────┐         ┌──────────────────────────────┐ │
│ │  Amplify AI LLM Engine    │         │  Deterministic Rule Engine   │ │
│ │  (REST API Completion)    │         │  (Native R Script in-memory) │ │
│ ├───────────────────────────┤         ├──────────────────────────────┤ │
│ │ • Context-rich prompt     │─(Fail)─>│ • 100% offline & instant     │ │
│ │ • Few-shot style guide    │         │ • Zero token / API dependency│ │
│ │ • Dynamic Next Steps      │         │ • Exact same metrics & logic │ │
│ └─────────────┬─────────────┘         └──────────────┬───────────────┘ │
│               └───────────────────────┬──────────────┘                 │
│                                       ▼                                │
│                Rich Executive Narrative + Next Steps                   │
│                                       │                                │
│                   Rendered in Executive Dashboard                      │
└────────────────────────────────────────────────────────────────────────┘
```

### Setup & Activation
Perf-Delta supports both **Amplify** and **Google Gemini** (auto-detected when `ai_url` contains `generativelanguage.googleapis.com`):

1. Create `secrets.yaml` in the project root (git-ignored, never commit it):

   ```yaml
   # For Amplify:
   amplify_token: "your-amplify-token-here"

   # Or for Google Gemini (alternatively set the GEMINI_API_KEY env var):
   gemini_api_key: "your-gemini-api-key-here"
   ```

2. Set `ai_summary_enabled: "true"` in `config.yaml` (and for Gemini, set `ai_url: "https://generativelanguage.googleapis.com/v1beta/models"` and `ai_model_id: "gemini-2.5-flash"`).
3. The engine sends aggregated run metrics (users, throughput, error rate, baseline delta %, per-journey breakdown, error breakdown, SLA breaches, top failing endpoints) to the completion endpoint (`ai_url` / `ai_model_id`).

### Automatic Deterministic Fallback
If any of the following occur:
- `secrets.yaml` is missing or the token has expired/unauthorized
- The machine is offline or behind a firewall blocking the API endpoint
- `ai_summary_enabled` is set to `"false"`
- The API call times out or returns an error

**The engine immediately and seamlessly falls back to the internal deterministic generator.**
- It computes and synthesizes the identical structured two-paragraph executive narrative and three tailored Next Steps directly from DuckDB metrics in memory.
- **Guarantee:** Reports **never break, never hang, and never display empty or missing summary boxes**.

---

## 18. Observations (editable notes in the report)

Every chart and the AI panel carry an **Observation** box that you can type into directly in the
rendered HTML.

- Supported syntax: `**bold**`, `_italic_`, `__underline__`, `==highlight==`, plus the special
  `==OVERALL PASSED==` / `==OVERALL FAILED==` badges.
- Toggle ✏️ Edit / 👁️ Preview per box. Drafts auto-save to browser `localStorage`.
- **💾 Save Observations File** writes `<report-name>_observations.js` — keep that file in the
  **same folder as the HTML** and the notes reload for anyone who opens the report (the HTML
  alone does not carry them).

---

## 19. Maintaining the vault

Run from the project root:

| Script | Purpose |
|---|---|
| `Rscript check_db_head.R` | Lists tables, row counts, column types and a sample row; also runs `VACUUM` |
| `Rscript check_rows.R` | Lists the distinct `csv_filename` / `app_name` pairs registered per table |
| `Rscript delete_by_runid.R` | Deletes one run and vacuums — **edit `target_run` and the table name inside the script first** |

Notes:

- DuckDB takes an exclusive lock: close RStudio/other R sessions before registering, otherwise
  you get `Could not set lock on file`.
- To start clean, simply delete the vault file pointed at by `database_path` — the next
  registration recreates it (sequence numbers restart at 1).
- The helper scripts read `database_path` from `config.yaml`, so they follow the vault to a
  shared drive automatically — except `delete_by_runid.R`, which has the path hard-coded to
  `Data/Performance_Vault.db`; edit it before running against a shared vault.
- The vault is git-ignored; back it up yourself if run history matters.

---

## 20. Transferring to another computer

Follow this checklist whenever moving Perf-Delta to a new workstation or laptop:

### 1. Install required software on the new computer

- [ ] **Git** — to clone the repository
- [ ] **R 4.6.0 (64-bit `x64`)** — required for vault registration and static HTML reports (see §3)
- [ ] **Pandoc 3.x (latest)** — required for RMarkdown HTML rendering (see §4)
- [ ] **Node.js 20+ LTS (includes `npm`)** — required for the Live Web Dashboard server (see §5)
- [ ] **Quarto CLI** *(optional)* — auto-detected for `.qmd` rendering (see §4)

*(No database server install is required — DuckDB is embedded in both R and Node.js.)*

### 2. Clone the repository

```bash
git clone https://github.com/rlaudeplanit/perf-delta.git
cd perf-delta
```

### 3. Copy git-ignored files from the old computer (if needed)

These files are intentionally **excluded from Git** (`.gitignore`). Copy them manually if you want to preserve your history, secrets, or offline caches:

| Path | Contains | Must copy? |
|---|---|---|
| `Data/Performance_Vault.db` | Your registered DuckDB test run history | **Yes** (unless using a shared network vault) |
| `secrets.yaml` | Amplify AI API token | Only if `ai_summary_enabled: "true"` |
| `Evidence/` | Manual CPU/memory screenshots per run | Only if you have saved evidence |
| `Reports/` & `RawResults/` | Previously generated HTML reports & raw CSVs | Optional (for archive) |
| `RLibs/` | Pre-installed R packages | Optional — speeds up setup on offline/proxy machines; otherwise auto-bootstraps |
| `dashboard-api/node_modules/` & `dashboard-ui/node_modules/` | Node.js dependencies | **Do not copy** — regenerate cleanly via `npm install` or `launch-dashboard.ps1` |

### 4. Bootstrap & verify on the new computer

```powershell
# 1. Verify software versions
& "C:\Program Files\R\R-4.6.0\bin\x64\Rscript.exe" -e "R.version.string"
pandoc --version
node -v
npm -v

# 2. Bootstrap RLibs and test static engine menu
powershell -ExecutionPolicy Bypass -File .\register.ps1

# 3. Bootstrap npm packages and launch Live Web Dashboard (:3001 API + :5173 UI)
powershell -ExecutionPolicy Bypass -File .\launch-dashboard.ps1
```

Once running, open `http://localhost:5173` and verify `http://localhost:3001/api/health` returns `"ok": true`.

---

## 21. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Rscript.exe not found` | R not installed, or installed without the 64-bit (`x64`) files. See §3 |
| `pandoc version 1.12.3 or higher is required and was not found` | Pandoc missing from `PATH`. Install it (§4), reopen the terminal, or set `RSTUDIO_PANDOC` / drop a portable copy in `RLibs/tools/pandoc` |
| `ERROR: Node.js (npm) is not installed or not on PATH` | Install Node.js 20+ LTS (§5), close and reopen PowerShell, and re-run `.\launch-dashboard.ps1` |
| Live Dashboard shows *DuckDB Vault Snapshot (JSON)* instead of *Live DuckDB API* | Either `Data/Performance_Vault.db` does not exist yet, `@duckdb/node-api` failed to load, or `dashboard-api` is not running. Check `http://localhost:3001/api/health` or export a fresh snapshot via `Rscript .engine/export_dashboard_data.R` |
| Port `3001` or `5173` already in use | Stop the conflicting process, or set `DASHBOARD_API_PORT` (and update `dashboard-ui/vite.config.ts`) |
| `cannot open file 'config.yaml'` | You launched from the wrong directory — run from the project root |
| `Filename 'X.csv' does not match expected format` | Rename to `<Project>_<TestType>_<App>_<BuildId>_<Timestamp>.csv` (§9) |
| `CSV files in the folder have different BuildIds` | Split them into one folder per build and register separately |
| `Run ID 'X' already exists` | That build is already registered — report on it, or remove it with `delete_by_runid.R` |
| `[ERROR] No CSV files found in: …` | Wrong path, or the files are in a sub-folder (the scan is not recursive) |
| `Run(s) not found (checked both run_id and sequence_num)` | Typo in Run ID/sequence number, or the run has not been registered yet |
| `Table 'performance_history' does not exist` | No test data has been registered into the vault yet |
| `column not found` during registration | Your export headers differ from `tool_mappings` — update `config.yaml` (§8) |
| `No transactions matched query criteria` | The label filter excluded everything (matching is case-sensitive). Re-run with fewer keywords or an empty filter |
| `cannot create dir '//<host>/shared/...'` / vault not found on a share | `config.yaml` still has unreachable UNC paths, or the share is not permitted. Check the `[DB]` and `[REPORT]` path lines printed at startup (§8) |
| AI summary shows a warning | `secrets.yaml` missing or token blank (§17) |
| Response Time SLA shows `N/A` | No `response_time_sla` block, or no SLA file configured |
| First run hangs for several minutes | Package bootstrap into `RLibs/` or `npm install` — normal once; check proxy settings if it never finishes |
| `Could not set lock on file … Performance_Vault.db` | Another R session/RStudio holds the vault open — close it and retry |
| PowerShell refuses to run the script | `powershell -ExecutionPolicy Bypass -File .\register.ps1` (or `.\launch-dashboard.ps1`) |

---

## 22. Quick reference

| Task | How |
|---|---|
| Install prerequisites | R 4.6.0 (§3) + Pandoc/Quarto (§4) + Node.js 20+ LTS (§5) — full stack in §2 |
| Start Static Report / Vault CLI | `register.ps1` (Windows) / `./launch.sh` (Linux/macOS), from the project root |
| Start Live Web Dashboard | `.\launch-dashboard.ps1` (Windows) → open `http://localhost:5173` (API on `:3001`) (§12) |
| Refresh offline dashboard JSON | `Rscript .engine/export_dashboard_data.R` → updates `dashboard-ui/public/vault-runs.json` |
| Register results | Menu → **2** → tool type → full folder path |
| Generate a static HTML report | Menu → **1** (or Enter) → Current Run ID & Baseline Run ID → optional filter |
| Compare runs (CLI) | Pass `--current=<run>` and `--base=<run>` (add `--ci` to fail build on SLA breach) |
| Filter transactions | Type one or more comma-separated substrings at the filter prompt (`Login, Checkout`) |
| Filter by application | Click application pill buttons (`All`, `App1`, `App2`) in Scenario Breakdown or Charts Modal |
| Add infrastructure screenshots | Drop `.png` files into `Evidence/<run_id>/` (opens via `🖥 Infrastructure 🔍`) |
| Switch report theme | Set `params.report_theme: "cyber-slate"` or `"light"` in `config.yaml`, or click ☀️ / 🌙 in navbar |
| Set report version | Update `params.version` in `config.yaml` (e.g. `v2.0`) |
| Set SLA thresholds | `SLA/performance-sla.yaml` |
| Exclude labels globally | Add label names under `label_exclusions` in `config.yaml` |
| AI Executive Summary | `ai_summary_enabled: "true"` + `secrets.yaml` (automatically falls back if offline/expired) |
| Find static HTML output | `<output_dir>/Performance_Report_<runs>_<timestamp>.html` (`Reports/` by default) |
| Use a shared vault / report folder | Point `database_path` and `output_dir` at a UNC or absolute path (§8) |
| Inspect the vault | `Rscript check_db_head.R` |
| Delete a run | Edit and run `delete_by_runid.R` |
| Reset everything | Delete `Data/Performance_Vault.db` |
| Transfer to another computer | Follow the checklist in §20 |
