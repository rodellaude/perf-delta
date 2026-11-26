/**
 * Root Application Shell (`dashboard-ui/src/App.tsx`)
 *
 * Coordinates all client-side state for Perf-Delta Live:
 *  - Run loading from `/api/runs` (with static `/vault-runs.json` & mock fallback)
 *  - Multi-Select Include/Exclude Global Scope (`applyGlobalScope` recalculates KPIs,
 *    Apdex, tables, and errors in 0ms; fetches filtered DuckDB `/timeseries` on demand)
 *  - Grafana-style URL State Sync (`?run=&base=&tab=&range=&apps=&scenarios=&endpoints=`)
 *    and 1-click Read-Only Share Link generation
 *  - Admin authentication hydration (`/api/auth/status`) and role-gated views
 *  - Pure-TS offline Static HTML report export (`exportStaticHtmlReport`)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertOctagon, ArrowRight, Flame } from 'lucide-react';
import { MOCK_TEST_RUNS } from './data/mockPerformanceData';
import {
  PerformanceTestRun,
  TelemetryPoint,
  TimeRangeOption,
  VaultExportPayload,
} from './types/performance';
import { TopNavBar } from './components/TopNavBar';
import { DashboardTab, SideNav } from './components/SideNav';
import { GlobalFilterBar } from './components/GlobalFilterBar';
import { EMPTY_MULTI_FILTER, MultiFilterState } from './components/MultiSelectFilter';
import { AiSummaryPayload, ExecutiveSummaryBanner } from './components/ExecutiveSummaryBanner';
import { KpiSummaryRow } from './components/KpiSummaryRow';
import { TelemetryChartsRow } from './components/TelemetryChartsRow';
import { EndpointAndErrorsSection } from './components/EndpointAndErrorsSection';
import { ErrorsDiagnosticsView } from './components/ErrorsDiagnosticsView';
import { GlossaryView } from './components/GlossaryView';
import { TrendsView } from './components/TrendsView';
import { DatabaseExplorerView } from './components/DatabaseExplorerView';
import { SettingsView } from './components/SettingsView';
import { LoginModal } from './components/LoginModal';
import { computeFallbackApdex } from './utils/executiveSummary';
import { exportStaticHtmlReport } from './utils/staticHtmlExport';

function matchesMultiFilter(val: string | undefined, filter: MultiFilterState): boolean {
  if (filter.values.length === 0) return true;
  const s = val || '';
  const hit = filter.values.includes(s);
  return filter.mode === 'include' ? hit : !hit;
}

function applyGlobalScope(
  run: PerformanceTestRun,
  appFilter: MultiFilterState,
  scenFilter: MultiFilterState,
  epFilter: MultiFilterState,
  overrideTimeSeries?: TelemetryPoint[] | null
): PerformanceTestRun {
  const hasFilter =
    appFilter.values.length > 0 ||
    scenFilter.values.length > 0 ||
    epFilter.values.length > 0;
  if (!hasFilter) return run;

  const filteredEndpoints = run.endpoints.filter(
    (ep) =>
      matchesMultiFilter(ep.appName, appFilter) &&
      matchesMultiFilter(ep.scenario, scenFilter) &&
      matchesMultiFilter(ep.endpoint, epFilter)
  );

  const filteredScenarios = (run.scenarios || []).filter((sc) => {
    if (!matchesMultiFilter(sc.appName, appFilter)) return false;
    if (!matchesMultiFilter(sc.scenario, scenFilter)) return false;
    if (epFilter.values.length > 0) {
      return filteredEndpoints.some((e) => e.scenario === sc.scenario && e.appName === sc.appName);
    }
    return true;
  });

  const filteredApps = (run.apps || []).filter((a) => matchesMultiFilter(a.appName, appFilter));

  const filteredErrorDetails = (run.errorDetails || []).filter(
    (d) =>
      matchesMultiFilter(d.appName, appFilter) &&
      matchesMultiFilter(d.scenario, scenFilter) &&
      matchesMultiFilter(d.endpoint, epFilter)
  );

  const codeMap = new Map<string, { code: string; label: string; count: number }>();
  const afMap = new Map<string, { assertion: string; endpoint: string; count: number }>();
  for (const d of filteredErrorDetails) {
    const c = codeMap.get(d.responseCode) || {
      code: d.responseCode,
      label: d.responseMessage,
      count: 0,
    };
    c.count += d.count;
    codeMap.set(d.responseCode, c);

    const fm = d.failureMessage || d.responseMessage || 'Request Failed';
    const a = afMap.get(fm) || { assertion: fm, endpoint: d.endpoint, count: 0 };
    a.count += d.count;
    afMap.set(fm, a);
  }
  const errArr = [...codeMap.values()].sort((a, b) => b.count - a.count);
  const errTot = Math.max(errArr.reduce((acc, x) => acc + x.count, 0), 1);
  const filteredHttpErrors = errArr.map((x) => ({
    ...x,
    percentage: Number(((x.count / errTot) * 100).toFixed(1)),
  }));
  const filteredAssertions = [...afMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((x, idx) => ({
      id: `scoped-assert-${idx + 1}`,
      assertion: x.assertion,
      endpoint: x.endpoint,
      count: x.count,
      severity: x.count >= 20 ? ('critical' as const) : ('warning' as const),
    }));

  const durSecs = Math.max(run.durationMinutes * 60, 1);
  const totalRequests = filteredEndpoints.reduce((acc, ep) => acc + ep.samples, 0);
  const failedRequests = filteredEndpoints.reduce(
    (acc, ep) => acc + Math.round((ep.errorPct / 100) * ep.samples),
    0
  );
  const avgThroughputRps = Number((totalRequests / durSecs).toFixed(2));
  const errorRatePct = Number(((failedRequests / Math.max(totalRequests, 1)) * 100).toFixed(2));

  let p95ResponseTimeMs = run.summary.p95ResponseTimeMs;
  if (filteredEndpoints.length === 1) {
    p95ResponseTimeMs = Math.round(filteredEndpoints[0].p95);
  } else if (filteredEndpoints.length > 1 && totalRequests > 0) {
    const weighted = filteredEndpoints.reduce((acc, ep) => acc + ep.p95 * ep.samples, 0);
    p95ResponseTimeMs = Math.round(weighted / totalRequests);
  } else if (filteredEndpoints.length === 0) {
    p95ResponseTimeMs = 0;
  }

  const ts = overrideTimeSeries && overrideTimeSeries.length > 0 ? overrideTimeSeries : run.timeSeries;
  const peakVUs =
    overrideTimeSeries && overrideTimeSeries.length > 0
      ? Math.max(...overrideTimeSeries.map((p) => p.vus))
      : run.summary.peakVUs;

  const scopedBase: PerformanceTestRun = {
    ...run,
    apps: filteredApps,
    scenarios: filteredScenarios,
    endpoints: filteredEndpoints,
    httpErrors: run.errorDetails ? filteredHttpErrors : run.httpErrors,
    assertionFailures: run.errorDetails ? filteredAssertions : run.assertionFailures,
    errorDetails: filteredErrorDetails,
    timeSeries: ts,
    summary: {
      ...run.summary,
      peakVUs,
      totalRequests,
      failedRequests,
      avgThroughputRps,
      p95ResponseTimeMs,
      errorRatePct,
    },
    apdex: undefined,
  };
  scopedBase.apdex = computeFallbackApdex(scopedBase);
  return scopedBase;
}

function describeScope(
  appFilter: MultiFilterState,
  scenFilter: MultiFilterState,
  epFilter: MultiFilterState
): string {
  const parts: string[] = [];
  if (appFilter.values.length > 0) {
    parts.push(`${appFilter.mode === 'exclude' ? 'Excl' : 'Apps'}: ${appFilter.values.join(', ')}`);
  }
  if (scenFilter.values.length > 0) {
    parts.push(`${scenFilter.mode === 'exclude' ? 'Excl Scenarios' : 'Scenarios'}: ${scenFilter.values.join(', ')}`);
  }
  if (epFilter.values.length > 0) {
    parts.push(`${epFilter.mode === 'exclude' ? 'Excl Tx' : 'Tx'}: ${epFilter.values.slice(0, 3).join(', ')}${epFilter.values.length > 3 ? ` (+${epFilter.values.length - 3})` : ''}`);
  }
  return parts.length > 0 ? parts.join(' | ') : 'ALL';
}

const SHAREABLE_TABS: DashboardTab[] = [
  'overview',
  'applications',
  'scenarios',
  'transactions',
  'compare',
  'trends',
  'errors',
  'glossary',
];

function parseFilterParam(params: URLSearchParams, modeKey: string, valKey: string): MultiFilterState {
  const rawVals = params.get(valKey);
  if (!rawVals) return EMPTY_MULTI_FILTER;
  const mode = params.get(modeKey) === 'exclude' ? 'exclude' : 'include';
  try {
    const parsed = JSON.parse(rawVals);
    if (Array.isArray(parsed)) {
      return { mode, values: parsed.map(String).filter(Boolean) };
    }
  } catch {
    // support comma-separated fallback
  }
  const values = rawVals
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return values.length > 0 ? { mode, values } : EMPTY_MULTI_FILTER;
}

function matchRunByParam(allRuns: PerformanceTestRun[], param: string | null): string | null {
  if (!param) return null;
  const exact = allRuns.find((r) => r.id === param);
  if (exact) return exact.id;
  const bySuffix = allRuns.find((r) => r.id.endsWith(`-${param}`));
  return bySuffix ? bySuffix.id : null;
}

function readInitialUrlState() {
  try {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab') as DashboardTab | null;
    const rangeParam = params.get('range') as TimeRangeOption | null;
    return {
      run: params.get('run'),
      base: params.get('base'),
      tab: tabParam && SHAREABLE_TABS.includes(tabParam) ? tabParam : ('overview' as DashboardTab),
      range:
        rangeParam === '15m' || rangeParam === '1h' || rangeParam === 'full'
          ? rangeParam
          : ('full' as TimeRangeOption),
      appFilter: parseFilterParam(params, 'appMode', 'apps'),
      scenarioFilter: parseFilterParam(params, 'scenMode', 'scenarios'),
      endpointFilter: parseFilterParam(params, 'epMode', 'endpoints'),
    };
  } catch {
    return {
      run: null,
      base: null,
      tab: 'overview' as DashboardTab,
      range: 'full' as TimeRangeOption,
      appFilter: EMPTY_MULTI_FILTER,
      scenarioFilter: EMPTY_MULTI_FILTER,
      endpointFilter: EMPTY_MULTI_FILTER,
    };
  }
}

export const App: React.FC = () => {
  // Hydrate initial state from URL query params once on mount.
  // `skipNextRunResetRef` prevents the initial `selectedRunId` assignment from wiping
  // URL-hydrated global filters when a user opens a shared filtered link.
  const initialUrlRef = useRef(readInitialUrlState());
  const skipNextRunResetRef = useRef(true);
  const runsLoadedRef = useRef(false);

  const [runs, setRuns] = useState<PerformanceTestRun[]>(MOCK_TEST_RUNS);
  const [selectedRunId, setSelectedRunId] = useState<string>(MOCK_TEST_RUNS[0].id);
  const [baselineRunId, setBaselineRunId] = useState<string>('');
  const [appFilter, setAppFilter] = useState<MultiFilterState>(initialUrlRef.current.appFilter);
  const [scenarioFilter, setScenarioFilter] = useState<MultiFilterState>(initialUrlRef.current.scenarioFilter);
  const [endpointFilter, setEndpointFilter] = useState<MultiFilterState>(initialUrlRef.current.endpointFilter);
  const [scopedTimeSeries, setScopedTimeSeries] = useState<TelemetryPoint[] | null>(null);
  const [scopedBaseTimeSeries, setScopedBaseTimeSeries] = useState<TelemetryPoint[] | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>(initialUrlRef.current.tab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('perf-delta-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [timeRange, setTimeRange] = useState<TimeRangeOption>(initialUrlRef.current.range);
  const [isLive, setIsLive] = useState<boolean>(false);
  const [livePoints, setLivePoints] = useState<TelemetryPoint[]>([]);
  const [apiMode, setApiMode] = useState<'live-duckdb-agg' | 'live-duckdb' | 'cached-json' | 'mock-only'>('mock-only');
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [adminUsername, setAdminUsername] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean>(false);
  const [loginModalOpen, setLoginModalOpen] = useState<boolean>(false);
  const [activeAiSummary, setActiveAiSummary] = useState<AiSummaryPayload | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = window.localStorage.getItem('perf-delta-ui-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // ignore storage errors
    }
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem('perf-delta-ui-theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem('perf-delta-sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  const applyInitialSelection = useCallback((loadedVaultRuns: PerformanceTestRun[]) => {
    const allRuns = [...MOCK_TEST_RUNS, ...loadedVaultRuns];
    const urlInit = initialUrlRef.current;
    const matchedRun = matchRunByParam(allRuns, urlInit.run);
    const chosenRun = matchedRun || loadedVaultRuns[0].id;
    skipNextRunResetRef.current = true;
    setSelectedRunId(chosenRun);

    if (urlInit.base === 'none') {
      setBaselineRunId('');
    } else {
      const matchedBase = matchRunByParam(allRuns, urlInit.base);
      if (matchedBase && matchedBase !== chosenRun) {
        setBaselineRunId(matchedBase);
      } else if (loadedVaultRuns.length > 1) {
        const fallbackBase = loadedVaultRuns.find((r) => r.id !== chosenRun)?.id || '';
        setBaselineRunId(fallbackBase);
      }
    }
    runsLoadedRef.current = true;
  }, []);

  const loadVaultRuns = useCallback(async (preserveSelection = false) => {
    try {
      const apiRes = await fetch('/api/runs');
      if (apiRes.ok) {
        const payload = (await apiRes.json()) as VaultExportPayload & { mode?: string };
        if (Array.isArray(payload.runs) && payload.runs.length > 0) {
          const allNext = [...MOCK_TEST_RUNS, ...payload.runs];
          setRuns(allNext);
          if (!preserveSelection) {
            applyInitialSelection(payload.runs);
          } else {
            const validIds = new Set(allNext.map((r) => r.id));
            setSelectedRunId((cur) => (validIds.has(cur) ? cur : payload.runs[0].id));
            setBaselineRunId((cur) => (cur && validIds.has(cur) ? cur : ''));
          }
          setApiMode(
            payload.mode === 'live-duckdb-agg'
              ? 'live-duckdb-agg'
              : payload.mode === 'live-duckdb'
              ? 'live-duckdb'
              : 'cached-json'
          );
          return;
        }
      }
    } catch {
      // Live API not running — fall back to static vault-runs.json
    }

    try {
      const res = await fetch('/vault-runs.json');
      if (res.ok) {
        const payload = (await res.json()) as VaultExportPayload;
        if (Array.isArray(payload.runs) && payload.runs.length > 0) {
          const allNext = [...MOCK_TEST_RUNS, ...payload.runs];
          setRuns(allNext);
          if (!preserveSelection) {
            applyInitialSelection(payload.runs);
          } else {
            const validIds = new Set(allNext.map((r) => r.id));
            setSelectedRunId((cur) => (validIds.has(cur) ? cur : payload.runs[0].id));
            setBaselineRunId((cur) => (cur && validIds.has(cur) ? cur : ''));
          }
          setApiMode('cached-json');
          return;
        }
      }
    } catch {
      // Silently fall back to built-in mock data
    }
    runsLoadedRef.current = true;
  }, [applyInitialSelection]);

  useEffect(() => {
    loadVaultRuns(false);
  }, [loadVaultRuns]);

  useEffect(() => {
    let cancelled = false;
    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/status');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data.ok) {
          setIsAdmin(Boolean(data.authenticated));
          setAdminUsername(data.username || null);
          setSetupRequired(Boolean(data.setupRequired));
        }
      } catch {
        // Default to Read-Only Viewer if API is unavailable
      }
    }
    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore network error
    }
    setIsAdmin(false);
    setAdminUsername(null);
    if (activeTab === 'settings' || activeTab === 'database') {
      setActiveTab('overview');
    }
  };

  const rawSelectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId]
  );

  const rawBaselineRun = useMemo(
    () =>
      baselineRunId && baselineRunId !== rawSelectedRun.id
        ? runs.find((r) => r.id === baselineRunId) ?? null
        : null,
    [runs, baselineRunId, rawSelectedRun.id]
  );

  useEffect(() => {
    setLivePoints([]);
    if (skipNextRunResetRef.current) {
      skipNextRunResetRef.current = false;
      return;
    }
    setAppFilter(EMPTY_MULTI_FILTER);
    setScenarioFilter(EMPTY_MULTI_FILTER);
    setEndpointFilter(EMPTY_MULTI_FILTER);
    setScopedTimeSeries(null);
    setScopedBaseTimeSeries(null);
  }, [selectedRunId]);

  const buildShareUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (selectedRunId) params.set('run', selectedRunId);
    params.set('base', baselineRunId || 'none');
    const safeTab = SHAREABLE_TABS.includes(activeTab) ? activeTab : 'overview';
    if (safeTab !== 'overview') params.set('tab', safeTab);
    if (timeRange !== 'full') params.set('range', timeRange);
    if (appFilter.values.length > 0) {
      params.set('appMode', appFilter.mode);
      params.set('apps', JSON.stringify(appFilter.values));
    }
    if (scenarioFilter.values.length > 0) {
      params.set('scenMode', scenarioFilter.mode);
      params.set('scenarios', JSON.stringify(scenarioFilter.values));
    }
    if (endpointFilter.values.length > 0) {
      params.set('epMode', endpointFilter.mode);
      params.set('endpoints', JSON.stringify(endpointFilter.values));
    }
    const qs = params.toString();
    return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`;
  }, [selectedRunId, baselineRunId, activeTab, timeRange, appFilter, scenarioFilter, endpointFilter]);

  useEffect(() => {
    if (!runsLoadedRef.current) return;
    try {
      const nextUrl = buildShareUrl();
      window.history.replaceState(null, '', nextUrl);
    } catch {
      // ignore history errors
    }
  }, [buildShareUrl]);

  const handleShareLink = useCallback(async () => {
    const shareUrl = buildShareUrl();
    try {
      await navigator.clipboard.writeText(shareUrl);
      return true;
    } catch {
      window.prompt('Copy shareable read-only link:', shareUrl);
      return true;
    }
  }, [buildShareUrl]);

  const hasGlobalFilter =
    appFilter.values.length > 0 ||
    scenarioFilter.values.length > 0 ||
    endpointFilter.values.length > 0;

  useEffect(() => {
    if (!hasGlobalFilter || rawSelectedRun.source !== 'duckdb-vault') {
      setScopedTimeSeries(null);
      setScopedBaseTimeSeries(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams();
    if (appFilter.values.length > 0) {
      params.set('appMode', appFilter.mode);
      params.set('apps', JSON.stringify(appFilter.values));
    }
    if (scenarioFilter.values.length > 0) {
      params.set('scenarioMode', scenarioFilter.mode);
      params.set('scenarios', JSON.stringify(scenarioFilter.values));
    }
    if (endpointFilter.values.length > 0) {
      params.set('endpointMode', endpointFilter.mode);
      params.set('endpoints', JSON.stringify(endpointFilter.values));
    }

    async function fetchScoped() {
      try {
        const res = await fetch(
          `/api/runs/${encodeURIComponent(rawSelectedRun.id)}/timeseries?${params.toString()}`
        );
        if (res.ok && !cancelled) {
          const data = (await res.json()) as { timeSeries?: TelemetryPoint[] };
          setScopedTimeSeries(data.timeSeries && data.timeSeries.length > 0 ? data.timeSeries : null);
        }
      } catch {
        if (!cancelled) setScopedTimeSeries(null);
      }

      if (rawBaselineRun && rawBaselineRun.source === 'duckdb-vault') {
        try {
          const bRes = await fetch(
            `/api/runs/${encodeURIComponent(rawBaselineRun.id)}/timeseries?${params.toString()}`
          );
          if (bRes.ok && !cancelled) {
            const bData = (await bRes.json()) as { timeSeries?: TelemetryPoint[] };
            setScopedBaseTimeSeries(
              bData.timeSeries && bData.timeSeries.length > 0 ? bData.timeSeries : null
            );
          }
        } catch {
          if (!cancelled) setScopedBaseTimeSeries(null);
        }
      } else if (!cancelled) {
        setScopedBaseTimeSeries(null);
      }
    }
    fetchScoped();
    return () => {
      cancelled = true;
    };
  }, [hasGlobalFilter, rawSelectedRun.id, rawSelectedRun.source, rawBaselineRun, appFilter, scenarioFilter, endpointFilter]);

  const availableApps = useMemo(
    () => (rawSelectedRun.apps || []).map((a) => a.appName),
    [rawSelectedRun.apps]
  );
  const availableScenarios = useMemo(() => {
    const scs = (rawSelectedRun.scenarios || []).filter((s) =>
      matchesMultiFilter(s.appName, appFilter)
    );
    return [...new Set(scs.map((s) => s.scenario))];
  }, [rawSelectedRun.scenarios, appFilter]);
  const availableEndpoints = useMemo(() => {
    const eps = rawSelectedRun.endpoints.filter(
      (e) =>
        matchesMultiFilter(e.appName, appFilter) &&
        matchesMultiFilter(e.scenario, scenarioFilter)
    );
    return [...new Set(eps.map((e) => e.endpoint))];
  }, [rawSelectedRun.endpoints, appFilter, scenarioFilter]);

  const selectedRun = useMemo(
    () =>
      applyGlobalScope(
        rawSelectedRun,
        appFilter,
        scenarioFilter,
        endpointFilter,
        scopedTimeSeries
      ),
    [rawSelectedRun, appFilter, scenarioFilter, endpointFilter, scopedTimeSeries]
  );

  const baselineRun = useMemo(
    () =>
      rawBaselineRun
        ? applyGlobalScope(
            rawBaselineRun,
            appFilter,
            scenarioFilter,
            endpointFilter,
            scopedBaseTimeSeries
          )
        : null,
    [rawBaselineRun, appFilter, scenarioFilter, endpointFilter, scopedBaseTimeSeries]
  );

  const scopedVaultRuns = useMemo(
    () =>
      runs
        .filter((r) => r.source === 'duckdb-vault')
        .map((r) => applyGlobalScope(r, appFilter, scenarioFilter, endpointFilter, null)),
    [runs, appFilter, scenarioFilter, endpointFilter]
  );

  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => {
      setLivePoints((prev) => {
        const baseSeries = prev.length > 0 ? prev : selectedRun.timeSeries;
        const last = baseSeries[baseSeries.length - 1];
        if (!last) return prev;

        const nextEpoch = last.epochMs + 15000;
        const d = new Date(nextEpoch);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        const ss = String(d.getUTCSeconds()).padStart(2, '0');

        const delta = (Math.random() - 0.48) * 0.08;
        const nextVus = Math.max(10, Math.round(last.vus * (1 + delta)));
        const nextTps = Number(Math.max(1, last.throughput * (1 + delta * 0.9)).toFixed(1));
        const nextAvg = Math.max(15, Math.round(last.avg * (1 + delta * 1.1)));
        const nextP90 = Math.max(nextAvg + 10, Math.round(last.p90 * (1 + delta * 1.1)));
        const nextP95 = Math.max(nextP90 + 10, Math.round(last.p95 * (1 + delta * 1.2)));
        const nextP99 = Math.max(nextP95 + 20, Math.round(last.p99 * (1 + delta * 1.2)));
        const nextErr = Number(
          Math.max(0, last.errorRate + (Math.random() - 0.5) * 0.15).toFixed(2)
        );

        const nextPoint: TelemetryPoint = {
          timestamp: `${hh}:${mm}:${ss}`,
          isoTimestamp: d.toISOString(),
          epochMs: nextEpoch,
          vus: nextVus,
          throughput: nextTps,
          avg: nextAvg,
          p90: nextP90,
          p95: nextP95,
          p99: nextP99,
          errorCount: Math.round((nextErr / 100) * nextTps * 15),
          errorRate: nextErr,
          phase: last.phase,
        };

        return [...prev.slice(-29), nextPoint];
      });
    }, 2000);

    return () => window.clearInterval(timer);
  }, [isLive, selectedRun]);

  const combinedSeries = useMemo(
    () => [...selectedRun.timeSeries, ...livePoints],
    [selectedRun.timeSeries, livePoints]
  );

  const visibleSeries = useMemo(() => {
    if (timeRange === 'full' || combinedSeries.length === 0) {
      return combinedSeries;
    }
    const lastEpoch = combinedSeries[combinedSeries.length - 1].epochMs;
    const windowMs = timeRange === '15m' ? 15 * 60 * 1000 : 60 * 60 * 1000;
    const filtered = combinedSeries.filter((p) => p.epochMs >= lastEpoch - windowMs);
    return filtered.length >= 2 ? filtered : combinedSeries.slice(-12);
  }, [combinedSeries, timeRange]);

  const handleExportReport = () => {
    const reportBlob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            timeRange,
            scope: { appFilter, scenarioFilter, endpointFilter },
            run: {
              ...selectedRun,
              timeSeries: visibleSeries,
            },
            baselineRun: baselineRun
              ? { id: baselineRun.id, name: baselineRun.name, summary: baselineRun.summary }
              : null,
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(reportBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedRun.id}-${timeRange}-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const vaultCount = runs.filter((r) => r.source === 'duckdb-vault').length;
  const rtEnabled = selectedRun.sla.rtEnabled !== false;
  const errEnabled = selectedRun.sla.errorEnabled !== false;

  const breachCount = useMemo(
    () =>
      selectedRun.endpoints.filter((ep) => {
        const p95B = ep.rtBreached !== undefined ? ep.rtBreached : rtEnabled && ep.p95 > ep.slaP95Ms;
        const errB =
          ep.errorBreached !== undefined
            ? ep.errorBreached
            : errEnabled && ep.errorPct > selectedRun.sla.errorRatePct;
        return p95B || errB;
      }).length,
    [selectedRun, rtEnabled, errEnabled]
  );

  const totalErrorCount = useMemo(
    () => selectedRun.httpErrors.reduce((acc, g) => acc + g.count, 0),
    [selectedRun.httpErrors]
  );

  const topSlowest5 = useMemo(
    () => [...selectedRun.endpoints].sort((a, b) => b.p95 - a.p95).slice(0, 5),
    [selectedRun.endpoints]
  );

  const scopeLabel = describeScope(appFilter, scenarioFilter, endpointFilter);
  const scopeKey = `${selectedRun.id}|${baselineRun?.id || ''}|${JSON.stringify({
    appFilter,
    scenarioFilter,
    endpointFilter,
  })}`;

  const handleExportStaticHtml = () => {
    exportStaticHtmlReport({
      run: selectedRun,
      baselineRun,
      vaultRuns: scopedVaultRuns,
      visibleSeries,
      scopeLabel,
      theme,
      aiSummary: activeAiSummary,
    });
  };

  return (
    <div className="min-h-screen bg-[#0B0F19] text-[#F9FAFB]">
      <TopNavBar
        runs={runs}
        selectedRun={rawSelectedRun}
        onSelectRun={setSelectedRunId}
        baselineRunId={baselineRunId}
        onSelectBaselineRun={setBaselineRunId}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        isLive={isLive}
        onToggleLive={() => setIsLive((v) => !v)}
        onShareLink={handleShareLink}
        onExportHtml={handleExportStaticHtml}
        onExportReport={handleExportReport}
        vaultCount={vaultCount}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        isAdmin={isAdmin}
        adminUsername={adminUsername}
        onOpenLogin={() => setLoginModalOpen(true)}
        onLogout={handleLogout}
      />

      <div className="flex flex-col md:flex-row">
        <SideNav
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
          appCount={selectedRun.apps?.length ?? 0}
          endpointCount={selectedRun.endpoints.length}
          scenarioCount={selectedRun.scenarios?.length ?? 0}
          vaultCount={vaultCount}
          errorCount={totalErrorCount}
          breachCount={breachCount}
          hasBaseline={Boolean(baselineRun)}
          isAdmin={isAdmin}
        />

        <main className="min-w-0 flex-1 space-y-3 px-4 py-3.5 lg:px-6">
          {/* Run Meta Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#1F2937] bg-[#111827]/70 px-3.5 py-2 text-[11px] text-[#9CA3AF]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Run:{' '}
                <strong className="font-medium text-[#F9FAFB]">{selectedRun.name}</strong>
              </span>
              {baselineRun && (
                <span>
                  Baseline:{' '}
                  <strong className="font-medium text-[#A5B4FC]">{baselineRun.name}</strong>
                </span>
              )}
              <span>
                Window:{' '}
                <span className="metric-num text-[#F9FAFB]">
                  {selectedRun.startedAt.replace('T', ' ').replace('Z', ' UTC')}
                </span>
              </span>
              <span>
                Duration:{' '}
                <span className="metric-num text-[#F9FAFB]">
                  {selectedRun.durationMinutes} min
                </span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span>
                Source:{' '}
                <span className="metric-num text-[#06B6D4]">
                  {selectedRun.source === 'duckdb-vault'
                    ? apiMode === 'live-duckdb-agg'
                      ? 'Live DuckDB API (Pre-Aggregated Vault)'
                      : apiMode === 'live-duckdb'
                      ? 'Live DuckDB API (Performance_Vault.db)'
                      : 'DuckDB Vault Snapshot (JSON)'
                    : 'Built-in Stress Simulation'}
                </span>
              </span>
            </div>
          </div>

          {/* Global Multi-Select Include / Exclude Filter Bar */}
          {activeTab !== 'glossary' && activeTab !== 'settings' && activeTab !== 'database' && (
            <GlobalFilterBar
              apps={availableApps}
              scenarios={availableScenarios}
              endpoints={availableEndpoints}
              appFilter={appFilter}
              scenarioFilter={scenarioFilter}
              endpointFilter={endpointFilter}
              onChangeAppFilter={(next) => {
                setAppFilter(next);
              }}
              onChangeScenarioFilter={(next) => {
                setScenarioFilter(next);
              }}
              onChangeEndpointFilter={setEndpointFilter}
              onReset={() => {
                setAppFilter(EMPTY_MULTI_FILTER);
                setScenarioFilter(EMPTY_MULTI_FILTER);
                setEndpointFilter(EMPTY_MULTI_FILTER);
              }}
            />
          )}

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <>
              <ExecutiveSummaryBanner
                run={selectedRun}
                baselineRun={baselineRun}
                selectedApp={scopeLabel}
                scopeKey={scopeKey}
                isAdmin={isAdmin}
                onActiveAiChange={setActiveAiSummary}
              />

              <KpiSummaryRow
                run={selectedRun}
                baselineRun={baselineRun}
                visibleSeries={hasGlobalFilter && !scopedTimeSeries ? [] : visibleSeries}
              />

              <TelemetryChartsRow
                data={visibleSeries}
                baselineData={baselineRun?.timeSeries}
                slaP95Ms={selectedRun.sla.p95Ms}
                theme={theme}
              />

              <section className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden lg:col-span-7">
                  <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                      <Flame className="h-3.5 w-3.5 text-[#F59E0B]" />
                      Top 5 Slowest Transactions (P95)
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('transactions')}
                      className="no-print inline-flex items-center gap-1 text-[11px] font-medium text-[#22D3EE] hover:underline"
                    >
                      View all {selectedRun.endpoints.length}
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                        <th className="px-3 py-1.5">Transaction</th>
                        <th className="px-3 py-1.5 text-right">Samples</th>
                        <th className="px-3 py-1.5 text-right">P95 (ms)</th>
                        <th className="px-3 py-1.5 text-right">Error %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F2937]/70">
                      {topSlowest5.map((ep) => (
                        <tr
                          key={`${ep.appName || ''}-${ep.scenario || ''}-${ep.endpoint}`}
                          className="hover:bg-[#1F2937]/40 cursor-pointer"
                          onClick={() => setActiveTab('transactions')}
                        >
                          <td className="metric-num max-w-[280px] truncate px-3 py-1.5 font-medium text-[#F9FAFB]">
                            {ep.endpoint}
                          </td>
                          <td className="metric-num px-3 py-1.5 text-right text-[#9CA3AF]">
                            {ep.samples.toLocaleString()}
                          </td>
                          <td className="metric-num px-3 py-1.5 text-right font-semibold text-[#F59E0B]">
                            {ep.p95.toLocaleString()}
                          </td>
                          <td
                            className={`metric-num px-3 py-1.5 text-right font-semibold ${
                              ep.errorPct > 0 ? 'text-[#EF4444]' : 'text-[#10B981]'
                            }`}
                          >
                            {ep.errorPct.toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden lg:col-span-5">
                  <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                      <AlertOctagon className="h-3.5 w-3.5 text-[#EF4444]" />
                      Error Snapshot
                    </h3>
                    <button
                      type="button"
                      onClick={() => setActiveTab('errors')}
                      className="no-print inline-flex items-center gap-1 text-[11px] font-medium text-[#22D3EE] hover:underline"
                    >
                      Open Diagnostics
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="p-3.5">
                    {selectedRun.httpErrors.length === 0 ? (
                      <div className="rounded border border-[#10B981]/30 bg-[#10B981]/10 px-3 py-4 text-center text-xs text-[#10B981]">
                        Zero HTTP errors recorded in this scope.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {selectedRun.httpErrors.slice(0, 4).map((err) => (
                          <div key={`${err.code}-${err.label}`} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="metric-num rounded bg-[#EF4444]/15 border border-[#EF4444]/30 px-1.5 py-0.5 text-[10px] font-semibold text-[#EF4444]">
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
                </div>
              </section>
            </>
          )}

          {/* TAB 2: APPLICATIONS */}
          {activeTab === 'applications' && (
            <EndpointAndErrorsSection
              run={selectedRun}
              baselineRun={baselineRun}
              selectedApp="ALL"
              onSelectApp={(a) =>
                setAppFilter(a === 'ALL' ? EMPTY_MULTI_FILTER : { mode: 'include', values: [a] })
              }
              endpoints={selectedRun.endpoints}
              apps={selectedRun.apps}
              scenarios={selectedRun.scenarios}
              httpErrors={selectedRun.httpErrors}
              assertionFailures={selectedRun.assertionFailures}
              errorRateSlaPct={selectedRun.sla.errorRatePct}
              forcedView="applications"
            />
          )}

          {/* TAB 3: TRANSACTIONS */}
          {activeTab === 'transactions' && (
            <EndpointAndErrorsSection
              run={selectedRun}
              baselineRun={baselineRun}
              selectedApp="ALL"
              onSelectApp={(a) =>
                setAppFilter(a === 'ALL' ? EMPTY_MULTI_FILTER : { mode: 'include', values: [a] })
              }
              endpoints={selectedRun.endpoints}
              apps={selectedRun.apps}
              scenarios={selectedRun.scenarios}
              httpErrors={selectedRun.httpErrors}
              assertionFailures={selectedRun.assertionFailures}
              errorRateSlaPct={selectedRun.sla.errorRatePct}
              forcedView="endpoints"
            />
          )}

          {/* TAB 3: SCENARIOS */}
          {activeTab === 'scenarios' && (
            <EndpointAndErrorsSection
              run={selectedRun}
              baselineRun={baselineRun}
              selectedApp="ALL"
              onSelectApp={(a) =>
                setAppFilter(a === 'ALL' ? EMPTY_MULTI_FILTER : { mode: 'include', values: [a] })
              }
              endpoints={selectedRun.endpoints}
              apps={selectedRun.apps}
              scenarios={selectedRun.scenarios}
              httpErrors={selectedRun.httpErrors}
              assertionFailures={selectedRun.assertionFailures}
              errorRateSlaPct={selectedRun.sla.errorRatePct}
              forcedView="scenarios"
            />
          )}

          {/* TAB 4: COMPARE VS BASE & APP HEALTH */}
          {activeTab === 'compare' && (
            <EndpointAndErrorsSection
              run={selectedRun}
              baselineRun={baselineRun}
              selectedApp="ALL"
              onSelectApp={(a) =>
                setAppFilter(a === 'ALL' ? EMPTY_MULTI_FILTER : { mode: 'include', values: [a] })
              }
              endpoints={selectedRun.endpoints}
              apps={selectedRun.apps}
              scenarios={selectedRun.scenarios}
              httpErrors={selectedRun.httpErrors}
              assertionFailures={selectedRun.assertionFailures}
              errorRateSlaPct={selectedRun.sla.errorRatePct}
              forcedView="compare"
            />
          )}

          {/* TAB 5: HISTORICAL TRENDS */}
          {activeTab === 'trends' && (
            <TrendsView
              vaultRuns={scopedVaultRuns}
              activeRunId={rawSelectedRun.id}
              theme={theme}
            />
          )}

          {/* TAB 6: ERRORS & DIAGNOSTICS */}
          {activeTab === 'errors' && (
            <ErrorsDiagnosticsView
              timeSeries={visibleSeries}
              httpErrors={selectedRun.httpErrors}
              assertionFailures={selectedRun.assertionFailures}
              errorDetails={selectedRun.errorDetails}
              theme={theme}
            />
          )}

          {/* TAB 6: GLOSSARY */}
          {activeTab === 'glossary' && <GlossaryView />}

          {/* TAB 7: DB EXPLORER (Admin only) */}
          {activeTab === 'database' && isAdmin && (
            <DatabaseExplorerView
              currentRunId={rawSelectedRun.id}
              baselineRunId={baselineRunId}
            />
          )}

          {/* TAB 8: SETTINGS (Admin only) */}
          {activeTab === 'settings' && isAdmin && (
            <SettingsView
              vaultRuns={runs.filter((r) => r.source === 'duckdb-vault')}
              onSettingsSaved={() => loadVaultRuns(true)}
            />
          )}
        </main>
      </div>

      <LoginModal
        open={loginModalOpen}
        setupRequired={setupRequired}
        onClose={() => setLoginModalOpen(false)}
        onSuccess={(username) => {
          setIsAdmin(true);
          setAdminUsername(username);
          setSetupRequired(false);
          setLoginModalOpen(false);
        }}
      />
    </div>
  );
};

export default App;
