/**
 * Deterministic 0ms Executive Summary & Apdex Calculator (`dashboard-ui/src/utils/executiveSummary.ts`)
 *
 * Synthesizes an instant 2-paragraph stakeholder summary, SLA verdict, Next Steps,
 * and Apdex distribution directly from the active scoped run + baseline (zero LLM calls).
 * Used as the live default and fallback whenever no Admin-saved AI summary exists for a scope.
 */
import { ApdexSummary, PerformanceTestRun } from '../types/performance';

export interface ExecutiveSummaryResult {
  overallStatus: 'PASS' | 'FAIL' | 'INFO';
  paragraph1: string;
  paragraph2: string;
  paragraphs: string[];
  nextSteps: string[];
  apdex: ApdexSummary;
  breachedEndpointsCount: number;
  slowestEndpoint: { name: string; p95: number; sla: number } | null;
}

export function computeFallbackApdex(run: PerformanceTestRun): ApdexSummary {
  if (run.apdex && run.apdex.total > 0) return run.apdex;
  let satisfied = 0;
  let tolerating = 0;
  let frustrated = 0;
  for (const ep of run.endpoints) {
    const t = ep.slaP95Ms || run.sla.p95Ms || 3000;
    const errs = Math.round((ep.errorPct / 100) * ep.samples);
    const ok = Math.max(0, ep.samples - errs);
    frustrated += errs;
    if (ep.p95 <= t) {
      satisfied += ok;
    } else if (ep.p95 <= 4 * t) {
      tolerating += ok;
    } else {
      frustrated += ok;
    }
  }
  const total = Math.max(satisfied + tolerating + frustrated, 1);
  const score = Number(((satisfied + 0.5 * tolerating) / total).toFixed(2));
  const rating =
    score >= 0.94
      ? 'Excellent'
      : score >= 0.85
      ? 'Good'
      : score >= 0.7
      ? 'Fair'
      : score >= 0.5
      ? 'Poor'
      : 'Unacceptable';
  return {
    score,
    rating,
    satisfied,
    tolerating,
    frustrated,
    total: satisfied + tolerating + frustrated,
    satisfiedPct: Number(((satisfied / total) * 100).toFixed(1)),
    toleratingPct: Number(((tolerating / total) * 100).toFixed(1)),
    frustratedPct: Number(((frustrated / total) * 100).toFixed(1)),
  };
}

function fmtMs(v: number): string {
  return Number.isInteger(v)
    ? v.toLocaleString()
    : Number(v.toFixed(1)).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function shortenUrlPath(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    return u.pathname || rawUrl;
  } catch {
    return rawUrl.length > 60 ? `${rawUrl.slice(0, 57)}...` : rawUrl;
  }
}

