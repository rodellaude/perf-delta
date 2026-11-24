import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.DASHBOARD_API_PORT || 3001);

let DuckDBInstance = null;
try {
  const duckdbMod = await import('@duckdb/node-api');
  DuckDBInstance = duckdbMod.DuckDBInstance;
} catch (err) {
  console.warn('[dashboard-api] @duckdb/node-api unavailable, will use vault-runs.json fallback:', err.message);
}

function loadConfig() {
  const cfgPath = path.join(PROJECT_ROOT, 'config.yaml');
  const cfg = fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {} : {};

  const rawDb = cfg.database_path && String(cfg.database_path).trim()
    ? String(cfg.database_path).trim()
    : 'Data/Performance_Vault.db';
  const dbPath = path.isAbsolute(rawDb) ? rawDb : path.resolve(PROJECT_ROOT, rawDb);

  const rawSla = cfg.sla_file_path && String(cfg.sla_file_path).trim()
    ? String(cfg.sla_file_path).trim()
    : 'SLA/performance-sla.yaml';
  const slaPath = path.isAbsolute(rawSla) ? rawSla : path.resolve(PROJECT_ROOT, rawSla);
  const slaCfg = fs.existsSync(slaPath) ? yaml.load(fs.readFileSync(slaPath, 'utf8')) || {} : {};

  const defaultP95Sla = Number(slaCfg?.response_time_sla?.default_threshold) || 3000;
  const erRule = Array.isArray(slaCfg?.sla_rules)
    ? slaCfg.sla_rules.find((r) => r.metric === 'error_rate')
    : null;
  const defaultErrorSla = erRule && erRule.threshold != null ? Number(erRule.threshold) : 1.0;

  const excludedLabels = Array.isArray(cfg.label_exclusions)
    ? cfg.label_exclusions.map(String)
    : [];

  return { dbPath, defaultP95Sla, defaultErrorSla, excludedLabels };
}

