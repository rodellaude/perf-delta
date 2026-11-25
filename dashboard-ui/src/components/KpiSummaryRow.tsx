import React from 'react';
import { AlertTriangle, CheckCircle2, Gauge, Timer, Users, XCircle } from 'lucide-react';
import { PerformanceTestRun, TelemetryPoint } from '../types/performance';

interface KpiSummaryRowProps {
  run: PerformanceTestRun;
  baselineRun?: PerformanceTestRun | null;
  visibleSeries: TelemetryPoint[];
}

function DeltaPill({
  current,
  baseline,
  lowerIsBetter,
}: {
  current: number;
  baseline?: number;
  lowerIsBetter: boolean;
}) {
  if (baseline === undefined || baseline === null || !Number.isFinite(baseline)) return null;
  if (baseline === 0 && current === 0) {
    return (
      <span className="inline-flex items-center rounded border border-[#9CA3AF]/30 bg-[#9CA3AF]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#9CA3AF] metric-num">
        0.0%
      </span>
    );
  }
  const pct = baseline === 0 ? 100 : ((current - baseline) / Math.abs(baseline)) * 100;
  const absPct = Math.abs(pct);
  const isNeutral = absPct < 0.5;
  const isGood = lowerIsBetter ? pct < 0 : pct > 0;
  const arrow = isNeutral ? '•' : pct > 0 ? '▲' : '▼';
  const sign = pct > 0 ? '+' : '';
  const cls = isNeutral
    ? 'border-[#9CA3AF]/30 bg-[#9CA3AF]/10 text-[#9CA3AF]'
    : isGood
    ? 'border-[#10B981]/35 bg-[#10B981]/15 text-[#10B981]'
    : 'border-[#EF4444]/35 bg-[#EF4444]/15 text-[#EF4444]';

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold metric-num ${cls}`}
      title={`Baseline: ${baseline.toLocaleString()}`}
    >
      <span>{arrow}</span>
      <span>
        {sign}
        {pct.toFixed(1)}%
      </span>
    </span>
  );
}

export const KpiSummaryRow: React.FC<KpiSummaryRowProps> = ({
  run,
  baselineRun,
  visibleSeries,
}) => {
  const peakVUs =
    visibleSeries.length > 0
      ? Math.max(...visibleSeries.map((p) => p.vus))
      : run.summary.peakVUs;

  const avgThroughput =
    visibleSeries.length > 0
      ? visibleSeries.reduce((acc, p) => acc + p.throughput, 0) / visibleSeries.length
      : run.summary.avgThroughputRps;

  const avgP95 =
    visibleSeries.length > 0
      ? Math.round(visibleSeries.reduce((acc, p) => acc + p.p95, 0) / visibleSeries.length)
      : run.summary.p95ResponseTimeMs;

  const avgErrorRate =
    visibleSeries.length > 0
      ? Number(
          (
            visibleSeries.reduce((acc, p) => acc + p.errorRate, 0) / visibleSeries.length
          ).toFixed(2)
        )
      : run.summary.errorRatePct;

  const rtEnabled = run.sla.rtEnabled !== false;
  const errEnabled = run.sla.errorEnabled !== false;

  const p95Breached = rtEnabled && avgP95 > run.sla.p95Ms;
  const p95Warn = rtEnabled && !p95Breached && avgP95 > run.sla.p95Ms * 0.85;
  const errorBreached = errEnabled && avgErrorRate > run.sla.errorRatePct;

  const tpm = Math.round(avgThroughput * 60);

  return (
    <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {/* KPI 1: Peak Virtual Users */}
      <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#9CA3AF]">
            Peak Virtual Users
          </span>
          <Users className="h-4 w-4 text-[#06B6D4]" />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="metric-num text-2xl font-bold text-[#F9FAFB]">
              {peakVUs.toLocaleString()}
            </span>
            <span className="metric-num text-xs text-[#06B6D4]">VUs</span>
          </div>
          {baselineRun && (
            <DeltaPill
              current={peakVUs}
              baseline={baselineRun.summary.peakVUs}
              lowerIsBetter={false}
            />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#1F2937]/80 pt-2 text-[11px] text-[#9CA3AF]">
          <span>Total Requests</span>
          <span className="metric-num text-[#F9FAFB]">
            {run.summary.totalRequests.toLocaleString()}
          </span>
        </div>
      </div>

      {/* KPI 2: Average Throughput */}
      <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#9CA3AF]">
            Average Throughput
          </span>
          <Gauge className="h-4 w-4 text-[#6366F1]" />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="metric-num text-2xl font-bold text-[#F9FAFB]">
              {avgThroughput.toLocaleString(undefined, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}
            </span>
            <span className="metric-num text-xs text-[#818CF8]">req/s</span>
          </div>
          {baselineRun && (
            <DeltaPill
              current={avgThroughput}
              baseline={baselineRun.summary.avgThroughputRps}
              lowerIsBetter={false}
            />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#1F2937]/80 pt-2 text-[11px] text-[#9CA3AF]">
          <span>Transactions / Min</span>
          <span className="metric-num text-[#F9FAFB]">{tpm.toLocaleString()} TPM</span>
        </div>
      </div>

      {/* KPI 3: 95th Percentile (P95) Response Time */}
      <div
        className={`rounded-lg border bg-[#111827] p-3.5 ${
          p95Breached ? 'border-[#EF4444]/50' : 'border-[#1F2937]'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#9CA3AF]">
            {run.sla.rtMetric === 'p90' ? 'P90' : 'P95'} Response Time
          </span>
          <Timer
            className={`h-4 w-4 ${
              p95Breached
                ? 'text-[#EF4444]'
                : p95Warn
                ? 'text-[#F59E0B]'
                : 'text-[#10B981]'
            }`}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`metric-num text-2xl font-bold ${
                p95Breached
                  ? 'text-[#EF4444]'
                  : p95Warn
                  ? 'text-[#F59E0B]'
                  : 'text-[#F9FAFB]'
              }`}
            >
              {avgP95.toLocaleString()}
            </span>
            <span className="metric-num text-xs text-[#9CA3AF]">ms</span>
          </div>
          <div className="flex items-center gap-1.5">
            {baselineRun && (
              <DeltaPill
                current={avgP95}
                baseline={baselineRun.summary.p95ResponseTimeMs}
                lowerIsBetter={true}
              />
            )}
            {rtEnabled && (
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase metric-num ${
                  p95Breached
                    ? 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/30'
                    : p95Warn
                    ? 'bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/30'
                    : 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/30'
                }`}
              >
                {p95Breached ? (
                  <>
                    <AlertTriangle className="h-3 w-3" />
                    BREACH
                  </>
                ) : p95Warn ? (
                  'NEAR SLA'
                ) : (
                  'PASS'
                )}
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#1F2937]/80 pt-2 text-[11px] text-[#9CA3AF]">
          <span>SLA Threshold</span>
          <span className="metric-num text-[#F9FAFB]">
            {rtEnabled ? `≤ ${run.sla.p95Ms.toLocaleString()} ms` : 'SLA: Disabled'}
          </span>
        </div>
      </div>

      {/* KPI 4: Error Rate (%) */}
      <div
        className={`rounded-lg border bg-[#111827] p-3.5 ${
          errorBreached ? 'border-[#EF4444]/50' : 'border-[#1F2937]'
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-[#9CA3AF]">
            Error Rate
          </span>
          {errorBreached ? (
            <XCircle className="h-4 w-4 text-[#EF4444]" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
          )}
        </div>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1">
            <span
              className={`metric-num text-2xl font-bold ${
                errorBreached ? 'text-[#EF4444]' : 'text-[#10B981]'
              }`}
            >
              {avgErrorRate.toFixed(2)}
            </span>
            <span className="metric-num text-xs text-[#9CA3AF]">%</span>
          </div>
          <div className="flex items-center gap-1.5">
            {baselineRun && (
              <DeltaPill
                current={avgErrorRate}
                baseline={baselineRun.summary.errorRatePct}
                lowerIsBetter={true}
              />
            )}
            {errEnabled && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide metric-num ${
                  errorBreached
                    ? 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/40'
                    : 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/40'
                }`}
              >
                {errorBreached ? 'FAIL' : 'PASS'}
              </span>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#1F2937]/80 pt-2 text-[11px] text-[#9CA3AF]">
          <span>Failed / SLA Limit</span>
          <span className="metric-num text-[#F9FAFB]">
            {run.summary.failedRequests.toLocaleString()}{' '}
            {errEnabled ? `(≤ ${run.sla.errorRatePct}%)` : '(SLA: Disabled)'}
          </span>
        </div>
      </div>
    </section>
  );
};
