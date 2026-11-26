import { GLOSSARY_ENTRIES } from '../components/GlossaryView';
import { PerformanceTestRun, TelemetryPoint } from '../types/performance';
import { computeFallbackApdex, synthesizeExecutiveSummary } from './executiveSummary';

export interface StaticHtmlAiSummary {
  provider: string;
  model: string;
  paragraphs: string[];
  nextSteps: string[];
  updatedBy?: string;
  updatedAt?: string;
}

export interface StaticHtmlExportOptions {
  run: PerformanceTestRun;
  baselineRun: PerformanceTestRun | null;
  vaultRuns?: PerformanceTestRun[];
  visibleSeries: TelemetryPoint[];
  scopeLabel: string;
  theme: 'dark' | 'light';
  aiSummary?: StaticHtmlAiSummary | null;
}

function esc(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBoldHtml(text: string): string {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function fmtDeltaPill(
  current: number,
  baseline: number | null | undefined,
  lowerIsBetter: boolean
): string {
  if (baseline === null || baseline === undefined || !Number.isFinite(baseline) || baseline === 0) {
    return '<span class="muted">—</span>';
  }
  const pct = ((current - baseline) / Math.abs(baseline)) * 100;
  if (Math.abs(pct) < 0.05) {
    return '<span class="pill pill-neutral">0.0%</span>';
  }
  const improved = lowerIsBetter ? pct < 0 : pct > 0;
  const cls = improved ? 'pill-pass' : 'pill-fail';
  const arrow = pct > 0 ? '▲' : '▼';
  const sign = pct > 0 ? '+' : '';
  return `<span class="pill ${cls}">${arrow} ${sign}${pct.toFixed(1)}%</span>`;
}

function buildSvgLineChart(opts: {
  id: string;
  title: string;
  subtitle: string;
  series: TelemetryPoint[];
  baselineSeries?: TelemetryPoint[];
  lines: {
    label: string;
    color: string;
    dashed?: boolean;
    values: number[];
  }[];
  yUnit: string;
  slaLine?: { value: number; label: string; color: string } | null;
}): string {
  const { id, title, subtitle, series, lines, yUnit, slaLine } = opts;
  const W = 720;
  const H = 250;
  const padL = 54;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allVals = lines.flatMap((l) => l.values).filter((v) => Number.isFinite(v));
  if (slaLine && Number.isFinite(slaLine.value)) allVals.push(slaLine.value);
  const maxVal = Math.max(...allVals, 1) * 1.12;
  const n = Math.max(series.length, 1);

  const xAt = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - (Math.max(0, v) / maxVal) * plotH;

  // Y gridlines (4 ticks)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => {
    const val = maxVal * frac;
    const y = yAt(val);
    const lbl = val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val >= 10 ? Math.round(val).toString() : val.toFixed(1);
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" class="svg-grid" />
      <text x="${padL - 8}" y="${(y + 3.5).toFixed(1)}" text-anchor="end" class="svg-tick">${esc(lbl)}</text>
    `;
  }).join('');

  // X labels (up to 6 evenly spaced)
  const step = Math.max(1, Math.floor((n - 1) / 5));
  const xTicks: string[] = [];
  for (let i = 0; i < n; i += step) {
    const x = xAt(i);
    xTicks.push(`<text x="${x.toFixed(1)}" y="${H - 10}" text-anchor="middle" class="svg-tick">${esc(series[i]?.timestamp || '')}</text>`);
  }
  if (n > 1 && (n - 1) % step !== 0) {
    xTicks.push(`<text x="${xAt(n - 1).toFixed(1)}" y="${H - 10}" text-anchor="end" class="svg-tick">${esc(series[n - 1]?.timestamp || '')}</text>`);
  }

  // Paths
  const paths = lines
    .map((line) => {
      if (line.values.length === 0) return '';
      const pts = line.values
        .slice(0, n)
        .map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
        .join(' ');
      const dash = line.dashed ? 'stroke-dasharray="5 4" opacity="0.78"' : '';
      return `<polyline fill="none" stroke="${line.color}" stroke-width="${line.dashed ? 1.6 : 2.1}" stroke-linejoin="round" stroke-linecap="round" ${dash} points="${pts}" />`;
    })
    .join('');

  const slaSvg =
    slaLine && slaLine.value > 0
      ? (() => {
          const y = yAt(slaLine.value);
          return `
            <line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="${slaLine.color}" stroke-width="1.3" stroke-dasharray="6 4" />
            <text x="${W - padR - 4}" y="${(y - 5).toFixed(1)}" text-anchor="end" fill="${slaLine.color}" font-size="10" font-weight="600">${esc(slaLine.label)}</text>
          `;
        })()
      : '';

  const legendHtml = lines
    .map(
      (l) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${l.color};${l.dashed ? 'opacity:0.75;border-bottom:2px dashed ' + l.color : ''}"></span>${esc(l.label)}</span>`
    )
    .join('');

  return `
    <div class="card chart-card">
      <div class="card-head">
        <div>
          <div class="card-title">${esc(title)}</div>
          <div class="card-sub">${esc(subtitle)} (${esc(yUnit)})</div>
        </div>
        <button type="button" class="btn-sm" onclick="copySvgChart('${esc(id)}', '${esc(title.replace(/[^a-z0-9]+/gi, '_'))}.png', this)">Copy PNG</button>
      </div>
      <div class="chart-wrap">
        <svg id="${esc(id)}" viewBox="0 0 ${W} ${H}" width="100%" height="auto" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${W}" height="${H}" class="svg-bg" rx="6" />
          ${yTicks}
          ${xTicks.join('')}
          ${slaSvg}
          ${paths}
        </svg>
        <div class="legend-row">${legendHtml}</div>
      </div>
    </div>
  `;
}

export function generateStaticHtmlString(opts: StaticHtmlExportOptions): string {
  const { run, baselineRun, vaultRuns = [], visibleSeries, scopeLabel, theme, aiSummary } = opts;
  const chronoVaultRuns = [...vaultRuns].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const trendSeriesPoints: TelemetryPoint[] = chronoVaultRuns.map((r) => {
    const m = r.name.match(/#([^\s]+)$/);
    const lbl = m ? `#${m[1]}` : r.id.replace(/^vault-[a-z]+-/i, '#');
    return {
      timestamp: lbl,
      isoTimestamp: r.startedAt,
      epochMs: Date.parse(r.startedAt),
      vus: r.summary.peakVUs,
      throughput: r.summary.avgThroughputRps,
      avg: Math.round(r.summary.p95ResponseTimeMs * 0.6),
      p90: Math.round(r.summary.p90ResponseTimeMs ?? r.summary.p95ResponseTimeMs * 0.85),
      p95: Math.round(r.summary.p95ResponseTimeMs),
      p99: Math.round(r.summary.p95ResponseTimeMs * 1.15),
      errorCount: r.summary.failedRequests,
      errorRate: r.summary.errorRatePct,
      phase: 'steady',
    };
  });
  const trendChartLatency =
    chronoVaultRuns.length >= 2
      ? buildSvgLineChart({
          id: 'chart-trend-latency',
          title: 'Multi-Run P95 & P90 Latency Trend',
          subtitle: `${chronoVaultRuns.length} Historical Builds`,
          series: trendSeriesPoints,
          yUnit: 'ms',
          slaLine: run.sla.rtEnabled !== false ? { value: run.sla.p95Ms, label: `SLA ${run.sla.p95Ms} ms`, color: '#EF4444' } : null,
          lines: [
            { label: 'P95 (ms)', color: '#F59E0B', values: trendSeriesPoints.map((p) => p.p95) },
            { label: 'P90 (ms)', color: '#06B6D4', values: trendSeriesPoints.map((p) => p.p90) },
          ],
        })
      : '';
  const trendChartTps =
    chronoVaultRuns.length >= 2
      ? buildSvgLineChart({
          id: 'chart-trend-tps',
          title: 'Multi-Run Throughput & Error Rate Trend',
          subtitle: `${chronoVaultRuns.length} Historical Builds`,
          series: trendSeriesPoints,
          yUnit: 'req/s / %',
          lines: [
            { label: 'Avg TPS (req/s)', color: '#06B6D4', values: trendSeriesPoints.map((p) => p.throughput) },
            { label: 'Error Rate (%)', color: '#EF4444', values: trendSeriesPoints.map((p) => p.errorRate) },
          ],
        })
      : '';
  const trendScenDriftRows = (() => {
    if (chronoVaultRuns.length < 2) return '';
    const latest = chronoVaultRuns[chronoVaultRuns.length - 1];
    const prev = chronoVaultRuns[chronoVaultRuns.length - 2];
    const builds = chronoVaultRuns.slice(-6);
    const names = [...new Set(builds.flatMap((r) => (r.scenarios || []).map((s) => s.scenario)))];
    return names
      .map((name) => {
        const curHit = (latest.scenarios || []).find((s) => s.scenario === name);
        const prevHit = (prev.scenarios || []).find((s) => s.scenario === name);
        if (!curHit) return '';
        const cells = builds
          .map((r) => {
            const h = (r.scenarios || []).find((s) => s.scenario === name);
            return `<td class="num">${h ? `${Math.round(h.p95).toLocaleString()} ms` : '—'}</td>`;
          })
          .join('');
        return `<tr><td class="mono-sm"><strong>${esc(name)}</strong></td>${cells}<td class="num">${fmtDeltaPill(curHit.p95, prevHit?.p95, true)}</td></tr>`;
      })
      .filter(Boolean)
      .join('');
  })();
  const summary = synthesizeExecutiveSummary(run, baselineRun, scopeLabel);
  const baseApdex = baselineRun ? computeFallbackApdex(baselineRun) : null;
  const apdexDelta = baseApdex ? Number((summary.apdex.score - baseApdex.score).toFixed(2)) : null;

  const displayParagraphs = aiSummary ? aiSummary.paragraphs : [summary.paragraph1, summary.paragraph2];
  const displayNextSteps =
    aiSummary && aiSummary.nextSteps.length > 0 ? aiSummary.nextSteps : summary.nextSteps;

  const baseEpMap = new Map<string, number>();
  if (baselineRun) {
    for (const ep of baselineRun.endpoints) {
      baseEpMap.set(`${ep.appName || ''}|${ep.scenario || ''}|${ep.endpoint}`, ep.p95);
      if (!baseEpMap.has(ep.endpoint)) baseEpMap.set(ep.endpoint, ep.p95);
    }
  }

  const baseScenMap = new Map<string, number>();
  if (baselineRun?.scenarios) {
    for (const sc of baselineRun.scenarios) {
      baseScenMap.set(`${sc.appName}|${sc.scenario}`, sc.p95);
      if (!baseScenMap.has(sc.scenario)) baseScenMap.set(sc.scenario, sc.p95);
    }
  }

  const rtEnabled = run.sla.rtEnabled !== false;
  const errEnabled = run.sla.errorEnabled !== false;

  const sortedEps = [...run.endpoints].sort((a, b) => b.p95 - a.p95);
  const top5Eps = sortedEps.slice(0, 5);
  const breachCount = run.endpoints.filter((ep) => {
    const p95B = ep.rtBreached !== undefined ? ep.rtBreached : rtEnabled && ep.p95 > ep.slaP95Ms;
    const errB =
      ep.errorBreached !== undefined
        ? ep.errorBreached
        : errEnabled && ep.errorPct > run.sla.errorRatePct;
    return p95B || errB;
  }).length;
  const totalErrors = run.httpErrors.reduce((acc, g) => acc + g.count, 0);

  // Build Charts
  const chartLoad = buildSvgLineChart({
    id: 'chart-load',
    title: 'Concurrency & Throughput',
    subtitle: 'Virtual Users & Requests/sec',
    series: visibleSeries,
    yUnit: 'VUs / req/s',
    lines: [
      { label: 'Active VUs', color: '#6366F1', values: visibleSeries.map((p) => p.vus) },
      { label: 'Throughput (req/s)', color: '#06B6D4', values: visibleSeries.map((p) => p.throughput) },
      ...(baselineRun && baselineRun.timeSeries.length > 0
        ? [
            {
              label: 'Baseline Throughput',
              color: '#94A3B8',
              dashed: true,
              values: baselineRun.timeSeries.slice(0, visibleSeries.length).map((p) => p.throughput),
            },
          ]
        : []),
    ],
  });

  const chartLatency = buildSvgLineChart({
    id: 'chart-latency',
    title: 'Response Time Latency',
    subtitle: 'P95, P90 & Average Response Time',
    series: visibleSeries,
    yUnit: 'ms',
    slaLine: rtEnabled ? { value: run.sla.p95Ms, label: `SLA ${run.sla.p95Ms} ms`, color: '#EF4444' } : null,
    lines: [
      { label: 'P95 (ms)', color: '#F59E0B', values: visibleSeries.map((p) => p.p95) },
      { label: 'P90 (ms)', color: '#06B6D4', values: visibleSeries.map((p) => p.p90) },
      { label: 'Avg (ms)', color: '#10B981', values: visibleSeries.map((p) => p.avg) },
      ...(baselineRun && baselineRun.timeSeries.length > 0
        ? [
            {
              label: 'Baseline P95',
              color: '#A5B4FC',
              dashed: true,
              values: baselineRun.timeSeries.slice(0, visibleSeries.length).map((p) => p.p95),
            },
          ]
        : []),
    ],
  });

  const verdictBadge =
    summary.overallStatus === 'PASS'
      ? '<span class="pill pill-pass">SLA PASS</span>'
      : summary.overallStatus === 'FAIL'
      ? '<span class="pill pill-fail">SLA FAIL</span>'
      : '<span class="pill pill-cyan">INFORMATIONAL</span>';

  const txRowsHtml = sortedEps
    .map((ep) => {
      const p95B = ep.rtBreached !== undefined ? ep.rtBreached : rtEnabled && ep.p95 > ep.slaP95Ms;
      const errB =
        ep.errorBreached !== undefined
          ? ep.errorBreached
          : errEnabled && ep.errorPct > run.sla.errorRatePct;
      const breached = p95B || errB;
      const baseP95 =
        baseEpMap.get(`${ep.appName || ''}|${ep.scenario || ''}|${ep.endpoint}`) ??
        baseEpMap.get(ep.endpoint);
      const statusHtml = !rtEnabled && !errEnabled
        ? '<span class="pill pill-neutral">INFO</span>'
        : breached
        ? '<span class="pill pill-fail">BREACH</span>'
        : '<span class="pill pill-pass">PASS</span>';
      return `
        <tr data-breach="${breached ? '1' : '0'}" data-search="${esc(`${ep.endpoint} ${ep.scenario || ''} ${ep.appName || ''}`).toLowerCase()}">
          <td class="mono-sm"><strong>${esc(ep.endpoint)}</strong>${ep.scenario ? `<div class="muted-xs">${esc(ep.scenario)}</div>` : ''}</td>
          <td class="num">${ep.samples.toLocaleString()}</td>
          <td class="num">${ep.avg.toFixed(0)}</td>
          <td class="num">${ep.p90.toFixed(0)}</td>
          <td class="num ${p95B ? 'text-fail' : ''}"><strong>${ep.p95.toFixed(0)}</strong></td>
          <td class="num">${ep.p99.toFixed(0)}</td>
          <td class="num muted">${ep.slaP95Ms.toLocaleString()}</td>
          <td class="num">${fmtDeltaPill(ep.p95, baseP95, true)}</td>
          <td class="num ${errB ? 'text-fail' : ''}">${ep.errorPct.toFixed(2)}%</td>
          <td class="num">${statusHtml}</td>
        </tr>
      `;
    })
    .join('');

  const scenRowsHtml = (run.scenarios || [])
    .map((sc) => {
      const baseP95 =
        baseScenMap.get(`${sc.appName}|${sc.scenario}`) ?? baseScenMap.get(sc.scenario);
      return `
        <tr>
          <td><strong>${esc(sc.scenario)}</strong><div class="muted-xs">${esc(sc.appName)}</div></td>
          <td class="num">${sc.samples.toLocaleString()}</td>
          <td class="num">${sc.throughput.toFixed(2)}</td>
          <td class="num">${sc.avg.toFixed(0)}</td>
          <td class="num">${sc.p90.toFixed(0)}</td>
          <td class="num"><strong>${sc.p95.toFixed(0)}</strong></td>
          <td class="num">${fmtDeltaPill(sc.p95, baseP95, true)}</td>
          <td class="num ${sc.errorPct > 0 ? 'text-fail' : ''}">${sc.errorPct.toFixed(2)}%</td>
          <td class="num"><span class="pill ${sc.passedLabels === sc.totalLabels ? 'pill-pass' : 'pill-warn'}">${sc.passedLabels} / ${sc.totalLabels}</span></td>
        </tr>
      `;
    })
    .join('');

  const baseAppMap = new Map<string, { p95: number; throughput: number }>();
  if (baselineRun?.apps) {
    for (const ba of baselineRun.apps) {
      baseAppMap.set(ba.appName, { p95: ba.p95, throughput: ba.throughput });
    }
  }

  const appRowsHtml = (run.apps || [])
    .map((a) => {
      const baseApp = baseAppMap.get(a.appName);
      const score = a.apdexScore ?? 0;
      const rating = a.apdexRating || 'N/A';
      const apdexHtml =
        a.apdexScore !== undefined
          ? `<span class="pill ${score >= 0.85 ? 'pill-pass' : score >= 0.7 ? 'pill-warn' : 'pill-fail'}">${score.toFixed(2)} (${esc(rating)})</span>`
          : '<span class="muted">—</span>';
      return `
      <tr>
        <td><strong>${esc(a.appName)}</strong></td>
        <td class="num">${a.peakVUs.toLocaleString()}</td>
        <td class="num">${a.samples.toLocaleString()}</td>
        <td class="num">${a.throughput.toFixed(2)}</td>
        <td class="num">${fmtDeltaPill(a.throughput, baseApp?.throughput, false)}</td>
        <td class="num">${a.avg.toFixed(0)}</td>
        <td class="num">${a.p90.toFixed(0)}</td>
        <td class="num"><strong>${a.p95.toFixed(0)}</strong></td>
        <td class="num">${fmtDeltaPill(a.p95, baseApp?.p95, true)}</td>
        <td class="num">${a.p99.toFixed(0)}</td>
        <td class="num ${a.errorPct > 0 ? 'text-fail' : ''}">${a.errorPct.toFixed(2)}%</td>
        <td class="num">${apdexHtml}</td>
      </tr>
    `;
    })
    .join('');

  const errCodeRowsHtml =
    run.httpErrors.length > 0
      ? run.httpErrors
          .map(
            (e) => `
        <tr>
          <td class="mono-sm"><strong>${esc(e.code)}</strong></td>
          <td>${esc(e.label)}</td>
          <td class="num">${e.count.toLocaleString()}</td>
          <td class="num">${e.percentage.toFixed(1)}%</td>
        </tr>
      `
          )
          .join('')
      : '<tr><td colspan="4" class="muted" style="text-align:center;padding:18px;">No HTTP errors recorded in this scope.</td></tr>';

  const errDetailRowsHtml =
    run.errorDetails && run.errorDetails.length > 0
      ? run.errorDetails
          .map(
            (d) => `
        <tr data-search="${esc(`${d.endpoint} ${d.scenario} ${d.responseCode} ${d.responseMessage} ${d.failureMessage} ${d.url}`).toLowerCase()}">
          <td class="mono-sm"><strong>${esc(d.endpoint)}</strong><div class="muted-xs">${esc(d.scenario)}</div></td>
          <td class="num"><span class="pill pill-fail">${esc(d.responseCode)}</span></td>
          <td class="mono-sm">${esc(d.failureMessage || d.responseMessage)}</td>
          <td class="mono-sm muted" style="word-break:break-all;max-width:280px;">${esc(d.url || '—')}</td>
          <td class="num"><strong>${d.count.toLocaleString()}</strong></td>
        </tr>
      `
          )
          .join('')
      : '<tr><td colspan="5" class="muted" style="text-align:center;padding:18px;">No detailed error diagnostics recorded.</td></tr>';

  const glossaryHtml = GLOSSARY_ENTRIES.map(
    (g) => `
      <div class="gloss-card" data-search="${esc(`${g.term} ${g.category} ${g.formula} ${g.interpretation}`).toLowerCase()}">
        <div class="gloss-top">
          <strong>${esc(g.term)}</strong>
          <span class="pill pill-cyan">${esc(g.category)}</span>
        </div>
        <div class="gloss-formula">${esc(g.formula)}</div>
        <p class="gloss-desc">${esc(g.interpretation)}</p>
      </div>
    `
  ).join('');

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Perf-Delta Report — ${esc(run.name)}</title>
  <style>
    :root {
      --bg: #0B0F19;
      --surface: #111827;
      --surface-2: #0F1625;
      --border: #1F2937;
      --text: #F9FAFB;
      --text-2: #D1D5DB;
      --muted: #9CA3AF;
      --cyan: #06B6D4;
      --cyan-hi: #22D3EE;
      --pass: #10B981;
      --warn: #F59E0B;
      --fail: #EF4444;
      --indigo: #6366F1;
      --grid: #1F2937;
    }
    html[data-theme="light"] {
      --bg: #F3F4F6;
      --surface: #FFFFFF;
      --surface-2: #F9FAFB;
      --border: #E5E7EB;
      --text: #111827;
      --text-2: #374151;
      --muted: #6B7280;
      --cyan: #0891B2;
      --cyan-hi: #0E7490;
      --grid: #E5E7EB;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 13px;
      line-height: 1.5;
    }
    .topbar {
      position: sticky; top: 0; z-index: 20;
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px;
      padding: 10px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; font-size: 12px; }
    .brand-icon { width: 24px; height: 24px; border-radius: 6px; background: rgba(6,182,212,.15); border: 1px solid rgba(6,182,212,.35); display: grid; place-items: center; color: var(--cyan); }
    .meta-line { font-size: 11px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 14px; }
    .meta-line strong { color: var(--text); font-weight: 600; }
    .layout {
      display: flex;
      min-height: calc(100vh - 49px);
    }
    .sidebar {
      width: 216px;
      flex-shrink: 0;
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: sticky;
      top: 49px;
      height: calc(100vh - 49px);
      padding: 12px 8px;
      transition: width 150ms ease;
    }
    .sidebar.collapsed { width: 58px; }
    .sidebar.collapsed .nav-label,
    .sidebar.collapsed .nav-badge,
    .sidebar.collapsed .nav-heading,
    .sidebar.collapsed .collapse-label { display: none; }
    .sidebar.collapsed .nav-btn { justify-content: center; padding: 8px; }
    .nav-heading {
      font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
      color: var(--muted); padding: 0 8px 8px;
    }
    .nav-list { display: flex; flex-direction: column; gap: 4px; }
    .nav-btn {
      width: 100%;
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      border: 1px solid transparent; background: transparent; color: var(--muted);
      padding: 8px 10px; border-radius: 6px; font-size: 12px; font-weight: 500;
      cursor: pointer; text-align: left; transition: background 120ms, color 120ms;
    }
    .nav-btn-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .nav-icon { font-size: 13px; width: 16px; text-align: center; flex-shrink: 0; }
    .nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .nav-btn:hover { color: var(--text); background: rgba(148,163,184,.10); }
    .nav-btn.active { color: var(--cyan-hi); background: rgba(6,182,212,.15); border-color: rgba(6,182,212,.35); font-weight: 600; }
    .nav-badge {
      font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums;
      padding: 1px 6px; border-radius: 4px; background: var(--surface-2); color: var(--muted);
      border: 1px solid var(--border); flex-shrink: 0;
    }
    .nav-badge.danger { background: rgba(239,68,68,.15); color: #FCA5A5; border-color: rgba(239,68,68,.35); }
    .nav-badge.cyan { background: rgba(6,182,212,.15); color: var(--cyan-hi); border-color: rgba(6,182,212,.35); }
    html[data-theme="light"] .nav-badge.danger { color: #B91C1C; }
    .sidebar-foot { border-top: 1px solid var(--border); padding-top: 8px; }
    .collapse-btn {
      width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;
      border: none; background: transparent; color: var(--muted);
      padding: 6px 8px; border-radius: 6px; font-size: 11px; cursor: pointer;
    }
    .collapse-btn:hover { background: rgba(148,163,184,.10); color: var(--text); }
    .container { flex: 1; min-width: 0; width: 100%; padding: 14px 24px 40px; }
    @media (max-width: 768px) {
      .layout { flex-direction: column; }
      .sidebar {
        position: static; width: 100% !important; height: auto;
        border-right: none; border-bottom: 1px solid var(--border);
        padding: 8px 12px;
      }
      .nav-heading, .sidebar-foot { display: none; }
      .nav-list { flex-direction: row; overflow-x: auto; }
      .nav-btn { width: auto; flex-shrink: 0; padding: 6px 10px; }
      .sidebar.collapsed .nav-label, .sidebar.collapsed .nav-badge { display: inline; }
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }
    .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
    .card-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
    .card-sub { font-size: 11px; color: var(--muted); }
    .card-body { padding: 14px; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; }
    .kpi-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
    .kpi-val { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 4px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .kpi-sub { font-size: 11px; color: var(--muted); margin-top: 4px; }
    .pill { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pill-pass { background: rgba(16,185,129,.16); color: #34D399; border: 1px solid rgba(16,185,129,.35); }
    .pill-fail { background: rgba(239,68,68,.16); color: #FCA5A5; border: 1px solid rgba(239,68,68,.35); }
    .pill-warn { background: rgba(245,158,11,.16); color: #FBBF24; border: 1px solid rgba(245,158,11,.35); }
    .pill-cyan { background: rgba(6,182,212,.15); color: var(--cyan-hi); border: 1px solid rgba(6,182,212,.35); }
    .pill-neutral { background: rgba(148,163,184,.14); color: var(--muted); border: 1px solid var(--border); }
    html[data-theme="light"] .pill-pass { color: #047857; }
    html[data-theme="light"] .pill-fail { color: #B91C1C; }
    html[data-theme="light"] .pill-warn { color: #B45309; }
    .exec-card { border-left: 4px solid var(--cyan); }
    .exec-card.status-pass { border-left-color: var(--pass); }
    .exec-card.status-fail { border-left-color: var(--fail); border-color: rgba(239,68,68,.45); }
    .exec-grid { display: grid; grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); gap: 14px; }
    @media (max-width: 1024px) { .exec-grid { grid-template-columns: 1fr; } }
    .exec-p { margin: 0 0 10px; color: var(--text-2); font-size: 12.5px; }
    .exec-bullets { margin: 4px 0 10px; padding-left: 18px; color: var(--text-2); font-size: 12.5px; }
    .exec-bullets li { margin-bottom: 5px; }
    .exec-sub-bullets { margin: 4px 0 6px; padding-left: 20px; list-style-type: circle; color: var(--muted); font-size: 11.5px; }
    .exec-sub-bullets li { margin-bottom: 3px; }
    .next-box { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 12px; }
    .next-box ul { margin: 8px 0 0; padding-left: 18px; color: var(--text-2); font-size: 12px; }
    .next-box li { margin-bottom: 6px; }
    .apdex-bar { display: flex; height: 8px; border-radius: 999px; overflow: hidden; background: var(--border); margin-top: 6px; }
    .chart-wrap { padding: 10px 14px 12px; }
    .svg-bg { fill: var(--surface-2); }
    .svg-grid { stroke: var(--grid); stroke-width: 1; }
    .svg-tick { fill: var(--muted); font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .legend-row { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; margin-top: 8px; font-size: 11px; color: var(--muted); }
    .legend-item { display: inline-flex; align-items: center; gap: 6px; }
    .legend-swatch { width: 12px; height: 3px; border-radius: 2px; display: inline-block; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px 10px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); background: var(--surface-2); border-bottom: 1px solid var(--border); cursor: pointer; user-select: none; white-space: nowrap; }
    td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
    tr:hover td { background: rgba(6,182,212,.04); }
    .num { text-align: right; font-variant-numeric: tabular-nums; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
    .mono-sm { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
    .muted { color: var(--muted); }
    .muted-xs { color: var(--muted); font-size: 10.5px; font-family: inherit; }
    .text-fail { color: var(--fail); }
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
    .input { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); border-radius: 6px; padding: 6px 10px; font-size: 12px; min-width: 220px; }
    .btn-sm { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-2); border-radius: 6px; padding: 5px 10px; font-size: 11px; font-weight: 600; cursor: pointer; }
    .btn-sm:hover { border-color: var(--cyan); color: var(--cyan-hi); }
    .gloss-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
    .gloss-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
    .gloss-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px; }
    .gloss-formula { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; color: var(--cyan-hi); background: var(--surface-2); border: 1px solid var(--border); padding: 4px 7px; border-radius: 4px; margin-bottom: 6px; word-break: break-word; }
    .gloss-desc { margin: 0; font-size: 11.5px; color: var(--text-2); }
    .footer { text-align: center; font-size: 11px; color: var(--muted); margin-top: 24px; }
  </style>
</head>
<body>
  <header class="topbar">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <span>Perf-Delta</span>
      </div>
      <div class="meta-line">
        <span>Run: <strong>${esc(run.name)}</strong></span>
        ${baselineRun ? `<span>Baseline: <strong>${esc(baselineRun.name)}</strong></span>` : ''}
        <span>Scope: <strong>${esc(scopeLabel)}</strong></span>
        <span>Duration: <strong>${run.durationMinutes} min</strong></span>
      </div>
    </div>
    <button type="button" class="btn-sm" id="themeBtn" onclick="toggleTheme()">☀ Light / 🌙 Dark</button>
  </header>

  <div class="layout">
    <aside class="sidebar" id="sidebar" aria-label="Report navigation">
      <div>
        <div class="nav-heading">Views</div>
        <div class="nav-list">
          <button class="nav-btn active" onclick="showTab('overview', this)" title="Overview">
            <span class="nav-btn-left"><span class="nav-icon">⊞</span><span class="nav-label">Overview</span></span>
          </button>
          <button class="nav-btn" onclick="showTab('applications', this)" title="Applications">
            <span class="nav-btn-left"><span class="nav-icon">⬡</span><span class="nav-label">Applications</span></span>
            <span class="nav-badge">${run.apps?.length ?? 0}</span>
          </button>
          <button class="nav-btn" onclick="showTab('scenarios', this)" title="Scenarios">
            <span class="nav-btn-left"><span class="nav-icon">◫</span><span class="nav-label">Scenarios</span></span>
            <span class="nav-badge">${run.scenarios?.length ?? 0}</span>
          </button>
          <button class="nav-btn" onclick="showTab('transactions', this)" title="Transactions">
            <span class="nav-btn-left"><span class="nav-icon">▤</span><span class="nav-label">Transactions</span></span>
            <span class="nav-badge ${breachCount > 0 ? 'danger' : ''}">${breachCount > 0 ? `${breachCount}!` : run.endpoints.length}</span>
          </button>
          <button class="nav-btn" onclick="showTab('compare', this)" title="${baselineRun ? 'Compare vs Base' : 'App Health'}">
            <span class="nav-btn-left"><span class="nav-icon">⇄</span><span class="nav-label">${baselineRun ? 'Compare vs Base' : 'App Health'}</span></span>
            ${baselineRun ? '<span class="nav-badge cyan">Δ</span>' : ''}
          </button>
          ${
            chronoVaultRuns.length >= 2
              ? `<button class="nav-btn" onclick="showTab('trends', this)" title="Historical Trends">
            <span class="nav-btn-left"><span class="nav-icon">📈</span><span class="nav-label">Trends</span></span>
            <span class="nav-badge cyan">${chronoVaultRuns.length}</span>
          </button>`
              : ''
          }
          <button class="nav-btn" onclick="showTab('errors', this)" title="Errors &amp; Diagnostics">
            <span class="nav-btn-left"><span class="nav-icon">⚠</span><span class="nav-label">Errors &amp; Diagnostics</span></span>
            <span class="nav-badge ${totalErrors > 0 ? 'danger' : ''}">${totalErrors.toLocaleString()}</span>
          </button>
          <button class="nav-btn" onclick="showTab('glossary', this)" title="Glossary">
            <span class="nav-btn-left"><span class="nav-icon">📖</span><span class="nav-label">Glossary</span></span>
          </button>
        </div>
      </div>
      <div class="sidebar-foot">
        <button type="button" class="collapse-btn" onclick="toggleSidebar()" title="Collapse / Expand sidebar">
          <span id="collapseIcon">⇤</span>
          <span class="collapse-label">Collapse Rail</span>
        </button>
      </div>
    </aside>

    <main class="container">
    <!-- OVERVIEW -->
    <section id="tab-overview" class="tab-panel active">
      <div class="card exec-card ${summary.overallStatus === 'PASS' ? 'status-pass' : summary.overallStatus === 'FAIL' ? 'status-fail' : ''}">
        <div class="card-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="card-title">Executive Summary &amp; Assessment</span>
            ${verdictBadge}
            <span class="pill ${summary.apdex.score >= 0.85 ? 'pill-pass' : summary.apdex.score >= 0.7 ? 'pill-warn' : 'pill-fail'}">
              Apdex ${summary.apdex.score.toFixed(2)} (${esc(summary.apdex.rating)})${apdexDelta !== null && apdexDelta !== 0 ? ` ${apdexDelta > 0 ? '+' : ''}${apdexDelta.toFixed(2)}` : ''}
            </span>
            ${aiSummary ? `<span class="pill pill-cyan">✨ ${esc(aiSummary.provider)}</span>` : ''}
          </div>
          <span class="card-sub">Generated ${esc(generatedAt)}</span>
        </div>
        <div class="card-body exec-grid">
          <div>
            ${(() => {
              const out: string[] = [];
              let bullets: { text: string; children: string[]; wasSub?: boolean }[] = [];
              const flush = () => {
                if (bullets.length === 0) return;
                out.push(
                  `<ul class="exec-bullets">${bullets
                    .map(
                      (b) =>
                        `<li>${renderBoldHtml(b.text)}${
                          b.children.length > 0
                            ? `<ul class="exec-sub-bullets">${b.children
                                .map((c) => `<li>${renderBoldHtml(c)}</li>`)
                                .join('')}</ul>`
                            : ''
                        }</li>`
                    )
                    .join('')}</ul>`
                );
                bullets = [];
              };
              for (const p of displayParagraphs) {
                if (/^\s{2,}[-*•]\s+/.test(p)) {
                  const subText = p.replace(/^\s+[-*•]\s+/, '').trim();
                  const parent = bullets.length > 0 ? bullets[bullets.length - 1] : null;
                  if (parent && !parent.wasSub) {
                    parent.children.push(subText);
                  } else {
                    bullets.push({ text: subText, children: [], wasSub: true });
                  }
                } else if (/^[-*•]\s+/.test(p)) {
                  bullets.push({ text: p.replace(/^[-*•]\s+/, '').trim(), children: [], wasSub: false });
                } else {
                  flush();
                  out.push(`<p class="exec-p">${renderBoldHtml(p)}</p>`);
                }
              }
              flush();
              return out.join('');
            })()}
            <div style="margin-top:12px;">
              <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted);">
                <strong>Apdex Distribution</strong>
                <span>Satisfied ${summary.apdex.satisfiedPct}% · Tolerating ${summary.apdex.toleratingPct}% · Frustrated ${summary.apdex.frustratedPct}%</span>
              </div>
              <div class="apdex-bar">
                <div style="width:${summary.apdex.satisfiedPct}%;background:#10B981;"></div>
                <div style="width:${summary.apdex.toleratingPct}%;background:#F59E0B;"></div>
                <div style="width:${summary.apdex.frustratedPct}%;background:#EF4444;"></div>
              </div>
            </div>
          </div>
          <div class="next-box">
            <div class="card-title">Next Steps</div>
            <ul>
              ${displayNextSteps.map((s) => `<li>${renderBoldHtml(s)}</li>`).join('')}
            </ul>
          </div>
        </div>
      </div>

      <div class="grid-4">
        <div class="kpi">
          <div class="kpi-label">Peak Virtual Users</div>
          <div class="kpi-val">${run.summary.peakVUs.toLocaleString()} ${fmtDeltaPill(run.summary.peakVUs, baselineRun?.summary.peakVUs, false)}</div>
          <div class="kpi-sub">Total Requests: ${run.summary.totalRequests.toLocaleString()}</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Avg Throughput</div>
          <div class="kpi-val">${run.summary.avgThroughputRps.toFixed(2)} <span style="font-size:12px;color:var(--muted);">req/s</span> ${fmtDeltaPill(run.summary.avgThroughputRps, baselineRun?.summary.avgThroughputRps, false)}</div>
          <div class="kpi-sub">Duration: ${run.durationMinutes} min</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">P95 Response Time</div>
          <div class="kpi-val">${run.summary.p95ResponseTimeMs.toLocaleString()} <span style="font-size:12px;color:var(--muted);">ms</span> ${fmtDeltaPill(run.summary.p95ResponseTimeMs, baselineRun?.summary.p95ResponseTimeMs, true)}</div>
          <div class="kpi-sub">SLA Target: ${run.sla.p95Ms.toLocaleString()} ms (${breachCount} breaches)</div>
        </div>
        <div class="kpi">
          <div class="kpi-label">Error Rate</div>
          <div class="kpi-val ${run.summary.errorRatePct > 0 ? 'text-fail' : ''}">${run.summary.errorRatePct.toFixed(2)}% ${fmtDeltaPill(run.summary.errorRatePct, baselineRun?.summary.errorRatePct, true)}</div>
          <div class="kpi-sub">Failed Requests: ${run.summary.failedRequests.toLocaleString()}</div>
        </div>
      </div>

      <div class="grid-2">
        ${chartLoad}
        ${chartLatency}
      </div>

      <div class="card">
        <div class="card-head">
          <span class="card-title">Top 5 Slowest Transactions (P95)</span>
          <span class="card-sub">${run.endpoints.length} total transactions in scope</span>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr><th>Transaction</th><th class="num">Samples</th><th class="num">P95 (ms)</th><th class="num">SLA (ms)</th><th class="num">Err %</th></tr>
            </thead>
            <tbody>
              ${top5Eps
                .map(
                  (ep) => `
                <tr>
                  <td class="mono-sm"><strong>${esc(ep.endpoint)}</strong></td>
                  <td class="num">${ep.samples.toLocaleString()}</td>
                  <td class="num"><strong>${ep.p95.toFixed(0)}</strong></td>
                  <td class="num muted">${ep.slaP95Ms.toLocaleString()}</td>
                  <td class="num ${ep.errorPct > 0 ? 'text-fail' : ''}">${ep.errorPct.toFixed(2)}%</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- APPLICATIONS -->
    <section id="tab-applications" class="tab-panel">
      <div class="card">
        <div class="card-head">
          <span class="card-title">Application Performance Breakdown</span>
          <span class="card-sub">${run.apps?.length ?? 0} application(s)</span>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Application</th><th class="num">Peak VUs</th><th class="num">Samples</th>
                <th class="num">TPS</th><th class="num">TPS Δ</th>
                <th class="num">Avg</th><th class="num">P90</th><th class="num">P95</th>
                <th class="num">P95 Δ</th><th class="num">P99</th>
                <th class="num">Err %</th><th class="num">Apdex</th>
              </tr>
            </thead>
            <tbody>${appRowsHtml || '<tr><td colspan="12" class="muted" style="text-align:center;padding:18px;">No application breakdown available.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- TRANSACTIONS -->
    <section id="tab-transactions" class="tab-panel">
      <div class="card">
        <div class="toolbar">
          <input type="search" id="txSearch" class="input" placeholder="Search transactions, scenarios, or apps..." oninput="filterTxTable()" />
          <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);cursor:pointer;">
            <input type="checkbox" id="txBreachOnly" onchange="filterTxTable()" />
            SLA Breaches Only (${breachCount})
          </label>
        </div>
        <div style="overflow-x:auto;">
          <table id="txTable">
            <thead>
              <tr>
                <th onclick="sortTable('txTable', 0, false)">Transaction / Scenario</th>
                <th class="num" onclick="sortTable('txTable', 1, true)">Samples</th>
                <th class="num" onclick="sortTable('txTable', 2, true)">Avg</th>
                <th class="num" onclick="sortTable('txTable', 3, true)">P90</th>
                <th class="num" onclick="sortTable('txTable', 4, true)">P95</th>
                <th class="num" onclick="sortTable('txTable', 5, true)">P99</th>
                <th class="num" onclick="sortTable('txTable', 6, true)">SLA</th>
                <th class="num">vs Base P95</th>
                <th class="num" onclick="sortTable('txTable', 8, true)">Err %</th>
                <th class="num">Status</th>
              </tr>
            </thead>
            <tbody>${txRowsHtml}</tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- SCENARIOS -->
    <section id="tab-scenarios" class="tab-panel">
      <div class="card">
        <div class="card-head"><span class="card-title">Scenario Breakdown</span></div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Scenario</th><th class="num">Samples</th><th class="num">TPS</th>
                <th class="num">Avg</th><th class="num">P90</th><th class="num">P95</th>
                <th class="num">vs Base P95</th><th class="num">Err %</th><th class="num">RT SLA</th>
              </tr>
            </thead>
            <tbody>${scenRowsHtml || '<tr><td colspan="9" class="muted" style="text-align:center;padding:18px;">No scenarios recorded.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- COMPARE / APP HEALTH -->
    <section id="tab-compare" class="tab-panel">
      ${
        baselineRun
          ? `
      <div class="card">
        <div class="card-head"><span class="card-title">Current vs Baseline Scorecard</span></div>
        <div style="overflow-x:auto;">
          <table>
            <thead><tr><th>Metric</th><th class="num">Baseline</th><th class="num">Current</th><th class="num">Delta</th></tr></thead>
            <tbody>
              <tr><td>Peak Virtual Users</td><td class="num">${baselineRun.summary.peakVUs}</td><td class="num"><strong>${run.summary.peakVUs}</strong></td><td class="num">${fmtDeltaPill(run.summary.peakVUs, baselineRun.summary.peakVUs, false)}</td></tr>
              <tr><td>Avg Throughput (req/s)</td><td class="num">${baselineRun.summary.avgThroughputRps.toFixed(2)}</td><td class="num"><strong>${run.summary.avgThroughputRps.toFixed(2)}</strong></td><td class="num">${fmtDeltaPill(run.summary.avgThroughputRps, baselineRun.summary.avgThroughputRps, false)}</td></tr>
              <tr><td>P95 Response Time (ms)</td><td class="num">${baselineRun.summary.p95ResponseTimeMs}</td><td class="num"><strong>${run.summary.p95ResponseTimeMs}</strong></td><td class="num">${fmtDeltaPill(run.summary.p95ResponseTimeMs, baselineRun.summary.p95ResponseTimeMs, true)}</td></tr>
              <tr><td>Error Rate (%)</td><td class="num">${baselineRun.summary.errorRatePct.toFixed(2)}%</td><td class="num"><strong>${run.summary.errorRatePct.toFixed(2)}%</strong></td><td class="num">${fmtDeltaPill(run.summary.errorRatePct, baselineRun.summary.errorRatePct, true)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>`
          : ''
      }
      <div class="card">
        <div class="card-head"><span class="card-title">Application Health Matrix</span></div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Application</th><th class="num">Peak VUs</th><th class="num">Samples</th>
                <th class="num">TPS</th><th class="num">TPS Δ</th>
                <th class="num">Avg</th><th class="num">P90</th><th class="num">P95</th>
                <th class="num">P95 Δ</th><th class="num">P99</th>
                <th class="num">Err %</th><th class="num">Apdex</th>
              </tr>
            </thead>
            <tbody>${appRowsHtml || '<tr><td colspan="12" class="muted" style="text-align:center;padding:18px;">No application breakdown available.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </section>

    ${
      chronoVaultRuns.length >= 2
        ? `<!-- TRENDS -->
    <section id="tab-trends" class="tab-panel">
      <div class="grid-2">
        ${trendChartLatency}
        ${trendChartTps}
      </div>
      <div class="card">
        <div class="card-head">
          <span class="card-title">Scenario P95 Build-over-Build Drift</span>
          <span class="card-sub">${chronoVaultRuns.length} historical builds</span>
        </div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Scenario</th>
                ${chronoVaultRuns
                  .slice(-6)
                  .map((r) => {
                    const m = r.name.match(/#([^\s]+)$/);
                    return `<th class="num">${esc(m ? `#${m[1]}` : r.id)} P95</th>`;
                  })
                  .join('')}
                <th class="num">vs Prev</th>
              </tr>
            </thead>
            <tbody>${trendScenDriftRows || '<tr><td colspan="8" class="muted" style="text-align:center;padding:18px;">No scenario trend data.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </section>`
        : ''
    }

    <!-- ERRORS -->
    <section id="tab-errors" class="tab-panel">
      <div class="card">
        <div class="card-head"><span class="card-title">HTTP Error Distribution</span></div>
        <div style="overflow-x:auto;">
          <table>
            <thead><tr><th>Code</th><th>Message</th><th class="num">Count</th><th class="num">Share</th></tr></thead>
            <tbody>${errCodeRowsHtml}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="toolbar">
          <span class="card-title">Detailed Error &amp; URL Drilldown</span>
          <input type="search" id="errSearch" class="input" placeholder="Filter by endpoint, code, URL, or message..." oninput="filterErrTable()" />
        </div>
        <div style="overflow-x:auto;">
          <table id="errTable">
            <thead><tr><th>Transaction</th><th class="num">Code</th><th>Failure Message</th><th>URL</th><th class="num">Count</th></tr></thead>
            <tbody>${errDetailRowsHtml}</tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- GLOSSARY -->
    <section id="tab-glossary" class="tab-panel">
      <div class="card">
        <div class="toolbar">
          <span class="card-title">Performance Testing Glossary</span>
          <input type="search" id="glossSearch" class="input" placeholder="Search terms or formulas..." oninput="filterGlossary()" />
        </div>
        <div class="card-body gloss-grid" id="glossGrid">${glossaryHtml}</div>
      </div>
    </section>

    <div class="footer">Exported offline from Perf-Delta Live Dashboard · ${esc(generatedAt)}</div>
  </main>
  </div>

  <script>
    function showTab(id, btn) {
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      var el = document.getElementById('tab-' + id);
      if (el) el.classList.add('active');
      if (btn) btn.classList.add('active');
    }
    function toggleSidebar() {
      var sb = document.getElementById('sidebar');
      var icon = document.getElementById('collapseIcon');
      if (!sb) return;
      var collapsed = sb.classList.toggle('collapsed');
      if (icon) icon.textContent = collapsed ? '⇥' : '⇤';
    }
    function toggleTheme() {
      var cur = document.documentElement.getAttribute('data-theme') || 'dark';
      document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
    }
    function filterTxTable() {
      var q = (document.getElementById('txSearch').value || '').toLowerCase();
      var breachOnly = document.getElementById('txBreachOnly').checked;
      document.querySelectorAll('#txTable tbody tr').forEach(tr => {
        var matchQ = !q || (tr.dataset.search || '').includes(q);
        var matchB = !breachOnly || tr.dataset.breach === '1';
        tr.style.display = (matchQ && matchB) ? '' : 'none';
      });
    }
    function filterErrTable() {
      var q = (document.getElementById('errSearch').value || '').toLowerCase();
      document.querySelectorAll('#errTable tbody tr').forEach(tr => {
        tr.style.display = (!q || (tr.dataset.search || '').includes(q)) ? '' : 'none';
      });
    }
    function filterGlossary() {
      var q = (document.getElementById('glossSearch').value || '').toLowerCase();
      document.querySelectorAll('#glossGrid .gloss-card').forEach(c => {
        c.style.display = (!q || (c.dataset.search || '').includes(q)) ? '' : 'none';
      });
    }
    var sortState = {};
    function sortTable(tableId, colIdx, isNum) {
      var tbody = document.querySelector('#' + tableId + ' tbody');
      var rows = Array.from(tbody.querySelectorAll('tr'));
      var key = tableId + ':' + colIdx;
      var asc = !sortState[key];
      sortState[key] = asc;
      rows.sort(function(a, b) {
        var av = (a.children[colIdx]?.textContent || '').trim();
        var bv = (b.children[colIdx]?.textContent || '').trim();
        if (isNum) {
          var an = parseFloat(av.replace(/[^0-9.-]/g, '')) || 0;
          var bn = parseFloat(bv.replace(/[^0-9.-]/g, '')) || 0;
          return asc ? an - bn : bn - an;
        }
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      rows.forEach(r => tbody.appendChild(r));
    }
    function copySvgChart(svgId, filename, btn) {
      var svg = document.getElementById(svgId);
      if (!svg) return;
      var clone = svg.cloneNode(true);
      var style = getComputedStyle(document.documentElement);
      var bg = style.getPropertyValue('--surface-2').trim() || '#0F1625';
      clone.querySelectorAll('.svg-bg').forEach(el => el.setAttribute('fill', bg));
      clone.querySelectorAll('.svg-grid').forEach(el => el.setAttribute('stroke', style.getPropertyValue('--grid').trim() || '#1F2937'));
      clone.querySelectorAll('.svg-tick').forEach(el => el.setAttribute('fill', style.getPropertyValue('--muted').trim() || '#9CA3AF'));
      var xml = new XMLSerializer().serializeToString(clone);
      var blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        canvas.width = 1440; canvas.height = 500;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function(png) {
          if (!png) return;
          if (navigator.clipboard && window.ClipboardItem) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(function() {
              var old = btn.textContent; btn.textContent = 'Copied!';
              setTimeout(() => btn.textContent = old, 1500);
            }).catch(function() { triggerPngDownload(png, filename); });
          } else {
            triggerPngDownload(png, filename);
          }
        });
      };
      img.src = url;
    }
    function triggerPngDownload(blob, filename) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }
  </script>
</body>
</html>`;
}

export function exportStaticHtmlReport(opts: StaticHtmlExportOptions): string {
  const html = generateStaticHtmlString(opts);
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 13);
  const cleanId = (id: string) => id.replace(/^vault-[a-z]+-/i, '').replace(/[^a-z0-9_-]+/gi, '_');
  const basePart = opts.baselineRun ? `${cleanId(opts.baselineRun.id)}_vs_` : '';
  const filename = `Perf-Delta_Report_${basePart}${cleanId(opts.run.id)}_${ts}.html`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}
