import React, { useRef, useState } from 'react';
import { Camera, Check } from 'lucide-react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { TelemetryPoint } from '../types/performance';
import { copyChartContainerAsPng } from '../utils/chartExport';

interface TelemetryChartsRowProps {
  data: TelemetryPoint[];
  baselineData?: TelemetryPoint[];
  slaP95Ms: number;
  theme?: 'dark' | 'light';
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
    payload: TelemetryPoint;
  }>;
  label?: string;
  mode: 'load' | 'latency';
  slaP95Ms?: number;
}

const TelemetryTooltip: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  mode,
  slaP95Ms,
}) => {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-md border border-[#374151] bg-[#0B0F19]/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1.5 flex items-center justify-between gap-4 border-b border-[#1F2937] pb-1">
        <span className="metric-num font-semibold text-[#F9FAFB]">{label} UTC</span>
        <span className="rounded bg-[#1F2937] px-1.5 py-0.5 text-[10px] font-mono uppercase text-[#9CA3AF]">
          {point.phase}
        </span>
      </div>
      <div className="space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-[#9CA3AF]">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="metric-num font-semibold text-[#F9FAFB]">
              {mode === 'load'
                ? entry.dataKey === 'vus'
                  ? `${Number(entry.value).toLocaleString()} VUs`
                  : `${Number(entry.value).toFixed(1)} req/s`
                : `${Number(entry.value).toLocaleString()} ms`}
            </span>
          </div>
        ))}
        {mode === 'latency' && slaP95Ms !== undefined && (
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-[#1F2937] pt-1 text-[11px]">
            <span className="text-[#EF4444]">SLA Threshold</span>
            <span className="metric-num font-semibold text-[#EF4444]">
              {slaP95Ms.toLocaleString()} ms
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const TelemetryChartsRow: React.FC<TelemetryChartsRowProps> = ({
  data,
  baselineData,
  slaP95Ms,
  theme = 'dark',
}) => {
  const isLight = theme === 'light';
  const gridStroke = isLight ? '#E2E8F0' : '#1F2937';
  const tickFill = isLight ? '#64748B' : '#9CA3AF';
  const axisStroke = isLight ? '#CBD5E1' : '#6B7280';
  const cursorStroke = isLight ? '#94A3B8' : '#4B5563';
  const activeDotStroke = isLight ? '#FFFFFF' : '#0B0F19';
  const hasBaseline = Boolean(baselineData && baselineData.length > 0);

  const chartData = React.useMemo(() => {
    if (!hasBaseline || !baselineData) return data;
    return data.map((pt, idx) => {
      const bIdx = Math.min(
        Math.round((idx / Math.max(data.length - 1, 1)) * Math.max(baselineData.length - 1, 1)),
        baselineData.length - 1
      );
      const bPt = baselineData[bIdx];
      return {
        ...pt,
        baseThroughput: bPt ? bPt.throughput : undefined,
        baseP95: bPt ? bPt.p95 : undefined,
      };
    });
  }, [data, baselineData, hasBaseline]);

  const leftCardRef = useRef<HTMLDivElement>(null);
  const rightCardRef = useRef<HTMLDivElement>(null);
  const [leftCopy, setLeftCopy] = useState<'idle' | 'copied' | 'downloaded'>('idle');
  const [rightCopy, setRightCopy] = useState<'idle' | 'copied' | 'downloaded'>('idle');

  const handleCopyLeft = async () => {
    const res = await copyChartContainerAsPng(leftCardRef.current, 'Concurrent VUs vs Throughput', theme);
    if (res === 'copied' || res === 'downloaded') {
      setLeftCopy(res);
      window.setTimeout(() => setLeftCopy('idle'), 1800);
    }
  };

  const handleCopyRight = async () => {
    const res = await copyChartContainerAsPng(rightCardRef.current, 'Response Time Percentiles (ms)', theme);
    if (res === 'copied' || res === 'downloaded') {
      setRightCopy(res);
      window.setTimeout(() => setRightCopy('idle'), 1800);
    }
  };

  return (
    <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {/* Left Chart: Concurrent VUs vs Throughput */}
      <div ref={leftCardRef} className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Concurrent VUs vs. Throughput
            </h2>
            <p className="text-[11px] text-[#9CA3AF]">
              Synchronized load profile (ramp-up, steady-state, spike, ramp-down)
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5 text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#06B6D4]" />
              Virtual Users
            </span>
            <span className="flex items-center gap-1.5 text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#6366F1]" />
              Throughput (req/s)
            </span>
            <button
              type="button"
              onClick={handleCopyLeft}
              className="no-print inline-flex items-center gap-1 rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-[10px] font-medium text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE] transition-colors"
              title="Copy chart as PNG image"
            >
              {leftCopy === 'idle' ? (
                <>
                  <Camera className="h-3 w-3" />
                  PNG
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 text-[#10B981]" />
                  {leftCopy === 'copied' ? 'Copied' : 'Saved'}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="h-[270px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={chartData}
              syncId="perf-telemetry"
              margin={{ top: 6, right: 8, left: -12, bottom: 0 }}
            >
              <defs>
                <linearGradient id="vuGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.32} />
                  <stop offset="95%" stopColor="#06B6D4" stopOpacity={0.02} />
                </linearGradient>
              </defs>
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
                stroke="#06B6D4"
                tick={{ fill: tickFill, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#6366F1"
                tick={{ fill: tickFill, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ stroke: cursorStroke, strokeDasharray: '3 3' }}
                content={<TelemetryTooltip mode="load" />}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="vus"
                name="Concurrent VUs"
                stroke="#06B6D4"
                strokeWidth={2}
                fill="url(#vuGradient)"
                isAnimationActive={false}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="throughput"
                name="Throughput"
                stroke="#6366F1"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#6366F1', stroke: activeDotStroke, strokeWidth: 2 }}
                isAnimationActive={false}
              />
              {hasBaseline && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="baseThroughput"
                  name="Baseline Throughput"
                  stroke="#9CA3AF"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Right Chart: Response Time Percentiles + SLA Threshold */}
      <div ref={rightCardRef} className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Response Time Percentiles (ms)
            </h2>
            <p className="text-[11px] text-[#9CA3AF]">
              Avg, P90, P95, and P99 latency vs. SLA threshold ({slaP95Ms} ms)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1 text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#9CA3AF]" />
              Avg
            </span>
            <span className="flex items-center gap-1 text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#06B6D4]" />
              P90
            </span>
            <span className="flex items-center gap-1 text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
              P95
            </span>
            <span className="flex items-center gap-1 text-[#9CA3AF]">
              <span className="h-2 w-2 rounded-full bg-[#EF4444]" />
              P99
            </span>
            <button
              type="button"
              onClick={handleCopyRight}
              className="no-print inline-flex items-center gap-1 rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-[10px] font-medium text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE] transition-colors"
              title="Copy chart as PNG image"
            >
              {rightCopy === 'idle' ? (
                <>
                  <Camera className="h-3 w-3" />
                  PNG
                </>
              ) : (
                <>
                  <Check className="h-3 w-3 text-[#10B981]" />
                  {rightCopy === 'copied' ? 'Copied' : 'Saved'}
                </>
              )}
            </button>
          </div>
        </div>

        <div className="h-[270px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartData}
              syncId="perf-telemetry"
              margin={{ top: 6, right: 8, left: -8, bottom: 0 }}
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
                stroke={axisStroke}
                tick={{ fill: tickFill, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                cursor={{ stroke: cursorStroke, strokeDasharray: '3 3' }}
                content={<TelemetryTooltip mode="latency" slaP95Ms={slaP95Ms} />}
              />
              <ReferenceLine
                y={slaP95Ms}
                stroke="#EF4444"
                strokeDasharray="5 5"
                strokeWidth={1.5}
                label={{
                  value: `SLA ${slaP95Ms}ms`,
                  position: 'insideTopRight',
                  fill: '#EF4444',
                  fontSize: 10,
                  fontFamily: 'JetBrains Mono',
                }}
              />
              <Line
                type="monotone"
                dataKey="avg"
                name="Avg"
                stroke="#9CA3AF"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="p90"
                name="P90"
                stroke="#06B6D4"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="p95"
                name="P95"
                stroke="#F59E0B"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="p99"
                name="P99"
                stroke="#EF4444"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
              {hasBaseline && (
                <Line
                  type="monotone"
                  dataKey="baseP95"
                  name="Baseline P95"
                  stroke="#A855F7"
                  strokeWidth={1.6}
                  strokeDasharray="4 3"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
};
