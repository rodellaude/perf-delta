/**
 * Single-Row Top Navigation Bar (`dashboard-ui/src/components/TopNavBar.tsx`)
 *
 * Houses Current Run & Baseline Run selectors, time-window switcher (`15m | 1h | Full`),
 * simulated Live toggle, Dark/Light theme switcher, 1-click Read-Only `Share` link,
 * pure-TS `HTML` report export, `JSON` export, and Grafana-style `Login` / `Admin Logout`.
 */
import React, { useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  Clock,
  Database,
  Download,
  FileCode2,
  LogIn,
  LogOut,
  Moon,
  Radio,
  Share2,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { PerformanceTestRun, TimeRangeOption } from '../types/performance';

interface TopNavBarProps {
  runs: PerformanceTestRun[];
  selectedRun: PerformanceTestRun;
  onSelectRun: (runId: string) => void;
  baselineRunId: string;
  onSelectBaselineRun: (runId: string) => void;
  timeRange: TimeRangeOption;
  onTimeRangeChange: (range: TimeRangeOption) => void;
  isLive: boolean;
  onToggleLive: () => void;
  onShareLink: () => Promise<boolean> | boolean;
  onExportHtml: () => void;
  onExportReport: () => void;
  vaultCount: number;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isAdmin: boolean;
  adminUsername: string | null;
  onOpenLogin: () => void;
  onLogout: () => void;
}

const TIME_RANGES: { value: TimeRangeOption; label: string }[] = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
  { value: 'full', label: 'Full' },
];

