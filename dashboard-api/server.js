import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
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

  const showOverallStatus = slaCfg?.show_overall_status !== false;
  const rtCfg = slaCfg?.response_time_sla || {};
  const rtEnabled = rtCfg.enabled !== false;
  const rtMetric = String(rtCfg.metric || 'p95').toLowerCase() === 'p90' ? 'p90' : 'p95';
  const defaultP95Sla = Number(rtCfg.default_threshold) || 3000;
  const rtTolerancePct = Number(rtCfg.tolerance_pct) || 0;
  const rtOverrides = Array.isArray(rtCfg.overrides)
    ? rtCfg.overrides
        .filter((o) => o && o.label && o.threshold != null)
        .map((o) => ({ label: String(o.label), threshold: Number(o.threshold) }))
    : [];

  const rules = Array.isArray(slaCfg?.sla_rules) ? slaCfg.sla_rules : [];
  const erRule = rules.find((r) => r.metric === 'error_rate');
  const tpsRule = rules.find((r) => r.metric === 'throughput');
  const vuRule = rules.find((r) => r.metric === 'total_users');

  const errorEnabled = erRule ? erRule.enabled !== false : false;
  const defaultErrorSla = erRule && erRule.threshold != null ? Number(erRule.threshold) : 1.0;
  const tpsEnabled = tpsRule ? tpsRule.enabled !== false : false;
  const tpsTarget = tpsRule && tpsRule.threshold != null ? Number(tpsRule.threshold) : 10.0;
  const vuEnabled = vuRule ? vuRule.enabled !== false : false;
  const vuTarget = vuRule && vuRule.threshold != null ? Number(vuRule.threshold) : 100;

  const excludedLabels = Array.isArray(cfg.label_exclusions)
    ? cfg.label_exclusions.map(String)
    : [];

  return {
    dbPath,
    excludedLabels,
    sla: {
      showOverallStatus,
      rtEnabled,
      rtMetric,
      defaultP95Sla,
      rtTolerancePct,
      rtOverrides,
      errorEnabled,
      defaultErrorSla,
      tpsEnabled,
      tpsTarget,
      vuEnabled,
      vuTarget,
    },
  };
}

function getRtThreshold(label, sla) {
  if (!sla.rtOverrides || sla.rtOverrides.length === 0) return sla.defaultP95Sla;
  const str = String(label || '');
  let best = null;
  for (const ov of sla.rtOverrides) {
    if (str.startsWith(ov.label)) {
      if (!best || ov.label.length > best.label.length) {
        best = ov;
      }
    }
  }
  return best ? best.threshold : sla.defaultP95Sla;
}

