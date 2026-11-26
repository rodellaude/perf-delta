import React from 'react';
import {
  AlertOctagon,
  BookOpen,
  Boxes,
  Database,
  GitCompare,
  Layers,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Table2,
  TrendingUp,
} from 'lucide-react';

export type DashboardTab =
  | 'overview'
  | 'applications'
  | 'scenarios'
  | 'transactions'
  | 'compare'
  | 'trends'
  | 'errors'
  | 'glossary'
  | 'database'
  | 'settings';

interface SideNavProps {
  activeTab: DashboardTab;
  onSelectTab: (tab: DashboardTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  appCount: number;
  endpointCount: number;
  scenarioCount: number;
  vaultCount: number;
  errorCount: number;
  breachCount: number;
  hasBaseline: boolean;
  isAdmin: boolean;
}

export const SideNav: React.FC<SideNavProps> = ({
  activeTab,
  onSelectTab,
  collapsed,
  onToggleCollapse,
  appCount,
  endpointCount,
  scenarioCount,
  vaultCount,
  errorCount,
  breachCount,
  hasBaseline,
  isAdmin,
}) => {
  const navItems: {
    id: DashboardTab;
    label: string;
    icon: React.ReactNode;
    badge?: string | number;
    badgeTone?: 'neutral' | 'danger' | 'cyan';
  }[] = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <LayoutDashboard className="h-4 w-4 shrink-0" />,
    },
    {
      id: 'applications',
      label: 'Applications',
      icon: <Boxes className="h-4 w-4 shrink-0" />,
      badge: appCount > 0 ? appCount : undefined,
      badgeTone: 'neutral',
    },
    {
      id: 'scenarios',
      label: 'Scenarios',
      icon: <Layers className="h-4 w-4 shrink-0" />,
      badge: scenarioCount > 0 ? scenarioCount : undefined,
      badgeTone: 'neutral',
    },
    {
      id: 'transactions',
      label: 'Transactions',
      icon: <Table2 className="h-4 w-4 shrink-0" />,
      badge: breachCount > 0 ? `${breachCount}!` : endpointCount,
      badgeTone: breachCount > 0 ? 'danger' : 'neutral',
    },
    {
      id: 'compare',
      label: hasBaseline ? 'Compare vs Base' : 'App Health',
      icon: <GitCompare className="h-4 w-4 shrink-0" />,
      badge: hasBaseline ? 'Δ' : undefined,
      badgeTone: 'cyan',
    },
    {
      id: 'trends',
      label: 'Trends',
      icon: <TrendingUp className="h-4 w-4 shrink-0" />,
      badge: vaultCount > 0 ? vaultCount : undefined,
      badgeTone: 'cyan',
    },
    {
      id: 'errors',
      label: 'Errors & Diagnostics',
      icon: <AlertOctagon className="h-4 w-4 shrink-0" />,
      badge: errorCount > 0 ? errorCount.toLocaleString() : '0',
      badgeTone: errorCount > 0 ? 'danger' : 'neutral',
    },
    {
      id: 'glossary',
      label: 'Glossary',
      icon: <BookOpen className="h-4 w-4 shrink-0" />,
    },
  ];

  const badgeClass = (tone?: 'neutral' | 'danger' | 'cyan') => {
    if (tone === 'danger') {
      return 'bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/35';
    }
    if (tone === 'cyan') {
      return 'bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/35';
    }
    return 'bg-[#1F2937] text-[#9CA3AF]';
  };

  return (
    <>
      {/* Mobile / Narrow Screen Horizontal Tab Bar */}
      <nav
        aria-label="Dashboard sections"
        className="no-print flex items-center gap-1 overflow-x-auto border-b border-[#1F2937] bg-[#111827] px-3 py-2 md:hidden"
      >
        {navItems.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/40'
                  : 'text-[#9CA3AF] hover:bg-[#1F2937] hover:text-[#F9FAFB]'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.badge !== undefined && (
                <span className={`metric-num rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeClass(item.badgeTone)}`}>
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
        {isAdmin && (
          <>
            <button
              type="button"
              onClick={() => onSelectTab('database')}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'database'
                  ? 'bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/40'
                  : 'text-[#9CA3AF] hover:bg-[#1F2937] hover:text-[#F9FAFB]'
              }`}
            >
              <Database className="h-4 w-4 shrink-0" />
              <span>DB Explorer</span>
            </button>
            <button
              type="button"
              onClick={() => onSelectTab('settings')}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/40'
                  : 'text-[#9CA3AF] hover:bg-[#1F2937] hover:text-[#F9FAFB]'
              }`}
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span>Settings</span>
            </button>
          </>
        )}
      </nav>

      {/* Desktop Sticky Collapsible Left Rail */}
      <aside
        aria-label="Dashboard navigation"
        className={`no-print hidden md:flex flex-col shrink-0 border-r border-[#1F2937] bg-[#111827]/90 transition-all duration-150 ${
          collapsed ? 'w-[58px]' : 'w-[216px]'
        }`}
      >
        <div className="sticky top-[53px] flex h-[calc(100vh-53px)] flex-col justify-between py-3">
          <div className="space-y-1 px-2">
            {!collapsed && (
              <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Views
              </div>
            )}
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  title={collapsed ? item.label : undefined}
                  className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/35'
                      : 'border border-transparent text-[#9CA3AF] hover:bg-[#1F2937]/60 hover:text-[#F9FAFB]'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    {item.icon}
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!collapsed && item.badge !== undefined && (
                    <span
                      className={`metric-num ml-1.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeClass(
                        item.badgeTone
                      )}`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="space-y-1 border-t border-[#1F2937] px-2 pt-2">
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={() => onSelectTab('database')}
                  title={collapsed ? 'DB Explorer' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                    activeTab === 'database'
                      ? 'bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/35'
                      : 'border border-transparent text-[#9CA3AF] hover:bg-[#1F2937]/60 hover:text-[#F9FAFB]'
                  }`}
                >
                  <Database className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">DB Explorer</span>}
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTab('settings')}
                  title={collapsed ? 'Settings' : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium transition-colors ${
                    activeTab === 'settings'
                      ? 'bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/35'
                      : 'border border-transparent text-[#9CA3AF] hover:bg-[#1F2937]/60 hover:text-[#F9FAFB]'
                  }`}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">Settings</span>}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onToggleCollapse}
              className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-[#9CA3AF] hover:bg-[#1F2937]/60 hover:text-[#F9FAFB] transition-colors"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" />
                  <span>Collapse Rail</span>
                </>
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
