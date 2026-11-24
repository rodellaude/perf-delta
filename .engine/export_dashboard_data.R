###############################################################################
# .engine/export_dashboard_data.R
# Non-destructive bridge: Exports registered runs from DuckDB Performance Vault
# into structured JSON for the Cyber-Slate React Performance Dashboard.
# Does NOT modify any existing tables, HTML reports, or engine.R behavior.
###############################################################################

get_script_dir <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  needle <- "--file="
  match <- grep(needle, args)
  if (length(match) > 0) {
    return(dirname(normalizePath(sub(needle, "", args[match]))))
  }
  return(getwd())
}

project_root <- dirname(get_script_dir())
lib_dir <- file.path(project_root, "RLibs")
if (dir.exists(lib_dir)) {
  .libPaths(c(lib_dir, file.path(R.home(), "library")))
}

suppressPackageStartupMessages({
  library(DBI)
  library(duckdb)
  library(dplyr)
  library(yaml)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
out_path <- file.path(project_root, "dashboard-ui", "public", "vault-runs.json")
for (a in args) {
  if (grepl("^--out=", a)) {
    out_path <- sub("^--out=", "", a)
  }
}

cfg_path <- file.path(project_root, "config.yaml")
cfg <- if (file.exists(cfg_path)) yaml::read_yaml(cfg_path) else list()

raw_db_path <- if (!is.null(cfg$database_path) && nzchar(trimws(cfg$database_path))) {
  cfg$database_path
} else {
  "Data/Performance_Vault.db"
}

db_path <- if (grepl("^[A-Za-z]:[/\\\\]|^//|^/[^/]", raw_db_path)) {
  raw_db_path
} else {
  file.path(project_root, raw_db_path)
}

sla_path <- if (!is.null(cfg$sla_file_path) && nzchar(trimws(cfg$sla_file_path))) {
  file.path(project_root, cfg$sla_file_path)
} else {
  file.path(project_root, "SLA", "performance-sla.yaml")
}

sla_cfg <- if (file.exists(sla_path)) yaml::read_yaml(sla_path) else list()
default_p95_sla <- if (!is.null(sla_cfg$response_time_sla$default_threshold)) {
  as.numeric(sla_cfg$response_time_sla$default_threshold)
} else {
  3000
}
default_error_sla <- 1.0
if (!is.null(sla_cfg$sla_rules)) {
  er_rules <- Filter(function(x) identical(x$metric, "error_rate"), sla_cfg$sla_rules)
  if (length(er_rules) > 0 && !is.null(er_rules[[1]]$threshold)) {
    default_error_sla <- as.numeric(er_rules[[1]]$threshold)
  }
}

excluded_labels <- if (!is.null(cfg$label_exclusions)) as.character(cfg$label_exclusions) else character(0)
excl_sql <- if (length(excluded_labels) > 0) {
  paste0(" AND label NOT IN (", paste0("'", gsub("'", "''", excluded_labels), "'", collapse = ", "), ")")
} else {
  ""
}

if (!file.exists(db_path)) {
  stop(paste0("DuckDB vault not found at: ", db_path))
}

con <- dbConnect(duckdb(shared_home = FALSE), dbdir = db_path, read_only = TRUE)
on.exit(dbDisconnect(con, shutdown = TRUE), add = TRUE)

tables <- dbListTables(con)
candidate_tables <- intersect(
  c("performance_history", "performance_history_jmeter", "performance_history_neoload"),
  tables
)

is_pass_expr <- "LOWER(TRIM(CAST(success AS VARCHAR))) IN ('true', 'yes', '1')"
exported_runs <- list()

for (tbl in candidate_tables) {
  tool_label <- if (grepl("neoload", tbl)) "NEOLOAD" else "JMETER"
  cols <- dbListFields(con, tbl)
  has_all_threads <- "allThreads" %in% cols
  has_resp_code <- "responseCode" %in% cols
  has_resp_msg <- "responseMessage" %in% cols
  has_fail_msg <- "failureMessage" %in% cols
  has_thread_group <- "thread_group" %in% cols
  has_thread_name <- "threadName" %in% cols

  vu_expr <- if (has_all_threads && has_thread_group && has_thread_name) {
    "GREATEST(COALESCE(MAX(TRY_CAST(allThreads AS INTEGER)), 0), COUNT(DISTINCT CONCAT(thread_group, '|', threadName)))"
  } else if (has_thread_name) {
    "GREATEST(COUNT(DISTINCT threadName), 1)"
  } else {
    "1"
  }

  runs_df <- dbGetQuery(con, sprintf("
    SELECT
      CAST(run_id AS VARCHAR) AS run_id,
      MAX(sequence_num) AS sequence_num,
      FIRST(project_name) AS project_name,
      FIRST(test_name) AS test_name,
      MIN(timestamp) AS start_time,
      MAX(timestamp) AS end_time,
      GREATEST(date_diff('milliseconds', MIN(timestamp), MAX(timestamp)) / 1000.0, 1.0) AS duration_secs,
      %s AS peak_vus,
      COUNT(*) AS total_samples,
      SUM(CASE WHEN %s THEN 1 ELSE 0 END) AS passed_samples,
      SUM(CASE WHEN NOT (%s) THEN 1 ELSE 0 END) AS failed_samples,
      ROUND(AVG(elapsed), 1) AS avg_rt,
      ROUND(QUANTILE_CONT(elapsed, 0.90), 1) AS p90_rt,
      ROUND(QUANTILE_CONT(elapsed, 0.95), 1) AS p95_rt,
      ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_rt
    FROM %s
    WHERE 1=1 %s
    GROUP BY run_id
    ORDER BY sequence_num DESC
    LIMIT 10
  ", vu_expr, is_pass_expr, is_pass_expr, tbl, excl_sql))

  if (nrow(runs_df) == 0) next

  for (i in seq_len(nrow(runs_df))) {
    r <- runs_df[i, ]
    rid_esc <- gsub("'", "''", r$run_id)
    dur_secs <- max(as.numeric(r$duration_secs), 1.0)
    # Choose adaptive bucket size so charts have ~20-60 clean data points
    bucket_secs <- if (dur_secs <= 300) 10 else if (dur_secs <= 1800) 30 else 60

    ts_df <- dbGetQuery(con, sprintf("
      SELECT
        to_timestamp(FLOOR(epoch(timestamp) / %d) * %d) AS bucket_ts,
        %s AS active_vus,
        COUNT(*) AS samples,
        SUM(CASE WHEN NOT (%s) THEN 1 ELSE 0 END) AS errors,
        ROUND(AVG(elapsed), 1) AS avg_ms,
        ROUND(QUANTILE_CONT(elapsed, 0.90), 1) AS p90_ms,
        ROUND(QUANTILE_CONT(elapsed, 0.95), 1) AS p95_ms,
        ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_ms
      FROM %s
      WHERE CAST(run_id AS VARCHAR) = '%s' %s
      GROUP BY 1
      ORDER BY 1 ASC
    ", bucket_secs, bucket_secs, vu_expr, is_pass_expr, tbl, rid_esc, excl_sql))

    ep_df <- dbGetQuery(con, sprintf("
      SELECT
        CAST(label AS VARCHAR) AS endpoint,
        COUNT(*) AS samples,
        ROUND(AVG(elapsed), 1) AS avg_ms,
        ROUND(QUANTILE_CONT(elapsed, 0.90), 1) AS p90_ms,
        ROUND(QUANTILE_CONT(elapsed, 0.95), 1) AS p95_ms,
        ROUND(QUANTILE_CONT(elapsed, 0.99), 1) AS p99_ms,
        ROUND(MAX(elapsed), 1) AS max_ms,
        SUM(CASE WHEN NOT (%s) THEN 1 ELSE 0 END) AS errors
      FROM %s
      WHERE CAST(run_id AS VARCHAR) = '%s' %s
      GROUP BY label
      ORDER BY p95_ms DESC
      LIMIT 50
    ", is_pass_expr, tbl, rid_esc, excl_sql))

    http_errors <- list()
    assertions <- list()

    if (has_resp_code && r$failed_samples > 0) {
      rc_msg <- if (has_resp_msg) "COALESCE(NULLIF(TRIM(CAST(responseMessage AS VARCHAR)), ''), 'Error')" else "'Error'"
      err_df <- dbGetQuery(con, sprintf("
        SELECT
          REGEXP_REPLACE(CAST(responseCode AS VARCHAR), '\\.0$', '') AS code,
          FIRST(%s) AS message,
          COUNT(*) AS count
        FROM %s
        WHERE CAST(run_id AS VARCHAR) = '%s' AND NOT (%s) %s
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 10
      ", rc_msg, tbl, rid_esc, is_pass_expr, excl_sql))

      if (nrow(err_df) > 0) {
        total_err <- max(sum(err_df$count), 1)
        http_errors <- lapply(seq_len(nrow(err_df)), function(k) {
          list(
            code = as.character(err_df$code[k]),
            label = as.character(err_df$message[k]),
            count = as.integer(err_df$count[k]),
            percentage = round((err_df$count[k] / total_err) * 100, 1)
          )
        })
      }
    }

    if (has_fail_msg && r$failed_samples > 0) {
      af_df <- dbGetQuery(con, sprintf("
        SELECT
          COALESCE(NULLIF(TRIM(CAST(failureMessage AS VARCHAR)), ''), 'Non-2xx HTTP Status / Request Failed') AS message,
          FIRST(CAST(label AS VARCHAR)) AS endpoint,
          COUNT(*) AS count
        FROM %s
        WHERE CAST(run_id AS VARCHAR) = '%s' AND NOT (%s) %s
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 8
      ", tbl, rid_esc, is_pass_expr, excl_sql))

      if (nrow(af_df) > 0) {
        assertions <- lapply(seq_len(nrow(af_df)), function(k) {
          list(
            id = paste0("vault-assert-", k),
            assertion = as.character(af_df$message[k]),
            endpoint = as.character(af_df$endpoint[k]),
            count = as.integer(af_df$count[k]),
            severity = if (af_df$count[k] >= 20) "critical" else "warning"
          )
        })
      }
    }

    ts_list <- if (nrow(ts_df) > 0) {
      lapply(seq_len(nrow(ts_df)), function(k) {
        row_k <- ts_df[k, ]
        epoch_ms <- as.numeric(row_k$bucket_ts) * 1000
        list(
          timestamp = format(row_k$bucket_ts, "%H:%M:%S", tz = "UTC"),
          isoTimestamp = format(row_k$bucket_ts, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
          epochMs = epoch_ms,
          vus = as.integer(row_k$active_vus),
          throughput = round(as.numeric(row_k$samples) / bucket_secs, 2),
          avg = as.numeric(row_k$avg_ms),
          p90 = as.numeric(row_k$p90_ms),
          p95 = as.numeric(row_k$p95_ms),
          p99 = as.numeric(row_k$p99_ms),
          errorRate = round((as.numeric(row_k$errors) / max(as.numeric(row_k$samples), 1)) * 100, 2),
          phase = "steady"
        )
      })
    } else {
      list()
    }

    ep_list <- if (nrow(ep_df) > 0) {
      lapply(seq_len(nrow(ep_df)), function(k) {
        row_k <- ep_df[k, ]
        list(
          endpoint = as.character(row_k$endpoint),
          samples = as.integer(row_k$samples),
          avg = as.numeric(row_k$avg_ms),
          p90 = as.numeric(row_k$p90_ms),
          p95 = as.numeric(row_k$p95_ms),
          p99 = as.numeric(row_k$p99_ms),
          max = as.numeric(row_k$max_ms),
          throughput = round(as.numeric(row_k$samples) / dur_secs, 2),
          errorPct = round((as.numeric(row_k$errors) / max(as.numeric(row_k$samples), 1)) * 100, 2),
          slaP95Ms = default_p95_sla
        )
      })
    } else {
      list()
    }

    avg_tps <- round(as.numeric(r$total_samples) / dur_secs, 2)
    err_rate <- round((as.numeric(r$failed_samples) / max(as.numeric(r$total_samples), 1)) * 100, 2)

    exported_runs[[length(exported_runs) + 1]] <- list(
      id = paste0("vault-", tolower(tool_label), "-", r$run_id),
      name = paste0("[Vault] ", r$project_name, " - ", r$test_name, " #", r$run_id),
      source = "duckdb-vault",
      tool = tool_label,
      environment = paste0("VAULT · ", tool_label),
      startedAt = format(r$start_time, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
      endedAt = format(r$end_time, "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
      durationMinutes = max(round(dur_secs / 60, 1), 0.1),
      sla = list(
        p95Ms = default_p95_sla,
        errorRatePct = default_error_sla
      ),
      summary = list(
        peakVUs = as.integer(r$peak_vus),
        avgThroughputRps = avg_tps,
        p95ResponseTimeMs = as.numeric(r$p95_rt),
        errorRatePct = err_rate,
        totalRequests = as.integer(r$total_samples),
        failedRequests = as.integer(r$failed_samples)
      ),
      timeSeries = ts_list,
      endpoints = ep_list,
      httpErrors = http_errors,
      assertionFailures = assertions
    )
  }
}

out_dir <- dirname(out_path)
if (!dir.exists(out_dir)) dir.create(out_dir, recursive = TRUE)

payload <- list(
  generatedAt = format(Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC"),
  vaultPath = basename(db_path),
  runs = exported_runs
)

jsonlite::write_json(payload, out_path, auto_unbox = TRUE, pretty = TRUE)
message(">>> [DASHBOARD BRIDGE] Exported ", length(exported_runs), " vault run(s) to: ", out_path)