function getApdexRating(score) {
  if (score >= 0.94) return 'Excellent';
  if (score >= 0.85) return 'Good';
  if (score >= 0.70) return 'Fair';
  if (score >= 0.50) return 'Poor';
  return 'Unacceptable';
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

function buildSqlThresholdExpr(sla) {
  if (!sla.rtOverrides || sla.rtOverrides.length === 0) {
    return String(sla.defaultP95Sla);
  }
  const sorted = [...sla.rtOverrides].sort((a, b) => b.label.length - a.label.length);
  const cases = sorted
    .map((ov) => `WHEN CAST(label AS VARCHAR) LIKE '${ov.label.replace(/'/g, "''")}%' THEN ${ov.threshold}`)
    .join(' ');
  return `CASE ${cases} ELSE ${sla.defaultP95Sla} END`;
}

const HARDCODED_EXCLUDED_SUBSTRINGS = ['bzm - parallel controller'];

function isExcludedLabel(label, exclSet) {
  const s = String(label || '').trim();
  if (exclSet.has(s)) return true;
  const lower = s.toLowerCase();
  return HARDCODED_EXCLUDED_SUBSTRINGS.some((sub) => lower.includes(sub));
}

const AGG_TABLES = [
  'agg_run_summary',
  'agg_timeseries',
  'agg_app_summary',
  'agg_scenario_summary',
  'agg_endpoint_summary',
  'agg_error_details',
];

async function fetchRunsFromAggTables(conn, dbPath, excludedLabels, sla) {
  const exclSet = new Set(excludedLabels.map(String));
  const summaryRows = await queryAll(conn, `
    SELECT * FROM agg_run_summary
    ORDER BY sequence_num DESC
    LIMIT 25
  `);
  if (summaryRows.length === 0) return null;

  const runIds = summaryRows.map((r) => `'${String(r.run_id).replace(/'/g, "''")}'`).join(', ');
  const [allTs, allApps, allScens, allEps, allErrs] = await Promise.all([
    queryAll(conn, `SELECT * FROM agg_timeseries WHERE run_id IN (${runIds}) ORDER BY run_id, bucket_ts ASC`),
    queryAll(conn, `SELECT * FROM agg_app_summary WHERE run_id IN (${runIds}) ORDER BY samples DESC`),
    queryAll(conn, `SELECT * FROM agg_scenario_summary WHERE run_id IN (${runIds}) ORDER BY samples DESC`),
    queryAll(conn, `SELECT * FROM agg_endpoint_summary WHERE run_id IN (${runIds}) ORDER BY p95_ms DESC`),
    queryAll(conn, `SELECT * FROM agg_error_details WHERE run_id IN (${runIds}) ORDER BY error_count DESC`),
  ]);

  const groupByRun = (rows) => {
    const map = new Map();
    for (const row of rows) {
      const k = String(row.run_id);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(row);
    }
    return map;
  };

  const tsByRun = groupByRun(allTs);
  const appsByRun = groupByRun(allApps);
  const scensByRun = groupByRun(allScens);
  const epsByRun = groupByRun(allEps);
  const errsByRun = groupByRun(allErrs);

  const runs = [];
  for (const r of summaryRows) {
    const rid = String(r.run_id);
    const durSecs = Math.max(toNum(r.duration_secs, 1), 1);
    const bucketSecs = Math.max(toNum(r.bucket_secs, 60), 1);
    const totalSamples = toNum(r.total_samples, 0);
    const failedSamples = toNum(r.failed_samples, 0);
    const peakVUs = toNum(r.peak_vus, 1);

    const tsRows = tsByRun.get(rid) || [];
    const tsVus = tsRows.map((t) => toNum(t.active_vus, 1));
    const maxTsVu = Math.max(...tsVus, 1);
    const steadyThreshold = maxTsVu * 0.88;
    const firstSteadyIdx = tsVus.findIndex((v) => v >= steadyThreshold);
    let lastSteadyIdx = tsVus.length - 1;
    for (let i = tsVus.length - 1; i >= 0; i--) {
      if (tsVus[i] >= steadyThreshold) {
        lastSteadyIdx = i;
        break;
      }
    }

    const timeSeries = tsRows.map((t, idx) => {
      const iso = toIso(t.bucket_ts);
      const samples = toNum(t.samples, 1);
      const vus = toNum(t.active_vus, 1);
      let phase = 'steady';
      if (firstSteadyIdx > 0 && idx < firstSteadyIdx) phase = 'ramp-up';
      else if (lastSteadyIdx < tsRows.length - 1 && idx > lastSteadyIdx) phase = 'ramp-down';
      return {
        timestamp: formatHms(iso),
        isoTimestamp: iso,
        epochMs: Date.parse(iso),
        vus,
        throughput: Number((samples / bucketSecs).toFixed(2)),
        avg: toNum(t.avg_ms),
        p90: toNum(t.p90_ms),
        p95: toNum(t.p95_ms),
        p99: toNum(t.p99_ms),
        errorCount: toNum(t.errors, 0),
        errorRate: Number(((toNum(t.errors) / Math.max(samples, 1)) * 100).toFixed(2)),
        phase,
      };
    });

    const rawEpRows = (epsByRun.get(rid) || []).filter((e) => !isExcludedLabel(e.endpoint, exclSet));
    const endpoints = rawEpRows.map((e) => {
      const samples = toNum(e.samples, 1);
      const epName = String(e.endpoint);
      const slaThreshold = getRtThreshold(epName, sla);
      const tolBand = slaThreshold * (1 + sla.rtTolerancePct / 100);
      const actualRt = sla.rtMetric === 'p90' ? toNum(e.p90_ms) : toNum(e.p95_ms);
      const errPct = Number(((toNum(e.errors) / Math.max(samples, 1)) * 100).toFixed(2));
      return {
        endpoint: epName,
        appName: String(e.app_name),
        scenario: String(e.scenario_name),
        samples,
        avg: toNum(e.avg_ms),
        p90: toNum(e.p90_ms),
        p95: toNum(e.p95_ms),
        p99: toNum(e.p99_ms),
        max: toNum(e.max_ms),
        throughput: Number((samples / durSecs).toFixed(2)),
        errorPct: errPct,
        slaP95Ms: slaThreshold,
        rtBreached: sla.rtEnabled ? actualRt > tolBand : false,
        errorBreached: sla.errorEnabled ? errPct > sla.defaultErrorSla : false,
      };
    });

    // Compute Apdex dynamically from pre-aggregated endpoints + SLA overrides
    let apSat = 0;
    let apTol = 0;
    let apFru = 0;
    for (const ep of endpoints) {
      const errs = Math.round((ep.errorPct / 100) * ep.samples);
      const ok = Math.max(0, ep.samples - errs);
      apFru += errs;
      if (ep.p95 <= ep.slaP95Ms) apSat += ok;
      else if (ep.p95 <= 4 * ep.slaP95Ms) apTol += ok;
      else apFru += ok;
    }
    const apTot = Math.max(apSat + apTol + apFru, 1);
    const apScore = Number(((apSat + 0.5 * apTol) / apTot).toFixed(2));

    const apps = (appsByRun.get(rid) || []).map((a) => {
      const samples = toNum(a.samples, 1);
      const errors = toNum(a.errors, 0);
      const appName = String(a.app_name);
      const appEps = endpoints.filter((ep) => ep.appName === appName);
      let s = 0, t = 0, f = 0;
      for (const ep of appEps) {
        const errs = Math.round((ep.errorPct / 100) * ep.samples);
        const ok = Math.max(0, ep.samples - errs);
        f += errs;
        if (ep.p95 <= ep.slaP95Ms) s += ok;
        else if (ep.p95 <= 4 * ep.slaP95Ms) t += ok;
        else f += ok;
      }
      const tot = Math.max(s + t + f, 1);
      const score = Number(((s + 0.5 * t) / tot).toFixed(2));
      return {
        appName,
        samples,
        peakVUs: toNum(a.peak_vus, 1),
        throughput: Number((samples / durSecs).toFixed(2)),
        avg: toNum(a.avg_ms),
        p90: toNum(a.p90_ms),
        p95: toNum(a.p95_ms),
        p99: toNum(a.p99_ms),
        errors,
        errorPct: Number(((errors / Math.max(samples, 1)) * 100).toFixed(2)),
        apdexScore: score,
        apdexRating: getApdexRating(score),
      };
    });

    const scenarios = (scensByRun.get(rid) || []).map((s) => {
      const samples = toNum(s.samples, 1);
      const errors = toNum(s.errors, 0);
      const appName = String(s.app_name);
      const scenName = String(s.scenario_name);
      const scenEps = endpoints.filter((ep) => ep.appName === appName && ep.scenario === scenName);
      return {
        appName,
        scenario: scenName,
        samples,
        throughput: Number((samples / durSecs).toFixed(2)),
        avg: toNum(s.avg_ms),
        p90: toNum(s.p90_ms),
        p95: toNum(s.p95_ms),
        p99: toNum(s.p99_ms),
        errors,
        errorPct: Number(((errors / Math.max(samples, 1)) * 100).toFixed(2)),
        passedLabels: scenEps.filter((ep) => !ep.rtBreached).length,
        totalLabels: scenEps.length,
      };
    });

    const rawErrRows = (errsByRun.get(rid) || []).filter((d) => !isExcludedLabel(d.endpoint, exclSet));
    const nonContainer = rawErrRows.filter(
      (d) => !/^Number of samples in transaction/i.test(String(d.response_message || ''))
    );
    const finalDet = nonContainer.length > 0 ? nonContainer : rawErrRows;

    const errorDetails = finalDet.slice(0, 60).map((d) => ({
      appName: String(d.app_name || ''),
      scenario: String(d.scenario_name || ''),
      endpoint: String(d.endpoint || ''),
      url: d.url && String(d.url).trim() && String(d.url).trim().toLowerCase() !== 'null' ? String(d.url).trim() : '',
      responseCode: String(d.response_code || 'Non-HTTP'),
      responseMessage: String(d.response_message || 'No error message recorded'),
      failureMessage: d.failure_message && String(d.failure_message).trim() && String(d.failure_message).trim().toLowerCase() !== 'null' ? String(d.failure_message).trim() : '',
      count: toNum(d.error_count, 0),
    }));

    // Roll up httpErrors and assertionFailures from pre-aggregated errorDetails
    const codeMap = new Map();
    const afMap = new Map();
    for (const d of rawErrRows) {
      const cnt = toNum(d.error_count, 0);
      const code = String(d.response_code || 'ERR');
      const curC = codeMap.get(code) || { code, label: String(d.response_message || 'Error'), count: 0 };
      curC.count += cnt;
      codeMap.set(code, curC);

      const fm = d.failure_message && String(d.failure_message).trim() && String(d.failure_message).trim().toLowerCase() !== 'null'
        ? String(d.failure_message).trim()
        : 'Non-2xx HTTP Status / Request Failed';
      const curA = afMap.get(fm) || { assertion: fm, endpoint: String(d.endpoint || ''), count: 0 };
      curA.count += cnt;
      afMap.set(fm, curA);
    }
    const errList = [...codeMap.values()].sort((a, b) => b.count - a.count).slice(0, 15);
    const errSum = Math.max(errList.reduce((acc, x) => acc + x.count, 0), 1);
    const httpErrors = errList.map((x) => ({
      ...x,
      percentage: Number(((x.count / errSum) * 100).toFixed(1)),
    }));
    const assertionFailures = [...afMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((x, idx) => ({
        id: `vault-assert-${idx + 1}`,
        assertion: x.assertion,
        endpoint: x.endpoint,
        count: x.count,
        severity: x.count >= 20 ? 'critical' : 'warning',
      }));

    // Recalculate clean totals excluding hardcoded/configured labels
    const cleanTotalSamples = endpoints.length > 0
      ? endpoints.reduce((acc, ep) => acc + ep.samples, 0)
      : totalSamples;
    const cleanFailedSamples = rawErrRows.reduce((acc, d) => acc + toNum(d.error_count, 0), 0);

    runs.push({
      id: `vault-jmeter-${rid}`,
      name: `[Vault] ${r.project_name} - ${r.test_name} #${rid}`,
      source: 'duckdb-vault',
      tool: 'JMETER',
      environment: 'VAULT · AGG',
      startedAt: toIso(r.start_time),
      endedAt: toIso(r.end_time),
      durationMinutes: Math.max(Number((durSecs / 60).toFixed(1)), 0.1),
      sla: {
        p95Ms: sla.defaultP95Sla,
        errorRatePct: sla.defaultErrorSla,
        rtEnabled: sla.rtEnabled,
        rtMetric: sla.rtMetric,
        tolerancePct: sla.rtTolerancePct,
        errorEnabled: sla.errorEnabled,
        tpsEnabled: sla.tpsEnabled,
        tpsTarget: sla.tpsTarget,
        vuEnabled: sla.vuEnabled,
        vuTarget: sla.vuTarget,
        showOverallStatus: sla.showOverallStatus,
      },
      summary: {
        peakVUs,
        avgThroughputRps: Number((cleanTotalSamples / durSecs).toFixed(2)),
        p90ResponseTimeMs: toNum(r.p90_rt),
        p95ResponseTimeMs: toNum(r.p95_rt),
        errorRatePct: Number(((cleanFailedSamples / Math.max(cleanTotalSamples, 1)) * 100).toFixed(2)),
        totalRequests: cleanTotalSamples,
        failedRequests: cleanFailedSamples,
      },
      apdex: {
        score: apScore,
        rating: getApdexRating(apScore),
        satisfied: apSat,
        tolerating: apTol,
        frustrated: apFru,
        total: apSat + apTol + apFru,
        satisfiedPct: Number(((apSat / apTot) * 100).toFixed(1)),
        toleratingPct: Number(((apTol / apTot) * 100).toFixed(1)),
        frustratedPct: Number(((apFru / apTot) * 100).toFixed(1)),
      },
      apps,
      scenarios,
      timeSeries,
      endpoints,
      httpErrors,
      assertionFailures,
      errorDetails,
    });
  }

  return {
    mode: 'live-duckdb-agg',
    generatedAt: new Date().toISOString(),
    vaultPath: path.basename(dbPath),
    runs,
  };
}

async function fetchRunsFromDuckDB() {
  const { dbPath, excludedLabels, sla } = loadConfig();
  if (!DuckDBInstance || !fs.existsSync(dbPath)) {
    return null;
  }

  const instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
  const conn = await instance.connect();

  try {
    const tableRows = await queryAll(conn, 'SHOW TABLES');
    const availableTables = tableRows.map((r) => String(r.name));

    // Fast-path: use pre-aggregated tables created during registration
    if (AGG_TABLES.every((t) => availableTables.includes(t))) {
      const aggPayload = await fetchRunsFromAggTables(conn, dbPath, excludedLabels, sla);
      if (aggPayload && aggPayload.runs.length > 0) {
        return aggPayload;
      }
    }
    const candidateTables = ['performance_history', 'performance_history_jmeter', 'performance_history_neoload']
      .filter((t) => availableTables.includes(t));

    const hardcodedSql = HARDCODED_EXCLUDED_SUBSTRINGS
      .map((s) => ` AND LOWER(TRIM(CAST(label AS VARCHAR))) NOT LIKE '%${s.replace(/'/g, "''")}%'`)
      .join('');
    const exclSql = (excludedLabels.length > 0
      ? ` AND label NOT IN (${excludedLabels.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')})`
      : '') + hardcodedSql;

    const isPassExpr = "LOWER(TRIM(CAST(success AS VARCHAR))) IN ('true', 'yes', '1')";
    const thresholdExpr = buildSqlThresholdExpr(sla);
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

      const appExpr = cols.has('app_name')
        ? "COALESCE(NULLIF(TRIM(CAST(app_name AS VARCHAR)), ''), 'DefaultApp')"
        : "'DefaultApp'";

      const scenarioExpr = cols.has('thread_group')
        ? "COALESCE(NULLIF(TRIM(REGEXP_REPLACE(CAST(thread_group AS VARCHAR), '\\s+\\d+-\\d+$', '')), ''), 'Default Scenario')"
        : cols.has('threadName')
          ? "COALESCE(NULLIF(TRIM(REGEXP_REPLACE(CAST(threadName AS VARCHAR), '\\s+\\d+-\\d+$', '')), ''), 'Default Scenario')"
          : "'Default Scenario'";

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
          ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_rt,
          SUM(CASE WHEN (${isPassExpr}) AND elapsed <= (${thresholdExpr}) THEN 1 ELSE 0 END) AS apdex_satisfied,
          SUM(CASE WHEN (${isPassExpr}) AND elapsed > (${thresholdExpr}) AND elapsed <= (4 * (${thresholdExpr})) THEN 1 ELSE 0 END) AS apdex_tolerating,
          SUM(CASE WHEN NOT (${isPassExpr}) OR elapsed > (4 * (${thresholdExpr})) THEN 1 ELSE 0 END) AS apdex_frustrated
        FROM ${tbl}
        WHERE 1=1 ${exclSql}
        GROUP BY run_id
        ORDER BY sequence_num DESC
        LIMIT 25
      `);

      for (const r of summaryRows) {
        const rid = String(r.run_id);
        const ridEsc = rid.replace(/'/g, "''");
        const durSecs = Math.max(toNum(r.duration_secs, 1), 1);
        const bucketSecs = durSecs <= 180 ? 5 : durSecs <= 600 ? 15 : durSecs <= 1800 ? 30 : 60;
        const totalSamples = toNum(r.total_samples, 0);
        const failedSamples = toNum(r.failed_samples, 0);
        const peakVUs = toNum(r.peak_vus, 1);

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
            ${appExpr} AS app_name,
            ${scenarioExpr} AS scenario_name,
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
          GROUP BY 1, 2, 3
          ORDER BY p95_ms DESC
        `);

        const appRows = await queryAll(conn, `
          SELECT
            ${appExpr} AS app_name,
            COUNT(*) AS samples,
            ${vuExpr} AS peak_vus,
            ROUND(AVG(elapsed), 1) AS avg_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.90), 1) AS p90_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.95), 1) AS p95_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_ms,
            SUM(CASE WHEN NOT (${isPassExpr}) THEN 1 ELSE 0 END) AS errors,
            SUM(CASE WHEN (${isPassExpr}) AND elapsed <= (${thresholdExpr}) THEN 1 ELSE 0 END) AS apdex_satisfied,
            SUM(CASE WHEN (${isPassExpr}) AND elapsed > (${thresholdExpr}) AND elapsed <= (4 * (${thresholdExpr})) THEN 1 ELSE 0 END) AS apdex_tolerating,
            SUM(CASE WHEN NOT (${isPassExpr}) OR elapsed > (4 * (${thresholdExpr})) THEN 1 ELSE 0 END) AS apdex_frustrated
          FROM ${tbl}
          WHERE CAST(run_id AS VARCHAR) = '${ridEsc}' ${exclSql}
          GROUP BY 1
          ORDER BY samples DESC
        `);

        const scenRows = await queryAll(conn, `
          SELECT
            ${appExpr} AS app_name,
            ${scenarioExpr} AS scenario_name,
            COUNT(*) AS samples,
            ROUND(AVG(elapsed), 1) AS avg_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.90), 1) AS p90_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.95), 1) AS p95_ms,
            ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_ms,
            SUM(CASE WHEN NOT (${isPassExpr}) THEN 1 ELSE 0 END) AS errors
          FROM ${tbl}
          WHERE CAST(run_id AS VARCHAR) = '${ridEsc}' ${exclSql}
          GROUP BY 1, 2
          ORDER BY samples DESC
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
            LIMIT 15
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
            LIMIT 10
          `);
          assertionFailures = afRows.map((x, idx) => ({
            id: `vault-assert-${idx + 1}`,
            assertion: String(x.message),
            endpoint: String(x.endpoint),
            count: toNum(x.count),
            severity: toNum(x.count) >= 20 ? 'critical' : 'warning',
          }));
        }

        let errorDetails = [];
        if (failedSamples > 0) {
          const urlSql = cols.has('URL') ? 'CAST(URL AS VARCHAR)' : 'CAST(NULL AS VARCHAR)';
          const codeSql = cols.has('responseCode')
            ? "REGEXP_REPLACE(CAST(responseCode AS VARCHAR), '\\.0$', '')"
            : "'ERR'";
          const msgSql = cols.has('responseMessage')
            ? "COALESCE(NULLIF(TRIM(CAST(responseMessage AS VARCHAR)), ''), 'No error message recorded')"
            : "'No error message recorded'";
          const fmSql = cols.has('failureMessage')
            ? 'CAST(failureMessage AS VARCHAR)'
            : 'CAST(NULL AS VARCHAR)';
          const detRows = await queryAll(conn, `
            SELECT
              ${appExpr} AS app_name,
              ${scenarioExpr} AS scenario_name,
              CAST(label AS VARCHAR) AS endpoint,
              ${urlSql} AS url,
              ${codeSql} AS response_code,
              ${msgSql} AS response_message,
              ${fmSql} AS failure_message,
              COUNT(*) AS error_count
            FROM ${tbl}
            WHERE CAST(run_id AS VARCHAR) = '${ridEsc}' AND NOT (${isPassExpr}) ${exclSql}
            GROUP BY 1, 2, 3, 4, 5, 6, 7
            ORDER BY error_count DESC
            LIMIT 60
          `);
          const nonContainer = detRows.filter(
            (d) => !/^Number of samples in transaction/i.test(String(d.response_message || ''))
          );
          const finalDet = nonContainer.length > 0 ? nonContainer : detRows;
          errorDetails = finalDet.map((d) => ({
            appName: String(d.app_name || ''),
            scenario: String(d.scenario_name || ''),
            endpoint: String(d.endpoint || ''),
            url: d.url && String(d.url).trim() && String(d.url).trim().toLowerCase() !== 'null' ? String(d.url).trim() : '',
            responseCode: String(d.response_code || 'Non-HTTP'),
            responseMessage: String(d.response_message || 'No error message recorded'),
            failureMessage: d.failure_message && String(d.failure_message).trim() && String(d.failure_message).trim().toLowerCase() !== 'null' ? String(d.failure_message).trim() : '',
            count: toNum(d.error_count, 0),
          }));
        }

        // Real telemetry-based workload phase detection
        const tsVus = tsRows.map((t) => toNum(t.active_vus, 1));
        const maxTsVu = Math.max(...tsVus, 1);
        const steadyThreshold = maxTsVu * 0.88;
        const firstSteadyIdx = tsVus.findIndex((v) => v >= steadyThreshold);
        let lastSteadyIdx = tsVus.length - 1;
        for (let i = tsVus.length - 1; i >= 0; i--) {
          if (tsVus[i] >= steadyThreshold) {
            lastSteadyIdx = i;
            break;
          }
        }

        const timeSeries = tsRows.map((t, idx) => {
          const iso = toIso(t.bucket_ts);
          const samples = toNum(t.samples, 1);
          const vus = toNum(t.active_vus, 1);
          let phase = 'steady';
          if (firstSteadyIdx > 0 && idx < firstSteadyIdx) {
            phase = 'ramp-up';
          } else if (lastSteadyIdx < tsRows.length - 1 && idx > lastSteadyIdx) {
            phase = 'ramp-down';
          }
          return {
            timestamp: formatHms(iso),
            isoTimestamp: iso,
            epochMs: Date.parse(iso),
            vus,
            throughput: Number((samples / bucketSecs).toFixed(2)),
            avg: toNum(t.avg_ms),
            p90: toNum(t.p90_ms),
            p95: toNum(t.p95_ms),
            p99: toNum(t.p99_ms),
            errorCount: toNum(t.errors, 0),
            errorRate: Number(((toNum(t.errors) / Math.max(samples, 1)) * 100).toFixed(2)),
            phase,
          };
        });

        const endpoints = epRows.map((e) => {
          const samples = toNum(e.samples, 1);
          const epName = String(e.endpoint);
          const slaThreshold = getRtThreshold(epName, sla);
          const tolBand = slaThreshold * (1 + sla.rtTolerancePct / 100);
          const actualRt = sla.rtMetric === 'p90' ? toNum(e.p90_ms) : toNum(e.p95_ms);
          const errPct = Number(((toNum(e.errors) / Math.max(samples, 1)) * 100).toFixed(2));
          return {
            endpoint: epName,
            appName: String(e.app_name),
            scenario: String(e.scenario_name),
            samples,
            avg: toNum(e.avg_ms),
            p90: toNum(e.p90_ms),
            p95: toNum(e.p95_ms),
            p99: toNum(e.p99_ms),
            max: toNum(e.max_ms),
            throughput: Number((samples / durSecs).toFixed(2)),
            errorPct: errPct,
            slaP95Ms: slaThreshold,
            rtBreached: sla.rtEnabled ? actualRt > tolBand : false,
            errorBreached: sla.errorEnabled ? errPct > sla.defaultErrorSla : false,
          };
        });

        const apps = appRows.map((a) => {
          const samples = toNum(a.samples, 1);
          const errors = toNum(a.errors, 0);
          const sat = toNum(a.apdex_satisfied, 0);
          const tol = toNum(a.apdex_tolerating, 0);
          const fru = toNum(a.apdex_frustrated, 0);
          const tot = Math.max(sat + tol + fru, 1);
          const score = Number(((sat + 0.5 * tol) / tot).toFixed(2));
          return {
            appName: String(a.app_name),
            samples,
            peakVUs: toNum(a.peak_vus, 1),
            throughput: Number((samples / durSecs).toFixed(2)),
            avg: toNum(a.avg_ms),
            p90: toNum(a.p90_ms),
            p95: toNum(a.p95_ms),
            p99: toNum(a.p99_ms),
            errors,
            errorPct: Number(((errors / Math.max(samples, 1)) * 100).toFixed(2)),
            apdexScore: score,
            apdexRating: getApdexRating(score),
          };
        });

        const scenarios = scenRows.map((s) => {
          const samples = toNum(s.samples, 1);
          const errors = toNum(s.errors, 0);
          const appName = String(s.app_name);
          const scenName = String(s.scenario_name);
          const scenEps = endpoints.filter((ep) => ep.appName === appName && ep.scenario === scenName);
          const totalLabels = scenEps.length;
          const passedLabels = scenEps.filter((ep) => !ep.rtBreached).length;
          return {
            appName,
            scenario: scenName,
            samples,
            throughput: Number((samples / durSecs).toFixed(2)),
            avg: toNum(s.avg_ms),
            p90: toNum(s.p90_ms),
            p95: toNum(s.p95_ms),
            p99: toNum(s.p99_ms),
            errors,
            errorPct: Number(((errors / Math.max(samples, 1)) * 100).toFixed(2)),
            passedLabels,
            totalLabels,
          };
        });

        const apSat = toNum(r.apdex_satisfied, 0);
        const apTol = toNum(r.apdex_tolerating, 0);
        const apFru = toNum(r.apdex_frustrated, 0);
        const apTot = Math.max(apSat + apTol + apFru, 1);
        const apScore = Number(((apSat + 0.5 * apTol) / apTot).toFixed(2));

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
            p95Ms: sla.defaultP95Sla,
            errorRatePct: sla.defaultErrorSla,
            rtEnabled: sla.rtEnabled,
            rtMetric: sla.rtMetric,
            tolerancePct: sla.rtTolerancePct,
            errorEnabled: sla.errorEnabled,
            tpsEnabled: sla.tpsEnabled,
            tpsTarget: sla.tpsTarget,
            vuEnabled: sla.vuEnabled,
            vuTarget: sla.vuTarget,
            showOverallStatus: sla.showOverallStatus,
          },
          summary: {
            peakVUs,
            avgThroughputRps: Number((totalSamples / durSecs).toFixed(2)),
            p90ResponseTimeMs: toNum(r.p90_rt),
            p95ResponseTimeMs: toNum(r.p95_rt),
            errorRatePct: Number(((failedSamples / Math.max(totalSamples, 1)) * 100).toFixed(2)),
            totalRequests: totalSamples,
            failedRequests: failedSamples,
          },
          apdex: {
            score: apScore,
            rating: getApdexRating(apScore),
            satisfied: apSat,
            tolerating: apTol,
            frustrated: apFru,
            total: apSat + apTol + apFru,
            satisfiedPct: Number(((apSat / apTot) * 100).toFixed(1)),
            toleratingPct: Number(((apTol / apTot) * 100).toFixed(1)),
            frustratedPct: Number(((apFru / apTot) * 100).toFixed(1)),
          },
          apps,
          scenarios,
          timeSeries,
          endpoints,
          httpErrors,
          assertionFailures,
          errorDetails,
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
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ============================================================
// AUTHENTICATION & ADMIN SESSION RBAC (Grafana-style Viewer + Admin)
// ============================================================

const SESSION_COOKIE = 'perf_delta_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSIONS = new Map();

function readSecrets() {
  const secPath = path.join(PROJECT_ROOT, 'secrets.yaml');
  return fs.existsSync(secPath) ? yaml.load(fs.readFileSync(secPath, 'utf8')) || {} : {};
}

function writeSecrets(sec) {
  const secPath = path.join(PROJECT_ROOT, 'secrets.yaml');
  atomicWriteYaml(secPath, sec, '# Perf-Delta Secrets (git-ignored — do not commit)');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${key}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  const derived = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

function parseCookies(req) {
  const raw = req.headers?.cookie || '';
  const map = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      map[k] = decodeURIComponent(v);
    }
  }
  return map;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const sess = SESSIONS.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    SESSIONS.delete(token);
    return null;
  }
  sess.expiresAt = Date.now() + SESSION_TTL_MS;
  return { token, username: sess.username };
}

