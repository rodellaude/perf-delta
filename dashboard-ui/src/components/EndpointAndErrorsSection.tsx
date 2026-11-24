import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Columns2,
  Filter,
  Search,
  ShieldAlert,
  Table2,
} from 'lucide-react';
import {
  AssertionFailure,
  EndpointMetric,
  HttpErrorGroup,
} from '../types/performance';

interface EndpointAndErrorsSectionProps {
  endpoints: EndpointMetric[];
  httpErrors: HttpErrorGroup[];
  assertionFailures: AssertionFailure[];
  errorRateSlaPct: number;
}

type SortKey = keyof Pick<
  EndpointMetric,
  'endpoint' | 'samples' | 'avg' | 'p90' | 'p95' | 'p99' | 'max' | 'throughput' | 'errorPct'
>;

type ViewMode = 'split' | 'endpoints' | 'errors';

export const EndpointAndErrorsSection: React.FC<EndpointAndErrorsSectionProps> = ({
  endpoints,
  httpErrors,
  assertionFailures,
  errorRateSlaPct,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [search, setSearch] = useState('');
  const [onlyBreaches, setOnlyBreaches] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('p95');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'endpoint' ? 'asc' : 'desc');
    }
  };

  const filteredEndpoints = useMemo(() => {
    return endpoints
      .filter((ep) => {
        const matchesSearch = ep.endpoint
          .toLowerCase()
          .includes(search.trim().toLowerCase());
        const breached = ep.p95 > ep.slaP95Ms || ep.errorPct > errorRateSlaPct;
        return matchesSearch && (!onlyBreaches || breached);
      })
      .sort((a, b) => {
        const valA = a[sortKey];
        const valB = b[sortKey];
        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDir === 'asc'
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }
        return sortDir === 'asc'
          ? Number(valA) - Number(valB)
          : Number(valB) - Number(valA);
      });
  }, [endpoints, search, onlyBreaches, sortKey, sortDir, errorRateSlaPct]);

  const breachCount = useMemo(
    () =>
      endpoints.filter(
        (ep) => ep.p95 > ep.slaP95Ms || ep.errorPct > errorRateSlaPct
      ).length,
    [endpoints, errorRateSlaPct]
  );

  const totalErrorCount = useMemo(
    () => httpErrors.reduce((acc, g) => acc + g.count, 0),
    [httpErrors]
  );

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3 w-3 text-[#4B5563]" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-[#06B6D4]" />
    ) : (
      <ArrowDown className="h-3 w-3 text-[#06B6D4]" />
    );
  };

  const columns: { key: SortKey; label: string; align: 'left' | 'right' }[] = [
    { key: 'endpoint', label: 'Endpoint / Transaction', align: 'left' },
    { key: 'samples', label: 'Samples', align: 'right' },
    { key: 'avg', label: 'Avg (ms)', align: 'right' },
    { key: 'p90', label: 'P90 (ms)', align: 'right' },
    { key: 'p95', label: 'P95 (ms)', align: 'right' },
    { key: 'p99', label: 'P99 (ms)', align: 'right' },
    { key: 'max', label: 'Max (ms)', align: 'right' },
    { key: 'throughput', label: 'RPS', align: 'right' },
    { key: 'errorPct', label: 'Error %', align: 'right' },
  ];

  return (
    <section className="space-y-3">
      {/* Toolbar: View Mode Tabs (Split / Endpoints / Errors) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center rounded-md border border-[#1F2937] bg-[#111827] p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
              viewMode === 'split'
                ? 'bg-[#1F2937] text-[#F9FAFB]'
                : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
            }`}
          >
            <Columns2 className="h-3.5 w-3.5" />
            Split View
          </button>
          <button
            type="button"
            onClick={() => setViewMode('endpoints')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
              viewMode === 'endpoints'
                ? 'bg-[#1F2937] text-[#F9FAFB]'
                : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
            }`}
          >
            <Table2 className="h-3.5 w-3.5" />
            Transactions ({endpoints.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('errors')}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 font-medium transition-colors ${
              viewMode === 'errors'
                ? 'bg-[#1F2937] text-[#F9FAFB]'
                : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
            }`}
          >
            <AlertOctagon className="h-3.5 w-3.5" />
            Error Analysis ({totalErrorCount.toLocaleString()})
          </button>
        </div>

        {/* Search & SLA Breach Filter */}
        {viewMode !== 'errors' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter endpoint..."
                className="w-52 rounded-md border border-[#1F2937] bg-[#111827] py-1 pl-8 pr-2.5 text-xs text-[#F9FAFB] placeholder-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setOnlyBreaches((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                onlyBreaches
                  ? 'border-[#EF4444]/50 bg-[#EF4444]/15 text-[#EF4444]'
                  : 'border-[#1F2937] bg-[#111827] text-[#9CA3AF] hover:text-[#F9FAFB]'
              }`}
            >
              <Filter className="h-3 w-3" />
              SLA Breaches ({breachCount})
            </button>
          </div>
        )}
      </div>

      {/* Main Content Grid */}
      <div
        className={`grid grid-cols-1 gap-3 ${
          viewMode === 'split' ? 'xl:grid-cols-12' : ''
        }`}
      >
        {/* Transaction Breakdown Table */}
        {viewMode !== 'errors' && (
          <div
            className={`rounded-lg border border-[#1F2937] bg-[#111827] overflow-hidden ${
              viewMode === 'split' ? 'xl:col-span-8' : ''
            }`}
          >
            <div className="flex items-center justify-between border-b border-[#1F2937] px-3.5 py-2.5">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                Transaction Breakdown
              </h3>
              <span className="metric-num text-[11px] text-[#9CA3AF]">
                Showing {filteredEndpoints.length} of {endpoints.length} endpoints
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[#1F2937] bg-[#0B0F19]/60 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 hover:text-[#F9FAFB] ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        <span
                          className={`inline-flex items-center gap-1 ${
                            col.align === 'right' ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          {col.label}
                          {renderSortIcon(col.key)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F2937]/70">
                  {filteredEndpoints.map((ep) => {
                    const p95Breach = ep.p95 > ep.slaP95Ms;
                    const errBreach = ep.errorPct > errorRateSlaPct;
                    const rowBreach = p95Breach || errBreach;

                    return (
                      <tr
                        key={ep.endpoint}
                        className={`transition-colors ${
                          rowBreach
                            ? 'bg-[#EF4444]/[0.08] hover:bg-[#EF4444]/[0.14]'
                            : 'hover:bg-[#1F2937]/40'
                        }`}
                      >
                        <td
                          className={`metric-num max-w-[280px] truncate px-3 py-2 font-medium text-[#F9FAFB] ${
                            rowBreach ? 'border-l-2 border-[#EF4444]' : ''
                          }`}
                          title={ep.endpoint}
                        >
                          {ep.endpoint}
                        </td>
                        <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#9CA3AF]">
                          {ep.samples.toLocaleString()}
                        </td>
                        <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#F9FAFB]">
                          {ep.avg.toLocaleString()}
                        </td>
                        <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#9CA3AF]">
                          {ep.p90.toLocaleString()}
                        </td>
                        <td
                          className={`metric-num whitespace-nowrap px-3 py-2 text-right font-semibold ${
                            p95Breach ? 'text-[#EF4444]' : 'text-[#F59E0B]'
                          }`}
                        >
                          {ep.p95.toLocaleString()}
                        </td>
                        <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#9CA3AF]">
                          {ep.p99.toLocaleString()}
                        </td>
                        <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#9CA3AF]">
                          {ep.max.toLocaleString()}
                        </td>
                        <td className="metric-num whitespace-nowrap px-3 py-2 text-right text-[#06B6D4]">
                          {ep.throughput.toFixed(1)}
                        </td>
                        <td
                          className={`metric-num whitespace-nowrap px-3 py-2 text-right font-semibold ${
                            errBreach
                              ? 'text-[#EF4444]'
                              : ep.errorPct > 0
                              ? 'text-[#F59E0B]'
                              : 'text-[#10B981]'
                          }`}
                        >
                          {ep.errorPct.toFixed(2)}%
                        </td>
                      </tr>
                    );
                  })}
                  {filteredEndpoints.length === 0 && (
                    <tr>
                      <td
                        colSpan={9}
                        className="px-4 py-8 text-center text-xs text-[#9CA3AF]"
                      >
                        No transactions match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Error Analysis Panel */}
        {viewMode !== 'endpoints' && (
          <div
            className={`flex flex-col gap-3 ${
              viewMode === 'split' ? 'xl:col-span-4' : ''
            }`}
          >
            {/* Grouped HTTP Status Codes */}
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
                          <strong className="text-[#F9FAFB]">
                            {err.count.toLocaleString()}
                          </strong>{' '}
                          ({err.percentage.toFixed(1)}%)
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

            {/* Top Assertion Failures */}
            <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5 flex-1">
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
        )}
      </div>
    </section>
  );
};
