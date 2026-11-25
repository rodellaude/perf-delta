import { ApdexSummary, PerformanceTestRun } from '../types/performance';

export interface ExecutiveSummaryResult {
  overallStatus: 'PASS' | 'FAIL' | 'INFO';
  paragraph1: string;
  paragraph2: string;
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

export function synthesizeExecutiveSummary(
  run: PerformanceTestRun,
  baselineRun: PerformanceTestRun | null,
  selectedApp: string
): ExecutiveSummaryResult {
  const apdex = computeFallbackApdex(run);
  const rtEnabled = run.sla.rtEnabled !== false;
  const errEnabled = run.sla.errorEnabled !== false;
  const showOverall = run.sla.showOverallStatus !== false && (rtEnabled || errEnabled);

  const filteredEps =
    selectedApp === 'ALL'
      ? run.endpoints
      : run.endpoints.filter((e) => e.appName === selectedApp);

  const breachedEps = filteredEps.filter((ep) =>
    ep.rtBreached !== undefined
      ? ep.rtBreached
      : rtEnabled && ep.p95 > (ep.slaP95Ms || run.sla.p95Ms)
  );
  const sortedByLatency = [...filteredEps].sort((a, b) => b.p95 - a.p95);
  const worst = sortedByLatency[0] || null;

  const rtFailed = rtEnabled && (breachedEps.length > 0 || run.summary.p95ResponseTimeMs > run.sla.p95Ms);
  const errFailed = errEnabled && run.summary.errorRatePct > run.sla.errorRatePct;
  const overallStatus: 'PASS' | 'FAIL' | 'INFO' = !showOverall
    ? 'INFO'
    : rtFailed || errFailed
    ? 'FAIL'
    : 'PASS';

  const appScope = selectedApp === 'ALL'
    ? run.apps && run.apps.length > 0
      ? run.apps.map((a) => a.appName).join(', ')
      : run.name
    : selectedApp;

  const p95DeltaStr = (() => {
    if (!baselineRun || baselineRun.summary.p95ResponseTimeMs <= 0) {
      return `recording an overall P95 response time of ${run.summary.p95ResponseTimeMs.toLocaleString()} ms`;
    }
    const diffPct =
      ((run.summary.p95ResponseTimeMs - baselineRun.summary.p95ResponseTimeMs) /
        baselineRun.summary.p95ResponseTimeMs) *
      100;
    const dir = diffPct < -1 ? 'improvement' : diffPct > 1 ? 'regression' : 'broadly stable';
    const sign = diffPct > 0 ? '+' : '';
    return `recording a ${sign}${diffPct.toFixed(1)}% P95 latency ${dir} vs baseline (${run.summary.p95ResponseTimeMs.toLocaleString()} ms vs ${baselineRun.summary.p95ResponseTimeMs.toLocaleString()} ms)`;
  })();

  const paragraph1 = `Performance run for ${appScope} executed for ${run.durationMinutes} min with ${run.summary.peakVUs.toLocaleString()} peak virtual users, sustaining ${run.summary.avgThroughputRps.toFixed(2)} req/s across ${run.summary.totalRequests.toLocaleString()} requests with a ${run.summary.errorRatePct.toFixed(2)}% error rate and ${p95DeltaStr}.`;

  let paragraph2 = '';
  if (rtEnabled && breachedEps.length > 0 && worst) {
    paragraph2 = `${breachedEps.length} of ${filteredEps.length} monitored transactions exceeded their response time SLA target. The slowest outlier was ${worst.endpoint} at ${worst.p95.toLocaleString()} ms vs ${worst.slaP95Ms.toLocaleString()} ms target (Apdex ${apdex.score.toFixed(2)} — ${apdex.rating}).`;
  } else if (worst) {
    const fastCnt = filteredEps.filter((e) => e.p95 <= 2000).length;
    const fastPct = filteredEps.length > 0 ? Math.round((fastCnt / filteredEps.length) * 100) : 100;
    paragraph2 = `Across ${filteredEps.length} monitored transactions, ${fastCnt} (${fastPct}%) completed within 2,000 ms (Apdex ${apdex.score.toFixed(2)} — ${apdex.rating}). The slowest outlier was ${worst.endpoint} at ${worst.p95.toLocaleString()} ms.`;
  } else {
    paragraph2 = `Overall Apdex user experience scored ${apdex.score.toFixed(2)} (${apdex.rating}) with ${run.summary.failedRequests.toLocaleString()} failed requests.`;
  }

  const nextSteps: string[] = [];
  if (worst) {
    nextSteps.push(
      `Profile ${worst.endpoint} (${worst.p95.toLocaleString()} ms P95) in APM/server logs to check query latency, payload size, or lock contention.`
    );
  }
  if (run.summary.failedRequests > 0) {
    const topErr = run.httpErrors[0];
    nextSteps.push(
      `Investigate ${run.summary.failedRequests.toLocaleString()} failed requests${topErr ? ` (top error: HTTP ${topErr.code} — ${topErr.label})` : ''} before release sign-off.`
    );
  } else {
    nextSteps.push(
      `Retain this run as a reference baseline while tracking release-over-release P95 latency and throughput trends.`
    );
  }
  nextSteps.push(
    `Re-run under identical load profile after tuning to confirm P95 latency and error rate remain within SLA targets.`
  );

  return {
    overallStatus,
    paragraph1,
    paragraph2,
    nextSteps,
    apdex,
    breachedEndpointsCount: breachedEps.length,
    slowestEndpoint: worst ? { name: worst.endpoint, p95: worst.p95, sla: worst.slaP95Ms } : null,
  };
}