function createSession(res, username) {
  const token = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(token, { username, expiresAt: Date.now() + SESSION_TTL_MS });
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
  return token;
}

function clearSession(req, res) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) SESSIONS.delete(token);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function requireAdmin(req, res, next) {
  const sess = getSession(req);
  if (!sess) {
    return res.status(401).json({ ok: false, error: 'Admin authentication required.' });
  }
  req.adminUser = sess.username;
  return next();
}

app.get('/api/auth/status', (req, res) => {
  const sec = readSecrets();
  const setupRequired = !Boolean(sec.admin_password_hash);
  const sess = getSession(req);
  return res.json({
    ok: true,
    authenticated: Boolean(sess),
    username: sess ? sess.username : null,
    setupRequired,
  });
});

app.post('/api/auth/setup', (req, res) => {
  try {
    const sec = readSecrets();
    if (sec.admin_password_hash) {
      return res.status(403).json({ ok: false, error: 'Admin account is already configured.' });
    }
    const username = String(req.body?.username || 'admin').trim() || 'admin';
    const password = String(req.body?.password || '');
    if (password.length < 6) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters.' });
    }
    sec.admin_username = username;
    sec.admin_password_hash = hashPassword(password);
    writeSecrets(sec);
    createSession(res, username);
    return res.json({ ok: true, authenticated: true, username, setupRequired: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Admin setup failed.' });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const sec = readSecrets();
    if (!sec.admin_password_hash) {
      return res.status(400).json({ ok: false, error: 'Admin account not configured yet. Please complete first-time setup.' });
    }
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const expectedUser = String(sec.admin_username || 'admin').trim();
    if (username.toLowerCase() !== expectedUser.toLowerCase() || !verifyPassword(password, sec.admin_password_hash)) {
      return res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    }
    createSession(res, expectedUser);
    return res.json({ ok: true, authenticated: true, username: expectedUser, setupRequired: false });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Login failed.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearSession(req, res);
  return res.json({ ok: true, authenticated: false });
});

app.post('/api/auth/change-password', requireAdmin, (req, res) => {
  try {
    const sec = readSecrets();
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const newUsername = String(req.body?.newUsername || sec.admin_username || 'admin').trim() || 'admin';

    if (!verifyPassword(currentPassword, sec.admin_password_hash)) {
      return res.status(401).json({ ok: false, error: 'Current password is incorrect.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters.' });
    }
    sec.admin_username = newUsername;
    sec.admin_password_hash = hashPassword(newPassword);
    writeSecrets(sec);
    createSession(res, newUsername);
    return res.json({ ok: true, username: newUsername, message: 'Admin credentials updated.' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Password update failed.' });
  }
});

app.get('/api/health', async (_req, res) => {
  const { dbPath, sla } = loadConfig();
  let hasAggTables = false;
  if (DuckDBInstance && fs.existsSync(dbPath)) {
    try {
      const inst = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
      const conn = await inst.connect();
      try {
        const tbls = (await queryAll(conn, 'SHOW TABLES')).map((r) => String(r.name));
        hasAggTables = AGG_TABLES.every((t) => tbls.includes(t));
      } finally {
        conn.closeSync();
        inst.closeSync();
      }
    } catch {
      hasAggTables = false;
    }
  }
  res.json({
    ok: true,
    duckdbDriverLoaded: Boolean(DuckDBInstance),
    vaultExists: fs.existsSync(dbPath),
    vaultFile: path.basename(dbPath),
    hasAggTables,
    slaMetric: sla.rtMetric,
    slaRtEnabled: sla.rtEnabled,
    slaOverridesCount: sla.rtOverrides.length,
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

function parseListParam(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter((s) => s && s !== 'ALL');
  const str = String(val).trim();
  if (!str || str === 'ALL') return [];
  if (str.startsWith('[')) {
    try {
      const arr = JSON.parse(str);
      if (Array.isArray(arr)) return arr.map(String).filter(Boolean);
    } catch {
      // fall through
    }
  }
  return str.split(',').map((s) => s.trim()).filter((s) => s && s !== 'ALL');
}

function buildSqlFilterClause(colExpr, values, mode) {
  if (!values || values.length === 0) return '';
  const op = mode === 'exclude' ? 'NOT IN' : 'IN';
  const quoted = values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
  return ` AND ${colExpr} ${op} (${quoted})`;
}

app.get('/api/runs/:runId/timeseries', async (req, res) => {
  const { dbPath, excludedLabels } = loadConfig();
  if (!DuckDBInstance || !fs.existsSync(dbPath)) {
    return res.json({ timeSeries: [] });
  }
  const rawRunId = String(req.params.runId || '').replace(/^vault-(jmeter|neoload)-/i, '');
  const appValues = parseListParam(req.query.apps ?? req.query.app);
  const appMode = req.query.appMode === 'exclude' ? 'exclude' : 'include';
  const scenValues = parseListParam(req.query.scenarios ?? req.query.scenario);
  const scenMode = req.query.scenarioMode === 'exclude' ? 'exclude' : 'include';
  const epValues = parseListParam(req.query.endpoints ?? req.query.endpoint);
  const epMode = req.query.endpointMode === 'exclude' ? 'exclude' : 'include';

  const instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
  const conn = await instance.connect();
  try {
    const tbls = (await queryAll(conn, 'SHOW TABLES')).map((r) => String(r.name));
    const tbl = tbls.includes('performance_history')
      ? 'performance_history'
      : tbls.find((t) => t.startsWith('performance_history_'));
    if (!tbl) return res.json({ timeSeries: [] });

    const ridEsc = rawRunId.replace(/'/g, "''");
    const isPassExpr = "LOWER(TRIM(CAST(success AS VARCHAR))) IN ('true', 'yes', '1')";
    const scenExpr = "COALESCE(NULLIF(TRIM(REGEXP_REPLACE(CAST(thread_group AS VARCHAR), '\\s+\\d+-\\d+$', '')), ''), 'Default Scenario')";
    const vuExpr = "GREATEST(COALESCE(MAX(TRY_CAST(allThreads AS INTEGER)), 0), COUNT(DISTINCT CONCAT(thread_group, '|', threadName)))";

    let where = `CAST(run_id AS VARCHAR) = '${ridEsc}'`;
    for (const s of HARDCODED_EXCLUDED_SUBSTRINGS) {
      where += ` AND LOWER(TRIM(CAST(label AS VARCHAR))) NOT LIKE '%${s.replace(/'/g, "''")}%'`;
    }
    if (excludedLabels.length > 0) {
      where += ` AND label NOT IN (${excludedLabels.map((l) => `'${l.replace(/'/g, "''")}'`).join(', ')})`;
    }
    where += buildSqlFilterClause('CAST(app_name AS VARCHAR)', appValues, appMode);
    where += buildSqlFilterClause(scenExpr, scenValues, scenMode);
    where += buildSqlFilterClause('CAST(label AS VARCHAR)', epValues, epMode);

    const durRows = await queryAll(conn, `
      SELECT GREATEST(date_diff('milliseconds', MIN(timestamp), MAX(timestamp)) / 1000.0, 1.0) AS dur_secs
      FROM ${tbl} WHERE ${where}
    `);
    const durSecs = durRows.length > 0 ? Math.max(toNum(durRows[0].dur_secs, 1), 1) : 1;
    const bucketSecs = durSecs <= 180 ? 5 : durSecs <= 600 ? 15 : durSecs <= 1800 ? 30 : 60;

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
      WHERE ${where}
      GROUP BY 1
      ORDER BY 1 ASC
    `);

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
        errorCount: toNum(t.errors, 0),
        errorRate: Number(((toNum(t.errors) / Math.max(samples, 1)) * 100).toFixed(2)),
        phase: 'steady',
      };
    });

    return res.json({ timeSeries });
  } catch (err) {
    console.error('[dashboard-api] Filtered timeseries failed:', err.message);
    return res.json({ timeSeries: [] });
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
});

// ============================================================
// PERSISTED AI SUMMARIES (DuckDB ai_summaries table)
// ============================================================

async function readSavedAiSummary(scopeKey) {
  const { dbPath } = loadConfig();
  if (!DuckDBInstance || !fs.existsSync(dbPath) || !scopeKey) return null;
  let instance = null;
  let conn = null;
  try {
    instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
    conn = await instance.connect();
    const tbls = (await queryAll(conn, 'SHOW TABLES')).map((r) => String(r.name));
    if (!tbls.includes('ai_summaries')) return null;
    const esc = String(scopeKey).replace(/'/g, "''");
    const rows = await queryAll(
      conn,
      `SELECT provider, model, paragraphs_json, next_steps_json, updated_by, updated_at
       FROM ai_summaries WHERE scope_key = '${esc}' LIMIT 1`
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      provider: String(r.provider || 'AI'),
      model: String(r.model || ''),
      paragraphs: JSON.parse(String(r.paragraphs_json || '[]')),
      nextSteps: JSON.parse(String(r.next_steps_json || '[]')),
      updatedBy: String(r.updated_by || 'admin'),
      updatedAt: toIso(r.updated_at),
    };
  } catch {
    return null;
  } finally {
    if (conn) conn.closeSync();
    if (instance) instance.closeSync();
  }
}

async function saveAiSummaryToDb(payload) {
  const { dbPath } = loadConfig();
  if (!DuckDBInstance || !fs.existsSync(dbPath) || !payload.scopeKey) return;
  let instance = null;
  let conn = null;
  try {
    instance = await DuckDBInstance.create(dbPath);
    conn = await instance.connect();
    await conn.run(`
      CREATE TABLE IF NOT EXISTS ai_summaries (
        scope_key VARCHAR PRIMARY KEY,
        run_id VARCHAR,
        baseline_run_id VARCHAR,
        provider VARCHAR,
        model VARCHAR,
        paragraphs_json VARCHAR,
        next_steps_json VARCHAR,
        updated_by VARCHAR,
        updated_at TIMESTAMP
      )
    `);
    const q = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
    await conn.run(`DELETE FROM ai_summaries WHERE scope_key = ${q(payload.scopeKey)}`);
    await conn.run(`
      INSERT INTO ai_summaries (
        scope_key, run_id, baseline_run_id, provider, model,
        paragraphs_json, next_steps_json, updated_by, updated_at
      ) VALUES (
        ${q(payload.scopeKey)},
        ${q(payload.runId)},
        ${q(payload.baselineRunId)},
        ${q(payload.provider)},
        ${q(payload.model)},
        ${q(JSON.stringify(payload.paragraphs || []))},
        ${q(JSON.stringify(payload.nextSteps || []))},
        ${q(payload.updatedBy)},
        CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.warn('[dashboard-api] Could not persist AI summary to DuckDB:', err.message);
  } finally {
    if (conn) conn.closeSync();
    if (instance) instance.closeSync();
  }
}

app.get('/api/ai-summary', async (req, res) => {
  try {
    const scopeKey = String(req.query.scopeKey || '').trim();
    if (!scopeKey) return res.json({ ok: true, found: false });
    const saved = await readSavedAiSummary(scopeKey);
    if (!saved) return res.json({ ok: true, found: false });
    return res.json({ ok: true, found: true, summary: saved });
  } catch (err) {
    return res.json({ ok: false, found: false, reason: err?.message });
  }
});

app.delete('/api/ai-summary', requireAdmin, async (req, res) => {
  const scopeKey = String(req.query.scopeKey || '').trim();
  const { dbPath } = loadConfig();
  if (!scopeKey || !DuckDBInstance || !fs.existsSync(dbPath)) {
    return res.json({ ok: true });
  }
  let instance = null;
  let conn = null;
  try {
    instance = await DuckDBInstance.create(dbPath);
    conn = await instance.connect();
    const tbls = (await queryAll(conn, 'SHOW TABLES')).map((r) => String(r.name));
    if (tbls.includes('ai_summaries')) {
      await conn.run(`DELETE FROM ai_summaries WHERE scope_key = '${scopeKey.replace(/'/g, "''")}'`);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message });
  } finally {
    if (conn) conn.closeSync();
    if (instance) instance.closeSync();
  }
});

app.post('/api/ai-summary', requireAdmin, async (req, res) => {
  try {
    const cfgPath = path.join(PROJECT_ROOT, 'config.yaml');
    const cfg = fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {} : {};
    const secPath = path.join(PROJECT_ROOT, 'secrets.yaml');
    const sec = fs.existsSync(secPath) ? yaml.load(fs.readFileSync(secPath, 'utf8')) || {} : {};

    const aiUrl = String(cfg.ai_url || 'https://generativelanguage.googleapis.com/v1beta/models').trim();
    const isGemini = /generativelanguage\.googleapis\.com/i.test(aiUrl) || Boolean(sec.gemini_api_key || process.env.GEMINI_API_KEY);
    const effectiveUrl = isGemini && !/generativelanguage\.googleapis\.com/i.test(aiUrl) && !sec.amplify_token
      ? 'https://generativelanguage.googleapis.com/v1beta/models'
      : aiUrl;
    const useGemini = /generativelanguage\.googleapis\.com/i.test(effectiveUrl);

    const apiKey = useGemini
      ? String(sec.gemini_api_key || process.env.GEMINI_API_KEY || '').trim()
      : String(sec.amplify_token || '').trim();

    if (!apiKey) {
      return res.json({
        ok: false,
        reason: useGemini
          ? 'No Gemini API key found. Add gemini_api_key to secrets.yaml or set GEMINI_API_KEY.'
          : 'No Amplify API token found. Add amplify_token to secrets.yaml.',
      });
    }

    const aiModel = useGemini
      ? (/gemini/i.test(String(cfg.ai_model_id || '')) ? String(cfg.ai_model_id).trim() : 'gemini-2.5-flash')
      : String(cfg.ai_model_id || '19b89d52-23cf-463d-a5bb-c2896a0f8661').trim();

    const body = req.body || {};
    const prompt = [
      'Write a clear, concise executive summary of this performance test for engineering and project stakeholders.',
      'Use plain natural British English. Bold key metrics, scenario names, and transaction names with **...**.',
      'Do NOT include any preamble (start directly with Paragraph 1).',
      'Output 2 concise paragraphs (2-3 sentences each), followed by a line "Next steps:" and 3 practical bullet points starting with "- ".',
      '',
      `Run: ${body.runName || 'Performance Run'}`,
      `Scope: ${body.scopeLabel || 'Full Run'}`,
      `Duration: ${body.durationMinutes || 0} min | Peak VUs: ${body.peakVUs || 0} | Requests: ${body.totalRequests || 0}`,
      `Throughput: ${body.avgThroughputRps || 0} req/s | P95: ${body.p95ResponseTimeMs || 0} ms | Error Rate: ${body.errorRatePct || 0}%`,
      `Apdex: ${body.apdexScore ?? 'N/A'} (${body.apdexRating || 'N/A'}) | SLA Status: ${body.overallStatus || 'INFO'}`,
      body.baselineName
        ? `Baseline: ${body.baselineName} (P95: ${body.baselineP95Ms} ms, TPS: ${body.baselineTps} req/s, Error Rate: ${body.baselineErrorPct}%)`
        : 'Baseline: Standalone single-run report (no baseline).',
      body.slowestEndpoint
        ? `Slowest Transaction: ${body.slowestEndpoint.name} at ${body.slowestEndpoint.p95} ms (SLA: ${body.slowestEndpoint.sla} ms)`
        : '',
      body.scenarioSummary ? `Scenarios:\n${body.scenarioSummary}` : '',
      body.errorSummary ? `Errors:\n${body.errorSummary}` : '',
    ].filter(Boolean).join('\n');

    let rawText = '';
    if (useGemini) {
      const endpoint = effectiveUrl.includes(':generateContent')
        ? effectiveUrl.replace('{model}', aiModel)
        : `${effectiveUrl.replace(/\/+$/, '')}/${aiModel}:generateContent`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(35000),
      });
      if (!resp.ok) {
        return res.json({ ok: false, reason: `Gemini API returned HTTP ${resp.status}.` });
      }
      const data = await resp.json();
      rawText = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
    } else {
      const resp = await fetch(effectiveUrl, {
        method: 'POST',
        headers: {
          accept: '*/*',
          token: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model_id: aiModel,
          messages: [{ role: 'user', content: prompt }],
          parameters: { temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(35000),
      });
      if (!resp.ok) {
        return res.json({ ok: false, reason: `Amplify API returned HTTP ${resp.status}.` });
      }
      const data = await resp.json();
      rawText = String(data?.assistant_resp || '').trim();
    }

    if (!rawText || rawText.length < 30) {
      return res.json({ ok: false, reason: 'AI provider returned an empty response.' });
    }

    const parts = rawText.split(/\n\s*[*_#]*\s*(?:Next steps|Recommended actions|Key actions)[*_:\s]*\r?\n/i);
    const narrativePart = (parts[0] || rawText).trim();
    const stepsPart = (parts[1] || '').trim();

    const paragraphs = narrativePart
      .split(/\n\s*\n/)
      .map((p) => p.replace(/^[-*•]\s+/, '').trim())
      .filter((p) => p.length > 0 && !/^(here('s| is)|below is|executive summary)/i.test(p));

    const nextSteps = stepsPart
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
      .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, '').trim())
      .slice(0, 4);

    const finalParagraphs = paragraphs.length > 0 ? paragraphs : [narrativePart];
    const providerName = useGemini ? 'Gemini' : 'Amplify';
    const updatedAt = new Date().toISOString();

    if (body.scopeKey) {
      await saveAiSummaryToDb({
        scopeKey: String(body.scopeKey),
        runId: String(body.runId || ''),
        baselineRunId: String(body.baselineRunId || ''),
        provider: providerName,
        model: aiModel,
        paragraphs: finalParagraphs,
        nextSteps,
        updatedBy: req.adminUser || 'admin',
      });
    }

    return res.json({
      ok: true,
      provider: providerName,
      model: aiModel,
      paragraphs: finalParagraphs,
      nextSteps,
      updatedBy: req.adminUser || 'admin',
      updatedAt,
    });
  } catch (err) {
    return res.json({ ok: false, reason: err?.message || 'AI request failed.' });
  }
});

// ============================================================
// LIVE SETTINGS API (config.yaml + SLA/performance-sla.yaml + secrets.yaml)
// ============================================================

function maskSecret(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (s.length <= 8) return '••••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function atomicWriteYaml(filePath, data, headerComment = '') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const dumped = yaml.dump(data, { lineWidth: 120, noRefs: true, quotingType: '"' });
  const content = headerComment ? `${headerComment.trimEnd()}\n\n${dumped}` : dumped;
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function resolveSlaPath(cfg) {
  const rawSla = cfg?.sla_file_path && String(cfg.sla_file_path).trim()
    ? String(cfg.sla_file_path).trim()
    : 'SLA/performance-sla.yaml';
  return path.isAbsolute(rawSla) ? rawSla : path.resolve(PROJECT_ROOT, rawSla);
}

function buildSettingsPayload() {
  const cfgPath = path.join(PROJECT_ROOT, 'config.yaml');
  const cfg = fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {} : {};
  const slaPath = resolveSlaPath(cfg);
  const slaCfg = fs.existsSync(slaPath) ? yaml.load(fs.readFileSync(slaPath, 'utf8')) || {} : {};
  const secPath = path.join(PROJECT_ROOT, 'secrets.yaml');
  const sec = fs.existsSync(secPath) ? yaml.load(fs.readFileSync(secPath, 'utf8')) || {} : {};

  const aiUrl = String(cfg.ai_url || 'https://generativelanguage.googleapis.com/v1beta/models').trim();
  const provider = /generativelanguage\.googleapis\.com/i.test(aiUrl) ? 'gemini' : 'amplify';

  const rtCfg = slaCfg?.response_time_sla || {};
  const rules = Array.isArray(slaCfg?.sla_rules) ? slaCfg.sla_rules : [];
  const erRule = rules.find((r) => r.metric === 'error_rate') || {};
  const tpsRule = rules.find((r) => r.metric === 'throughput') || {};
  const vuRule = rules.find((r) => r.metric === 'total_users') || {};

  const geminiKey = String(sec.gemini_api_key || '').trim();
  const amplifyToken = String(sec.amplify_token || '').trim();

  return {
    general: {
      project: String(cfg?.params?.project ?? ''),
      version: String(cfg?.params?.version ?? 'v2.0'),
      reportTheme: String(cfg?.params?.report_theme ?? 'cyber-slate') === 'light' ? 'light' : 'cyber-slate',
      displayTimezone: String(cfg?.timezone?.display_timezone ?? 'Pacific/Auckland'),
      showTimezoneAbbr: cfg?.timezone?.show_timezone_abbr !== false,
      databasePath: String(cfg?.database_path ?? 'Data/Performance_Vault.db'),
      slaFilePath: String(cfg?.sla_file_path ?? 'SLA/performance-sla.yaml'),
      outputDir: String(cfg?.output_dir ?? 'Reports'),
    },
    ai: {
      provider,
      aiUrl,
      aiModelId: String(cfg.ai_model_id || (provider === 'gemini' ? 'gemini-2.5-flash' : '')),
      aiPromptTemplate: String(cfg.ai_prompt_template || ''),
      hasGeminiKey: Boolean(geminiKey),
      geminiKeyMasked: maskSecret(geminiKey),
      hasGeminiEnvVar: Boolean(String(process.env.GEMINI_API_KEY || '').trim()),
      hasAmplifyToken: Boolean(amplifyToken),
      amplifyTokenMasked: maskSecret(amplifyToken),
    },
    exclusions: {
      labels: Array.isArray(cfg.label_exclusions) ? cfg.label_exclusions.map(String) : [],
      hardcoded: ['bzm - Parallel Controller'],
    },
    sla: {
      showOverallStatus: slaCfg?.show_overall_status !== false,
      responseTime: {
        enabled: rtCfg.enabled !== false,
        metric: String(rtCfg.metric || 'p95').toLowerCase() === 'p90' ? 'p90' : 'p95',
        defaultThreshold: Number(rtCfg.default_threshold) || 3000,
        tolerancePct: Number(rtCfg.tolerance_pct) || 0,
        overrides: Array.isArray(rtCfg.overrides)
          ? rtCfg.overrides
              .filter((o) => o && o.label && o.threshold != null)
              .map((o) => ({ label: String(o.label), threshold: Number(o.threshold) }))
          : [],
      },
      rules: {
        errorRate: {
          enabled: erRule.enabled !== false,
          threshold: erRule.threshold != null ? Number(erRule.threshold) : 1.0,
        },
        throughput: {
          enabled: tpsRule.enabled !== false,
          threshold: tpsRule.threshold != null ? Number(tpsRule.threshold) : 5.0,
        },
        totalUsers: {
          enabled: vuRule.enabled !== false,
          threshold: vuRule.threshold != null ? Number(vuRule.threshold) : 1,
        },
      },
    },
  };
}

app.get('/api/settings', requireAdmin, (_req, res) => {
  try {
    return res.json({ ok: true, settings: buildSettingsPayload() });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to read settings.' });
  }
});

app.put('/api/settings', requireAdmin, (req, res) => {
  try {
    const body = req.body || {};
    const cfgPath = path.join(PROJECT_ROOT, 'config.yaml');
    const cfg = fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {} : {};

    // 1. Update config.yaml (preserving untouched keys like tool_mappings, workload_profile, bin_size)
    if (body.general) {
      const g = body.general;
      cfg.params = cfg.params && typeof cfg.params === 'object' ? cfg.params : {};
      if (g.project !== undefined) cfg.params.project = String(g.project);
      if (g.version !== undefined) cfg.params.version = String(g.version || 'v2.0');
      if (g.reportTheme !== undefined) {
        cfg.params.report_theme = g.reportTheme === 'light' ? 'light' : 'cyber-slate';
      }
      cfg.timezone = cfg.timezone && typeof cfg.timezone === 'object' ? cfg.timezone : { source_timezone: 'UTC' };
      if (g.displayTimezone !== undefined) cfg.timezone.display_timezone = String(g.displayTimezone);
      if (g.showTimezoneAbbr !== undefined) cfg.timezone.show_timezone_abbr = Boolean(g.showTimezoneAbbr);
      if (g.databasePath && String(g.databasePath).trim()) cfg.database_path = String(g.databasePath).trim();
      if (g.slaFilePath && String(g.slaFilePath).trim()) cfg.sla_file_path = String(g.slaFilePath).trim();
      if (g.outputDir && String(g.outputDir).trim()) cfg.output_dir = String(g.outputDir).trim();
    }

    if (body.ai) {
      const a = body.ai;
      if (a.aiUrl !== undefined && String(a.aiUrl).trim()) cfg.ai_url = String(a.aiUrl).trim();
      if (a.aiModelId !== undefined && String(a.aiModelId).trim()) cfg.ai_model_id = String(a.aiModelId).trim();
      if (a.aiPromptTemplate !== undefined && String(a.aiPromptTemplate).trim()) {
        cfg.ai_prompt_template = String(a.aiPromptTemplate);
      }
    }

    if (body.exclusions && Array.isArray(body.exclusions.labels)) {
      cfg.label_exclusions = [...new Set(body.exclusions.labels.map((s) => String(s).trim()).filter(Boolean))];
    }

    atomicWriteYaml(
      cfgPath,
      cfg,
      '# Perf-Delta Configuration (managed by Perf-Delta Live Settings & Static Report Engine)'
    );

    // 2. Update SLA/performance-sla.yaml (preserving per-app overrides & descriptions)
    if (body.sla) {
      const s = body.sla;
      const slaPath = resolveSlaPath(cfg);
      const slaCfg = fs.existsSync(slaPath) ? yaml.load(fs.readFileSync(slaPath, 'utf8')) || {} : {};

      if (s.showOverallStatus !== undefined) {
        slaCfg.show_overall_status = Boolean(s.showOverallStatus);
      }

      const rules = Array.isArray(slaCfg.sla_rules) ? slaCfg.sla_rules : [];
      const upsertRule = (metric, defaults, incoming) => {
        if (!incoming) return;
        let existing = rules.find((r) => r.metric === metric);
        if (!existing) {
          existing = { metric, ...defaults };
          rules.push(existing);
        }
        if (incoming.enabled !== undefined) existing.enabled = Boolean(incoming.enabled);
        if (incoming.threshold !== undefined && Number.isFinite(Number(incoming.threshold))) {
          existing.threshold = Number(incoming.threshold);
        }
      };

      upsertRule('total_users', { label: 'Virtual Users', operator: '>=', description: 'Minimum virtual users.' }, s.rules?.totalUsers);
      upsertRule('error_rate', { label: 'Error Rate', operator: '<=', unit: '%', description: 'Max error rate (%).' }, s.rules?.errorRate);
      upsertRule('throughput', { label: 'Throughput', operator: '>=', unit: 'tps', description: 'Min throughput (req/s).' }, s.rules?.throughput);
      slaCfg.sla_rules = rules;

      if (s.responseTime) {
        const rt = s.responseTime;
        slaCfg.response_time_sla = slaCfg.response_time_sla && typeof slaCfg.response_time_sla === 'object'
          ? slaCfg.response_time_sla
          : { unit: 'ms' };
        if (rt.enabled !== undefined) slaCfg.response_time_sla.enabled = Boolean(rt.enabled);
        if (rt.metric !== undefined) {
          slaCfg.response_time_sla.metric = String(rt.metric).toLowerCase() === 'p90' ? 'p90' : 'p95';
        }
        if (rt.defaultThreshold !== undefined && Number.isFinite(Number(rt.defaultThreshold))) {
          slaCfg.response_time_sla.default_threshold = Math.max(1, Number(rt.defaultThreshold));
        }
        if (rt.tolerancePct !== undefined && Number.isFinite(Number(rt.tolerancePct))) {
          slaCfg.response_time_sla.tolerance_pct = Math.max(0, Number(rt.tolerancePct));
        }
        if (Array.isArray(rt.overrides)) {
          slaCfg.response_time_sla.overrides = rt.overrides
            .filter((o) => o && String(o.label || '').trim() && Number.isFinite(Number(o.threshold)))
            .map((o) => ({ label: String(o.label).trim(), threshold: Math.max(1, Number(o.threshold)) }));
        }
      }

      atomicWriteYaml(
        slaPath,
        slaCfg,
        '# Perf-Delta SLA Thresholds (managed by Perf-Delta Live Settings & Static Report Engine)'
      );
    }

    // 3. Update secrets.yaml only when keys are explicitly added or cleared
    if (body.secrets) {
      const secPath = path.join(PROJECT_ROOT, 'secrets.yaml');
      const sec = fs.existsSync(secPath) ? yaml.load(fs.readFileSync(secPath, 'utf8')) || {} : {};
      let secDirty = false;

      if (body.secrets.clearGeminiKey) {
        delete sec.gemini_api_key;
        secDirty = true;
      } else if (typeof body.secrets.geminiApiKey === 'string' && body.secrets.geminiApiKey.trim()) {
        sec.gemini_api_key = body.secrets.geminiApiKey.trim();
        secDirty = true;
      }

      if (body.secrets.clearAmplifyToken) {
        delete sec.amplify_token;
        secDirty = true;
      } else if (typeof body.secrets.amplifyToken === 'string' && body.secrets.amplifyToken.trim()) {
        sec.amplify_token = body.secrets.amplifyToken.trim();
        secDirty = true;
      }

      if (secDirty) {
        atomicWriteYaml(secPath, sec, '# Perf-Delta Secrets (git-ignored — do not commit)');
      }
    }

    return res.json({ ok: true, settings: buildSettingsPayload() });
  } catch (err) {
    console.error('[dashboard-api] Save settings failed:', err.message);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to save settings.' });
  }
});

app.post('/api/settings/test-ai', requireAdmin, async (req, res) => {
  const started = Date.now();
  try {
    const body = req.body || {};
    const cfgPath = path.join(PROJECT_ROOT, 'config.yaml');
    const cfg = fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {} : {};
    const secPath = path.join(PROJECT_ROOT, 'secrets.yaml');
    const sec = fs.existsSync(secPath) ? yaml.load(fs.readFileSync(secPath, 'utf8')) || {} : {};

    const aiUrl = String(body.aiUrl || cfg.ai_url || 'https://generativelanguage.googleapis.com/v1beta/models').trim();
    const useGemini = body.provider
      ? body.provider === 'gemini'
      : /generativelanguage\.googleapis\.com/i.test(aiUrl);
    const aiModel = String(
      body.aiModelId || cfg.ai_model_id || (useGemini ? 'gemini-2.5-flash' : '19b89d52-23cf-463d-a5bb-c2896a0f8661')
    ).trim();

    const apiKey = useGemini
      ? String(body.geminiApiKey || sec.gemini_api_key || process.env.GEMINI_API_KEY || '').trim()
      : String(body.amplifyToken || sec.amplify_token || '').trim();

    if (!apiKey) {
      return res.json({
        ok: false,
        provider: useGemini ? 'Gemini' : 'Amplify',
        model: aiModel,
        latencyMs: Date.now() - started,
        message: useGemini
          ? 'No Gemini API key entered or saved in secrets.yaml.'
          : 'No Amplify API token entered or saved in secrets.yaml.',
      });
    }

    if (useGemini) {
      const endpoint = aiUrl.includes(':generateContent')
        ? aiUrl.replace('{model}', aiModel)
        : `${aiUrl.replace(/\/+$/, '')}/${aiModel}:generateContent`;
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: OK' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 16 },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) {
        return res.json({
          ok: false,
          provider: 'Gemini',
          model: aiModel,
          latencyMs: Date.now() - started,
          message: `Gemini returned HTTP ${resp.status}. Check your API key and model ID.`,
        });
      }
      return res.json({
        ok: true,
        provider: 'Gemini',
        model: aiModel,
        latencyMs: Date.now() - started,
        message: `Connected to Gemini (${aiModel}) successfully.`,
      });
    }

    const resp = await fetch(aiUrl, {
      method: 'POST',
      headers: { accept: '*/*', token: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: aiModel,
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        parameters: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      return res.json({
        ok: false,
        provider: 'Amplify',
        model: aiModel,
        latencyMs: Date.now() - started,
        message: `Amplify returned HTTP ${resp.status}. Check your token and model ID.`,
      });
    }
    return res.json({
      ok: true,
      provider: 'Amplify',
      model: aiModel,
      latencyMs: Date.now() - started,
      message: `Connected to Amplify (${aiModel}) successfully.`,
    });
  } catch (err) {
    return res.json({
      ok: false,
      provider: 'AI',
      model: '',
      latencyMs: Date.now() - started,
      message: err?.message || 'Connection test failed.',
    });
  }
});

// ============================================================
// DUCKDB DATABASE EXPLORER (Admin-only, Strictly Read-Only)
// ============================================================

function serializeDbCell(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'bigint') return Number(val);
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object') {
    if ('micros' in val) {
      return new Date(Number(val.micros) / 1000).toISOString();
    }
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  return val;
}

function isReadOnlySql(rawSql) {
  const cleaned = String(rawSql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ')
    .trim();
  if (!cleaned) return { ok: false, reason: 'SQL query is empty.' };
  // Disallow stacked statements (semicolon followed by another statement)
  const withoutTrailingSemi = cleaned.replace(/;+\s*$/, '');
  if (/;/.test(withoutTrailingSemi)) {
    return { ok: false, reason: 'Only a single read-only SQL statement is allowed per execution.' };
  }
  if (!/^(SELECT|WITH|SHOW|DESCRIBE|DESC|PRAGMA|EXPLAIN|SUMMARIZE)\b/i.test(withoutTrailingSemi)) {
    return {
      ok: false,
      reason: 'Read-Only Explorer: only SELECT, WITH, SHOW, DESCRIBE, EXPLAIN, SUMMARIZE, or PRAGMA statements are permitted.',
    };
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|ATTACH|DETACH|COPY)\b/i.test(withoutTrailingSemi)) {
    return {
      ok: false,
      reason: 'Write/DDL keywords are blocked in Read-Only Explorer mode.',
    };
  }
  return { ok: true, sql: withoutTrailingSemi };
}

app.get('/api/db/schema', requireAdmin, async (_req, res) => {
  const { dbPath } = loadConfig();
  if (!DuckDBInstance || !fs.existsSync(dbPath)) {
    return res.status(503).json({ ok: false, error: 'DuckDB vault is unavailable.' });
  }
  let instance = null;
  let conn = null;
  try {
    instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
    conn = await instance.connect();
    const tblRows = await queryAll(conn, 'SHOW TABLES');
    const tables = [];
    for (const t of tblRows) {
      const name = String(t.name);
      const qName = `"${name.replace(/"/g, '""')}"`;
      const [descRows, cntRows] = await Promise.all([
        queryAll(conn, `DESCRIBE ${qName}`),
        queryAll(conn, `SELECT COUNT(*) AS cnt FROM ${qName}`),
      ]);
      tables.push({
        name,
        rowCount: cntRows.length > 0 ? toNum(cntRows[0].cnt, 0) : 0,
        columns: descRows.map((c) => ({
          name: String(c.column_name),
          type: String(c.column_type),
        })),
      });
    }
    return res.json({ ok: true, dbFile: path.basename(dbPath), tables });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to inspect schema.' });
  } finally {
    if (conn) conn.closeSync();
    if (instance) instance.closeSync();
  }
});

app.post('/api/db/query', requireAdmin, async (req, res) => {
  const started = Date.now();
  const { dbPath } = loadConfig();
  if (!DuckDBInstance || !fs.existsSync(dbPath)) {
    return res.status(503).json({ ok: false, error: 'DuckDB vault is unavailable.' });
  }
  const check = isReadOnlySql(req.body?.sql);
  if (!check.ok) {
    return res.status(400).json({ ok: false, error: check.reason });
  }
  const maxRows = Math.min(Math.max(Number(req.body?.maxRows) || 500, 1), 5000);

  let instance = null;
  let conn = null;
  try {
    instance = await DuckDBInstance.create(dbPath, { access_mode: 'READ_ONLY' });
    conn = await instance.connect();
    const rawRows = await queryAll(conn, check.sql);
    const totalFetched = rawRows.length;
    const truncated = totalFetched > maxRows;
    const sliced = truncated ? rawRows.slice(0, maxRows) : rawRows;
    const columns = sliced.length > 0 ? Object.keys(sliced[0]) : [];
    const rows = sliced.map((r) => {
      const out = {};
      for (const col of columns) {
        out[col] = serializeDbCell(r[col]);
      }
      return out;
    });
    return res.json({
      ok: true,
      columns,
      rows,
      rowCount: rows.length,
      totalFetched,
      truncated,
      elapsedMs: Date.now() - started,
    });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: err?.message || 'Query execution failed.',
      elapsedMs: Date.now() - started,
    });
  } finally {
    if (conn) conn.closeSync();
    if (instance) instance.closeSync();
  }
});

app.listen(PORT, () => {
  console.log(`>>> [Perf-Delta API] Listening on http://localhost:${PORT}`);
  console.log(`>>> [Perf-Delta API] DuckDB Native Driver: ${DuckDBInstance ? 'ENABLED' : 'FALLBACK (vault-runs.json)'}`);
});
