/**
 * Native DuckDB CSV Ingestion Engine (`dashboard-api/ingest.js`)
 *
 * Shared by BOTH the Web UI upload endpoint (`POST /api/runs/register`) and the CLI (`register-cli.js`).
 * Uses DuckDB's native C++ `read_csv_auto(..., all_varchar=true)` reader to stream JMeter / NeoLoad
 * CSVs straight into `performance_history` without loading large files into Node.js V8 memory,
 * then builds 6 pre-aggregated `agg_*` summary tables for sub-200ms dashboard queries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';

const HARDCODED_PARALLEL_EXCL = " AND LOWER(TRIM(CAST(label AS VARCHAR))) NOT LIKE '%bzm - parallel controller%'";

export function parseCsvFilename(filePathOrName) {
  const base = path.basename(filePathOrName);
  const stem = base.replace(/\.csv$/i, '');
  const parts = stem.split('_');
  if (parts.length < 4) {
    throw new Error(
      `Invalid CSV filename '${base}'. Expected: <ProjectName>_<TestType>_<AppName>_<BuildId>_<Timestamp>.csv (e.g. ECAN_PeakLoad_ECan-UAT_10008_20261126.csv)`
    );
  }
  const project_name = parts[0].trim();
  const test_name = parts[1].trim();
  const app_name = parts[2].trim();
  const run_id = parts[3].trim();
  if (!project_name || !test_name || !app_name || !run_id) {
    throw new Error(`Invalid CSV filename '${base}': empty metadata segment.`);
  }
  return { basename: base, project_name, test_name, app_name, run_id };
}

function sqlStr(val) {
  return `'${String(val ?? '').replace(/'/g, "''")}'`;
}

function qIdent(col) {
  return `"${String(col).replace(/"/g, '""')}"`;
}

async function queryAll(conn, sql) {
  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjects();
}

function toNum(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildColumnLookup(headerCols, mapping) {
  const exact = new Set(headerCols);
  const lowerMap = new Map(headerCols.map((c) => [c.toLowerCase(), c]));
  return (canonicalField) => {
    const mapped = mapping?.[canonicalField];
    if (mapped && exact.has(mapped)) return mapped;
    if (mapped && lowerMap.has(String(mapped).toLowerCase())) {
      return lowerMap.get(String(mapped).toLowerCase());
    }
    if (exact.has(canonicalField)) return canonicalField;
    if (lowerMap.has(canonicalField.toLowerCase())) {
      return lowerMap.get(canonicalField.toLowerCase());
    }
    return null;
  };
}

/**
 * Ingest one or more JMeter/NeoLoad CSV files directly into Data/Performance_Vault.db
 * using DuckDB's native C++ read_csv_auto engine and rebuild the 6 agg_* summary tables.
 *
 * @param {object} opts
 * @param {Array<{ filePath: string, originalName?: string }>} opts.files
 * @param {string} [opts.toolType='jmeter']
 * @param {string} opts.dbPath
 * @param {object} [opts.config={}]
 */
