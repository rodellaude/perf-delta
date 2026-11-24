import React, { useEffect, useMemo, useState } from 'react';
import { MOCK_TEST_RUNS } from './data/mockPerformanceData';
import {
  PerformanceTestRun,
  TelemetryPoint,
  TimeRangeOption,
  VaultExportPayload,
} from './types/performance';
import { TopNavBar } from './components/TopNavBar';
import { KpiSummaryRow } from './components/KpiSummaryRow';
import { TelemetryChartsRow } from './components/TelemetryChartsRow';
import { EndpointAndErrorsSection } from './components/EndpointAndErrorsSection';

export const App: React.FC = () => {
  const [runs, setRuns] = useState<PerformanceTestRun[]>(MOCK_TEST_RUNS);
  const [selectedRunId, setSelectedRunId] = useState<string>(MOCK_TEST_RUNS[0].id);
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('full');
  const [isLive, setIsLive] = useState<boolean>(false);
  const [livePoints, setLivePoints] = useState<TelemetryPoint[]>([]);
  const [apiMode, setApiMode] = useState<'live-duckdb' | 'cached-json' | 'mock-only'>('mock-only');

  // Load real DuckDB Vault runs from live Node.js API (/api/runs), falling back to /vault-runs.json
  useEffect(() => {
    let cancelled = false;
    async function loadVaultRuns() {
      try {
        const apiRes = await fetch('/api/runs');
        if (apiRes.ok) {
          const payload = (await apiRes.json()) as VaultExportPayload & { mode?: string };
          if (!cancelled && Array.isArray(payload.runs) && payload.runs.length > 0) {
            setRuns([...MOCK_TEST_RUNS, ...payload.runs]);
            setApiMode(payload.mode === 'live-duckdb' ? 'live-duckdb' : 'cached-json');
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
          if (!cancelled && Array.isArray(payload.runs) && payload.runs.length > 0) {
            setRuns([...MOCK_TEST_RUNS, ...payload.runs]);
            setApiMode('cached-json');
          }
        }
      } catch {
        // Silently fall back to built-in mock data
      }
    }
    loadVaultRuns();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedRunId) ?? runs[0],
    [runs, selectedRunId]
  );

  // Reset live appended points whenever user switches run
  useEffect(() => {
    setLivePoints([]);
  }, [selectedRunId]);

  // Live auto-refresh simulation (appends realistic jitter-free ticks every 2s)
  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => {
      setLivePoints((prev) => {
        const baseSeries =
          prev.length > 0 ? prev : selectedRun.timeSeries;
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
            run: {
              ...selectedRun,
              timeSeries: visibleSeries,
            },
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

  return (
    <div className="min-h-screen bg-[#0B0F19] text-[#F9FAFB]">
      <TopNavBar
        runs={runs}
        selectedRun={selectedRun}
        onSelectRun={setSelectedRunId}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        isLive={isLive}
        onToggleLive={() => setIsLive((v) => !v)}
        onExportReport={handleExportReport}
        vaultCount={vaultCount}
      />

      <main className="mx-auto max-w-[1600px] space-y-3 px-4 py-3.5 lg:px-6">
        {/* Run Meta Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#1F2937] bg-[#111827]/70 px-3.5 py-2 text-[11px] text-[#9CA3AF]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Run:{' '}
              <strong className="font-medium text-[#F9FAFB]">{selectedRun.name}</strong>
            </span>
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
                  ? apiMode === 'live-duckdb'
                    ? 'Live DuckDB API (Performance_Vault.db)'
                    : 'DuckDB Vault Snapshot (JSON)'
                  : 'Built-in Stress Simulation'}
              </span>
            </span>
          </div>
        </div>

        {/* Row 1: Executive KPI Summary Cards */}
        <KpiSummaryRow run={selectedRun} visibleSeries={visibleSeries} />

        {/* Row 2: Synchronized Time-Series Telemetry Charts */}
        <TelemetryChartsRow
          data={visibleSeries}
          slaP95Ms={selectedRun.sla.p95Ms}
        />

        {/* Row 3: Endpoint Breakdown & Error Analysis */}
        <EndpointAndErrorsSection
          endpoints={selectedRun.endpoints}
          httpErrors={selectedRun.httpErrors}
          assertionFailures={selectedRun.assertionFailures}
          errorRateSlaPct={selectedRun.sla.errorRatePct}
        />
      </main>
    </div>
  );
};

export default App;
