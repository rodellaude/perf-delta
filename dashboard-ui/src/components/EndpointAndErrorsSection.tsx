/**
 * Applications, Scenarios, Transactions & Compare Breakdown (`EndpointAndErrorsSection.tsx`)
 *
 * Renders the full-width sortable/searchable analytical tables for each deep-dive tab
 * (`applications`, `scenarios`, `endpoints`, and `compare` vs Baseline Scorecard) with
 * SLA breach highlighting and inline Baseline Delta (`▲`/`▼` %) indicators.
 */
import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns2,
  Filter,
  GitCompare,
  Layers,
  Search,
  ShieldAlert,
  Table2,
} from 'lucide-react';
import {
  AppHealthMetric,
  AssertionFailure,
  EndpointMetric,
  HttpErrorGroup,
  PerformanceTestRun,
  ScenarioMetric,
} from '../types/performance';

interface EndpointAndErrorsSectionProps {
  run: PerformanceTestRun;
  baselineRun?: PerformanceTestRun | null;
  selectedApp: string;
  onSelectApp: (app: string) => void;
  endpoints: EndpointMetric[];
  apps?: AppHealthMetric[];
  scenarios?: ScenarioMetric[];
  httpErrors: HttpErrorGroup[];
  assertionFailures: AssertionFailure[];
  errorRateSlaPct: number;
  forcedView?: 'applications' | 'endpoints' | 'scenarios' | 'compare';
}

type SortKey = keyof Pick<
  EndpointMetric,
  'endpoint' | 'samples' | 'avg' | 'p90' | 'p95' | 'p99' | 'max' | 'throughput' | 'errorPct'
>;

type ViewMode = 'split' | 'applications' | 'endpoints' | 'scenarios' | 'compare' | 'errors';

function InlineDelta({
  cur,
  base,
  lowerIsBetter,
}: {
  cur: number;
  base?: number;
  lowerIsBetter: boolean;
}) {
  if (base === undefined || !Number.isFinite(base)) {
    return <span className="text-[#6B7280]">—</span>;
  }
  if (base === 0 && cur === 0) {
    return <span className="text-[#9CA3AF]">0.0%</span>;
  }
  const pct = base === 0 ? 100 : ((cur - base) / Math.abs(base)) * 100;
  const neutral = Math.abs(pct) < 0.5;
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  const sign = pct > 0 ? '+' : '';
  const color = neutral
    ? 'text-[#9CA3AF]'
    : good
    ? 'text-[#10B981]'
    : 'text-[#EF4444]';
  return (
    <span className={`metric-num font-semibold ${color}`}>
      {neutral ? '•' : pct > 0 ? '▲' : '▼'} {sign}
      {pct.toFixed(1)}%
    </span>
  );
}

