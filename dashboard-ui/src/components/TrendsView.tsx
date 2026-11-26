/**
 * Multi-Run Historical Trends & Regression Analytics (`dashboard-ui/src/components/TrendsView.tsx`)
 *
 * Analyzes performance across all DuckDB Vault builds grouped by Test Profile (`Project + Test Type`),
 * reactive to the Global Filter Bar. Includes build toggle chips, `Compare vs` anchor build dropdown,
 * configurable drift sensitivity (`±5% | ±10% | ±20%`), 3 Recharts trend charts with `Copy PNG`,
 * and a build-over-build Scenario / Transaction P95 Drift Table.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Camera,
  Check,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { PerformanceTestRun } from '../types/performance';
import { computeFallbackApdex } from '../utils/executiveSummary';
import { copyChartContainerAsPng } from '../utils/chartExport';

interface TrendsViewProps {
  vaultRuns: PerformanceTestRun[];
  activeRunId: string;
  theme: 'dark' | 'light';
}

type DriftEntity = 'scenarios' | 'transactions';

function extractProfile(run: PerformanceTestRun): string {
  const cleaned = run.name
    .replace(/^\[Vault\]\s*/i, '')
    .replace(/\s*#[^\s]+$/, '')
    .trim();
  return cleaned || run.environment || 'Default Profile';
}

