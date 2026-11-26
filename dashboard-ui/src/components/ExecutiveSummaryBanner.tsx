/**
 * Executive Summary & Assessment Banner (`dashboard-ui/src/components/ExecutiveSummaryBanner.tsx`)
 *
 * Displays the live 0ms deterministic summary by default and automatically loads any
 * Admin-persisted AI summary from DuckDB (`GET /api/ai-summary?scopeKey=...`) for both
 * Read-Only Viewers and Admins. Signed-in Admins can trigger/regenerate AI summaries via
 * Gemini or Planit Amplify (`POST /api/ai-summary`). Supports clean nested bullet rendering.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  Wand2,
  XCircle,
} from 'lucide-react';
import { PerformanceTestRun } from '../types/performance';
import { computeFallbackApdex, synthesizeExecutiveSummary } from '../utils/executiveSummary';

export interface AiSummaryPayload {
  provider: string;
  model: string;
  paragraphs: string[];
  nextSteps: string[];
  updatedBy?: string;
  updatedAt?: string;
}

interface ExecutiveSummaryBannerProps {
  run: PerformanceTestRun;
  baselineRun: PerformanceTestRun | null;
  selectedApp: string;
  scopeKey: string;
  isAdmin: boolean;
  onActiveAiChange?: (ai: AiSummaryPayload | null) => void;
}

function renderBoldText(text: string): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={idx} className="font-semibold text-[#F9FAFB]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const ExecutiveSummaryBanner: React.FC<ExecutiveSummaryBannerProps> = ({
  run,
  baselineRun,
  selectedApp,
  scopeKey,
  isAdmin,
  onActiveAiChange,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [preferDeterministic, setPreferDeterministic] = useState(false);
  const [, setCacheTick] = useState(0);
  const aiCacheRef = useRef<Map<string, AiSummaryPayload>>(new Map());

  const summary = synthesizeExecutiveSummary(run, baselineRun, selectedApp);
  const baseApdex = baselineRun ? computeFallbackApdex(baselineRun) : null;
  const apdexDelta = baseApdex ? Number((summary.apdex.score - baseApdex.score).toFixed(2)) : null;

  // Load any Admin-persisted AI summary from DuckDB for this scope (read-only for both Viewers & Admins)
  useEffect(() => {
    let cancelled = false;
    setAiError(null);
    setPreferDeterministic(false);
    if (aiCacheRef.current.has(scopeKey)) return;

    async function loadSavedAi() {
      try {
        const resp = await fetch(`/api/ai-summary?scopeKey=${encodeURIComponent(scopeKey)}`);
        if (!resp.ok || cancelled) return;
        const data = await resp.json();
        if (!cancelled && data.ok && data.found && data.summary) {
          aiCacheRef.current.set(scopeKey, data.summary);
          setCacheTick((t) => t + 1);
        }
      } catch {
        // Silently stay on 0 ms deterministic summary
      }
    }
    loadSavedAi();
    return () => {
      cancelled = true;
    };
  }, [scopeKey]);

  const cachedAi = aiCacheRef.current.get(scopeKey) ?? null;
  const activeAi = !preferDeterministic ? cachedAi : null;

  useEffect(() => {
    onActiveAiChange?.(activeAi);
  }, [activeAi, onActiveAiChange]);

  const handleGenerateAi = async (forceRegenerate = false) => {
    if (!isAdmin) return;
    setAiError(null);
    setPreferDeterministic(false);
    if (!forceRegenerate && aiCacheRef.current.has(scopeKey)) {
      setCacheTick((t) => t + 1);
      return;
    }
    setLoadingAi(true);
    try {
      const baseScenMap = new Map<string, number>();
      if (baselineRun?.scenarios) {
        for (const bs of baselineRun.scenarios) {
          baseScenMap.set(`${bs.appName}|${bs.scenario}`, bs.p95);
          if (!baseScenMap.has(bs.scenario)) baseScenMap.set(bs.scenario, bs.p95);
        }
      }

      const journeyBreakdown = (run.scenarios || [])
        .slice(0, 15)
        .map((s) => {
          const baseP95 = baseScenMap.get(`${s.appName}|${s.scenario}`) ?? baseScenMap.get(s.scenario);
          if (baseP95 && baseP95 > 0) {
            const pct = ((s.p95 - baseP95) / baseP95) * 100;
            const status = pct <= -5 ? 'Improved' : pct >= 5 ? 'Regressed' : 'Broadly Stable';
            const sign = pct > 0 ? '+' : '';
            return `- ${s.scenario}: P95 ${s.p95} ms vs ${baseP95} ms (${sign}${pct.toFixed(1)}%, ${status}), ${s.throughput} TPS, ${s.errorPct}% err`;
          }
          return `- ${s.scenario}: P95 ${s.p95} ms, ${s.throughput} TPS, ${s.errorPct}% err`;
        })
        .join('\n');

      const errorBreakdown =
        run.errorDetails && run.errorDetails.length > 0
          ? run.errorDetails
              .slice(0, 10)
              .map(
                (d) =>
                  `- ${d.endpoint} (${d.scenario}): HTTP ${d.responseCode} — ${d.failureMessage || d.responseMessage} (${d.count} occurrences)`
              )
              .join('\n')
          : run.httpErrors.length > 0
          ? run.httpErrors
              .slice(0, 6)
              .map((e) => `- HTTP ${e.code} (${e.label}): ${e.count} errors (${e.percentage}%)`)
              .join('\n')
          : '0 errors recorded.';

      const appNames =
        run.apps && run.apps.length > 0 ? run.apps.map((a) => a.appName).join(', ') : run.name;
      const rtMetric = (run.sla.rtMetric || 'p95').toUpperCase();
      const rtEnabled = run.sla.rtEnabled !== false;
      const errEnabled = run.sla.errorEnabled !== false;
      const breachCount = run.endpoints.filter((ep) => {
        const p95B = ep.rtBreached !== undefined ? ep.rtBreached : rtEnabled && ep.p95 > ep.slaP95Ms;
        const errB =
          ep.errorBreached !== undefined
            ? ep.errorBreached
            : errEnabled && ep.errorPct > run.sla.errorRatePct;
        return p95B || errB;
      }).length;
      const cleanBaseId = baselineRun ? baselineRun.id.replace(/^vault-[a-z]+-/i, '') : 'N/A';
      const baseDeltaPct =
        baselineRun && baselineRun.summary.p95ResponseTimeMs > 0
          ? ((run.summary.p95ResponseTimeMs - baselineRun.summary.p95ResponseTimeMs) /
              baselineRun.summary.p95ResponseTimeMs) *
            100
          : null;
      const baselineComp =
        baselineRun && baseDeltaPct !== null
          ? `${baseDeltaPct > 0 ? '+' : ''}${baseDeltaPct.toFixed(1)}% vs baseline #${cleanBaseId} at ${baselineRun.summary.p95ResponseTimeMs} ms`
          : 'standalone single-run, no baseline';
      const runDate = run.startedAt ? run.startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
      const flowTheme =
        run.scenarios && run.scenarios.length > 0
          ? run.scenarios
              .slice(0, 6)
              .map((s) => s.scenario)
              .join(', ')
          : selectedApp;

      const resp = await fetch('/api/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scopeKey,
          runId: run.id,
          baselineRunId: cleanBaseId,
          runName: run.name,
          appNames,
          env: run.environment,
          testType: run.name.replace(/^\[Vault\]\s*/i, '').replace(/\s*#\S+$/, ''),
          runDate,
          durationDesc: `${run.durationMinutes} minutes`,
          scopeLabel: selectedApp,
          durationMinutes: run.durationMinutes,
          peakVUs: run.summary.peakVUs,
          totalRequests: run.summary.totalRequests,
          avgThroughputRps: run.summary.avgThroughputRps,
          p95ResponseTimeMs: run.summary.p95ResponseTimeMs,
          errorRatePct: run.summary.errorRatePct,
          rtMetric,
          breachCount,
          baselineComp,
          flowTheme,
          apdexScore: summary.apdex.score,
          apdexRating: summary.apdex.rating,
          overallStatus: summary.overallStatus,
          slowestEndpoint: summary.slowestEndpoint,
          baselineName: baselineRun?.name || null,
          baselineP95Ms: baselineRun?.summary.p95ResponseTimeMs ?? null,
          baselineTps: baselineRun?.summary.avgThroughputRps ?? null,
          baselineErrorPct: baselineRun?.summary.errorRatePct ?? null,
          journeyBreakdown,
          errorBreakdown,
        }),
      });
      const data = await resp.json();
      if (data.ok && Array.isArray(data.paragraphs) && data.paragraphs.length > 0) {
        aiCacheRef.current.set(scopeKey, {
          provider: data.provider || 'AI',
          model: data.model || '',
          paragraphs: data.paragraphs,
          nextSteps: Array.isArray(data.nextSteps) && data.nextSteps.length > 0
            ? data.nextSteps
            : summary.nextSteps,
          updatedBy: data.updatedBy,
          updatedAt: data.updatedAt,
        });
        setCacheTick((t) => t + 1);
      } else {
        setAiError(data.reason || data.error || 'AI summary unavailable — showing Rule-based summary.');
      }
    } catch {
      setAiError('Could not reach /api/ai-summary — showing Rule-based summary.');
    } finally {
      setLoadingAi(false);
    }
  };

  const apdexBadgeClass =
    summary.apdex.score >= 0.94
      ? 'border-[#10B981]/40 bg-[#10B981]/15 text-[#10B981]'
      : summary.apdex.score >= 0.85
      ? 'border-[#06B6D4]/40 bg-[#06B6D4]/15 text-[#22D3EE]'
      : summary.apdex.score >= 0.7
      ? 'border-[#F59E0B]/40 bg-[#F59E0B]/15 text-[#F59E0B]'
      : 'border-[#EF4444]/40 bg-[#EF4444]/15 text-[#EF4444]';

  const displayParagraphs = activeAi ? activeAi.paragraphs : summary.paragraphs;
  const displayNextSteps = activeAi ? activeAi.nextSteps : summary.nextSteps;

  return (
    <section
      className={`rounded-lg border bg-[#111827] transition-colors ${
        summary.overallStatus === 'FAIL'
          ? 'border-[#EF4444]/45 border-l-4 border-l-[#EF4444]'
          : summary.overallStatus === 'PASS'
          ? 'border-[#1F2937] border-l-4 border-l-[#10B981]'
          : 'border-[#1F2937] border-l-4 border-l-[#06B6D4]'
      }`}
    >
      {/* Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 border-b border-[#1F2937]">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
            <Sparkles className="h-3.5 w-3.5 text-[#06B6D4]" />
            Executive Summary &amp; Assessment
          </span>

          {summary.overallStatus === 'PASS' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#10B981]/40 bg-[#10B981]/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-[#10B981] metric-num">
              <CheckCircle2 className="h-3 w-3" />
              SLA PASS
            </span>
          )}
          {summary.overallStatus === 'FAIL' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#EF4444]/40 bg-[#EF4444]/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-[#EF4444] metric-num">
              <XCircle className="h-3 w-3" />
              SLA FAIL
            </span>
          )}
          {summary.overallStatus === 'INFO' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#06B6D4]/40 bg-[#06B6D4]/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-[#22D3EE] metric-num">
              <Info className="h-3 w-3" />
              INFORMATIONAL
            </span>
          )}

          {/* Compact Apdex Pill */}
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-semibold metric-num ${apdexBadgeClass}`}
            title="Apdex User Experience Score: (Satisfied + 0.5 × Tolerating) / Total"
          >
            Apdex {summary.apdex.score.toFixed(2)} ({summary.apdex.rating})
            {apdexDelta !== null && apdexDelta !== 0 && (
              <span className="opacity-85">
                {apdexDelta > 0 ? `+${apdexDelta.toFixed(2)}` : apdexDelta.toFixed(2)}
              </span>
            )}
          </span>

          {activeAi && (
            <span className="inline-flex items-center gap-1 rounded border border-[#6366F1]/40 bg-[#6366F1]/15 px-2 py-0.5 text-[10px] font-semibold text-[#A5B4FC]">
              ✨ {activeAi.provider}
            </span>
          )}
        </div>

        <div className="no-print flex items-center gap-2">
          {activeAi ? (
            <>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => handleGenerateAi(true)}
                  disabled={loadingAi}
                  className="inline-flex items-center gap-1 rounded border border-[#6366F1]/40 bg-[#6366F1]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#A5B4FC] hover:bg-[#6366F1]/25 disabled:opacity-60 transition-colors"
                  title="Regenerate and save a fresh AI summary to DuckDB"
                >
                  {loadingAi ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Regenerate
                </button>
              )}
              <button
                type="button"
                onClick={() => setPreferDeterministic(true)}
                className="inline-flex items-center gap-1 rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-0.5 text-[10.5px] font-medium text-[#9CA3AF] hover:border-[#374151] hover:text-[#F9FAFB] transition-colors"
              >
                Use Rule-based
              </button>
            </>
          ) : cachedAi ? (
            <button
              type="button"
              onClick={() => setPreferDeterministic(false)}
              className="inline-flex items-center gap-1 rounded border border-[#6366F1]/40 bg-[#6366F1]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#A5B4FC] hover:bg-[#6366F1]/25 transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              Show Saved AI
            </button>
          ) : isAdmin ? (
            <button
              type="button"
              onClick={() => handleGenerateAi(false)}
              disabled={loadingAi}
              className="inline-flex items-center gap-1 rounded border border-[#6366F1]/40 bg-[#6366F1]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#A5B4FC] hover:bg-[#6366F1]/25 disabled:opacity-60 transition-colors"
              title="Generate and persist an AI executive summary for this scope (Admin only)"
            >
              {loadingAi ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="h-3 w-3" />
                  AI Summary
                </>
              )}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-[#9CA3AF] hover:bg-[#1F2937] hover:text-[#F9FAFB] transition-colors"
          >
            {collapsed ? (
              <>
                Expand <ChevronDown className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Collapse <ChevronUp className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="grid grid-cols-1 gap-3 p-3.5 lg:grid-cols-12">
          {/* Narrative + Apdex Bar */}
          <div className="space-y-2.5 lg:col-span-7">
            {aiError && (
              <div className="rounded border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-2.5 py-1.5 text-[11px] text-[#FBBF24]">
                {aiError}
              </div>
            )}
            {(() => {
              interface BulletItem {
                text: string;
                children: string[];
                wasSub?: boolean;
              }
              const blocks: React.ReactNode[] = [];
              let bullets: BulletItem[] = [];
              const flushBullets = (keyPrefix: string) => {
                if (bullets.length === 0) return;
                blocks.push(
                  <ul
                    key={keyPrefix}
                    className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-[#D1D5DB]"
                  >
                    {bullets.map((b, bi) => (
                      <li key={bi}>
                        {renderBoldText(b.text)}
                        {b.children.length > 0 && (
                          <ul className="mt-1 list-[circle] space-y-0.5 pl-5 text-[11.5px] text-[#9CA3AF]">
                            {b.children.map((c, ci) => (
                              <li key={ci}>{renderBoldText(c)}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                );
                bullets = [];
              };
              displayParagraphs.forEach((p, idx) => {
                if (/^\s{2,}[-*•]\s+/.test(p)) {
                  const subText = p.replace(/^\s+[-*•]\s+/, '').trim();
                  const parent = bullets.length > 0 ? bullets[bullets.length - 1] : null;
                  // Only nest inside a true top-level bullet (`!parent.wasSub`) so when an LLM
                  // outputs a plain heading (`Improved:`) followed by indented items, all items
                  // stay at the same sibling level instead of nesting under the first item.
                  if (parent && !parent.wasSub) {
                    parent.children.push(subText);
                  } else {
                    bullets.push({ text: subText, children: [], wasSub: true });
                  }
                } else if (/^[-*•]\s+/.test(p)) {
                  bullets.push({ text: p.replace(/^[-*•]\s+/, '').trim(), children: [], wasSub: false });
                } else {
                  flushBullets(`bl-${idx}`);
                  blocks.push(
                    <p key={`p-${idx}`} className="text-xs leading-relaxed text-[#D1D5DB]">
                      {renderBoldText(p)}
                    </p>
                  );
                }
              });
              flushBullets('bl-end');
              return blocks;
            })()}

            {/* Apdex Experience Bar */}
            <div className="pt-1">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#9CA3AF]">
                <span className="font-semibold uppercase tracking-wider">
                  Apdex User Experience Distribution
                </span>
                <div className="flex items-center gap-3 metric-num">
                  <span className="text-[#10B981]">
                    Satisfied {summary.apdex.satisfiedPct}%
                  </span>
                  <span className="text-[#F59E0B]">
                    Tolerating {summary.apdex.toleratingPct}%
                  </span>
                  <span className="text-[#EF4444]">
                    Frustrated {summary.apdex.frustratedPct}%
                  </span>
                </div>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#1F2937]">
                {summary.apdex.satisfiedPct > 0 && (
                  <div
                    className="h-full bg-[#10B981]"
                    style={{ width: `${summary.apdex.satisfiedPct}%` }}
                    title={`Satisfied (<= T): ${summary.apdex.satisfied.toLocaleString()} (${summary.apdex.satisfiedPct}%)`}
                  />
                )}
                {summary.apdex.toleratingPct > 0 && (
                  <div
                    className="h-full bg-[#F59E0B]"
                    style={{ width: `${summary.apdex.toleratingPct}%` }}
                    title={`Tolerating (T–4T): ${summary.apdex.tolerating.toLocaleString()} (${summary.apdex.toleratingPct}%)`}
                  />
                )}
                {summary.apdex.frustratedPct > 0 && (
                  <div
                    className="h-full bg-[#EF4444]"
                    style={{ width: `${summary.apdex.frustratedPct}%` }}
                    title={`Frustrated (>4T or Error): ${summary.apdex.frustrated.toLocaleString()} (${summary.apdex.frustratedPct}%)`}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Next Steps */}
          <div className="rounded-md border border-[#1F2937] bg-[#0B0F19]/70 p-3 lg:col-span-5">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[#F9FAFB]">
              <ClipboardList className="h-3.5 w-3.5 text-[#06B6D4]" />
              Next Steps
            </div>
            <ul className="space-y-1.5 pl-4 text-xs leading-snug text-[#D1D5DB] list-disc">
              {displayNextSteps.map((step, i) => (
                <li key={i}>{renderBoldText(step)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
};