export const EndpointAndErrorsSection: React.FC<EndpointAndErrorsSectionProps> = ({
  run,
  baselineRun,
  selectedApp,
  onSelectApp,
  endpoints,
  apps = [],
  scenarios = [],
  httpErrors,
  assertionFailures,
  errorRateSlaPct,
  forcedView,
}) => {
  const [internalViewMode, setViewMode] = useState<ViewMode>('split');
  const viewMode: ViewMode = forcedView ?? internalViewMode;
  const [search, setSearch] = useState('');
  const [onlyBreaches, setOnlyBreaches] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('p95');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rtEnabled = run.sla.rtEnabled !== false;
  const errEnabled = run.sla.errorEnabled !== false;

  const baseEndpointMap = useMemo(() => {
    const map = new Map<string, EndpointMetric>();
    if (baselineRun) {
      for (const ep of baselineRun.endpoints) {
        map.set(ep.endpoint, ep);
      }
    }
    return map;
  }, [baselineRun]);

  const baseScenarioMap = useMemo(() => {
    const map = new Map<string, ScenarioMetric>();
    if (baselineRun?.scenarios) {
      for (const sc of baselineRun.scenarios) {
        map.set(`${sc.appName}|${sc.scenario}`, sc);
      }
    }
    return map;
  }, [baselineRun]);

  const baseAppMap = useMemo(() => {
    const map = new Map<string, AppHealthMetric>();
    if (baselineRun?.apps) {
      for (const ap of baselineRun.apps) {
        map.set(ap.appName, ap);
      }
    }
    return map;
  }, [baselineRun]);

  const appFilteredEndpoints = useMemo(() => {
    if (selectedApp === 'ALL') return endpoints;
    return endpoints.filter((e) => e.appName === selectedApp);
  }, [endpoints, selectedApp]);

  const appFilteredScenarios = useMemo(() => {
    if (selectedApp === 'ALL') return scenarios;
    return scenarios.filter((s) => s.appName === selectedApp);
  }, [scenarios, selectedApp]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'endpoint' ? 'asc' : 'desc');
    }
  };

  const filteredEndpoints = useMemo(() => {
    return appFilteredEndpoints
      .filter((ep) => {
        const matchesSearch = ep.endpoint
          .toLowerCase()
          .includes(search.trim().toLowerCase());
        const p95Breach = ep.rtBreached !== undefined ? ep.rtBreached : rtEnabled && ep.p95 > ep.slaP95Ms;
        const errBreach = ep.errorBreached !== undefined ? ep.errorBreached : errEnabled && ep.errorPct > errorRateSlaPct;
        const breached = p95Breach || errBreach;
        return matchesSearch && (!onlyBreaches || breached);
      })
      .sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDir === 'asc'
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }
        return sortDir === 'asc'
          ? Number(valA) - Number(valB)
          : Number(valB) - Number(valA);
      });
  }, [appFilteredEndpoints, search, onlyBreaches, sortKey, sortDir, errorRateSlaPct, rtEnabled, errEnabled]);

  const breachCount = useMemo(
    () =>
      appFilteredEndpoints.filter((ep) => {
        const p95Breach = ep.rtBreached !== undefined ? ep.rtBreached : rtEnabled && ep.p95 > ep.slaP95Ms;
        const errBreach = ep.errorBreached !== undefined ? ep.errorBreached : errEnabled && ep.errorPct > errorRateSlaPct;
        return p95Breach || errBreach;
      }).length,
    [appFilteredEndpoints, errorRateSlaPct, rtEnabled, errEnabled]
  );

  const totalErrorCount = useMemo(
    () => httpErrors.reduce((acc, g) => acc + g.count, 0),
    [httpErrors]
  );

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3 w-3 text-[#4B5563]" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-[#06B6D4]" />
    ) : (
      <ArrowDown className="h-3 w-3 text-[#06B6D4]" />
    );
  };

  const columns: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
    { key: 'endpoint', label: 'Endpoint / Transaction', align: 'left' },
    { key: 'samples', label: 'Samples', align: 'right' },
    { key: 'avg', label: 'Avg (ms)', align: 'right' },
    { key: 'p90', label: 'P90 (ms)', align: 'right' },
    { key: 'p95', label: 'P95 (ms)', align: 'right' },
    { key: 'p99', label: 'P99 (ms)', align: 'right' },
    { key: 'max', label: 'Max (ms)', align: 'right' },
    { key: 'throughput', label: 'RPS', align: 'right' },
    { key: 'errorPct', label: 'Error %', align: 'right' },
  ];

  return (
    <section className="space-y-3">
      {/* Toolbar: View Mode Tabs (hidden when controlled by SideNav) + App Filter Pills + Search */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {!forcedView && (
          <div className="inline-flex flex-wrap items-center rounded-md border border-[#1F2937] bg-[#111827] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
                viewMode === 'split'
                  ? 'bg-[#1F2937] text-[#F9FAFB]'
                  : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" />
              Split View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('endpoints')}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
                viewMode === 'endpoints'
                  ? 'bg-[#1F2937] text-[#F9FAFB]'
                  : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
              }`}
            >
              <Table2 className="h-3.5 w-3.5" />
              Transactions ({appFilteredEndpoints.length})
            </button>
            {scenarios.length > 0 && (
              <button
                type="button"
                onClick={() => setViewMode('scenarios')}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
                  viewMode === 'scenarios'
                    ? 'bg-[#1F2937] text-[#F9FAFB]'
                    : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Scenarios ({appFilteredScenarios.length})
              </button>
            )}
            {(baselineRun || apps.length > 0) && (
              <button
                type="button"
                onClick={() => setViewMode('compare')}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
                  viewMode === 'compare'
                    ? 'bg-[#1F2937] text-[#F9FAFB]'
                    : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                }`}
              >
                <GitCompare className="h-3.5 w-3.5" />
                {baselineRun ? 'Compare vs Base' : 'App Health'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setViewMode('errors')}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
                viewMode === 'errors'
                  ? 'bg-[#1F2937] text-[#F9FAFB]'
                  : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
              }`}
            >
              <AlertOctagon className="h-3.5 w-3.5" />
              Errors ({totalErrorCount.toLocaleString()})
            </button>
          </div>
          )}

          {/* App Filter Pills */}
          {apps.length > 0 && (
            <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-[#1F2937] bg-[#111827] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => onSelectApp('ALL')}
                className={`rounded px-2 py-1 font-medium transition-colors ${
                  selectedApp === 'ALL'
                    ? 'bg-[#06B6D4]/20 text-[#22D3EE]'
                    : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                }`}
              >
                All Apps ({apps.length})
              </button>
              {apps.map((a) => (
                <button
                  key={a.appName}
                  type="button"
                  onClick={() => onSelectApp(a.appName)}
                  className={`rounded px-2 py-1 font-medium transition-colors ${
                    selectedApp === a.appName
                      ? 'bg-[#06B6D4]/20 text-[#22D3EE]'
                      : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                  }`}
                >
                  {a.appName}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search & SLA Breach Filter */}
        {(viewMode === 'split' || viewMode === 'endpoints') && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter endpoint..."
                className="w-52 rounded-md border border-[#1F2937] bg-[#111827] py-1 pl-8 pr-2.5 text-xs text-[#F9FAFB] placeholder-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setOnlyBreaches((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                onlyBreaches
                  ? 'border-[#EF4444]/50 bg-[#EF4444]/15 text-[#EF4444]'
                  : 'border-[#1F2937] bg-[#111827] text-[#9CA3AF] hover:text-[#F9FAFB]'
              }`}
            >
              <Filter className="h-3 w-3" />
              SLA Breaches ({breachCount})
            </button>
          </div>
        )}
      </div>

      {/* Scenarios Breakdown Tab */}
      {viewMode === 'scenarios' && (
        <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Scenario Breakdown (Thread Groups)
            </h3>
            <span className="metric-num text-[11px] text-[#9CA3AF]">
              {appFilteredScenarios.length} scenarios
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  <th className="px-3 py-2">App</th>
                  <th className="px-3 py-2">Scenario</th>
                  <th className="px-3 py-2 text-right">Requests</th>
                  <th className="px-3 py-2 text-right">TPS</th>
                  <th className="px-3 py-2 text-right">P95 (ms)</th>
                  {baselineRun && <th className="px-3 py-2 text-right">vs Base P95</th>}
                  <th className="px-3 py-2 text-right">Tx SLA</th>
                  <th className="px-3 py-2 text-right">Error %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937]/70">
                {appFilteredScenarios.map((sc) => {
                  const baseSc = baseScenarioMap.get(`${sc.appName}|${sc.scenario}`);
                  const hasSlaFail = rtEnabled && sc.passedLabels < sc.totalLabels;
                  return (
                    <tr
                      key={`${sc.appName}|${sc.scenario}`}
                      className={hasSlaFail ? 'bg-[#EF4444]/[0.07]' : 'hover:bg-[#1F2937]/40'}
                    >
                      <td className="px-3 py-2 font-medium text-[#9CA3AF]">{sc.appName}</td>
                      <td className="metric-num px-3 py-2 font-medium text-[#F9FAFB]">{sc.scenario}</td>
                      <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                        {sc.samples.toLocaleString()}
                      </td>
                      <td className="metric-num px-3 py-2 text-right text-[#06B6D4]">
                        {sc.throughput.toFixed(2)}
                      </td>
                      <td className="metric-num px-3 py-2 text-right font-semibold text-[#F59E0B]">
                        {sc.p95.toLocaleString()}
                      </td>
                      {baselineRun && (
                        <td className="px-3 py-2 text-right">
                          <InlineDelta cur={sc.p95} base={baseSc?.p95} lowerIsBetter={true} />
                        </td>
                      )}
                      <td className="metric-num px-3 py-2 text-right text-[#F9FAFB]">
                        {rtEnabled ? `${sc.passedLabels} / ${sc.totalLabels}` : `${sc.totalLabels} Tx`}
                      </td>
                      <td
                        className={`metric-num px-3 py-2 text-right font-semibold ${
                          sc.errorPct > errorRateSlaPct && errEnabled
                            ? 'text-[#EF4444]'
                            : sc.errorPct > 0
                            ? 'text-[#F59E0B]'
                            : 'text-[#10B981]'
                        }`}
                      >
                        {sc.errorPct.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
                {appFilteredScenarios.length === 0 && (
                  <tr>
                    <td
                      colSpan={baselineRun ? 8 : 7}
                      className="px-4 py-8 text-center text-xs text-[#9CA3AF]"
                    >
                      No scenario (thread group) records available for this run. If using the live server, restart <code className="text-[#22D3EE]">launch-dashboard.ps1</code> or register runs with <code className="text-[#22D3EE]">register.ps1</code>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Applications Breakdown Tab */}
      {viewMode === 'applications' && (
        <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] px-3.5 py-2.5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                Application Performance Breakdown
              </h3>
              <p className="text-[11px] text-[#9CA3AF]">
                Click an application name to scope the dashboard to that application.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6B7280]" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter applications..."
                  className="w-48 rounded-md border border-[#1F2937] bg-[#0B0F19] py-1 pl-8 pr-2.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>
              <span className="metric-num text-[11px] text-[#9CA3AF]">
                {apps.length} app{apps.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  <th className="px-3 py-2">Application</th>
                  <th className="px-3 py-2 text-right">Peak VUs</th>
                  <th className="px-3 py-2 text-right">Samples</th>
                  <th className="px-3 py-2 text-right">TPS</th>
                  {baselineRun && <th className="px-3 py-2 text-right">TPS Δ</th>}
                  <th className="px-3 py-2 text-right">Avg (ms)</th>
                  <th className="px-3 py-2 text-right">P90 (ms)</th>
                  <th className="px-3 py-2 text-right">P95 (ms)</th>
                  {baselineRun && <th className="px-3 py-2 text-right">P95 Δ</th>}
                  <th className="px-3 py-2 text-right">P99 (ms)</th>
                  <th className="px-3 py-2 text-right">Error %</th>
                  <th className="px-3 py-2 text-right">Apdex</th>
                  <th className="px-3 py-2 text-right">RT SLA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937]/70">
                {apps
                  .filter((a) => !search.trim() || a.appName.toLowerCase().includes(search.trim().toLowerCase()))
                  .map((a) => {
                    const baseApp = baseAppMap.get(a.appName);
                    const appEps = endpoints.filter((ep) => ep.appName === a.appName);
                    const totalTx = appEps.length;
                    const passedTx = appEps.filter((ep) => {
                      const p95B = ep.rtBreached !== undefined ? ep.rtBreached : rtEnabled && ep.p95 > ep.slaP95Ms;
                      return !p95B;
                    }).length;
                    const apScore = a.apdexScore;
                    const apColor =
                      apScore === undefined
                        ? 'text-[#9CA3AF]'
                        : apScore >= 0.94
                        ? 'border-[#10B981]/40 bg-[#10B981]/15 text-[#10B981]'
                        : apScore >= 0.85
                        ? 'border-[#06B6D4]/40 bg-[#06B6D4]/15 text-[#22D3EE]'
                        : apScore >= 0.7
                        ? 'border-[#F59E0B]/40 bg-[#F59E0B]/15 text-[#F59E0B]'
                        : 'border-[#EF4444]/40 bg-[#EF4444]/15 text-[#EF4444]';
                    return (
                      <tr key={a.appName} className="hover:bg-[#1F2937]/40">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => onSelectApp(a.appName)}
                            className="font-semibold text-[#22D3EE] hover:underline text-left"
                            title={`Scope dashboard to ${a.appName}`}
                          >
                            {a.appName}
                          </button>
                        </td>
                        <td className="metric-num px-3 py-2 text-right text-[#F9FAFB]">
                          {a.peakVUs.toLocaleString()}
                        </td>
                        <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                          {a.samples.toLocaleString()}
                        </td>
                        <td className="metric-num px-3 py-2 text-right text-[#06B6D4]">
                          {a.throughput.toFixed(2)}
                        </td>
                        {baselineRun && (
                          <td className="px-3 py-2 text-right">
                            <InlineDelta cur={a.throughput} base={baseApp?.throughput} lowerIsBetter={false} />
                          </td>
                        )}
                        <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                          {a.avg.toLocaleString()}
                        </td>
                        <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                          {a.p90.toLocaleString()}
                        </td>
                        <td className="metric-num px-3 py-2 text-right font-semibold text-[#F59E0B]">
                          {a.p95.toLocaleString()}
                        </td>
                        {baselineRun && (
                          <td className="px-3 py-2 text-right">
                            <InlineDelta cur={a.p95} base={baseApp?.p95} lowerIsBetter={true} />
                          </td>
                        )}
                        <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                          {a.p99.toLocaleString()}
                        </td>
                        <td
                          className={`metric-num px-3 py-2 text-right font-semibold ${
                            a.errorPct > errorRateSlaPct && errEnabled
                              ? 'text-[#EF4444]'
                              : a.errorPct > 0
                              ? 'text-[#F59E0B]'
                              : 'text-[#10B981]'
                          }`}
                        >
                          {a.errorPct.toFixed(2)}%
                        </td>
                        <td className="px-3 py-2 text-right">
                          {apScore !== undefined ? (
                            <span className={`metric-num inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${apColor}`}>
                              {apScore.toFixed(2)} {a.apdexRating ? `(${a.apdexRating})` : ''}
                            </span>
                          ) : (
                            <span className="text-[#6B7280]">—</span>
                          )}
                        </td>
                        <td className="metric-num px-3 py-2 text-right text-[#F9FAFB]">
                          {totalTx > 0 ? (rtEnabled ? `${passedTx} / ${totalTx}` : `${totalTx} Tx`) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                {apps.length === 0 && (
                  <tr>
                    <td colSpan={baselineRun ? 13 : 11} className="px-4 py-8 text-center text-xs text-[#9CA3AF]">
                      No application breakdown records available for this run.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Compare vs Base & Application Health Matrix Tab */}
      {viewMode === 'compare' && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {/* Application Health Matrix */}
          <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden lg:col-span-7">
            <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                Application Health &amp; Baseline Matrix
              </h3>
              <span className="metric-num text-[11px] text-[#9CA3AF]">
                {apps.length} app{apps.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    <th className="px-3 py-2">Application</th>
                    <th className="px-3 py-2 text-right">Requests</th>
                    <th className="px-3 py-2 text-right">TPS</th>
                    <th className="px-3 py-2 text-right">P95 (ms)</th>
                    {baselineRun && <th className="px-3 py-2 text-right">P95 Δ</th>}
                    <th className="px-3 py-2 text-right">Error %</th>
                    <th className="px-3 py-2 text-right">Apdex</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2937]/70">
                  {apps.map((a) => {
                    const baseApp = baseAppMap.get(a.appName);
                    return (
                      <tr key={a.appName} className="hover:bg-[#1F2937]/40">
                        <td className="px-3 py-2 font-semibold text-[#F9FAFB]">{a.appName}</td>
                        <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                          {a.samples.toLocaleString()}
                        </td>
                        <td className="metric-num px-3 py-2 text-right text-[#06B6D4]">
                          {a.throughput.toFixed(2)}
                        </td>
                        <td className="metric-num px-3 py-2 text-right font-semibold text-[#F9FAFB]">
                          {a.p95.toLocaleString()}
                        </td>
                        {baselineRun && (
                          <td className="px-3 py-2 text-right">
                            <InlineDelta cur={a.p95} base={baseApp?.p95} lowerIsBetter={true} />
                          </td>
                        )}
                        <td className="metric-num px-3 py-2 text-right text-[#10B981]">
                          {a.errorPct.toFixed(2)}%
                        </td>
                        <td className="metric-num px-3 py-2 text-right text-[#22D3EE]">
                          {a.apdexScore !== undefined ? `${a.apdexScore.toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Current vs Baseline Scorecard */}
          <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden lg:col-span-5">
            <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                Current vs Baseline Scorecard
              </h3>
            </div>
            {!baselineRun ? (
              <div className="p-6 text-center text-xs text-[#9CA3AF]">
                Select a <strong>Baseline Run</strong> in the top navigation bar to compare run-over-run deltas.
              </div>
            ) : (
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2 text-right">Current</th>
                    <th className="px-3 py-2 text-right">Baseline</th>
                    <th className="px-3 py-2 text-right">Delta</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2937]/70">
                  <tr>
                    <td className="px-3 py-2 font-medium text-[#F9FAFB]">Peak Virtual Users</td>
                    <td className="metric-num px-3 py-2 text-right text-[#F9FAFB]">
                      {run.summary.peakVUs.toLocaleString()} VU
                    </td>
                    <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                      {baselineRun.summary.peakVUs.toLocaleString()} VU
                    </td>
                    <td className="px-3 py-2 text-right">
                      <InlineDelta
                        cur={run.summary.peakVUs}
                        base={baselineRun.summary.peakVUs}
                        lowerIsBetter={false}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-[#F9FAFB]">Avg Throughput</td>
                    <td className="metric-num px-3 py-2 text-right text-[#F9FAFB]">
                      {run.summary.avgThroughputRps.toFixed(2)} req/s
                    </td>
                    <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                      {baselineRun.summary.avgThroughputRps.toFixed(2)} req/s
                    </td>
                    <td className="px-3 py-2 text-right">
                      <InlineDelta
                        cur={run.summary.avgThroughputRps}
                        base={baselineRun.summary.avgThroughputRps}
                        lowerIsBetter={false}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-[#F9FAFB]">P95 Response Time</td>
                    <td className="metric-num px-3 py-2 text-right text-[#F9FAFB]">
                      {run.summary.p95ResponseTimeMs.toLocaleString()} ms
                    </td>
                    <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                      {baselineRun.summary.p95ResponseTimeMs.toLocaleString()} ms
                    </td>
                    <td className="px-3 py-2 text-right">
                      <InlineDelta
                        cur={run.summary.p95ResponseTimeMs}
                        base={baselineRun.summary.p95ResponseTimeMs}
                        lowerIsBetter={true}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-[#F9FAFB]">Error Rate</td>
                    <td className="metric-num px-3 py-2 text-right text-[#F9FAFB]">
                      {run.summary.errorRatePct.toFixed(2)}%
                    </td>
                    <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                      {baselineRun.summary.errorRatePct.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2 text-right">
                      <InlineDelta
                        cur={run.summary.errorRatePct}
                        base={baselineRun.summary.errorRatePct}
                        lowerIsBetter={true}
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-medium text-[#F9FAFB]">Total Requests</td>
                    <td className="metric-num px-3 py-2 text-right text-[#F9FAFB]">
                      {run.summary.totalRequests.toLocaleString()}
                    </td>
                    <td className="metric-num px-3 py-2 text-right text-[#9CA3AF]">
                      {baselineRun.summary.totalRequests.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <InlineDelta
                        cur={run.summary.totalRequests}
                        base={baselineRun.summary.totalRequests}
                        lowerIsBetter={false}
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Main Content Grid (Split / Transactions / Errors) */}
      {(viewMode === 'split' || viewMode === 'endpoints' || viewMode === 'errors') && (
        <div
          className={`grid grid-cols-1 gap-3 ${
            viewMode === 'split' ? 'xl:grid-cols-12' : ''
          }`}
        >
          {/* Transaction Breakdown Table */}
          {viewMode !== 'errors' && (
            <div
              className={`rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden ${
                viewMode === 'split' ? 'xl:col-span-8' : ''
              }`}
            >
              <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                  Transaction Breakdown
                </h3>
                <span className="metric-num text-[11px] text-[#9CA3AF]">
                  Showing {filteredEndpoints.length} of {appFilteredEndpoints.length} endpoints
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                      {columns.map((col) => (
                        <th
                          key={col.key}
                          onClick={() => handleSort(col.key)}
                          className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:text-[#F9FAFB] ${
                            col.align === 'right' ? 'text-right' : 'text-left'
                          }`}
                        >
                          <span
                            className={`inline-flex items-center gap-1 ${
                              col.align === 'right' ? 'justify-end' : 'justify-start'
                            }`}
                          >
                            {col.label}
                            {renderSortIcon(col.key)}
                          </span>
                        </th>
                      ))}
                      {baselineRun && (
                        <th className="whitespace-nowrap px-3 py-2 text-right">P95 Δ</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2937]/70">
                    {filteredEndpoints.map((ep) => {
                      const p95Breach =
                        ep.rtBreached !== undefined
                          ? ep.rtBreached
                          : rtEnabled && ep.p95 > ep.slaP95Ms;
                      const errBreach =
                        ep.errorBreached !== undefined
                          ? ep.errorBreached
                          : errEnabled && ep.errorPct > errorRateSlaPct;
                      const rowBreach = p95Breach || errBreach;
                      const baseEp = baseEndpointMap.get(ep.endpoint);

                      return (
                        <tr
                          key={`${ep.appName || ''}-${ep.scenario || ''}-${ep.endpoint}`}
                          className={`transition-colors ${
                            rowBreach
                              ? 'bg-[#EF4444]/[0.08] hover:bg-[#EF4444]/[0.14]'
                              : 'hover:bg-[#1F2937]/40'
                          }`}
                        >
                          <td
                            className={`metric-num max-w-[280px] truncate px-3 py-2 font-medium text-[#F9FAFB] ${
                              rowBreach ? 'border-l-2 border-[#EF4444]' : ''
                            }`}
                            title={ep.scenario ? `${ep.endpoint} [${ep.scenario}]` : ep.endpoint}
                          >
                            {ep.endpoint}
                          </td>
                          <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#9CA3AF]">
                            {ep.samples.toLocaleString()}
                          </td>
                          <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#F9FAFB]">
                            {ep.avg.toLocaleString()}
                          </td>
                          <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#9CA3AF]">
                            {ep.p90.toLocaleString()}
                          </td>
                          <td
                            className={`metric-num whitespace-nowrap px-3 py-2 text-right font-semibold ${
                              p95Breach ? 'text-[#EF4444]' : 'text-[#F59E0B]'
                            }`}
                          >
                            {ep.p95.toLocaleString()}
                          </td>
                          <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#9CA3AF]">
                            {ep.p99.toLocaleString()}
                          </td>
                          <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#9CA3AF]">
                            {ep.max.toLocaleString()}
                          </td>
                          <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#06B6D4]">
                            {ep.throughput.toFixed(1)}
                          </td>
                          <td
                            className={`metric-num whitespace-nowrap px-3 py-2 text-right font-semibold ${
                              errBreach
                                ? 'text-[#EF4444]'
                                : ep.errorPct > 0
                                ? 'text-[#F59E0B]'
                                : 'text-[#10B981]'
                            }`}
                          >
                            {ep.errorPct.toFixed(2)}%
                          </td>
                          {baselineRun && (
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              <InlineDelta cur={ep.p95} base={baseEp?.p95} lowerIsBetter={true} />
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {filteredEndpoints.length === 0 && (
                      <tr>
                        <td
                          colSpan={baselineRun ? 10 : 9}
                          className="px-4 py-8 text-center text-xs text-[#9CA3AF]"
                        >
                          No transactions match the current filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error Analysis Panel */}
          {viewMode !== 'endpoints' && (
            <div
              className={`flex flex-col gap-3 ${
                viewMode === 'split' ? 'xl:col-span-4' : ''
              }`}
            >
              {/* Grouped HTTP Status Codes */}
              <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                    <AlertOctagon className="h-3.5 w-3.5 text-[#EF4444]" />
                    HTTP Error Codes
                  </h3>
                  <span className="metric-num text-[11px] text-[#9CA3AF]">
                    {totalErrorCount.toLocaleString()} total
                  </span>
                </div>

                {httpErrors.length === 0 ? (
                  <div className="rounded border border-[#10B981]/30 bg-[#10B981]/10 px-3 py-4 text-center text-xs text-[#10B981]">
                    Zero HTTP errors recorded in this run.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {httpErrors.map((err) => (
                      <div key={`${err.code}-${err.label}`} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="metric-num rounded bg-[#EF4444]/15 border border-[#EF4444]/30 px-1.5 py-0.5 text-[11px] font-semibold text-[#EF4444]">
                              {err.code}
                            </span>
                            <span className="truncate text-[#F9FAFB]">{err.label}</span>
                          </div>
                          <span className="metric-num whitespace-nowrap text-[11px] text-[#9CA3AF]">
                            <strong className="text-[#F9FAFB]">
                              {err.count.toLocaleString()}
                            </strong>{' '}
                            ({err.percentage.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1F2937]">
                          <div
                            className="h-full rounded-full bg-[#EF4444]"
                            style={{ width: `${Math.max(4, err.percentage)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Top Assertion Failures */}
              <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5 flex-1">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                    <ShieldAlert className="h-3.5 w-3.5 text-[#F59E0B]" />
                    Top Assertion Failures
                  </h3>
                  <span className="metric-num text-[11px] text-[#9CA3AF]">
                    {assertionFailures.length} rules
                  </span>
                </div>

                {assertionFailures.length === 0 ? (
                  <div className="rounded border border-[#10B981]/30 bg-[#10B981]/10 px-3 py-4 text-center text-xs text-[#10B981]">
                    All response assertions passed.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {assertionFailures.map((af) => (
                      <div
                        key={af.id}
                        className="rounded-md border border-[#1F2937] bg-[#0B0F19]/70 p-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium leading-snug text-[#F9FAFB]">
                            {af.assertion}
                          </p>
                          <span
                            className={`metric-num shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              af.severity === 'critical'
                                ? 'bg-[#EF4444]/15 text-[#EF4444]'
                                : 'bg-[#F59E0B]/15 text-[#F59E0B]'
                            }`}
                          >
                            {af.count.toLocaleString()}x
                          </span>
                        </div>
                        <div className="mt-1.5 metric-num truncate text-[11px] text-[#9CA3AF]">
                          {af.endpoint}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