function shortBuildLabel(run: PerformanceTestRun): string {
  const m = run.name.match(/#([^\s]+)$/);
  if (m) return `#${m[1]}`;
  return run.id.replace(/^vault-[a-z]+-/i, '#');
}

function calcPct(cur: number, anchor: number | null | undefined): number | null {
  if (anchor === null || anchor === undefined || !Number.isFinite(anchor)) return null;
  if (anchor === 0 && cur === 0) return 0;
  if (anchor === 0) return 100;
  return ((cur - anchor) / Math.abs(anchor)) * 100;
}

export const TrendsView: React.FC<TrendsViewProps> = ({ vaultRuns, activeRunId, theme }) => {
  const latencyChartRef = useRef<HTMLDivElement>(null);
  const loadChartRef = useRef<HTMLDivElement>(null);
  const reliabilityChartRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const profiles = useMemo(() => {
    const set = new Set<string>();
    for (const r of vaultRuns) set.add(extractProfile(r));
    return [...set];
  }, [vaultRuns]);

  const defaultProfile = useMemo(() => {
    const active = vaultRuns.find((r) => r.id === activeRunId);
    if (active) return extractProfile(active);
    return profiles[0] || 'ALL';
  }, [vaultRuns, activeRunId, profiles]);

  const [selectedProfile, setSelectedProfile] = useState<string>(defaultProfile);
  const [excludedRunIds, setExcludedRunIds] = useState<Set<string>>(new Set());
  const [selectedAnchorId, setSelectedAnchorId] = useState<string>('');
  const [sensitivityPct, setSensitivityPct] = useState<number>(10);
  const [driftEntity, setDriftEntity] = useState<DriftEntity>('scenarios');
  const [driftSearch, setDriftSearch] = useState<string>('');
  const [onlyRegressions, setOnlyRegressions] = useState<boolean>(false);

  useEffect(() => {
    if (selectedProfile !== 'ALL' && !profiles.includes(selectedProfile) && profiles.length > 0) {
      setSelectedProfile(defaultProfile);
    }
  }, [profiles, selectedProfile, defaultProfile]);

  const profileRuns = useMemo(() => {
    const list =
      selectedProfile === 'ALL'
        ? vaultRuns
        : vaultRuns.filter((r) => extractProfile(r) === selectedProfile);
    return [...list].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  }, [vaultRuns, selectedProfile]);

  const activeRuns = useMemo(
    () => profileRuns.filter((r) => !excludedRunIds.has(r.id)),
    [profileRuns, excludedRunIds]
  );

  const latestRun = activeRuns.length > 0 ? activeRuns[activeRuns.length - 1] : null;
  const anchorCandidates = useMemo(
    () => (activeRuns.length >= 2 ? activeRuns.slice(0, -1).reverse() : []),
    [activeRuns]
  );

  // Keep selectedAnchorId valid (defaults to the immediately preceding build)
  useEffect(() => {
    if (anchorCandidates.length === 0) {
      if (selectedAnchorId !== '') setSelectedAnchorId('');
      return;
    }
    if (!anchorCandidates.some((r) => r.id === selectedAnchorId)) {
      setSelectedAnchorId(anchorCandidates[0].id);
    }
  }, [anchorCandidates, selectedAnchorId]);

  const anchorRun = useMemo(
    () => anchorCandidates.find((r) => r.id === selectedAnchorId) ?? anchorCandidates[0] ?? null,
    [anchorCandidates, selectedAnchorId]
  );

  const toggleRunChip = (id: string) => {
    setExcludedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (activeRuns.length > 1) {
        next.add(id);
      }
      return next;
    });
  };

  const chartData = useMemo(() => {
    return activeRuns.map((r) => {
      const apdex = r.apdex ?? computeFallbackApdex(r);
      const p95Drift =
        anchorRun && r.id !== anchorRun.id
          ? calcPct(r.summary.p95ResponseTimeMs, anchorRun.summary.p95ResponseTimeMs)
          : null;
      const avgMs =
        r.endpoints.length > 0
          ? Math.round(
              r.endpoints.reduce((acc, ep) => acc + ep.avg * ep.samples, 0) /
                Math.max(
                  r.endpoints.reduce((acc, ep) => acc + ep.samples, 0),
                  1
                )
            )
          : Math.round(r.summary.p95ResponseTimeMs * 0.55);
      const p90Ms =
        r.summary.p90ResponseTimeMs ??
        (r.endpoints.length > 0
          ? Math.round(
              r.endpoints.reduce((acc, ep) => acc + ep.p90 * ep.samples, 0) /
                Math.max(
                  r.endpoints.reduce((acc, ep) => acc + ep.samples, 0),
                  1
                )
            )
          : Math.round(r.summary.p95ResponseTimeMs * 0.85));

      return {
        id: r.id,
        build: shortBuildLabel(r),
        date: r.startedAt.slice(0, 10),
        p95: Math.round(r.summary.p95ResponseTimeMs),
        p90: Math.round(p90Ms),
        avg: avgMs,
        tps: Number(r.summary.avgThroughputRps.toFixed(2)),
        peakVUs: r.summary.peakVUs,
        errorPct: Number(r.summary.errorRatePct.toFixed(2)),
        apdex: Number(apdex.score.toFixed(2)),
        p95Drift,
      };
    });
  }, [activeRuns, anchorRun]);

  const latestApdex = latestRun ? (latestRun.apdex ?? computeFallbackApdex(latestRun)).score : 0;
  const anchorApdex = anchorRun ? (anchorRun.apdex ?? computeFallbackApdex(anchorRun)).score : null;

  // Scenario / Transaction Drift Table rows
  const displayBuilds = useMemo(() => activeRuns.slice(-6), [activeRuns]);

  const driftRows = useMemo(() => {
    if (!latestRun) return [];
    const anchor = anchorRun;
    const keySet = new Set<string>();
    for (const r of displayBuilds) {
      if (driftEntity === 'scenarios') {
        for (const s of r.scenarios || []) keySet.add(s.scenario);
      } else {
        for (const e of r.endpoints) keySet.add(e.endpoint);
      }
    }

    const rows = [...keySet].map((name) => {
      const perBuild: Record<string, number | null> = {};
      for (const r of displayBuilds) {
        if (driftEntity === 'scenarios') {
          const hit = (r.scenarios || []).find((s) => s.scenario === name);
          perBuild[r.id] = hit ? Math.round(hit.p95) : null;
        } else {
          const hit = r.endpoints.find((e) => e.endpoint === name);
          perBuild[r.id] = hit ? Math.round(hit.p95) : null;
        }
      }

      const latestVal = perBuild[latestRun.id] ?? null;
      let anchorVal: number | null = null;
      if (anchor) {
        if (driftEntity === 'scenarios') {
          const hit = (anchor.scenarios || []).find((s) => s.scenario === name);
          anchorVal = hit ? Math.round(hit.p95) : null;
        } else {
          const hit = anchor.endpoints.find((e) => e.endpoint === name);
          anchorVal = hit ? Math.round(hit.p95) : null;
        }
      }

      const slaThreshold =
        driftEntity === 'transactions'
          ? latestRun.endpoints.find((e) => e.endpoint === name)?.slaP95Ms ?? latestRun.sla.p95Ms
          : latestRun.sla.p95Ms;
      const rtEnabled = latestRun.sla.rtEnabled !== false;
      const slaBreach = rtEnabled && latestVal !== null && latestVal > slaThreshold;
      const driftPct = latestVal !== null ? calcPct(latestVal, anchorVal) : null;

      let status: 'SLA BREACH' | 'REGRESSED' | 'IMPROVED' | 'STABLE' = 'STABLE';
      if (slaBreach) status = 'SLA BREACH';
      else if (driftPct !== null && driftPct >= sensitivityPct) status = 'REGRESSED';
      else if (driftPct !== null && driftPct <= -sensitivityPct) status = 'IMPROVED';

      return { name, perBuild, anchorVal, latestVal, driftPct, status };
    });

    return rows
      .filter((r) => r.latestVal !== null)
      .filter((r) => !driftSearch.trim() || r.name.toLowerCase().includes(driftSearch.trim().toLowerCase()))
      .filter((r) => !onlyRegressions || r.status === 'REGRESSED' || r.status === 'SLA BREACH')
      .sort((a, b) => (b.driftPct ?? -9999) - (a.driftPct ?? -9999));
  }, [latestRun, anchorRun, displayBuilds, driftEntity, sensitivityPct, driftSearch, onlyRegressions]);

  const regressedCount = driftRows.filter(
    (r) => r.status === 'REGRESSED' || r.status === 'SLA BREACH'
  ).length;
  const improvedCount = driftRows.filter((r) => r.status === 'IMPROVED').length;

  const gridStroke = theme === 'light' ? '#E5E7EB' : '#1F2937';
  const tickColor = theme === 'light' ? '#6B7280' : '#9CA3AF';
  const tooltipStyle = {
    backgroundColor: theme === 'light' ? '#FFFFFF' : '#0B0F19',
    borderColor: theme === 'light' ? '#D1D5DB' : '#374151',
    borderRadius: '6px',
    fontSize: '11px',
    color: theme === 'light' ? '#111827' : '#F9FAFB',
  };

  const handleCopy = async (id: string, ref: React.RefObject<HTMLDivElement>, title: string) => {
    const res = await copyChartContainerAsPng(ref.current, title, theme);
    if (res !== 'failed') {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    }
  };

  if (vaultRuns.length === 0) {
    return (
      <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-8 text-center text-xs text-[#9CA3AF]">
        No DuckDB Vault runs found. Register at least 2 test runs with <code className="text-[#22D3EE]">register.ps1</code> to view historical trends.
      </div>
    );
  }

  const fmtDeltaBadge = (cur: number, anchor: number | null | undefined, lowerIsBetter: boolean) => {
    const pct = calcPct(cur, anchor);
    if (pct === null) return <span className="text-[11px] text-[#6B7280]">—</span>;
    const isReg = lowerIsBetter ? pct >= sensitivityPct : pct <= -sensitivityPct;
    const isImp = lowerIsBetter ? pct <= -sensitivityPct : pct >= sensitivityPct;
    const cls = isReg
      ? 'border-[#EF4444]/40 bg-[#EF4444]/15 text-[#FCA5A5]'
      : isImp
      ? 'border-[#10B981]/40 bg-[#10B981]/15 text-[#34D399]'
      : 'border-[#1F2937] bg-[#0B0F19] text-[#9CA3AF]';
    const arrow = pct > 0.05 ? '▲' : pct < -0.05 ? '▼' : '•';
    const sign = pct > 0 ? '+' : '';
    return (
      <span className={`metric-num inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>
        {arrow} {sign}
        {pct.toFixed(1)}%
      </span>
    );
  };

  const slaP95 = latestRun?.sla.p95Ms ?? 3000;
  const rtEnabled = latestRun?.sla.rtEnabled !== false;

  return (
    <div className="space-y-3">
      {/* Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-[#1F2937] bg-[#111827] px-3.5 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
            <TrendingUp className="h-4 w-4 text-[#06B6D4]" />
            Historical Trends
          </span>

          {/* Profile Selector */}
          <select
            aria-label="Test Profile"
            value={selectedProfile}
            onChange={(e) => {
              setSelectedProfile(e.target.value);
              setExcludedRunIds(new Set());
            }}
            className="rounded border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1 text-xs font-medium text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
          >
            {profiles.map((p) => (
              <option key={p} value={p}>
                Profile: {p}
              </option>
            ))}
            {profiles.length > 1 && <option value="ALL">All Vault Runs ({vaultRuns.length})</option>}
          </select>

          {/* Build Toggle Chips */}
          <div className="flex flex-wrap items-center gap-1">
            {profileRuns.map((r) => {
              const included = !excludedRunIds.has(r.id);
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleRunChip(r.id)}
                  className={`metric-num rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    included
                      ? 'border-[#06B6D4]/45 bg-[#06B6D4]/15 text-[#22D3EE]'
                      : 'border-[#1F2937] bg-[#0B0F19] text-[#6B7280] line-through hover:text-[#9CA3AF]'
                  }`}
                  title={`${r.name} (${r.startedAt.slice(0, 10)}) — click to toggle`}
                >
                  {shortBuildLabel(r)}
                </button>
              );
            })}
          </div>
        </div>

        {/* Anchor Build Selector + Sensitivity Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {anchorCandidates.length > 0 && (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF]">
              <span>Compare vs:</span>
              <select
                aria-label="Compare against build"
                value={anchorRun?.id || ''}
                onChange={(e) => setSelectedAnchorId(e.target.value)}
                className="metric-num rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-[11px] font-medium text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
              >
                {anchorCandidates.map((r, idx) => {
                  const tag =
                    idx === 0
                      ? ' (Prev)'
                      : idx === anchorCandidates.length - 1
                      ? ' (First)'
                      : '';
                  return (
                    <option key={r.id} value={r.id}>
                      {shortBuildLabel(r)} — {r.startedAt.slice(0, 10)}
                      {tag}
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          <div className="inline-flex items-center rounded border border-[#1F2937] bg-[#0B0F19] p-0.5 text-[11px]">
            <span className="px-1.5 text-[10px] text-[#6B7280]">Drift</span>
            {[5, 10, 20].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => setSensitivityPct(pct)}
                className={`metric-num rounded px-1.5 py-0.5 font-medium ${
                  sensitivityPct === pct ? 'bg-[#06B6D4]/20 text-[#22D3EE]' : 'text-[#9CA3AF]'
                }`}
              >
                ±{pct}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4 Mini Trend KPI Cards */}
      {latestRun && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-[#1F2937] bg-[#111827] px-3.5 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Latest P95 ({shortBuildLabel(latestRun)})
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="metric-num text-lg font-bold text-[#F59E0B]">
                {Math.round(latestRun.summary.p95ResponseTimeMs).toLocaleString()} ms
              </span>
              {fmtDeltaBadge(
                latestRun.summary.p95ResponseTimeMs,
                anchorRun?.summary.p95ResponseTimeMs,
                true
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[#1F2937] bg-[#111827] px-3.5 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Latest Throughput
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="metric-num text-lg font-bold text-[#06B6D4]">
                {latestRun.summary.avgThroughputRps.toFixed(2)} req/s
              </span>
              {fmtDeltaBadge(
                latestRun.summary.avgThroughputRps,
                anchorRun?.summary.avgThroughputRps,
                false
              )}
            </div>
          </div>

          <div className="rounded-lg border border-[#1F2937] bg-[#111827] px-3.5 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Latest Error Rate
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span
                className={`metric-num text-lg font-bold ${
                  latestRun.summary.errorRatePct > 0 ? 'text-[#EF4444]' : 'text-[#10B981]'
                }`}
              >
                {latestRun.summary.errorRatePct.toFixed(2)}%
              </span>
              {fmtDeltaBadge(latestRun.summary.errorRatePct, anchorRun?.summary.errorRatePct, true)}
            </div>
          </div>

          <div className="rounded-lg border border-[#1F2937] bg-[#111827] px-3.5 py-2.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Latest Apdex &amp; Drift
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="metric-num text-lg font-bold text-[#10B981]">
                {latestApdex.toFixed(2)}
              </span>
              <div className="flex items-center gap-1.5 text-[10px] font-semibold metric-num">
                <span className="text-[#EF4444]">{regressedCount}▲</span>
                <span className="text-[#10B981]">{improvedCount}▼</span>
                {anchorApdex !== null && (
                  <span className="text-[#9CA3AF]">
                    ({latestApdex - anchorApdex >= 0 ? '+' : ''}
                    {(latestApdex - anchorApdex).toFixed(2)})
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3 Trend Charts */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Chart 1: Latency Trend */}
        <div
          ref={latencyChartRef}
          className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5 lg:col-span-2"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                Response Time Trend Across Builds (ms)
              </h3>
              <p className="text-[11px] text-[#9CA3AF]">
                Red dots mark builds regressing &ge; +{sensitivityPct}%; green dots mark improvements &le; -{sensitivityPct}%.
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleCopy('lat', latencyChartRef, 'Response Time Trend Across Builds')}
              className="no-print inline-flex items-center gap-1 rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-[11px] text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE]"
            >
              {copiedId === 'lat' ? <Check className="h-3 w-3 text-[#10B981]" /> : <Camera className="h-3 w-3" />}
              {copiedId === 'lat' ? 'Copied' : 'Copy PNG'}
            </button>
          </div>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="build" tick={{ fill: tickColor, fontSize: 11 }} />
                <YAxis tick={{ fill: tickColor, fontSize: 11 }} unit=" ms" width={68} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                {rtEnabled && (
                  <ReferenceLine
                    y={slaP95}
                    stroke="#EF4444"
                    strokeDasharray="6 4"
                    label={{ value: `SLA ${slaP95}ms`, fill: '#EF4444', fontSize: 10, position: 'insideTopRight' }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="p95"
                  name="P95 (ms)"
                  stroke="#F59E0B"
                  strokeWidth={2.4}
                  dot={(props) => {
                    const { cx, cy, payload } = props as {
                      cx?: number;
                      cy?: number;
                      payload?: { p95Drift: number | null; p95: number };
                    };
                    if (cx === undefined || cy === undefined || !payload) return <g />;
                    const reg =
                      (rtEnabled && payload.p95 > slaP95) ||
                      (payload.p95Drift !== null && payload.p95Drift >= sensitivityPct);
                    const imp = payload.p95Drift !== null && payload.p95Drift <= -sensitivityPct;
                    const fill = reg ? '#EF4444' : imp ? '#10B981' : '#F59E0B';
                    return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={5} fill={fill} stroke="#0B0F19" strokeWidth={1.5} />;
                  }}
                />
                <Line type="monotone" dataKey="p90" name="P90 (ms)" stroke="#06B6D4" strokeWidth={1.8} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="avg" name="Avg (ms)" stroke="#10B981" strokeWidth={1.6} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Throughput & Peak VUs */}
        <div ref={loadChartRef} className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Throughput (TPS) &amp; Peak VUs
            </h3>
            <button
              type="button"
              onClick={() => handleCopy('load', loadChartRef, 'Throughput & Peak VUs Trend')}
              className="no-print inline-flex items-center gap-1 rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-[11px] text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE]"
            >
              {copiedId === 'load' ? <Check className="h-3 w-3 text-[#10B981]" /> : <Camera className="h-3 w-3" />}
              {copiedId === 'load' ? 'Copied' : 'Copy PNG'}
            </button>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="build" tick={{ fill: tickColor, fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fill: tickColor, fontSize: 11 }} width={46} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: tickColor, fontSize: 11 }} width={44} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar yAxisId="left" dataKey="tps" name="Avg TPS (req/s)" fill="#06B6D4" fillOpacity={0.75} radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Line yAxisId="right" type="monotone" dataKey="peakVUs" name="Peak VUs" stroke="#6366F1" strokeWidth={2.2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 3: Reliability & Apdex */}
        <div ref={reliabilityChartRef} className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Apdex Score &amp; Error Rate (%)
            </h3>
            <button
              type="button"
              onClick={() => handleCopy('rel', reliabilityChartRef, 'Apdex & Error Rate Trend')}
              className="no-print inline-flex items-center gap-1 rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-[11px] text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE]"
            >
              {copiedId === 'rel' ? <Check className="h-3 w-3 text-[#10B981]" /> : <Camera className="h-3 w-3" />}
              {copiedId === 'rel' ? 'Copied' : 'Copy PNG'}
            </button>
          </div>
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis dataKey="build" tick={{ fill: tickColor, fontSize: 11 }} />
                <YAxis yAxisId="left" domain={[0, 1]} tick={{ fill: tickColor, fontSize: 11 }} width={40} />
                <YAxis yAxisId="right" orientation="right" unit="%" tick={{ fill: tickColor, fontSize: 11 }} width={48} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line yAxisId="left" type="monotone" dataKey="apdex" name="Apdex (0–1)" stroke="#10B981" strokeWidth={2.2} dot={{ r: 4 }} />
                <Bar yAxisId="right" dataKey="errorPct" name="Error Rate (%)" fill="#EF4444" fillOpacity={0.75} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Scenario / Transaction Drift Table */}
      <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Build-over-Build P95 Drift
            </h3>
            <div className="inline-flex rounded border border-[#1F2937] bg-[#0B0F19] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setDriftEntity('scenarios')}
                className={`rounded px-2 py-0.5 font-medium ${
                  driftEntity === 'scenarios' ? 'bg-[#06B6D4]/20 text-[#22D3EE]' : 'text-[#9CA3AF]'
                }`}
              >
                Scenarios
              </button>
              <button
                type="button"
                onClick={() => setDriftEntity('transactions')}
                className={`rounded px-2 py-0.5 font-medium ${
                  driftEntity === 'transactions' ? 'bg-[#06B6D4]/20 text-[#22D3EE]' : 'text-[#9CA3AF]'
                }`}
              >
                Transactions
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]" />
              <input
                type="search"
                value={driftSearch}
                onChange={(e) => setDriftSearch(e.target.value)}
                placeholder={`Filter ${driftEntity}...`}
                className="w-48 rounded-md border border-[#1F2937] bg-[#0B0F19] py-1 pl-8 pr-2.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
              />
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-[#9CA3AF]">
              <input
                type="checkbox"
                checked={onlyRegressions}
                onChange={(e) => setOnlyRegressions(e.target.checked)}
                className="h-3.5 w-3.5 accent-[#EF4444]"
              />
              Regressions Only
            </label>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                <th className="px-3 py-2">{driftEntity === 'scenarios' ? 'Scenario' : 'Transaction'}</th>
                {displayBuilds.map((r) => (
                  <th key={r.id} className="metric-num px-3 py-2 text-right">
                    {shortBuildLabel(r)} P95
                  </th>
                ))}
                <th className="px-3 py-2 text-right">
                  Drift {anchorRun ? `(vs ${shortBuildLabel(anchorRun)})` : ''}
                </th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2937]/70">
              {driftRows.slice(0, 150).map((row) => (
                <tr
                  key={row.name}
                  className={
                    row.status === 'SLA BREACH' || row.status === 'REGRESSED'
                      ? 'bg-[#EF4444]/[0.05] hover:bg-[#EF4444]/[0.09]'
                      : 'hover:bg-[#1F2937]/40'
                  }
                >
                  <td className="px-3 py-2 font-mono text-[11px] font-medium text-[#F9FAFB]">
                    {row.name}
                  </td>
                  {displayBuilds.map((r, bi) => {
                    const v = row.perBuild[r.id];
                    const isLatest = bi === displayBuilds.length - 1;
                    return (
                      <td
                        key={r.id}
                        className={`metric-num px-3 py-2 text-right ${
                          isLatest ? 'font-semibold text-[#F59E0B]' : 'text-[#9CA3AF]'
                        }`}
                      >
                        {v !== null ? `${v.toLocaleString()} ms` : '—'}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    {row.driftPct === null ? (
                      <span className="text-[#6B7280]">—</span>
                    ) : (
                      <span
                        className={`metric-num inline-flex items-center gap-0.5 font-semibold ${
                          row.driftPct >= sensitivityPct
                            ? 'text-[#EF4444]'
                            : row.driftPct <= -sensitivityPct
                            ? 'text-[#10B981]'
                            : 'text-[#9CA3AF]'
                        }`}
                      >
                        {row.driftPct >= sensitivityPct ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : row.driftPct <= -sensitivityPct ? (
                          <TrendingDown className="h-3 w-3" />
                        ) : null}
                        {row.driftPct > 0 ? '+' : ''}
                        {row.driftPct.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        row.status === 'SLA BREACH' || row.status === 'REGRESSED'
                          ? 'border-[#EF4444]/40 bg-[#EF4444]/15 text-[#FCA5A5]'
                          : row.status === 'IMPROVED'
                          ? 'border-[#10B981]/40 bg-[#10B981]/15 text-[#34D399]'
                          : 'border-[#1F2937] bg-[#0B0F19] text-[#9CA3AF]'
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                </tr>
              ))}
              {driftRows.length === 0 && (
                <tr>
                  <td colSpan={displayBuilds.length + 3} className="px-4 py-8 text-center text-xs text-[#9CA3AF]">
                    No matching {driftEntity} found for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
