/**
 * Global Multi-Select Scope Filter Bar (`dashboard-ui/src/components/GlobalFilterBar.tsx`)
 *
 * Hosts cascading `Apps`, `Scenarios`, and `Transactions` Include/Exclude popovers
 * plus a 1-click `Reset Scope` button. Selecting filters recalculates all KPIs, tables,
 * Executive Summary, Trends, and live DuckDB time-series charts across the dashboard.
 */
import React from 'react';
import { Filter, RotateCcw } from 'lucide-react';
import { MultiFilterState, MultiSelectFilter } from './MultiSelectFilter';

interface GlobalFilterBarProps {
  apps: string[];
  scenarios: string[];
  endpoints: string[];
  appFilter: MultiFilterState;
  scenarioFilter: MultiFilterState;
  endpointFilter: MultiFilterState;
  onChangeAppFilter: (next: MultiFilterState) => void;
  onChangeScenarioFilter: (next: MultiFilterState) => void;
  onChangeEndpointFilter: (next: MultiFilterState) => void;
  onReset: () => void;
}

export const GlobalFilterBar: React.FC<GlobalFilterBarProps> = ({
  apps,
  scenarios,
  endpoints,
  appFilter,
  scenarioFilter,
  endpointFilter,
  onChangeAppFilter,
  onChangeScenarioFilter,
  onChangeEndpointFilter,
  onReset,
}) => {
  const hasFilter =
    appFilter.values.length > 0 ||
    scenarioFilter.values.length > 0 ||
    endpointFilter.values.length > 0;

  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded-md border border-[#1F2937] bg-[#111827] px-3 py-1.5 text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wider text-[#9CA3AF]">
          <Filter className="h-3.5 w-3.5 text-[#06B6D4]" />
          Scope
        </span>

        <MultiSelectFilter
          label="Apps"
          options={apps}
          value={appFilter}
          onChange={onChangeAppFilter}
          maxWidthClass="max-w-[180px]"
        />

        <MultiSelectFilter
          label="Scenarios"
          options={scenarios}
          value={scenarioFilter}
          onChange={onChangeScenarioFilter}
          maxWidthClass="max-w-[230px]"
        />

        <MultiSelectFilter
          label="Transactions"
          options={endpoints}
          value={endpointFilter}
          onChange={onChangeEndpointFilter}
          maxWidthClass="max-w-[250px]"
        />
      </div>

      {hasFilter && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-1 rounded border border-[#06B6D4]/40 bg-[#06B6D4]/15 px-2 py-0.5 text-[11px] font-medium text-[#22D3EE] hover:bg-[#06B6D4]/25 transition-colors"
        >
          <RotateCcw className="h-3 w-3" />
          Reset Scope
        </button>
      )}
    </div>
  );
};
