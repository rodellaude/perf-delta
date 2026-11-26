/**
 * Performance Testing Glossary (`dashboard-ui/src/components/GlossaryView.tsx`)
 *
 * Searchable, category-filtered reference of 20 core performance metrics, SQL formulas,
 * and SLA/Apdex definitions. Also exports `GLOSSARY_ENTRIES` for reuse in `staticHtmlExport.ts`.
 */
import React, { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';

export interface GlossaryEntry {
  catId: 'LOAD' | 'LATENCY' | 'SLA' | 'DELTA';
  category: string;
  term: string;
  formula: string;
  interpretation: string;
}

export const GLOSSARY_ENTRIES: GlossaryEntry[] = [
  // LOAD
  {
    catId: 'LOAD',
    category: 'Load & Throughput',
    term: 'Max Virtual Users (VU)',
    formula: "SUM(GREATEST(MAX(allThreads), COUNT(DISTINCT CONCAT(thread_group, '|', threadName))))",
    interpretation:
      'Peak concurrent simulated users across all application test plans. In multi-JMX/multi-CSV distributed architectures, active threads are summed across distinct thread pools to determine true simultaneous load without thread index collisions.',
  },
  {
    catId: 'LOAD',
    category: 'Load & Throughput',
    term: 'Workload Phases (Ramp-up, Steady State, Ramp-down)',
    formula: 'Telemetry thread boundary analysis across application workloads',
    interpretation:
      'Partitions test execution into distinct phases: Ramp-up (virtual user climb), Steady State (sustained target concurrency), and Ramp-down (cooldown). Automatically derived from concurrency telemetry to evaluate steady-state performance.',
  },
  {
    catId: 'LOAD',
    category: 'Load & Throughput',
    term: 'Throughput (TPS / req/s) & Steady-State TPS',
    formula: 'Successful Transactions / Duration (secs)',
    interpretation:
      'Rate of successful requests processed per second. Full-run TPS averages across the entire test window, while Steady-State TPS isolates sustained capacity during peak load, eliminating dilution from warmup or ramp-down.',
  },
  {
    catId: 'LOAD',
    category: 'Load & Throughput',
    term: 'Total Requests / Transactions',
    formula: 'COUNT(*) across the test window',
    interpretation:
      'Total volume of transaction samples executed during the run (including both passed and failed requests). Used to verify test workload volume against baseline.',
  },
  {
    catId: 'LOAD',
    category: 'Load & Throughput',
    term: 'Load Burden (%) & System Processing Time',
    formula: '(SUM(elapsed) / Total Run Elapsed) * 100',
    interpretation:
      'Measures cumulative server execution time consumed by a transaction across all its executions. Highlights high-volume moderate-latency transactions that consume the bulk of CPU, thread pool, and database capacity even when individual latencies pass SLA.',
  },

  // LATENCY
  {
    catId: 'LATENCY',
    category: 'Response Time & Percentiles',
    term: 'P95 / P90 Response Time (ms)',
    formula: 'QUANTILE_CONT(elapsed, 0.95) / QUANTILE_CONT(elapsed, 0.90)',
    interpretation:
      'The 95th (or 90th) percentile transaction response time in milliseconds. 95% of executed requests completed at or below this latency, isolating typical user experience from extreme single-request outliers.',
  },
  {
    catId: 'LATENCY',
    category: 'Response Time & Percentiles',
    term: 'Steady-State Response Time (ms)',
    formula: 'QUANTILE_CONT(elapsed, 0.95) during steady state',
    interpretation:
      'Percentile response time evaluated strictly within the sustained steady-state window. Prevents low-load warmup or ramp-up periods from artificially lowering perceived latency under load.',
  },
  {
    catId: 'LATENCY',
    category: 'Response Time & Percentiles',
    term: 'SLA Threshold & Tolerance Band',
    formula: 'Threshold * (1 + Tolerance % / 100)',
    interpretation:
      'Maximum acceptable response time configured per transaction (or default fallback) in SLA/performance-sla.yaml. A transaction passes if its actual percentile RT stays within the threshold plus any configured tolerance band.',
  },
  {
    catId: 'LATENCY',
    category: 'Response Time & Percentiles',
    term: 'Apdex (Application Performance Index)',
    formula: '(Satisfied + 0.5 * Tolerating) / Total Samples',
    interpretation:
      'Open international standard (0.00 to 1.00) measuring end-user satisfaction. Each transaction is judged against its specific target threshold (T): Satisfied (elapsed <= T), Tolerating (T < elapsed <= 4T), Frustrated (elapsed > 4T or HTTP Error). Industry ratings: >= 0.94 Excellent, >= 0.85 Good, >= 0.70 Fair, >= 0.50 Poor, < 0.50 Unacceptable.',
  },
  {
    catId: 'LATENCY',
    category: 'Response Time & Percentiles',
    term: 'Variance / Impact vs SLA (▲ +X%)',
    formula: '((Actual RT - SLA Threshold) / SLA Threshold) * 100',
    interpretation:
      'Percentage by which a transaction exceeded (▲ +X% breach) or remained below (▼ -X% headroom) its configured Response Time SLA threshold.',
  },

  // SLA
  {
    catId: 'SLA',
    category: 'SLA & Evaluation Rules',
    term: 'Overall Status (PASS / FAIL)',
    formula: 'VU Pass AND App TPS Pass AND Scenario RT Pass AND Scenario Error Pass',
    interpretation:
      'Top-level executive release gate. Evaluates to PASS only when all enabled SLA dimensions pass across all tested applications and scenarios.',
  },
  {
    catId: 'SLA',
    category: 'SLA & Evaluation Rules',
    term: 'Scenario (Logical Scenario / Thread Group)',
    formula: "TRIM(REGEXP_REPLACE(thread_group, '\\s+\\d+-\\d+$', ''))",
    interpretation:
      'A business user journey or flow group aggregated across load generators. Strips thread instance suffixes so distributed virtual users collapse into one logical scenario.',
  },
  {
    catId: 'SLA',
    category: 'SLA & Evaluation Rules',
    term: 'Transactions Met RT SLA (X / Y)',
    formula: 'Passed Transactions / Total Distinct Transactions in Scenario',
    interpretation:
      'Proportion of distinct transaction steps within a Scenario or Application whose percentile response time satisfied the SLA threshold.',
  },
  {
    catId: 'SLA',
    category: 'SLA & Evaluation Rules',
    term: 'TPS / Error / RT SLA Pass Rate (%)',
    formula: '(Passed Entities / Total Entities) * 100',
    interpretation:
      'Scorecard pass rates measuring the percentage of Applications (for TPS), Scenarios (for Error Rate), and Transactions (for Response Time) that met SLA.',
  },
  {
    catId: 'SLA',
    category: 'SLA & Evaluation Rules',
    term: 'Label Exclusions & Parallel Controller Filtering',
    formula: "label NOT IN (label_exclusions) AND label NOT LIKE '%bzm - Parallel Controller%'",
    interpretation:
      'Automatic pre-filtering of synthetic pacing timers (e.g. c_Thinktime, dw_pacing), debug samplers, and BlazeMeter Parallel Controller containers so statistics and error counts reflect real user transactions only.',
  },

  // DELTA
  {
    catId: 'DELTA',
    category: 'Baseline & Error Analysis',
    term: 'Baseline Delta (▲ / ▼ %)',
    formula: '((Current - Baseline) / Baseline) * 100',
    interpretation:
      'Relative percentage change compared to the Baseline Run. Color-coded by metric polarity: emerald when performance improved (higher TPS, or lower Response Time / Error Rate) and crimson when degraded.',
  },
  {
    catId: 'DELTA',
    category: 'Baseline & Error Analysis',
    term: 'Error Rate (%)',
    formula: '(Failed Transactions / Total Transactions) * 100',
    interpretation:
      'Percentage of transactions that returned non-success status or HTTP errors. Evaluated against the configured Application Error Rate SLA threshold.',
  },
  {
    catId: 'DELTA',
    category: 'Baseline & Error Analysis',
    term: 'Error Pareto & Share (%)',
    formula: '(Transaction Errors / Total Run Errors) * 100',
    interpretation:
      'Ranks failing HTTP status codes and transactions from highest to lowest error count to isolate the top root-cause contributors.',
  },
  {
    catId: 'DELTA',
    category: 'Baseline & Error Analysis',
    term: 'HTTP Code, URL & Failure Message',
    formula: 'Grouped by responseCode, URL, responseMessage, failureMessage',
    interpretation:
      'Granular failure breakdown inside Errors & Diagnostics showing exact HTTP status codes (e.g., HTTP 500, HTTP 502, Non-HTTP timeout), failing request URLs, and assertion failure details.',
  },
  {
    catId: 'DELTA',
    category: 'Baseline & Error Analysis',
    term: 'Canonical JMeter Schema & Pre-Aggregated Vault',
    formula: 'performance_history + agg_* summary tables in DuckDB',
    interpretation:
      'Unified schema standardizing external tool results (JMeter, NeoLoad) into canonical columns with pre-aggregated summary tables created at registration for sub-second dashboard queries.',
  },
];

const CATEGORIES: { id: 'ALL' | 'LOAD' | 'LATENCY' | 'SLA' | 'DELTA'; label: string }[] = [
  { id: 'ALL', label: 'All Terms (20)' },
  { id: 'LOAD', label: 'Load & Throughput' },
  { id: 'LATENCY', label: 'Response Time & Percentiles' },
  { id: 'SLA', label: 'SLA & Evaluation Rules' },
  { id: 'DELTA', label: 'Baseline & Error Analysis' },
];

export const GlossaryView: React.FC = () => {
  const [category, setCategory] = useState<'ALL' | 'LOAD' | 'LATENCY' | 'SLA' | 'DELTA'>('ALL');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GLOSSARY_ENTRIES.filter((item) => {
      const catOk = category === 'ALL' || item.catId === category;
      if (!catOk) return false;
      if (!q) return true;
      return (
        item.term.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.formula.toLowerCase().includes(q) ||
        item.interpretation.toLowerCase().includes(q)
      );
    });
  }, [category, search]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-md border border-[#1F2937] bg-[#111827] p-0.5 text-xs">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`rounded px-2.5 py-1 font-medium transition-colors ${
                category === c.id
                  ? 'bg-[#06B6D4]/20 text-[#22D3EE]'
                  : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search glossary terms..."
            className="w-60 rounded-md border border-[#1F2937] bg-[#111827] py-1 pl-8 pr-2.5 text-xs text-[#F9FAFB] placeholder-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
          />
        </div>
      </div>

      <div className="rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2.5">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
            <BookOpen className="h-3.5 w-3.5 text-[#06B6D4]" />
            Performance Engineering Glossary &amp; Methodology
          </h3>
          <span className="metric-num text-[11px] text-[#9CA3AF]">
            {filtered.length} of {GLOSSARY_ENTRIES.length} terms
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                <th className="px-3.5 py-2 w-[22%]">Term / Metric</th>
                <th className="px-3.5 py-2 w-[16%]">Category</th>
                <th className="px-3.5 py-2 w-[24%]">Formula / Derivation</th>
                <th className="px-3.5 py-2 w-[38%]">Engineering Interpretation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1F2937]/70">
              {filtered.map((item) => (
                <tr key={item.term} className="hover:bg-[#1F2937]/40">
                  <td className="px-3.5 py-2.5 align-top font-semibold text-[#F9FAFB]">
                    {item.term}
                  </td>
                  <td className="px-3.5 py-2.5 align-top">
                    <span className="inline-block rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-0.5 text-[10px] font-medium text-[#22D3EE]">
                      {item.category}
                    </span>
                  </td>
                  <td className="metric-num px-3.5 py-2.5 align-top text-[11px] text-[#A5B4FC] break-words">
                    {item.formula}
                  </td>
                  <td className="px-3.5 py-2.5 align-top leading-relaxed text-[#D1D5DB]">
                    {item.interpretation}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-xs text-[#9CA3AF]">
                    No glossary terms match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