export function synthesizeExecutiveSummary(
  run: PerformanceTestRun,
  baselineRun: PerformanceTestRun | null,
  selectedApp: string
): ExecutiveSummaryResult {
  const apdex = computeFallbackApdex(run);
  const rtEnabled = run.sla.rtEnabled !== false;
  const errEnabled = run.sla.errorEnabled !== false;
  const showOverall = run.sla.showOverallStatus !== false && (rtEnabled || errEnabled);

  // `run` is already scoped by `applyGlobalScope()` in App.tsx, so use its endpoints & scenarios directly.
  const scopedEps = run.endpoints;
  const scopedScens = run.scenarios || [];

  const breachedEps = scopedEps.filter((ep) =>
    ep.rtBreached !== undefined
      ? ep.rtBreached
      : rtEnabled && ep.p95 > (ep.slaP95Ms || run.sla.p95Ms)
  );
  const sortedByLatency = [...scopedEps].sort((a, b) => b.p95 - a.p95);
  const worst = sortedByLatency[0] || null;

  const rtFailed = rtEnabled && (breachedEps.length > 0 || run.summary.p95ResponseTimeMs > run.sla.p95Ms);
  const errFailed = errEnabled && run.summary.errorRatePct > run.sla.errorRatePct;
  const overallStatus: 'PASS' | 'FAIL' | 'INFO' = !showOverall
    ? 'INFO'
    : rtFailed || errFailed
    ? 'FAIL'
    : 'PASS';

  const testTitle = run.name.replace(/^\[Vault\]\s*/i, '').replace(/\s*#[^\s]+$/, '').trim() || run.name;
  const runDate = run.startedAt ? run.startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const rtMetric = (run.sla.rtMetric || 'p95').toUpperCase();
  const cleanBaseId = baselineRun ? baselineRun.id.replace(/^vault-[a-z]+-/i, '') : null;

  const p95CompSentence = (() => {
    const curP95 = fmtMs(run.summary.p95ResponseTimeMs);
    if (!baselineRun || baselineRun.summary.p95ResponseTimeMs <= 0) {
      return `Overall **${rtMetric}** latency was **${curP95} ms** with **${breachedEps.length} ${rtMetric} ${breachedEps.length === 1 ? 'breach' : 'breaches'}** recorded.`;
    }
    const diffPct =
      ((run.summary.p95ResponseTimeMs - baselineRun.summary.p95ResponseTimeMs) /
        baselineRun.summary.p95ResponseTimeMs) *
      100;
    const sign = diffPct > 0 ? '+' : '';
    const qualifier =
      diffPct <= -5
        ? 'a notable improvement'
        : diffPct >= 5
        ? 'a regression'
        : diffPct > 0.5
        ? 'a slight increase'
        : diffPct < -0.5
        ? 'a slight improvement'
        : 'broadly unchanged';
    return `Overall **${rtMetric}** latency was **${curP95} ms**, ${qualifier} (**${sign}${diffPct.toFixed(1)}%**) compared with baseline run **#${cleanBaseId}** (**${fmtMs(baselineRun.summary.p95ResponseTimeMs)} ms**), with **${breachedEps.length} ${rtMetric} ${breachedEps.length === 1 ? 'breach' : 'breaches'}** recorded.`;
  })();

  const scopeSuffix =
    selectedApp && selectedApp !== 'ALL' && selectedApp !== 'Full Run'
      ? ` (filtered scope: **${selectedApp}**)`
      : '';

  const paragraph1 = `The **${testTitle}** test on **${runDate}** held **${run.summary.peakVUs.toLocaleString()} virtual users** for **${run.durationMinutes} minutes**${scopeSuffix}, sustaining an average throughput of **${run.summary.avgThroughputRps.toFixed(2)} TPS** across **${run.summary.totalRequests.toLocaleString()} requests** with a **${run.summary.errorRatePct.toFixed(2)}% error rate**. ${p95CompSentence}`;

  // Build AI-parity nested bullet sections
  const paragraphs: string[] = [paragraph1];

  const improved: { name: string; p95: number; baseP95: number; pct: number; tps: number; errPct: number }[] = [];
  const stable: { name: string; p95: number; baseP95: number; pct: number; tps: number; errPct: number }[] = [];
  const regressed: { name: string; p95: number; baseP95: number; pct: number; tps: number; errPct: number }[] = [];

  if (baselineRun && scopedScens.length > 0) {
    const baseScenMap = new Map<string, number>();
    for (const bs of baselineRun.scenarios || []) {
      baseScenMap.set(`${bs.appName}|${bs.scenario}`, bs.p95);
      if (!baseScenMap.has(bs.scenario)) baseScenMap.set(bs.scenario, bs.p95);
    }

    for (const sc of scopedScens) {
      const baseP95 = baseScenMap.get(`${sc.appName}|${sc.scenario}`) ?? baseScenMap.get(sc.scenario);
      if (baseP95 && baseP95 > 0) {
        const pct = ((sc.p95 - baseP95) / baseP95) * 100;
        const item = { name: sc.scenario, p95: sc.p95, baseP95, pct, tps: sc.throughput, errPct: sc.errorPct };
        if (pct <= -5) improved.push(item);
        else if (pct >= 5) regressed.push(item);
        else stable.push(item);
      }
    }

    improved.sort((a, b) => a.pct - b.pct);
    regressed.sort((a, b) => b.pct - a.pct);
    stable.sort((a, b) => b.tps - a.tps);

    if (improved.length > 0) {
      paragraphs.push('- **Improved:**');
      for (const it of improved.slice(0, 8)) {
        paragraphs.push(
          `  - **${it.name}:** P95 **${fmtMs(it.p95)} ms** (**${it.pct.toFixed(1)}%** vs baseline **${fmtMs(it.baseP95)} ms**), ${it.tps.toFixed(2)} TPS, ${it.errPct.toFixed(2)}% error rate`
        );
      }
    }

    if (stable.length > 0) {
      paragraphs.push('- **Broadly Stable:**');
      for (const it of stable.slice(0, 8)) {
        const sign = it.pct > 0 ? '+' : '';
        paragraphs.push(
          `  - **${it.name}:** P95 **${fmtMs(it.p95)} ms** (**${sign}${it.pct.toFixed(1)}%** vs baseline **${fmtMs(it.baseP95)} ms**), ${it.tps.toFixed(2)} TPS, ${it.errPct.toFixed(2)}% error rate`
        );
      }
    }
  } else if (scopedScens.length > 0) {
    // Standalone run (no baseline)
    paragraphs.push('- **Key User Journeys (P95):**');
    for (const sc of [...scopedScens].sort((a, b) => b.p95 - a.p95).slice(0, 6)) {
      paragraphs.push(
        `  - **${sc.scenario}:** P95 **${fmtMs(sc.p95)} ms**, ${sc.throughput.toFixed(2)} TPS, ${sc.errorPct.toFixed(2)}% error rate`
      );
    }
  }

  // Regressions & Slowest Outlier
  if (regressed.length > 0 || worst) {
    paragraphs.push('- **Regressions & Slowest Outlier:**');
    for (const it of regressed.slice(0, 6)) {
      paragraphs.push(
        `  - **${it.name}:** P95 **${fmtMs(it.p95)} ms** (**+${it.pct.toFixed(1)}%** vs baseline **${fmtMs(it.baseP95)} ms**), ${it.tps.toFixed(2)} TPS`
      );
    }
    if (worst) {
      paragraphs.push(
        `  - Slowest transaction: **${worst.endpoint}** at **${fmtMs(worst.p95)} ms** (${rtMetric} vs **${worst.slaP95Ms.toLocaleString()} ms** target)`
      );
    }
  }

  // Error Summary
  if (run.summary.failedRequests === 0 && (!run.errorDetails || run.errorDetails.length === 0) && run.httpErrors.length === 0) {
    paragraphs.push(`- **Error Summary (0.00% Error Rate):** **0 errors** occurred across all monitored transactions.`);
  } else if (run.errorDetails && run.errorDetails.length > 0) {
    paragraphs.push(`- **Error Summary (${run.summary.errorRatePct.toFixed(2)}% Error Rate):**`);
    for (const d of run.errorDetails.slice(0, 5)) {
      const pathStr = shortenUrlPath(d.url);
      const reason = d.failureMessage || d.responseMessage || 'Request failed';
      paragraphs.push(
        `  - **${d.scenario || d.endpoint}:** **${d.count.toLocaleString()}** ${d.count === 1 ? 'occurrence' : 'occurrences'} of **HTTP ${d.responseCode}** (${reason})${pathStr ? ` on \`${pathStr}\`` : ''}`
      );
    }
  } else {
    paragraphs.push(`- **Error Summary (${run.summary.errorRatePct.toFixed(2)}% Error Rate):**`);
    for (const e of run.httpErrors.slice(0, 4)) {
      paragraphs.push(
        `  - **HTTP ${e.code} — ${e.label}:** **${e.count.toLocaleString()}** errors (${e.percentage.toFixed(1)}% share)`
      );
    }
  }

  const paragraph2 =
    worst
      ? `Slowest outlier was **${worst.endpoint}** at **${fmtMs(worst.p95)} ms** (Apdex **${apdex.score.toFixed(2)} — ${apdex.rating}**).`
      : `Overall Apdex user experience scored **${apdex.score.toFixed(2)} (${apdex.rating})**.`;

  // 3 Targeted British-English Next Steps (with inline bolding)
  const nextSteps: string[] = [];
  if (regressed.length > 0 && worst) {
    nextSteps.push(
      `Investigate the regressed journey **${regressed[0].name}** (**+${regressed[0].pct.toFixed(1)}%**) and slowest outlier **${worst.endpoint}** (**${fmtMs(worst.p95)} ms** ${rtMetric}) first to isolate backend bottlenecks.`
    );
  } else if (worst) {
    nextSteps.push(
      `Prioritise profiling **${worst.endpoint}** (**${fmtMs(worst.p95)} ms** ${rtMetric} vs **${worst.slaP95Ms.toLocaleString()} ms** target) in server/APM traces to identify slow queries, payload bloat, or downstream waits.`
    );
  }

  if (run.summary.failedRequests > 0) {
    const topDetail = run.errorDetails?.[0];
    const topHttp = run.httpErrors[0];
    if (topDetail) {
      nextSteps.push(
        `Review gateway timeouts, connection pooling, and upstream health for **HTTP ${topDetail.responseCode}** failures on **${topDetail.endpoint}** (${topDetail.count.toLocaleString()} occurrences) and optimise caching/database indexing where latency spiked.`
      );
    } else if (topHttp) {
      nextSteps.push(
        `Investigate **${run.summary.failedRequests.toLocaleString()}** failed requests (led by **HTTP ${topHttp.code} — ${topHttp.label}**) and review upstream timeouts, connection pools, and database query plans.`
      );
    }
  } else {
    nextSteps.push(
      `Look into practical tuning such as database query indexing, response caching, and payload optimisation on the slowest transactions while retaining this clean run as a reference baseline.`
    );
  }

  nextSteps.push(
    `Re-run the **${testTitle}** test under the same **${run.summary.peakVUs.toLocaleString()} virtual users** load profile after applying fixes to confirm latency improvements and error stability.`
  );

  return {
    overallStatus,
    paragraph1,
    paragraph2,
    paragraphs,
    nextSteps,
    apdex,
    breachedEndpointsCount: breachedEps.length,
    slowestEndpoint: worst ? { name: worst.endpoint, p95: worst.p95, sla: worst.slaP95Ms } : null,
  };
}