function toNum(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toIso(val) {
  if (!val) return new Date(0).toISOString();
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object' && 'micros' in val) {
    return new Date(Number(val.micros) / 1000).toISOString();
  }
  const d = new Date(String(val));
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function formatHms(isoStr) {
  const d = new Date(isoStr);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

async function queryAll(conn, sql) {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects();
}

async function fetchRunsFromDuckDB() {
  const { dbPath, defaultP95Sla, defaultErrorSla, excludedLabels } = loadConfig();
  if (!DuckDBInstance || !fs.existsSync(dbPath)) {
    return null;
  }

  const instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
  const conn = await instance.connect();

  try {
    const tableRows = await queryAll(conn, 'SHOW TABLES');
    const availableTables = tableRows.map((r) => String(r.name));
    const candidateTables = ['performance_history', 'performance_history_jmeter', 'performance_history_neoload']
      .filter((t) => availableTables.includes(t));

    const exclSql = excludedLabels.length > 0
      ? ` AND label NOT IN (${excludedLabels.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')})`
      : '';

    const isPassExpr = "LOWER(TRIM(CAST(success AS VARCHAR))) IN ('true', 'yes', '1')";
    const runs = [];

    for (const tbl of candidateTables) {
      const toolLabel = tbl.includes('neoload') ? 'NEOLOAD' : 'JMETER';
      const colRows = await queryAll(conn, `DESCRIBE ${tbl}`);
      const cols = new Set(colRows.map((c) => String(c.column_name)));

      const vuExpr = cols.has('allThreads') && cols.has('thread_group') && cols.has('threadName')
        ? "GREATEST(COALESCE(MAX(TRY_CAST(allThreads AS INTEGER)), 0), COUNT(DISTINCT CONCAT(thread_group, '|', threadName)))"
        : cols.has('threadName')
          ? 'GREATEST(COUNT(DISTINCT threadName), 1)'
          : '1';

      const summaryRows = await queryAll(conn, `
        SELECT
          CAST(run_id AS VARCHAR) AS run_id,
          MAX(sequence_num) AS sequence_num,
          FIRST(project_name) AS project_name,
          FIRST(test_name) AS test_name,
          MIN(timestamp) AS start_time,
          MAX(timestamp) AS end_time,
          GREATEST(date_diff('milliseconds', MIN(timestamp), MAX(timestamp)) / 1000.0, 1.0) AS duration_secs,
          ${vuExpr} AS peak_vus,
          COUNT(*) AS total_samples,
          SUM(CASE WHEN ${isPassExpr} THEN 1 ELSE 0 END) AS passed_samples,
          SUM(CASE WHEN NOT (${isPassExpr}) THEN 1 ELSE 0 END) AS failed_samples,
          ROUND(AVG(elapsed), 1) AS avg_rt,
          ROUND(QUANTILE_CONT(elapsed, 0.90), 1) AS p90_rt,
          ROUND(QUANTILE_CONT(elapsed, 0.95), 1) AS p95_rt,
          ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_rt
        FROM ${tbl}
        WHERE 1=1 ${exclSql}
        GROUP BY run_id
        ORDER BY sequence_num DESC
        LIMIT 10
      `);

      for (const r of summaryRows) {
        const rid = String(r.run_id);
        const ridEsc = rid.replace(/'/g, "''");
        const durSecs = Math.max(toNum(r.duration_secs, 1), 1);
        const bucketSecs = durSecs <= 300 ? 10 : durSecs <= 1800 ? 30 : 60;
        const totalSamples = toNum(r.total_samples, 0);
        const failedSamples = toNum(r.failed_samples, 0);

        const tsRows = await queryAll(conn, `
          SELECT
            to_timestamp(FLOOR(epoch(timestamp) / ${bucketSecs}) * ${bucketSecs}) AS bucket_ts,
            ${vuExpr} AS active_vus,
            COUNT(*) AS samples,
            SUM(CASE WHEN NOT (${isPassExpr}) THEN 1 ELSE 0 END) AS errors,
            ROUND(AVG(elapsed), 1) AS avg_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.90), 1) AS p90_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.95), 1) AS p95_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_ms
          FROM ${tbl}
          WHERE CAST(run_id AS VARCHAR) = '${ridEsc}' ${exclSql}
          GROUP BY 1
          ORDER BY 1 ASC
        `);

        const epRows = await queryAll(conn, `
          SELECT
            CAST(label AS VARCHAR) AS endpoint,
            COUNT(*) AS samples,
            ROUND(AVG(elapsed), 1) AS avg_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.90), 1) AS p90_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.95), 1) AS p95_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_ms,
            ROUND(MAX(elapsed), 1) AS max_ms,
            SUM(CASE WHEN NOT (${isPassExpr}) THEN 1 ELSE 0 END) AS errors
          FROM ${tbl}
          WHERE CAST(run_id AS VARCHAR) = '${ridEsc}' ${exclSql}
          GROUP BY label
          ORDER BY p95_ms DESC
          LIMIT 50
        `);

        let httpErrors = [];
        if (cols.has('responseCode') && failedSamples > 0) {
          const msgExpr = cols.has('responseMessage')
            ? "COALESCE(NULLIF(TRIM(CAST(responseMessage AS VARCHAR)), ''), 'Error')"
            : "'Error'";
          const errRows = await queryAll(conn, `
            SELECT
              REGEXP_REPLACE(CAST(responseCode AS VARCHAR), '\\.0$', '') AS code,
              FIRST(${msgExpr}) AS message,
              COUNT(*) AS count
            FROM ${tbl}
            WHERE CAST(run_id AS VARCHAR) = '${ridEsc}' AND NOT (${isPassExpr}) ${exclSql}
            GROUP BY 1
            ORDER BY count DESC
            LIMIT 10
          `);
          const errTotal = Math.max(errRows.reduce((acc, x) => acc + toNum(x.count), 0), 1);
          httpErrors = errRows.map((x) => ({
            code: String(x.code || 'ERR'),
            label: String(x.message || 'Error'),
            count: toNum(x.count),
            percentage: Number(((toNum(x.count) / errTotal) * 100).toFixed(1)),
          }));
        }

        let assertionFailures = [];
        if (cols.has('failureMessage') && failedSamples > 0) {
          const afRows = await queryAll(conn, `
            SELECT
              COALESCE(NULLIF(TRIM(CAST(failureMessage AS VARCHAR)), ''), 'Non-2xx HTTP Status / Request Failed') AS message,
              FIRST(CAST(label AS VARCHAR)) AS endpoint,
              COUNT(*) AS count
            FROM ${tbl}
            WHERE CAST(run_id AS VARCHAR) = '${ridEsc}' AND NOT (${isPassExpr}) ${exclSql}
            GROUP BY 1
            ORDER BY count DESC
            LIMIT 8
          `);
          assertionFailures = afRows.map((x, idx) => ({
            id: `vault-assert-${idx + 1}`,
            assertion: String(x.message),
            endpoint: String(x.endpoint),
            count: toNum(x.count),
            severity: toNum(x.count) >= 20 ? 'critical' : 'warning',
          }));
        }

        const timeSeries = tsRows.map((t) => {
          const iso = toIso(t.bucket_ts);
          const samples = toNum(t.samples, 1);
          return {
            timestamp: formatHms(iso),
            isoTimestamp: iso,
            epochMs: Date.parse(iso),
            vus: toNum(t.active_vus, 1),
            throughput: Number((samples / bucketSecs).toFixed(2)),
            avg: toNum(t.avg_ms),
            p90: toNum(t.p90_ms),
            p95: toNum(t.p95_ms),
            p99: toNum(t.p99_ms),
            errorRate: Number(((toNum(t.errors) / Math.max(samples, 1)) * 100).toFixed(2)),
            phase: 'steady',
          };
        });

        const endpoints = epRows.map((e) => {
          const samples = toNum(e.samples, 1);
          return {
            endpoint: String(e.endpoint),
            samples,
            avg: toNum(e.avg_ms),
            p90: toNum(e.p90_ms),
            p95: toNum(e.p95_ms),
            p99: toNum(e.p99_ms),
            max: toNum(e.max_ms),
            throughput: Number((samples / durSecs).toFixed(2)),
            errorPct: Number(((toNum(e.errors) / Math.max(samples, 1)) * 100).toFixed(2)),
            slaP95Ms: defaultP95Sla,
          };
        });

        runs.push({
          id: `vault-${toolLabel.toLowerCase()}-${rid}`,
          name: `[Vault] ${r.project_name} - ${r.test_name} #${rid}`,
          source: 'duckdb-vault',
          tool: toolLabel,
          environment: `VAULT · ${toolLabel}`,
          startedAt: toIso(r.start_time),
          endedAt: toIso(r.end_time),
          durationMinutes: Math.max(Number((durSecs / 60).toFixed(1)), 0.1),
          sla: {
            p95Ms: defaultP95Sla,
            errorRatePct: defaultErrorSla,
          },
          summary: {
            peakVUs: toNum(r.peak_vus),
            avgThroughputRps: Number((totalSamples / durSecs).toFixed(2)),
            p95ResponseTimeMs: toNum(r.p95_rt),
            errorRatePct: Number(((failedSamples / Math.max(totalSamples, 1)) * 100).toFixed(2)),
            totalRequests: totalSamples,
            failedRequests: failedSamples,
          },
          timeSeries,
          endpoints,
          httpErrors,
          assertionFailures,
        });
      }
    }

    return {
      mode: 'live-duckdb',
      generatedAt: new Date().toISOString(),
      vaultPath: path.basename(dbPath),
      runs,
    };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

function loadFallbackJson() {
  const fallbackPath = path.join(PROJECT_ROOT, 'dashboard-ui', 'public', 'vault-runs.json');
  if (!fs.existsSync(fallbackPath)) {
    return { mode: 'empty', generatedAt: new Date().toISOString(), vaultPath: 'none', runs: [] };
  }
  const parsed = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
  return { mode: 'cached-json', ...parsed };
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', async (_req, res) => {
  const { dbPath } = loadConfig();
  res.json({
    ok: true,
    duckdbDriverLoaded: Boolean(DuckDBInstance),
    vaultExists: fs.existsSync(dbPath),
    vaultFile: path.basename(dbPath),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/runs', async (_req, res) => {
  try {
    const livePayload = await fetchRunsFromDuckDB();
    if (livePayload) {
      return res.json(livePayload);
    }
    return res.json(loadFallbackJson());
  } catch (err) {
    console.error('[dashboard-api] DuckDB query failed, serving fallback:', err.message);
    return res.json(loadFallbackJson());
  }
});

app.listen(PORT, () => {
  console.log(`>>> [Perf-Delta API] Listening on http://localhost:${PORT}`);
  console.log(`>>> [Perf-Delta API] DuckDB Native Driver: ${DuckDBInstance ? 'ENABLED' : 'FALLBACK (vault-runs.json)'}`);
});
