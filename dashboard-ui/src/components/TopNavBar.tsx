import React from 'react';
import {
  Activity,
  ChevronDown,
  Clock,
  Database,
  Download,
  Radio,
} from 'lucide-react';
import { PerformanceTestRun, TimeRangeOption } from '../types/performance';

interface TopNavBarProps {
  runs: PerformanceTestRun[];
  selectedRun: PerformanceTestRun;
  onSelectRun: (runId: string) => void;
  timeRange: TimeRangeOption;
  onTimeRangeChange: (range: TimeRangeOption) => void;
  isLive: boolean;
  onToggleLive: () => void;
  onExportReport: () => void;
  vaultCount: number;
}

const TIME_RANGES: { value: TimeRangeOption; label: string }[] = [
  { value: '15m', label: 'Last 15m' },
  { value: '1h', label: '1h' },
  { value: 'full', label: 'Full Run' },
];

export const TopNavBar: React.FC<TopNavBarProps> = ({
  runs,
  selectedRun,
  onSelectRun,
  timeRange,
  onTimeRangeChange,
  isLive,
  onToggleLive,
  onExportReport,
  vaultCount,
}) => {
  const isVaultRun = selectedRun.source === 'duckdb-vault';

  return (
    <header className="sticky top-0 z-40 border-b border-[#1F2937] bg-[#0B0F19]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 lg:px-6">
        {/* Left: Brand + Test Run Selector + Environment Badge */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 pr-2 border-r border-[#1F2937]">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#06B6D4]/15 border border-[#06B6D4]/30 text-[#06B6D4]">
              <Activity className="h-4 w-4" />
            </div>
            <div className="leading-tight">
              <div className="text-xs font-semibold tracking-wider uppercase text-[#F9FAFB]">
                Perf-Delta
              </div>
              <div className="text-[10px] font-mono text-[#9CA3AF]">
                PERF TELEMETRY
              </div>
            </div>
          </div>

          {/* Test Run Selector */}
          <div className="relative">
            <select
              aria-label="Select Test Run"
              value={selectedRun.id}
              onChange={(e) => onSelectRun(e.target.value)}
              className="appearance-none rounded-md border border-[#1F2937] bg-[#111827] py-1.5 pl-3 pr-8 text-xs font-medium text-[#F9FAFB] hover:border-[#374151] focus:border-[#06B6D4] focus:outline-none cursor-pointer transition-colors"
            >
              <optgroup label="Simulated Telemetry Scenarios">
                {runs
                  .filter((r) => r.source === 'mock')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </optgroup>
              {vaultCount > 0 && (
                <optgroup label={`DuckDB Vault Runs (${vaultCount})`}>
                  {runs
                    .filter((r) => r.source === 'duckdb-vault')
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
          </div>

          {/* Environment Badge */}
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase metric-num ${
              isVaultRun
                ? 'border-[#6366F1]/40 bg-[#6366F1]/15 text-[#A5B4FC]'
                : selectedRun.environment === 'STAGING'
                ? 'border-[#F59E0B]/40 bg-[#F59E0B]/15 text-[#FBBF24]'
                : 'border-[#06B6D4]/40 bg-[#06B6D4]/15 text-[#22D3EE]'
            }`}
          >
            {isVaultRun && <Database className="h-3 w-3" />}
            {selectedRun.environment}
          </span>
        </div>

        {/* Right: Time-Range Picker + Live Auto-Refresh + Export */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Time Range Segmented Control */}
          <div className="inline-flex items-center rounded-md border border-[#1F2937] bg-[#111827] p-0.5">
            <Clock className="ml-2 mr-1.5 h-3.5 w-3.5 text-[#9CA3AF]" />
            {TIME_RANGES.map((opt) => {
              const active = timeRange === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onTimeRangeChange(opt.value)}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[#1F2937] text-[#F9FAFB]'
                      : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Live Auto-Refresh Toggle */}
          <button
            type="button"
            onClick={onToggleLive}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              isLive
                ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#10B981]'
                : 'border-[#1F2937] bg-[#111827] text-[#9CA3AF] hover:border-[#374151] hover:text-[#F9FAFB]'
            }`}
            title="Toggle simulated live telemetry stream (2s interval)"
          >
            <span className="relative flex h-2 w-2">
              {isLive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  isLive ? 'bg-[#10B981]' : 'bg-[#6B7280]'
                }`}
              />
            </span>
            <Radio className="h-3.5 w-3.5" />
            <span>{isLive ? 'Live (2s)' : 'Auto-Refresh'}</span>
          </button>

          {/* Export Report Button */}
          <button
            type="button"
            onClick={onExportReport}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#06B6D4]/40 bg-[#06B6D4]/15 px-3 py-1.5 text-xs font-semibold text-[#22D3EE] hover:bg-[#06B6D4]/25 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Report</span>
          </button>
        </div>
      </div>
    </header>
  );
};
