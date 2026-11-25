import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

export interface MultiFilterState {
  mode: 'include' | 'exclude';
  values: string[];
}

export const EMPTY_MULTI_FILTER: MultiFilterState = { mode: 'include', values: [] };

interface MultiSelectFilterProps {
  label: string;
  options: string[];
  value: MultiFilterState;
  onChange: (next: MultiFilterState) => void;
  maxWidthClass?: string;
}

export const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({
  label,
  options,
  value,
  onChange,
  maxWidthClass = 'max-w-[220px]',
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const selectedSet = useMemo(() => new Set(value.values), [value.values]);
  const count = value.values.length;
  const isExclude = value.mode === 'exclude';

  const toggleOption = (opt: string) => {
    const next = new Set(value.values);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange({ mode: value.mode, values: Array.from(next) });
  };

  const selectAllVisible = () => {
    const next = new Set(value.values);
    filteredOptions.forEach((o) => next.add(o));
    onChange({ mode: value.mode, values: Array.from(next) });
  };

  const clearAll = () => {
    onChange({ mode: value.mode, values: [] });
  };

  const summaryText =
    count === 0
      ? `${label}: All (${options.length})`
      : count === 1
      ? `${label}: ${isExclude ? '≠ ' : ''}${value.values[0]}`
      : `${label}: ${isExclude ? `-${count} excl` : `+${count} incl`}`;

  const triggerTone =
    count === 0
      ? 'border-[#1F2937] bg-[#0B0F19] text-[#F9FAFB] hover:border-[#374151]'
      : isExclude
      ? 'border-[#F59E0B]/50 bg-[#F59E0B]/15 text-[#FBBF24]'
      : 'border-[#06B6D4]/50 bg-[#06B6D4]/15 text-[#22D3EE]';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 rounded border py-1 pl-2.5 pr-2 text-[11px] font-medium transition-colors ${triggerTone} ${maxWidthClass}`}
        title={
          count > 0
            ? `${isExclude ? 'Excluding' : 'Including'}: ${value.values.join(', ')}`
            : `Filter by ${label}`
        }
      >
        <span className="truncate">{summaryText}</span>
        {count > 0 && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Clear ${label} filter`}
            onClick={(e) => {
              e.stopPropagation();
              clearAll();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                clearAll();
              }
            }}
            className="rounded p-0.5 hover:bg-black/20"
          >
            <X className="h-2.5 w-2.5" />
          </span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 opacity-75" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border border-[#374151] bg-[#111827] shadow-2xl">
          {/* Include / Exclude Mode Switcher */}
          <div className="flex items-center justify-between gap-2 border-b border-[#1F2937] p-2">
            <div className="inline-flex rounded border border-[#1F2937] bg-[#0B0F19] p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => onChange({ mode: 'include', values: value.values })}
                className={`rounded px-2 py-0.5 font-semibold transition-colors ${
                  !isExclude
                    ? 'bg-[#06B6D4]/20 text-[#22D3EE]'
                    : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                }`}
              >
                Include
              </button>
              <button
                type="button"
                onClick={() => onChange({ mode: 'exclude', values: value.values })}
                className={`rounded px-2 py-0.5 font-semibold transition-colors ${
                  isExclude
                    ? 'bg-[#F59E0B]/20 text-[#FBBF24]'
                    : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
                }`}
              >
                Exclude
              </button>
            </div>

            <div className="flex items-center gap-2 text-[10px]">
              <button
                type="button"
                onClick={selectAllVisible}
                className="text-[#22D3EE] hover:underline"
              >
                All
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="text-[#9CA3AF] hover:text-[#F9FAFB]"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Search Input */}
          <div className="border-b border-[#1F2937] p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#9CA3AF]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="w-full rounded border border-[#1F2937] bg-[#0B0F19] py-1 pl-7 pr-2 text-[11px] text-[#F9FAFB] placeholder-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
                autoFocus
              />
            </div>
          </div>

          {/* Checkbox List */}
          <div className="max-h-60 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-4 text-center text-[11px] text-[#9CA3AF]">
                No matches
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const checked = selectedSet.has(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleOption(opt)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition-colors ${
                      checked
                        ? isExclude
                          ? 'bg-[#F59E0B]/10 text-[#FBBF24]'
                          : 'bg-[#06B6D4]/10 text-[#22D3EE]'
                        : 'text-[#D1D5DB] hover:bg-[#1F2937]/60 hover:text-[#F9FAFB]'
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        checked
                          ? isExclude
                            ? 'border-[#F59E0B] bg-[#F59E0B] text-[#0B0F19]'
                            : 'border-[#06B6D4] bg-[#06B6D4] text-[#0B0F19]'
                          : 'border-[#374151] bg-[#0B0F19]'
                      }`}
                    >
                      {checked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                    </span>
                    <span className="metric-num truncate" title={opt}>
                      {opt}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
