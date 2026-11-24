import React from 'react';
import { AlertTriangle, CheckCircle2, Gauge, Timer, Users, XCircle } from 'lucide-react';
import { PerformanceTestRun, TelemetryPoint } from '../types/performance';

interface KpiSummaryRowProps {
  run: PerformanceTestRun;
  visibleSeries: TelemetryPoint[];
}

export const KpiSummaryRow: React.FC<KpiSummaryRowProps> = ({ run, visibleSeries }) => {
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

  const p95Breached = avgP95 > run.sla.p95Ms;
  const p95Warn = !p95Breached && avgP95 > run.sla.p95Ms * 0.85;
  const errorBreached = avgErrorRate > run.sla.errorRatePct;

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
        <div className="mt-2 flex items-baseline gap-2">
          <span className="metric-num text-2xl font-bold text-[#F9FAFB]">
            {peakVUs.toLocaleString()}
          </span>
          <span className="metric-num text-xs text-[#06B6D4]">VUs</span>
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
        <div className="mt-2 flex items-baseline gap-2">
          <span className="metric-num text-2xl font-bold text-[#F9FAFB]">
            {avgThroughput.toLocaleString(undefined, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
          </span>
          <span className="metric-num text-xs text-[#818CF8]">req/s</span>
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
            P95 Response Time
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
                SLA BREACH
              </>
            ) : p95Warn ? (
              'NEAR SLA'
            ) : (
              'WITHIN SLA'
            )}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#1F2937]/80 pt-2 text-[11px] text-[#9CA3AF]">
          <span>SLA Threshold</span>
          <span className="metric-num text-[#F9FAFB]">
            &le; {run.sla.p95Ms.toLocaleString()} ms
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
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide metric-num ${
              errorBreached
                ? 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/40'
                : 'bg-[#10B981]/15 text-[#10B981] border border-[#10B981]/40'
            }`}
          >
            {errorBreached ? 'FAIL' : 'PASS'}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-[#1F2937]/80 pt-2 text-[11px] text-[#9CA3AF]">
          <span>Failed / SLA Limit</span>
          <span className="metric-num text-[#F9FAFB]">
            {run.summary.failedRequests.toLocaleString()} (&le; {run.sla.errorRatePct}%)
          </span>
        </div>
      </div>
    </section>
  );
};