export const TopNavBar: React.FC<TopNavBarProps> = ({
  runs,
  selectedRun,
  onSelectRun,
  baselineRunId,
  onSelectBaselineRun,
  timeRange,
  onTimeRangeChange,
  isLive,
  onToggleLive,
  onShareLink,
  onExportHtml,
  onExportReport,
  vaultCount,
  theme,
  onToggleTheme,
  isAdmin,
  adminUsername,
  onOpenLogin,
  onLogout,
}) => {
  const isVaultRun = selectedRun.source === 'duckdb-vault';
  const [copiedShare, setCopiedShare] = useState(false);

  const handleShareClick = async () => {
    const ok = await onShareLink();
    if (ok) {
      setCopiedShare(true);
      window.setTimeout(() => setCopiedShare(false), 1800);
    }
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[#1F2937] bg-[#0B0F19]/95 backdrop-blur-md">
      <div className="flex flex-nowrap items-center justify-between gap-2 overflow-x-auto px-3 py-1.5 lg:px-4">
        {/* Left: Brand + Current Run + Baseline Run + Environment Badge */}
        <div className="flex flex-nowrap items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 pr-2 border-r border-[#1F2937] shrink-0">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-[#06B6D4]/15 border border-[#06B6D4]/30 text-[#06B6D4]">
              <Activity className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-semibold tracking-wider uppercase text-[#F9FAFB] whitespace-nowrap">
              Perf-Delta
            </span>
          </div>

          {/* Current Run Selector */}
          <div className="relative shrink-0">
            <select
              aria-label="Select Test Run"
              value={selectedRun.id}
              onChange={(e) => onSelectRun(e.target.value)}
              className="w-[185px] xl:w-[225px] appearance-none truncate rounded border border-[#1F2937] bg-[#111827] py-1 pl-2.5 pr-7 text-[11px] font-medium text-[#F9FAFB] hover:border-[#374151] focus:border-[#06B6D4] focus:outline-none cursor-pointer transition-colors"
            >
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
              <optgroup label="Simulated Telemetry Scenarios">
                {runs
                  .filter((r) => r.source === 'mock')
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </optgroup>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#9CA3AF]" />
          </div>

          {/* Baseline Run Selector */}
          <div className="relative shrink-0">
            <select
              aria-label="Select Baseline Run"
              value={baselineRunId}
              onChange={(e) => onSelectBaselineRun(e.target.value)}
              className="w-[165px] xl:w-[205px] appearance-none truncate rounded border border-[#1F2937] bg-[#111827] py-1 pl-2.5 pr-7 text-[11px] font-medium text-[#9CA3AF] hover:border-[#374151] focus:border-[#06B6D4] focus:outline-none cursor-pointer transition-colors"
              title="Select a baseline run to compare Current vs Baseline"
            >
              <option value="">vs Baseline: None</option>
              {vaultCount > 0 && (
                <optgroup label={`DuckDB Vault Runs (${vaultCount})`}>
                  {runs
                    .filter((r) => r.source === 'duckdb-vault' && r.id !== selectedRun.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        vs {r.name}
                      </option>
                    ))}
                </optgroup>
              )}
              <optgroup label="Simulated Telemetry Scenarios">
                {runs
                  .filter((r) => r.source === 'mock' && r.id !== selectedRun.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      vs {r.name}
                    </option>
                  ))}
              </optgroup>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#9CA3AF]" />
          </div>

          {/* Environment Badge */}
          <span
            className={`hidden 2xl:inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase metric-num whitespace-nowrap ${
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

        {/* Right: Single-Row Controls (Time Range + Auto-Refresh + Theme + PDF + JSON) */}
        <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
          {/* Time Range Segmented Control */}
          <div className="inline-flex items-center rounded border border-[#1F2937] bg-[#111827] p-0.5 shrink-0">
            <Clock className="ml-1.5 mr-1 h-3 w-3 text-[#9CA3AF]" />
            {TIME_RANGES.map((opt) => {
              const active = timeRange === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onTimeRangeChange(opt.value)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors ${
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
            className={`no-print inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
              isLive
                ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#10B981]'
                : 'border-[#1F2937] bg-[#111827] text-[#9CA3AF] hover:border-[#374151] hover:text-[#F9FAFB]'
            }`}
            title="Toggle simulated live telemetry stream (2s interval)"
          >
            <span className="relative flex h-1.5 w-1.5">
              {isLive && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#10B981] opacity-75" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  isLive ? 'bg-[#10B981]' : 'bg-[#6B7280]'
                }`}
              />
            </span>
            <Radio className="h-3 w-3" />
            <span>{isLive ? 'Live' : 'Auto'}</span>
          </button>

          {/* Light / Dark Theme Toggle */}
          <button
            type="button"
            onClick={onToggleTheme}
            className="no-print inline-flex shrink-0 items-center gap-1 rounded border border-[#1F2937] bg-[#111827] px-2 py-1 text-[11px] font-medium text-[#9CA3AF] hover:border-[#374151] hover:text-[#F9FAFB] whitespace-nowrap transition-colors"
            title={theme === 'dark' ? 'Switch to Light theme' : 'Switch to Cyber-Slate Dark theme'}
          >
            {theme === 'dark' ? (
              <Sun className="h-3 w-3 text-[#F59E0B]" />
            ) : (
              <Moon className="h-3 w-3 text-[#6366F1]" />
            )}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>

          {/* Copy Read-Only Share Link */}
          <button
            type="button"
            onClick={handleShareClick}
            className={`no-print inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
              copiedShare
                ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#34D399]'
                : 'border-[#1F2937] bg-[#111827] text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE]'
            }`}
            title="Copy shareable read-only link for this exact run, baseline, tab, and filter scope"
          >
            {copiedShare ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
            <span>{copiedShare ? 'Copied' : 'Share'}</span>
          </button>

          {/* Export Static HTML Report */}
          <button
            type="button"
            onClick={onExportHtml}
            className="no-print inline-flex shrink-0 items-center gap-1 rounded border border-[#06B6D4]/40 bg-[#06B6D4]/15 px-2.5 py-1 text-[11px] font-semibold text-[#22D3EE] hover:bg-[#06B6D4]/25 whitespace-nowrap transition-colors"
            title="Download self-contained offline Static HTML report (respects active scope & AI summary)"
          >
            <FileCode2 className="h-3 w-3" />
            <span>HTML</span>
          </button>

          {/* Export JSON */}
          <button
            type="button"
            onClick={onExportReport}
            className="no-print inline-flex shrink-0 items-center gap-1 rounded border border-[#1F2937] bg-[#111827] px-2 py-1 text-[11px] font-medium text-[#9CA3AF] hover:border-[#374151] hover:text-[#F9FAFB] whitespace-nowrap transition-colors"
            title="Export raw run telemetry as JSON"
          >
            <Download className="h-3 w-3" />
            <span>JSON</span>
          </button>

          {/* Admin Login / Logout */}
          {isAdmin ? (
            <button
              type="button"
              onClick={onLogout}
              className="no-print inline-flex shrink-0 items-center gap-1 rounded border border-[#10B981]/40 bg-[#10B981]/15 px-2 py-1 text-[11px] font-semibold text-[#34D399] hover:bg-[#EF4444]/15 hover:border-[#EF4444]/40 hover:text-[#FCA5A5] whitespace-nowrap transition-colors"
              title={`Signed in as ${adminUsername || 'admin'} — click to sign out to Read-Only mode`}
            >
              <ShieldCheck className="h-3 w-3" />
              <span className="hidden xl:inline">{adminUsername || 'Admin'}</span>
              <LogOut className="h-3 w-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenLogin}
              className="no-print inline-flex shrink-0 items-center gap-1 rounded border border-[#1F2937] bg-[#111827] px-2 py-1 text-[11px] font-medium text-[#9CA3AF] hover:border-[#06B6D4]/50 hover:text-[#22D3EE] whitespace-nowrap transition-colors"
              title="Read-Only Viewer Mode — click for Admin Login"
            >
              <LogIn className="h-3 w-3" />
              <span>Login</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
