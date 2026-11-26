#!/usr/bin/env bash
###################################################
# launch-dashboard.sh - Perf-Delta Single-Port Web Server Launcher (Linux/macOS)
# Serves both the React UI (dashboard-ui/dist) and DuckDB REST API on ONE port (default :8080)
# Usage:
#   ./launch-dashboard.sh [--port 8080] [--rebuild] [--dev]
###################################################
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$ROOT/dashboard-api"
UI_DIR="$ROOT/dashboard-ui"
PORT=8080
REBUILD=0
DEV=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --rebuild) REBUILD=1; shift ;;
    --dev) DEV=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Node.js 20+ LTS (node & npm) is required. Install from https://nodejs.org/"
  exit 1
fi

if [[ ! -d "$API_DIR/node_modules" ]]; then
  echo ">>> Installing API dependencies (dashboard-api)..."
  (cd "$API_DIR" && npm install)
fi

if [[ ! -d "$UI_DIR/node_modules" ]]; then
  echo ">>> Installing UI dependencies (dashboard-ui)..."
  (cd "$UI_DIR" && npm install)
fi

export DASHBOARD_API_PORT="$PORT"
export DASHBOARD_HOST="0.0.0.0"

if [[ "$DEV" -eq 1 ]]; then
  echo ">>> [DEV] Starting 2-port HMR mode: API (:$PORT) + Vite UI (:5173)..."
  (cd "$API_DIR" && node --watch server.js) &
  API_PID=$!
  trap 'kill "$API_PID" 2>/dev/null || true' EXIT
  (cd "$UI_DIR" && npm run dev)
  exit 0
fi

if [[ "$REBUILD" -eq 1 || ! -f "$UI_DIR/dist/index.html" ]]; then
  echo ">>> Building production UI bundle (dashboard-ui/dist)..."
  (cd "$UI_DIR" && npm run build)
fi

echo ">>> Starting Perf-Delta Single-Port Server on http://localhost:$PORT (LAN-accessible)..."
cd "$API_DIR"
exec node --watch server.js
