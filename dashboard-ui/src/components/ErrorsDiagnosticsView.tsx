/**
 * Errors & Diagnostics View (`dashboard-ui/src/components/ErrorsDiagnosticsView.tsx`)
 *
 * Renders the Error Timeline chart (error counts + error rate % with Copy PNG),
 * HTTP status code breakdown, top assertion failures, and a searchable URL / `failureMessage`
 * drilldown table.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  AlertOctagon,
  Camera,
  Check,
  Search,
  ShieldAlert,
} from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AssertionFailure,
  ErrorDetailRow,
  HttpErrorGroup,
  TelemetryPoint,
} from '../types/performance';
import { copyChartContainerAsPng } from '../utils/chartExport';

interface ErrorsDiagnosticsViewProps {
  timeSeries: TelemetryPoint[];
  httpErrors: HttpErrorGroup[];
  assertionFailures: AssertionFailure[];
  errorDetails?: ErrorDetailRow[];
  theme: 'dark' | 'light';
}

export const ErrorsDiagnosticsView: React.FC<ErrorsDiagnosticsViewProps> = ({
  timeSeries,
  httpErrors,
  assertionFailures,
  errorDetails = [],
  theme,
}) => {
  const [search, setSearch] = useState('');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'downloaded'>('idle');
  const chartCardRef = useRef<HTMLDivElement>(null);

  const isLight = theme === 'light';
  const gridStroke = isLight ? '#E2E8F0' : '#1F2937';
  const tickFill = isLight ? '#64748B' : '#9CA3AF';
  const axisStroke = isLight ? '#CBD5E1' : '#6B7280';

  const totalErrorCount = useMemo(
    () => httpErrors.reduce((acc, g) => acc + g.count, 0),
    [httpErrors]
  );

  const errorSeries = useMemo(
    () =>
      timeSeries.map((pt) => ({
        timestamp: pt.timestamp,
        errorCount: pt.errorCount ?? Math.round((pt.errorRate / 100) * pt.throughput * 15),
        errorRate: pt.errorRate,
      })),
    [timeSeries]
  );

  const filteredDetails = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return errorDetails;
    return errorDetails.filter(
      (d) =>
        d.endpoint.toLowerCase().includes(q) ||
        d.url.toLowerCase().includes(q) ||
        d.responseCode.toLowerCase().includes(q) ||
        d.responseMessage.toLowerCase().includes(q) ||
        d.failureMessage.toLowerCase().includes(q)
    );
  }, [errorDetails, search]);

  const handleCopyPng = async () => {
    const res = await copyChartContainerAsPng(
      chartCardRef.current,
      'Errors Over Time (Count & Error Rate %)',
      theme
    );
    if (res === 'copied' || res === 'downloaded') {
      setCopyStatus(res);
      window.setTimeout(() => setCopyStatus('idle'), 1800);
    }
  };

  return (
    <section className="space-y-3">
      {/* Row 1: Errors Over Time Timeline Chart */}
      <div
        ref={chartCardRef}
        className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Error Timeline (Count &amp; Error Rate %)
            </h2>
            <p className="text-[11px] text-[#9CA3AF]">
              Error spikes correlated over the test run timeline
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#EF4444]" />
              Error Count
            </span>
            <span className="flex items-center gap-1.5 text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
              Error Rate (%)
            </span>
            <button
              type="button"
              onClick={handleCopyPng}
              className="no-print inline-flex items-center gap-1 rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-[10px] font-medium text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE] transition-colors"
              title="Copy chart as PNG image"
            >
              {copyStatus === 'idle' ? (
                <>
                  <Camera className="h-3 w-3" />
                  Copy PNG
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 text-[#10B981]" />
                  {copyStatus === 'copied' ? 'Copied!' : 'Saved PNG'}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={errorSeries}
              syncId="perf-telemetry"
              margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
            >
              <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="timestamp"
                stroke={axisStroke}
                tick={{ fill: tickFill, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                yAxisId="left"
                stroke="#EF4444"
                tick={{ fill: tickFill, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#F59E0B"
                tick={{ fill: tickFill, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
                unit="%"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: isLight ? '#FFFFFF' : '#0B0F19',
                  borderColor: isLight ? '#E2E8F0' : '#374151',
                  borderRadius: '6px',
                  fontSize: '11px',
                }}
              />
              <Bar
                yAxisId="left"
                dataKey="errorCount"
                name="Errors"
                fill="#EF4444"
                fillOpacity={0.75}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="errorRate"
                name="Error Rate %"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2: Grouped HTTP Error Codes + Top Assertion Failures */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
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
                      <strong className="text-[#F9FAFB]">{err.count.toLocaleString()}</strong> (
                      {err.percentage.toFixed(1)}%)
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

        <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5">
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

      {/* Row 3: Detailed Error Drilldown Table (Endpoint, URL, HTTP Code, Message & FailureMessage) */}
      <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] px-3.5 py-2.5">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Detailed Error &amp; URL Drilldown
            </h3>
            <p className="text-[11px] text-[#9CA3AF]">
              Per-transaction HTTP codes, request URLs, response messages, and assertion failure details
            </p>
          </div>
          <div className="relative no-print">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter endpoint, URL, or error..."
              className="w-60 rounded-md border border-[#1F2937] bg-[#0B0F19] py-1 pl-8 pr-2.5 text-xs text-[#F9FAFB] placeholder-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
            />
          </div>
        </div>

        {filteredDetails.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#9CA3AF]">
            {errorDetails.length === 0
              ? 'No detailed error rows recorded for this run.'
              : 'No error rows match your search filter.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  <th className="px-3 py-2">App / Scenario</th>
                  <th className="px-3 py-2">Transaction &amp; URL</th>
                  <th className="px-3 py-2 text-center">Code</th>
                  <th className="px-3 py-2">Response / Failure Message</th>
                  <th className="px-3 py-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1F2937]/70">
                {filteredDetails.map((row, idx) => (
                  <tr key={`${row.endpoint}-${row.responseCode}-${idx}`} className="hover:bg-[#1F2937]/40">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium text-[#F9FAFB]">{row.appName || '—'}</div>
                      <div className="metric-num text-[10px] text-[#9CA3AF]">
                        {row.scenario || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top max-w-[320px]">
                      <div className="metric-num font-semibold text-[#F9FAFB] break-words">
                        {row.endpoint}
                      </div>
                      {row.url && (
                        <div className="mt-0.5 metric-num text-[10px] text-[#9CA3AF] break-all">
                          {row.url}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-center">
                      <span className="metric-num inline-block rounded border border-[#EF4444]/35 bg-[#EF4444]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#EF4444]">
                        {row.responseCode}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top max-w-[360px]">
                      <div className="metric-num text-[11px] text-[#D1D5DB] break-words">
                        {row.responseMessage}
                      </div>
                      {row.failureMessage && (
                        <div className="mt-1 metric-num text-[10px] text-[#EF4444] break-words">
                          {row.failureMessage}
                        </div>
                      )}
                    </td>
                    <td className="metric-num px-3 py-2 align-top text-right font-bold text-[#EF4444]">
                      {row.count.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
