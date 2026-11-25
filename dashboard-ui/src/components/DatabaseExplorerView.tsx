import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  Eye,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Table2,
} from 'lucide-react';

interface SchemaColumn {
  name: string;
  type: string;
}

interface SchemaTable {
  name: string;
  rowCount: number;
  columns: SchemaColumn[];
}

interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  totalFetched: number;
  truncated: boolean;
  elapsedMs: number;
}

interface DatabaseExplorerViewProps {
  currentRunId: string;
  baselineRunId: string;
}

function stripVaultPrefix(id: string): string {
  return id.replace(/^vault-[a-z]+-/i, '');
}

export const DatabaseExplorerView: React.FC<DatabaseExplorerViewProps> = ({
  currentRunId,
  baselineRunId,
}) => {
  const [dbFile, setDbFile] = useState<string>('Performance_Vault.db');
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [loadingSchema, setLoadingSchema] = useState<boolean>(true);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  const rawCurrent = stripVaultPrefix(currentRunId || '10007');
  const rawBase = baselineRunId ? stripVaultPrefix(baselineRunId) : '';

  const presets = useMemo(
    () => [
      {
        id: 'runs',
        label: 'All Registered Runs',
        category: 'Inventory',
        sql: `SELECT sequence_num, run_id, project_name, test_name, total_samples, failed_samples, peak_vus, p95_rt, duration_secs, start_time\nFROM agg_run_summary\nORDER BY sequence_num DESC;`,
      },
      {
        id: 'slowest-tx',
        label: `Top 25 Slowest Tx (#${rawCurrent})`,
        category: 'Latency',
        sql: `SELECT app_name, scenario_name, endpoint, samples, avg_ms, p90_ms, p95_ms, p99_ms, max_ms, errors\nFROM agg_endpoint_summary\nWHERE run_id = '${rawCurrent.replace(/'/g, "''")}'\nORDER BY p95_ms DESC\nLIMIT 25;`,
      },
      {
        id: 'scen-delta',
        label: rawBase ? `Scenario P95 (#${rawCurrent} vs #${rawBase})` : `Scenarios (#${rawCurrent})`,
        category: 'Compare',
        sql: rawBase
          ? `SELECT\n  c.scenario_name,\n  c.samples AS cur_samples,\n  c.p95_ms AS cur_p95,\n  b.p95_ms AS base_p95,\n  ROUND(((c.p95_ms - b.p95_ms) / NULLIF(b.p95_ms, 0)) * 100, 1) AS delta_pct,\n  c.errors AS cur_errors\nFROM agg_scenario_summary c\nLEFT JOIN agg_scenario_summary b\n  ON c.app_name = b.app_name AND c.scenario_name = b.scenario_name AND b.run_id = '${rawBase.replace(/'/g, "''")}'\nWHERE c.run_id = '${rawCurrent.replace(/'/g, "''")}'\nORDER BY delta_pct DESC NULLS LAST;`
          : `SELECT app_name, scenario_name, samples, avg_ms, p90_ms, p95_ms, p99_ms, errors\nFROM agg_scenario_summary\nWHERE run_id = '${rawCurrent.replace(/'/g, "''")}'\nORDER BY p95_ms DESC;`,
      },
      {
        id: 'errors',
        label: `Error & URL Breakdown (#${rawCurrent})`,
        category: 'Errors',
        sql: `SELECT scenario_name, endpoint, response_code, response_message, failure_message, url, error_count\nFROM agg_error_details\nWHERE run_id = '${rawCurrent.replace(/'/g, "''")}'\nORDER BY error_count DESC;`,
      },
      {
        id: 'raw-outliers',
        label: `Raw Outliers > 3000ms (#${rawCurrent})`,
        category: 'Latency',
        sql: `SELECT timestamp, app_name, thread_group, label, elapsed, responseCode, success, URL\nFROM performance_history\nWHERE CAST(run_id AS VARCHAR) = '${rawCurrent.replace(/'/g, "''")}'\n  AND elapsed > 3000\nORDER BY elapsed DESC\nLIMIT 100;`,
      },
      {
        id: 'naming-audit',
        label: 'Scenario Naming Audit (All Runs)',
        category: 'Quality',
        sql: `SELECT run_id, COUNT(DISTINCT scenario_name) AS distinct_scenarios, STRING_AGG(DISTINCT scenario_name, ', ' ORDER BY scenario_name) AS scenarios\nFROM agg_scenario_summary\nGROUP BY run_id\nORDER BY run_id DESC;`,
      },
      {
        id: 'ai-saved',
        label: 'Saved AI Summaries',
        category: 'AI',
        sql: `SELECT run_id, baseline_run_id, provider, model, updated_by, updated_at, scope_key\nFROM ai_summaries\nORDER BY updated_at DESC;`,
      },
      {
        id: 'summarize',
        label: 'Summarize Endpoint Table',
        category: 'Stats',
        sql: `SUMMARIZE agg_endpoint_summary;`,
      },
    ],
    [rawCurrent, rawBase]
  );

  const [sql, setSql] = useState<string>(presets[0].sql);
  const [maxRows, setMaxRows] = useState<number>(500);
  const [running, setRunning] = useState<boolean>(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  const loadSchema = useCallback(async () => {
    setLoadingSchema(true);
    setSchemaError(null);
    try {
      const res = await fetch('/api/db/schema');
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDbFile(data.dbFile || 'Performance_Vault.db');
      setTables(Array.isArray(data.tables) ? data.tables : []);
    } catch (err) {
      setSchemaError(err instanceof Error ? err.message : 'Failed to load schema.');
    } finally {
      setLoadingSchema(false);
    }
  }, []);

  const runQuery = useCallback(
    async (sqlToRun?: string) => {
      const targetSql = (sqlToRun ?? sql).trim();
      if (!targetSql) return;
      setRunning(true);
      setQueryError(null);
      try {
        const res = await fetch('/api/db/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: targetSql, maxRows }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setQueryError(data.error || `HTTP ${res.status}`);
          setResult(null);
          return;
        }
        setResult({
          columns: data.columns || [],
          rows: data.rows || [],
          rowCount: data.rowCount ?? 0,
          totalFetched: data.totalFetched ?? 0,
          truncated: Boolean(data.truncated),
          elapsedMs: data.elapsedMs ?? 0,
        });
      } catch (err) {
        setQueryError(err instanceof Error ? err.message : 'Network error running query.');
      } finally {
        setRunning(false);
      }
    },
    [sql, maxRows]
  );

  useEffect(() => {
    loadSchema();
    runQuery(presets[0].sql);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleExportCsv = () => {
    if (!result || result.columns.length === 0) return;
    const escCsv = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      result.columns.map(escCsv).join(','),
      ...result.rows.map((r) => result.columns.map((c) => escCsv(r[c])).join(',')),
    ];
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `perf-delta-query-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyJson = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.rows, null, 2));
      setCopiedJson(true);
      window.setTimeout(() => setCopiedJson(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#1F2937] bg-[#111827] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <Database className="h-4 w-4 text-[#06B6D4]" />
          <div>
            <h2 className="text-sm font-semibold text-[#F9FAFB]">DuckDB Vault Explorer</h2>
            <p className="text-[11px] text-[#9CA3AF]">
              Inspect tables in <code className="text-[#22D3EE]">{dbFile}</code> and run ready-to-use or custom DuckDB SQL.
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#10B981]/40 bg-[#10B981]/15 px-2.5 py-0.5 text-[10.5px] font-semibold text-[#34D399]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Read-Only Safe Mode
        </span>
      </div>

      {/* Main 2-Pane Workbench */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        {/* Left Pane: Schema Browser */}
        <aside className="rounded-lg border border-[#1F2937] bg-[#111827] lg:col-span-3 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1F2937] px-3 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Tables ({tables.length})
            </span>
            <button
              type="button"
              onClick={loadSchema}
              disabled={loadingSchema}
              className="rounded p-1 text-[#9CA3AF] hover:bg-[#1F2937] hover:text-[#F9FAFB]"
              title="Refresh table schema"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingSchema ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="max-h-[680px] overflow-y-auto divide-y divide-[#1F2937]/70">
            {loadingSchema && tables.length === 0 ? (
              <div className="flex items-center gap-2 p-4 text-xs text-[#9CA3AF]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#06B6D4]" />
                Inspecting vault...
              </div>
            ) : schemaError ? (
              <div className="p-3 text-xs text-[#FCA5A5]">{schemaError}</div>
            ) : (
              tables.map((t) => {
                const isOpen = Boolean(expandedTables[t.name]);
                return (
                  <div key={t.name} className="text-xs">
                    <div className="flex items-center justify-between gap-1 px-2.5 py-2 hover:bg-[#1F2937]/40">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedTables((prev) => ({ ...prev, [t.name]: !prev[t.name] }))
                        }
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      >
                        {isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" />
                        )}
                        <Table2 className="h-3.5 w-3.5 shrink-0 text-[#06B6D4]" />
                        <span className="truncate font-mono text-[11px] font-medium text-[#F9FAFB]">
                          {t.name}
                        </span>
                      </button>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="metric-num rounded bg-[#0B0F19] px-1.5 py-0.5 text-[10px] text-[#9CA3AF]">
                          {t.rowCount.toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const q = `SELECT * FROM "${t.name}" LIMIT 100;`;
                            setSql(q);
                            runQuery(q);
                          }}
                          className="rounded border border-[#1F2937] bg-[#0B0F19] p-1 text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE]"
                          title={`Preview 100 rows from ${t.name}`}
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="bg-[#0B0F19]/60 px-6 py-1.5 space-y-1 border-t border-[#1F2937]/50">
                        {t.columns.map((c) => (
                          <div
                            key={c.name}
                            className="flex items-center justify-between gap-2 text-[10.5px] font-mono"
                          >
                            <span className="truncate text-[#D1D5DB]">{c.name}</span>
                            <span className="shrink-0 text-[#6B7280]">{c.type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Pane: Presets + SQL Editor + Results */}
        <div className="space-y-3 lg:col-span-9 min-w-0">
          {/* Ready-to-Use Query Presets */}
          <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              <Sparkles className="h-3.5 w-3.5 text-[#06B6D4]" />
              Ready-to-Use Queries
            </div>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSql(p.sql);
                    runQuery(p.sql);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1 text-[11px] font-medium text-[#D1D5DB] hover:border-[#06B6D4]/50 hover:text-[#22D3EE] transition-colors"
                >
                  <span className="text-[9.5px] uppercase tracking-wider text-[#6B7280]">
                    {p.category}
                  </span>
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* SQL Editor */}
          <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                SQL Query <span className="font-normal normal-case text-[#6B7280]">(Ctrl + Enter to run)</span>
              </span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
                  <span>Max Rows:</span>
                  <select
                    value={maxRows}
                    onChange={(e) => setMaxRows(Number(e.target.value))}
                    className="rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-0.5 text-[11px] text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                  >
                    <option value={100}>100</option>
                    <option value={500}>500</option>
                    <option value={2000}>2,000</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => runQuery()}
                  disabled={running || !sql.trim()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#06B6D4] px-3 py-1 text-xs font-semibold text-[#0B0F19] hover:bg-[#22D3EE] disabled:opacity-50"
                >
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Run Query
                </button>
              </div>
            </div>
            <textarea
              rows={5}
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  runQuery();
                }
              }}
              spellCheck={false}
              className="w-full resize-y bg-[#0B0F19] p-3 font-mono text-xs text-[#F9FAFB] focus:outline-none"
            />
          </div>

          {/* Error Banner */}
          {queryError && (
            <div className="flex items-start gap-2 rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 px-3.5 py-2.5 text-xs text-[#FCA5A5]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#EF4444]" />
              <span className="font-mono">{queryError}</span>
            </div>
          )}

          {/* Results Grid */}
          {result && (
            <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] px-3.5 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#9CA3AF]">
                  <span className="metric-num font-semibold text-[#F9FAFB]">
                    {result.rowCount.toLocaleString()} rows
                  </span>
                  {result.truncated && (
                    <span className="rounded bg-[#F59E0B]/15 px-1.5 py-0.5 text-[10px] text-[#FBBF24]">
                      Showing first {result.rowCount.toLocaleString()} of{' '}
                      {result.totalFetched.toLocaleString()}
                    </span>
                  )}
                  <span className="metric-num text-[#06B6D4]">{result.elapsedMs} ms</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCopyJson}
                    disabled={result.rows.length === 0}
                    className="inline-flex items-center gap-1 rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-[11px] text-[#9CA3AF] hover:border-[#374151] hover:text-[#F9FAFB] disabled:opacity-40"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedJson ? 'Copied!' : 'Copy JSON'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    disabled={result.rows.length === 0}
                    className="inline-flex items-center gap-1 rounded border border-[#06B6D4]/40 bg-[#06B6D4]/15 px-2.5 py-1 text-[11px] font-semibold text-[#22D3EE] hover:bg-[#06B6D4]/25 disabled:opacity-40"
                  >
                    <Download className="h-3 w-3" />
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="max-h-[460px] overflow-auto">
                {result.columns.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#9CA3AF]">
                    Query executed cleanly and returned 0 rows.
                  </div>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-[#0B0F19] text-[10.5px] uppercase tracking-wider text-[#9CA3AF]">
                      <tr>
                        {result.columns.map((col) => (
                          <th
                            key={col}
                            className="whitespace-nowrap border-b border-[#1F2937] px-3 py-2 font-mono font-semibold"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2937]/70 font-mono text-[11px]">
                      {result.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-[#1F2937]/40">
                          {result.columns.map((col) => {
                            const val = row[col];
                            return (
                              <td
                                key={col}
                                className="max-w-[360px] truncate whitespace-nowrap px-3 py-1.5 text-[#E5E7EB]"
                                title={val === null || val === undefined ? 'NULL' : String(val)}
                              >
                                {val === null || val === undefined ? (
                                  <span className="italic text-[#6B7280]">NULL</span>
                                ) : (
                                  String(val)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