export async function registerCsvFiles({ files, toolType = 'jmeter', dbPath, config = {} }) {
  const started = Date.now();
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('No CSV files provided for registration.');
  }

  // 1. Parse & validate all filenames
  const parsedFiles = files.map((f) => {
    const meta = parseCsvFilename(f.originalName || f.filePath);
    return { ...meta, filePath: f.filePath };
  });

  const uniqueRunIds = [...new Set(parsedFiles.map((p) => p.run_id))];
  if (uniqueRunIds.length > 1) {
    throw new Error(
      `CSV files have different BuildIds (${uniqueRunIds.join(', ')}). All CSVs in one registration must share the same BuildId.`
    );
  }

  const runId = uniqueRunIds[0];
  const cfgProject = String(config?.params?.project || '').trim();
  const projectName = cfgProject || parsedFiles[0].project_name;
  const testName = parsedFiles[0].test_name;
  const uniqueApps = [...new Set(parsedFiles.map((p) => p.app_name))];

  const toolKey = config?.tool_mappings?.[toolType] ? toolType : 'jmeter';
  const mapping = config?.tool_mappings?.[toolKey] || {
    timestamp: 'timeStamp',
    elapsed: 'elapsed',
    label: 'label',
    responseCode: 'responseCode',
    responseMessage: 'responseMessage',
    threadName: 'threadName',
    dataType: 'dataType',
    success: 'success',
    failureMessage: 'failureMessage',
    bytes: 'bytes',
    sentBytes: 'sentBytes',
    grpThreads: 'grpThreads',
    allThreads: 'allThreads',
    URL: 'URL',
    Latency: 'Latency',
    IdleTime: 'IdleTime',
    Connect: 'Connect',
  };

  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  try {
    // 2. Ensure canonical performance_history table exists
    await conn.run(`
      CREATE TABLE IF NOT EXISTS performance_history (
        sequence_num DOUBLE,
        run_id VARCHAR,
        project_name VARCHAR,
        test_name VARCHAR,
        app_name VARCHAR,
        csv_filename VARCHAR,
        timestamp TIMESTAMP,
        elapsed DOUBLE,
        label VARCHAR,
        responseCode DOUBLE,
        responseMessage VARCHAR,
        threadName VARCHAR,
        dataType VARCHAR,
        success BOOLEAN,
        failureMessage VARCHAR,
        bytes DOUBLE,
        sentBytes DOUBLE,
        grpThreads DOUBLE,
        allThreads DOUBLE,
        URL VARCHAR,
        Latency DOUBLE,
        IdleTime DOUBLE,
        Connect DOUBLE,
        upload_time TIMESTAMP,
        thread_group VARCHAR,
        user_index INTEGER
      )
    `);

    // 3. Duplicate Run ID check
    const dupRows = await queryAll(
      conn,
      `SELECT COUNT(*) AS cnt FROM performance_history WHERE CAST(run_id AS VARCHAR) = ${sqlStr(runId)}`
    );
    if (dupRows.length > 0 && toNum(dupRows[0].cnt, 0) > 0) {
      throw new Error(
        `Run ID '${runId}' already exists in performance_history. Delete the existing run in Settings → Manage Runs or use a new BuildId.`
      );
    }

    // 4. Auto-increment sequence_num
    const seqRows = await queryAll(conn, `SELECT COALESCE(MAX(sequence_num), 0) AS max_seq FROM performance_history`);
    const sequenceNum = (seqRows.length > 0 ? toNum(seqRows[0].max_seq, 0) : 0) + 1;

    // 5. Ingest each CSV natively via DuckDB read_csv_auto
    for (const pf of parsedFiles) {
      const normalizedPath = pf.filePath.replace(/\\/g, '/');
      const csvReadExpr = `read_csv_auto(${sqlStr(normalizedPath)}, header=true, all_varchar=true, ignore_errors=true, null_padding=true)`;
      const descRows = await queryAll(conn, `DESCRIBE SELECT * FROM ${csvReadExpr}`);
      const headerCols = descRows.map((r) => String(r.column_name));
      const colOf = buildColumnLookup(headerCols, mapping);

      const tsCol = colOf('timestamp');
      const elapsedCol = colOf('elapsed');
      const labelCol = colOf('label');
      const rcCol = colOf('responseCode');
      const rmCol = colOf('responseMessage');
      const tnCol = colOf('threadName');
      const upCol = colOf('userPath');
      const dtCol = colOf('dataType');
      const succCol = colOf('success');
      const fmCol = colOf('failureMessage');
      const bytesCol = colOf('bytes');
      const sentBytesCol = colOf('sentBytes');
      const grpCol = colOf('grpThreads');
      const allCol = colOf('allThreads');
      const urlCol = colOf('URL');
      const latCol = colOf('Latency');
      const idleCol = colOf('IdleTime');
      const connCol = colOf('Connect');

      // Timestamp SQL expression: supports epoch ms (>1e11), epoch s, or ISO/standard datetime strings
      const tsExpr = tsCol
        ? `CASE
            WHEN TRY_CAST(${qIdent(tsCol)} AS DOUBLE) IS NOT NULL THEN
              CASE
                WHEN TRY_CAST(${qIdent(tsCol)} AS DOUBLE) > 100000000000
                  THEN to_timestamp(TRY_CAST(${qIdent(tsCol)} AS DOUBLE) / 1000.0)
                ELSE to_timestamp(TRY_CAST(${qIdent(tsCol)} AS DOUBLE))
              END
            ELSE COALESCE(
              TRY_CAST(${qIdent(tsCol)} AS TIMESTAMP),
              TRY_STRPTIME(${qIdent(tsCol)}, '%Y-%m-%d %H:%M:%S'),
              TRY_STRPTIME(${qIdent(tsCol)}, '%d/%m/%Y %H:%M:%S'),
              CURRENT_TIMESTAMP
            )
          END`
        : 'CURRENT_TIMESTAMP';

      const succExpr = succCol
        ? `LOWER(TRIM(COALESCE(${qIdent(succCol)}, 'true'))) IN ('true', 'yes', '1', 'pass', 'ok')`
        : 'TRUE';

      const elapsedExpr = elapsedCol ? `COALESCE(TRY_CAST(${qIdent(elapsedCol)} AS DOUBLE), 0.0)` : '0.0';
      const labelExpr = labelCol ? `COALESCE(NULLIF(TRIM(${qIdent(labelCol)}), ''), 'Unknown')` : "'Unknown'";

      const rcExpr = rcCol
        ? `TRY_CAST(REGEXP_REPLACE(TRIM(COALESCE(${qIdent(rcCol)}, '')), '\\.0$', '') AS DOUBLE)`
        : `CASE WHEN ${succExpr} THEN 200.0 ELSE 500.0 END`;
      const rmExpr = rmCol
        ? `COALESCE(NULLIF(TRIM(${qIdent(rmCol)}), ''), CASE WHEN ${succExpr} THEN 'OK' ELSE 'KO' END)`
        : `CASE WHEN ${succExpr} THEN 'OK' ELSE 'KO' END`;

      const tgExpr = tnCol
        ? `COALESCE(NULLIF(TRIM(REGEXP_REPLACE(COALESCE(${qIdent(tnCol)}, ''), '\\s+\\d+-\\d+$', '')), ''), ${upCol ? `NULLIF(TRIM(${qIdent(upCol)}), '')` : "'Thread Group'"}, 'Thread Group')`
        : upCol
        ? `COALESCE(NULLIF(TRIM(${qIdent(upCol)}), ''), 'Thread Group')`
        : "'Thread Group'";

      const tnExpr = tnCol
        ? `COALESCE(NULLIF(TRIM(${qIdent(tnCol)}), ''), CONCAT(${tgExpr}, ' 1-1'))`
        : `CONCAT(${tgExpr}, ' 1-1')`;

      const userIdxExpr = `TRY_CAST(REGEXP_EXTRACT(${tnExpr}, '(\\d+)$', 1) AS INTEGER)`;

      await conn.run(`
        INSERT INTO performance_history
        SELECT
          ${sequenceNum}::DOUBLE AS sequence_num,
          ${sqlStr(runId)} AS run_id,
          ${sqlStr(projectName)} AS project_name,
          ${sqlStr(testName)} AS test_name,
          ${sqlStr(pf.app_name)} AS app_name,
          ${sqlStr(pf.basename)} AS csv_filename,
          ${tsExpr} AS timestamp,
          ${elapsedExpr} AS elapsed,
          ${labelExpr} AS label,
          ${rcExpr} AS responseCode,
          ${rmExpr} AS responseMessage,
          ${tnExpr} AS threadName,
          ${dtCol ? `COALESCE(${qIdent(dtCol)}, 'text')` : "'text'"} AS dataType,
          ${succExpr} AS success,
          ${fmCol ? `NULLIF(TRIM(${qIdent(fmCol)}), '')` : 'NULL::VARCHAR'} AS failureMessage,
          ${bytesCol ? `COALESCE(TRY_CAST(${qIdent(bytesCol)} AS DOUBLE), 0.0)` : '0.0'} AS bytes,
          ${sentBytesCol ? `COALESCE(TRY_CAST(${qIdent(sentBytesCol)} AS DOUBLE), 0.0)` : '0.0'} AS sentBytes,
          ${grpCol ? `TRY_CAST(${qIdent(grpCol)} AS DOUBLE)` : 'NULL::DOUBLE'} AS grpThreads,
          ${allCol ? `TRY_CAST(${qIdent(allCol)} AS DOUBLE)` : 'NULL::DOUBLE'} AS allThreads,
          ${urlCol ? `NULLIF(TRIM(${qIdent(urlCol)}), '')` : 'NULL::VARCHAR'} AS URL,
          ${latCol ? `COALESCE(TRY_CAST(${qIdent(latCol)} AS DOUBLE), ${elapsedExpr})` : elapsedExpr} AS Latency,
          ${idleCol ? `COALESCE(TRY_CAST(${qIdent(idleCol)} AS DOUBLE), 0.0)` : '0.0'} AS IdleTime,
          ${connCol ? `COALESCE(TRY_CAST(${qIdent(connCol)} AS DOUBLE), 0.0)` : '0.0'} AS Connect,
          CURRENT_TIMESTAMP AS upload_time,
          ${tgExpr} AS thread_group,
          ${userIdxExpr} AS user_index
        FROM ${csvReadExpr}
      `);
    }

    // 6. Build the 6 pre-aggregated summary tables (matching dashboard-api fast-path schema)
    const ridEsc = runId.replace(/'/g, "''");
    const isPassSql = "LOWER(TRIM(CAST(success AS VARCHAR))) IN ('true', 'yes', '1')";
    const appSql = "COALESCE(NULLIF(TRIM(CAST(app_name AS VARCHAR)), ''), 'DefaultApp')";
    const scenSql = "COALESCE(NULLIF(TRIM(REGEXP_REPLACE(CAST(thread_group AS VARCHAR), '\\s+\\d+-\\d+$', '')), ''), 'Default Scenario')";
    const vuSql = "GREATEST(COALESCE(MAX(TRY_CAST(allThreads AS INTEGER)), 0), COUNT(DISTINCT CONCAT(thread_group, '|', threadName)))";

    const durRows = await queryAll(
      conn,
      `SELECT GREATEST(date_diff('milliseconds', MIN(timestamp), MAX(timestamp)) / 1000.0, 1.0) AS dur_secs
       FROM performance_history WHERE CAST(run_id AS VARCHAR) = '${ridEsc}'`
    );
    const durSecs = durRows.length > 0 ? Math.max(toNum(durRows[0].dur_secs, 1), 1) : 1;
    const bucketSecs = durSecs <= 180 ? 5 : durSecs <= 600 ? 15 : durSecs <= 1800 ? 30 : 60;

    await conn.run(`CREATE TABLE IF NOT EXISTS agg_run_summary (
      run_id VARCHAR, sequence_num INTEGER, project_name VARCHAR, test_name VARCHAR,
      start_time TIMESTAMP, end_time TIMESTAMP, duration_secs DOUBLE, bucket_secs INTEGER,
      peak_vus INTEGER, total_samples BIGINT, passed_samples BIGINT, failed_samples BIGINT,
      avg_rt DOUBLE, p90_rt DOUBLE, p95_rt DOUBLE, p99_rt DOUBLE
    )`);
    await conn.run(`DELETE FROM agg_run_summary WHERE run_id = '${ridEsc}'`);
    await conn.run(`
      INSERT INTO agg_run_summary
      SELECT
        CAST(run_id AS VARCHAR), CAST(MAX(sequence_num) AS INTEGER), FIRST(project_name), FIRST(test_name),
        MIN(timestamp), MAX(timestamp),
        GREATEST(date_diff('milliseconds', MIN(timestamp), MAX(timestamp)) / 1000.0, 1.0),
        ${bucketSecs},
        CAST(${vuSql} AS INTEGER),
        COUNT(*),
        SUM(CASE WHEN ${isPassSql} THEN 1 ELSE 0 END),
        SUM(CASE WHEN NOT (${isPassSql}) THEN 1 ELSE 0 END),
        ROUND(AVG(elapsed), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.90), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.95), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.99), 1)
      FROM performance_history
      WHERE CAST(run_id AS VARCHAR) = '${ridEsc}'${HARDCODED_PARALLEL_EXCL}
      GROUP BY run_id
    `);

    await conn.run(`CREATE TABLE IF NOT EXISTS agg_timeseries (
      run_id VARCHAR, bucket_ts TIMESTAMP, active_vus INTEGER, samples BIGINT, errors BIGINT,
      avg_ms DOUBLE, p90_ms DOUBLE, p95_ms DOUBLE, p99_ms DOUBLE
    )`);
    await conn.run(`DELETE FROM agg_timeseries WHERE run_id = '${ridEsc}'`);
    await conn.run(`
      INSERT INTO agg_timeseries
      SELECT
        '${ridEsc}',
        to_timestamp(FLOOR(epoch(timestamp) / ${bucketSecs}) * ${bucketSecs}) AS bucket_ts,
        CAST(${vuSql} AS INTEGER),
        COUNT(*),
        SUM(CASE WHEN NOT (${isPassSql}) THEN 1 ELSE 0 END),
        ROUND(AVG(elapsed), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.90), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.95), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.99), 1)
      FROM performance_history
      WHERE CAST(run_id AS VARCHAR) = '${ridEsc}'${HARDCODED_PARALLEL_EXCL}
      GROUP BY 2
      ORDER BY 2 ASC
    `);

    await conn.run(`CREATE TABLE IF NOT EXISTS agg_app_summary (
      run_id VARCHAR, app_name VARCHAR, samples BIGINT, peak_vus INTEGER,
      avg_ms DOUBLE, p90_ms DOUBLE, p95_ms DOUBLE, p99_ms DOUBLE, errors BIGINT
    )`);
    await conn.run(`DELETE FROM agg_app_summary WHERE run_id = '${ridEsc}'`);
    await conn.run(`
      INSERT INTO agg_app_summary
      SELECT
        '${ridEsc}', ${appSql} AS app_name, COUNT(*), CAST(${vuSql} AS INTEGER),
        ROUND(AVG(elapsed), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.90), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.95), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.99), 1),
        SUM(CASE WHEN NOT (${isPassSql}) THEN 1 ELSE 0 END)
      FROM performance_history
      WHERE CAST(run_id AS VARCHAR) = '${ridEsc}'${HARDCODED_PARALLEL_EXCL}
      GROUP BY 2
    `);

    await conn.run(`CREATE TABLE IF NOT EXISTS agg_scenario_summary (
      run_id VARCHAR, app_name VARCHAR, scenario_name VARCHAR, samples BIGINT,
      avg_ms DOUBLE, p90_ms DOUBLE, p95_ms DOUBLE, p99_ms DOUBLE, errors BIGINT
    )`);
    await conn.run(`DELETE FROM agg_scenario_summary WHERE run_id = '${ridEsc}'`);
    await conn.run(`
      INSERT INTO agg_scenario_summary
      SELECT
        '${ridEsc}', ${appSql} AS app_name, ${scenSql} AS scenario_name, COUNT(*),
        ROUND(AVG(elapsed), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.90), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.95), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.99), 1),
        SUM(CASE WHEN NOT (${isPassSql}) THEN 1 ELSE 0 END)
      FROM performance_history
      WHERE CAST(run_id AS VARCHAR) = '${ridEsc}'${HARDCODED_PARALLEL_EXCL}
      GROUP BY 2, 3
    `);

    await conn.run(`CREATE TABLE IF NOT EXISTS agg_endpoint_summary (
      run_id VARCHAR, app_name VARCHAR, scenario_name VARCHAR, endpoint VARCHAR, samples BIGINT,
      avg_ms DOUBLE, p90_ms DOUBLE, p95_ms DOUBLE, p99_ms DOUBLE, max_ms DOUBLE, errors BIGINT
    )`);
    await conn.run(`DELETE FROM agg_endpoint_summary WHERE run_id = '${ridEsc}'`);
    await conn.run(`
      INSERT INTO agg_endpoint_summary
      SELECT
        '${ridEsc}', ${appSql} AS app_name, ${scenSql} AS scenario_name, CAST(label AS VARCHAR) AS endpoint, COUNT(*),
        ROUND(AVG(elapsed), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.90), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.95), 1),
        ROUND(QUANTILE_CONT(elapsed, 0.99), 1),
        ROUND(MAX(elapsed), 1),
        SUM(CASE WHEN NOT (${isPassSql}) THEN 1 ELSE 0 END)
      FROM performance_history
      WHERE CAST(run_id AS VARCHAR) = '${ridEsc}'${HARDCODED_PARALLEL_EXCL}
      GROUP BY 2, 3, 4
    `);

    await conn.run(`CREATE TABLE IF NOT EXISTS agg_error_details (
      run_id VARCHAR, app_name VARCHAR, scenario_name VARCHAR, endpoint VARCHAR,
      url VARCHAR, response_code VARCHAR, response_message VARCHAR, failure_message VARCHAR,
      error_count BIGINT
    )`);
    await conn.run(`DELETE FROM agg_error_details WHERE run_id = '${ridEsc}'`);
    await conn.run(`
      INSERT INTO agg_error_details
      SELECT
        '${ridEsc}', ${appSql} AS app_name, ${scenSql} AS scenario_name, CAST(label AS VARCHAR) AS endpoint,
        CAST(URL AS VARCHAR),
        REGEXP_REPLACE(CAST(responseCode AS VARCHAR), '\\.0$', ''),
        COALESCE(NULLIF(TRIM(CAST(responseMessage AS VARCHAR)), ''), 'No error message recorded'),
        CAST(failureMessage AS VARCHAR),
        COUNT(*)
      FROM performance_history
      WHERE CAST(run_id AS VARCHAR) = '${ridEsc}' AND NOT (${isPassSql})${HARDCODED_PARALLEL_EXCL}
      GROUP BY 2, 3, 4, 5, 6, 7, 8
    `);

    await conn.run('CHECKPOINT;');

    const summaryRows = await queryAll(
      conn,
      `SELECT total_samples, peak_vus, p95_rt FROM agg_run_summary WHERE run_id = '${ridEsc}' LIMIT 1`
    );
    const totalSamples = summaryRows.length > 0 ? toNum(summaryRows[0].total_samples, 0) : 0;
    const peakVUs = summaryRows.length > 0 ? toNum(summaryRows[0].peak_vus, 0) : 0;
    const p95Rt = summaryRows.length > 0 ? toNum(summaryRows[0].p95_rt, 0) : 0;

    return {
      ok: true,
      runId,
      sequenceNum,
      projectName,
      testName,
      appCount: uniqueApps.length,
      fileCount: parsedFiles.length,
      totalSamples,
      peakVUs,
      p95Rt,
      elapsedMs: Date.now() - started,
    };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}
