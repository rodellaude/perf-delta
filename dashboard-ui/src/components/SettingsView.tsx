import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FilterX,
  FolderCog,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

interface RtOverride {
  label: string;
  threshold: number;
}

interface SettingsPayload {
  general: {
    project: string;
    version: string;
    reportTheme: 'cyber-slate' | 'light';
    displayTimezone: string;
    showTimezoneAbbr: boolean;
    databasePath: string;
    slaFilePath: string;
    outputDir: string;
  };
  ai: {
    provider: 'gemini' | 'amplify';
    aiUrl: string;
    aiModelId: string;
    aiPromptTemplate: string;
    hasGeminiKey: boolean;
    geminiKeyMasked: string;
    hasGeminiEnvVar: boolean;
    hasAmplifyToken: boolean;
    amplifyTokenMasked: string;
  };
  exclusions: {
    labels: string[];
    hardcoded: string[];
  };
  sla: {
    showOverallStatus: boolean;
    responseTime: {
      enabled: boolean;
      metric: 'p95' | 'p90';
      defaultThreshold: number;
      tolerancePct: number;
      overrides: RtOverride[];
    };
    rules: {
      errorRate: { enabled: boolean; threshold: number };
      throughput: { enabled: boolean; threshold: number };
      totalUsers: { enabled: boolean; threshold: number };
    };
  };
}

interface SettingsViewProps {
  onSettingsSaved: () => Promise<void> | void;
}

type SettingsSubTab = 'sla' | 'ai' | 'exclusions' | 'general';

const COMMON_TIMEZONES = [
  'Pacific/Auckland',
  'Australia/Sydney',
  'Australia/Melbourne',
  'UTC',
  'Asia/Manila',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Los_Angeles',
];

const GEMINI_DEFAULT_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const AMPLIFY_DEFAULT_URL = 'https://amplify.planittesting.com/external/api/completion';

export const SettingsView: React.FC<SettingsViewProps> = ({ onSettingsSaved }) => {
  const [subTab, setSubTab] = useState<SettingsSubTab>('sla');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  const [initial, setInitial] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<SettingsPayload | null>(null);

  // Ephemeral secret inputs (never pre-populated from server)
  const [newGeminiKey, setNewGeminiKey] = useState('');
  const [clearGeminiKey, setClearGeminiKey] = useState(false);
  const [newAmplifyToken, setNewAmplifyToken] = useState('');
  const [clearAmplifyToken, setClearAmplifyToken] = useState(false);

  // Test AI state
  const [testingAi, setTestingAi] = useState(false);
  const [testAiResult, setTestAiResult] = useState<{
    ok: boolean;
    message: string;
    latencyMs?: number;
  } | null>(null);

  // New exclusion / override inputs
  const [newExclusion, setNewExclusion] = useState('');
  const [newOvLabel, setNewOvLabel] = useState('');
  const [newOvThreshold, setNewOvThreshold] = useState('2000');
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // Admin password rotation state
  const [curPw, setCurPw] = useState('');
  const [nextPw, setNextPw] = useState('');
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [updatingPw, setUpdatingPw] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwMsg(null);
    setUpdatingPw(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: curPw, newPassword: nextPw }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setPwMsg({ ok: false, text: data.error || 'Could not update password.' });
      } else {
        setCurPw('');
        setNextPw('');
        setPwMsg({ ok: true, text: 'Admin password updated in secrets.yaml.' });
      }
    } catch {
      setPwMsg({ ok: false, text: 'Network error updating password.' });
    } finally {
      setUpdatingPw(false);
    }
  };

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setInitial(data.settings);
      setDraft(structuredClone(data.settings));
      setNewGeminiKey('');
      setClearGeminiKey(false);
      setNewAmplifyToken('');
      setClearAmplifyToken(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not load settings from live API (${err.message}). Make sure dashboard-api is running.`
          : 'Could not load settings.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const isDirty =
    Boolean(draft && initial) &&
    (JSON.stringify(draft) !== JSON.stringify(initial) ||
      newGeminiKey.trim().length > 0 ||
      clearGeminiKey ||
      newAmplifyToken.trim().length > 0 ||
      clearAmplifyToken);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setSavedBanner(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          general: draft.general,
          ai: draft.ai,
          exclusions: draft.exclusions,
          sla: draft.sla,
          secrets: {
            geminiApiKey: newGeminiKey.trim() || undefined,
            clearGeminiKey,
            amplifyToken: newAmplifyToken.trim() || undefined,
            clearAmplifyToken,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setInitial(data.settings);
      setDraft(structuredClone(data.settings));
      setNewGeminiKey('');
      setClearGeminiKey(false);
      setNewAmplifyToken('');
      setClearAmplifyToken(false);
      await onSettingsSaved();
      setSavedBanner('Settings saved to YAML & live metrics refreshed.');
      window.setTimeout(() => setSavedBanner(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!initial) return;
    setDraft(structuredClone(initial));
    setNewGeminiKey('');
    setClearGeminiKey(false);
    setNewAmplifyToken('');
    setClearAmplifyToken(false);
    setTestAiResult(null);
  };

  const handleTestAi = async () => {
    if (!draft) return;
    setTestingAi(true);
    setTestAiResult(null);
    try {
      const res = await fetch('/api/settings/test-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: draft.ai.provider,
          aiUrl: draft.ai.aiUrl,
          aiModelId: draft.ai.aiModelId,
          geminiApiKey: newGeminiKey.trim() || undefined,
          amplifyToken: newAmplifyToken.trim() || undefined,
        }),
      });
      const data = await res.json();
      setTestAiResult({
        ok: Boolean(data.ok),
        message: data.message || (data.ok ? 'Connection succeeded.' : 'Connection failed.'),
        latencyMs: data.latencyMs,
      });
    } catch (err) {
      setTestAiResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Network error during AI test.',
      });
    } finally {
      setTestingAi(false);
    }
  };

  const handleAddOverride = () => {
    if (!draft || !newOvLabel.trim()) return;
    const ms = Number(newOvThreshold);
    if (!Number.isFinite(ms) || ms <= 0) return;
    setDraft({
      ...draft,
      sla: {
        ...draft.sla,
        responseTime: {
          ...draft.sla.responseTime,
          overrides: [
            ...draft.sla.responseTime.overrides,
            { label: newOvLabel.trim(), threshold: Math.round(ms) },
          ],
        },
      },
    });
    setNewOvLabel('');
    setNewOvThreshold('2000');
  };

  const handleAddExclusion = () => {
    if (!draft || !newExclusion.trim()) return;
    const val = newExclusion.trim();
    if (draft.exclusions.labels.includes(val)) {
      setNewExclusion('');
      return;
    }
    setDraft({
      ...draft,
      exclusions: {
        ...draft.exclusions,
        labels: [...draft.exclusions.labels, val],
      },
    });
    setNewExclusion('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-[#1F2937] bg-[#111827] py-16 text-xs text-[#9CA3AF]">
        <Loader2 className="h-4 w-4 animate-spin text-[#06B6D4]" />
        Loading configuration from YAML...
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/10 p-4 text-xs text-[#FCA5A5]">
        {error || 'Unable to load settings.'}
      </div>
    );
  }

  const tabs: { id: SettingsSubTab; label: string; icon: React.ReactNode }[] = [
    { id: 'sla', label: 'SLA Thresholds', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    { id: 'ai', label: 'AI Executive Summary', icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: 'exclusions', label: 'Label Exclusions', icon: <FilterX className="h-3.5 w-3.5" /> },
    { id: 'general', label: 'General & Paths', icon: <FolderCog className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#1F2937] bg-[#111827] px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[#F9FAFB]">
            <SlidersHorizontal className="h-4 w-4 text-[#06B6D4]" />
            Workspace Settings
          </h2>
          <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
            Changes write directly to <code className="text-[#22D3EE]">config.yaml</code>,{' '}
            <code className="text-[#22D3EE]">SLA/performance-sla.yaml</code>, and{' '}
            <code className="text-[#22D3EE]">secrets.yaml</code> and apply live immediately.
          </p>
        </div>

        {/* Sub-tab pills */}
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-[#1F2937] bg-[#0B0F19] p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                subTab === t.id
                  ? 'bg-[#06B6D4]/15 text-[#22D3EE] border border-[#06B6D4]/35'
                  : 'text-[#9CA3AF] hover:text-[#F9FAFB]'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-[#EF4444]/40 bg-[#EF4444]/10 px-3.5 py-2 text-xs text-[#FCA5A5]">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#EF4444]" />
          {error}
        </div>
      )}

      {savedBanner && (
        <div className="flex items-center gap-2 rounded-md border border-[#10B981]/40 bg-[#10B981]/10 px-3.5 py-2 text-xs text-[#34D399]">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#10B981]" />
          {savedBanner}
        </div>
      )}

      {/* TAB 1: SLA THRESHOLDS */}
      {subTab === 'sla' && (
        <div className="space-y-4">
          {/* Governance Toggle */}
          <div className="flex items-center justify-between rounded-lg border border-[#1F2937] bg-[#111827] px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-[#F9FAFB]">
                Show Overall Status Verdict (PASS / FAIL)
              </div>
              <div className="text-[11px] text-[#9CA3AF]">
                Disable for informational reports that hide overall Pass/Fail banners and red fail badges.
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={draft.sla.showOverallStatus}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    sla: { ...draft.sla, showOverallStatus: e.target.checked },
                  })
                }
                className="peer sr-only"
              />
              <div className="h-5 w-9 rounded-full bg-[#1F2937] peer-checked:bg-[#06B6D4] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>

          {/* Response Time SLA */}
          <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
            <div className="flex items-center justify-between border-b border-[#1F2937] pb-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                  Response Time SLA (Per Transaction)
                </h3>
                <p className="text-[11px] text-[#9CA3AF]">
                  Evaluates every transaction against the default threshold or its longest-prefix override.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[#9CA3AF]">
                <span>{draft.sla.responseTime.enabled ? 'Enabled' : 'Disabled'}</span>
                <input
                  type="checkbox"
                  checked={draft.sla.responseTime.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        responseTime: { ...draft.sla.responseTime, enabled: e.target.checked },
                      },
                    })
                  }
                  className="h-4 w-4 accent-[#06B6D4]"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  Percentile Metric
                </label>
                <select
                  value={draft.sla.responseTime.metric}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        responseTime: {
                          ...draft.sla.responseTime,
                          metric: e.target.value === 'p90' ? 'p90' : 'p95',
                        },
                      },
                    })
                  }
                  className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                >
                  <option value="p95">P95 (95th Percentile)</option>
                  <option value="p90">P90 (90th Percentile)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  Default Threshold (ms)
                </label>
                <input
                  type="number"
                  min={1}
                  step={100}
                  value={draft.sla.responseTime.defaultThreshold}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        responseTime: {
                          ...draft.sla.responseTime,
                          defaultThreshold: Number(e.target.value) || 0,
                        },
                      },
                    })
                  }
                  className="metric-num w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  Tolerance Band (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={draft.sla.responseTime.tolerancePct}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        responseTime: {
                          ...draft.sla.responseTime,
                          tolerancePct: Number(e.target.value) || 0,
                        },
                      },
                    })
                  }
                  className="metric-num w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>
            </div>

            {/* Prefix Overrides Table */}
            <div className="space-y-2 pt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                Per-Transaction Prefix Overrides ({draft.sla.responseTime.overrides.length})
              </div>
              <div className="overflow-x-auto rounded-md border border-[#1F2937]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#0B0F19] text-[10px] uppercase tracking-wider text-[#9CA3AF]">
                    <tr>
                      <th className="px-3 py-2">Transaction Label Prefix</th>
                      <th className="px-3 py-2 w-40">Threshold (ms)</th>
                      <th className="px-3 py-2 w-14 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1F2937]">
                    {draft.sla.responseTime.overrides.map((ov, idx) => (
                      <tr key={`${ov.label}-${idx}`} className="bg-[#111827]">
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={ov.label}
                            onChange={(e) => {
                              const next = [...draft.sla.responseTime.overrides];
                              next[idx] = { ...next[idx], label: e.target.value };
                              setDraft({
                                ...draft,
                                sla: {
                                  ...draft.sla,
                                  responseTime: { ...draft.sla.responseTime, overrides: next },
                                },
                              });
                            }}
                            className="w-full rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            min={1}
                            value={ov.threshold}
                            onChange={(e) => {
                              const next = [...draft.sla.responseTime.overrides];
                              next[idx] = { ...next[idx], threshold: Number(e.target.value) || 0 };
                              setDraft({
                                ...draft,
                                sla: {
                                  ...draft.sla,
                                  responseTime: { ...draft.sla.responseTime, overrides: next },
                                },
                              });
                            }}
                            className="metric-num w-full rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              const next = draft.sla.responseTime.overrides.filter((_, i) => i !== idx);
                              setDraft({
                                ...draft,
                                sla: {
                                  ...draft.sla,
                                  responseTime: { ...draft.sla.responseTime, overrides: next },
                                },
                              });
                            }}
                            className="rounded p-1 text-[#9CA3AF] hover:bg-[#EF4444]/15 hover:text-[#EF4444]"
                            title="Remove override"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-[#0B0F19]/60">
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={newOvLabel}
                          onChange={(e) => setNewOvLabel(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddOverride()}
                          placeholder="e.g. UJ01_Login or CMS"
                          className="w-full rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={1}
                          value={newOvThreshold}
                          onChange={(e) => setNewOvThreshold(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddOverride()}
                          className="metric-num w-full rounded border border-[#1F2937] bg-[#0B0F19] px-2 py-1 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={handleAddOverride}
                          disabled={!newOvLabel.trim()}
                          className="inline-flex items-center gap-1 rounded bg-[#06B6D4]/20 px-2 py-1 text-[11px] font-medium text-[#22D3EE] hover:bg-[#06B6D4]/30 disabled:opacity-40"
                        >
                          <Plus className="h-3 w-3" />
                          Add
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Global Rules Grid */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* Error Rate */}
            <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F9FAFB]">Error Rate (&le;)</span>
                <input
                  type="checkbox"
                  checked={draft.sla.rules.errorRate.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        rules: {
                          ...draft.sla.rules,
                          errorRate: { ...draft.sla.rules.errorRate, enabled: e.target.checked },
                        },
                      },
                    })
                  }
                  className="h-4 w-4 accent-[#06B6D4]"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={draft.sla.rules.errorRate.threshold}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        rules: {
                          ...draft.sla.rules,
                          errorRate: {
                            ...draft.sla.rules.errorRate,
                            threshold: Number(e.target.value) || 0,
                          },
                        },
                      },
                    })
                  }
                  className="metric-num w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
                <span className="text-xs text-[#9CA3AF]">%</span>
              </div>
            </div>

            {/* Throughput */}
            <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F9FAFB]">Throughput (&ge;)</span>
                <input
                  type="checkbox"
                  checked={draft.sla.rules.throughput.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        rules: {
                          ...draft.sla.rules,
                          throughput: { ...draft.sla.rules.throughput, enabled: e.target.checked },
                        },
                      },
                    })
                  }
                  className="h-4 w-4 accent-[#06B6D4]"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={draft.sla.rules.throughput.threshold}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        rules: {
                          ...draft.sla.rules,
                          throughput: {
                            ...draft.sla.rules.throughput,
                            threshold: Number(e.target.value) || 0,
                          },
                        },
                      },
                    })
                  }
                  className="metric-num w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
                <span className="text-xs text-[#9CA3AF]">req/s</span>
              </div>
            </div>

            {/* Virtual Users */}
            <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F9FAFB]">Virtual Users (&ge;)</span>
                <input
                  type="checkbox"
                  checked={draft.sla.rules.totalUsers.enabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        rules: {
                          ...draft.sla.rules,
                          totalUsers: { ...draft.sla.rules.totalUsers, enabled: e.target.checked },
                        },
                      },
                    })
                  }
                  className="h-4 w-4 accent-[#06B6D4]"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draft.sla.rules.totalUsers.threshold}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      sla: {
                        ...draft.sla,
                        rules: {
                          ...draft.sla.rules,
                          totalUsers: {
                            ...draft.sla.rules.totalUsers,
                            threshold: Number(e.target.value) || 1,
                          },
                        },
                      },
                    })
                  }
                  className="metric-num w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
                <span className="text-xs text-[#9CA3AF]">VUs</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: AI EXECUTIVE SUMMARY */}
      {subTab === 'ai' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1F2937] pb-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
                  AI Provider &amp; Model
                </h3>
                <p className="text-[11px] text-[#9CA3AF]">
                  Powers the on-demand <span className="text-[#22D3EE]">AI Summary</span> button and static HTML reports.
                </p>
              </div>
              <button
                type="button"
                onClick={handleTestAi}
                disabled={testingAi}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#06B6D4]/40 bg-[#06B6D4]/15 px-3 py-1.5 text-xs font-medium text-[#22D3EE] hover:bg-[#06B6D4]/25 disabled:opacity-50"
              >
                {testingAi ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Test Connection
              </button>
            </div>

            {testAiResult && (
              <div
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
                  testAiResult.ok
                    ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#34D399]'
                    : 'border-[#EF4444]/40 bg-[#EF4444]/10 text-[#FCA5A5]'
                }`}
              >
                <span>{testAiResult.message}</span>
                {testAiResult.latencyMs !== undefined && (
                  <span className="metric-num text-[11px] opacity-80">{testAiResult.latencyMs} ms</span>
                )}
              </div>
            )}

            {/* Provider Selector */}
            <div className="grid grid-cols-2 gap-2 max-w-md">
              {(['gemini', 'amplify'] as const).map((p) => {
                const active = draft.ai.provider === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        ai: {
                          ...draft.ai,
                          provider: p,
                          aiUrl: p === 'gemini' ? GEMINI_DEFAULT_URL : AMPLIFY_DEFAULT_URL,
                          aiModelId:
                            p === 'gemini'
                              ? /gemini/i.test(draft.ai.aiModelId)
                                ? draft.ai.aiModelId
                                : 'gemini-2.5-flash'
                              : !/gemini/i.test(draft.ai.aiModelId) && draft.ai.aiModelId
                              ? draft.ai.aiModelId
                              : '19b89d52-23cf-463d-a5bb-c2896a0f8661',
                        },
                      })
                    }
                    className={`rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
                      active
                        ? 'border-[#06B6D4] bg-[#06B6D4]/15 text-[#22D3EE]'
                        : 'border-[#1F2937] bg-[#0B0F19] text-[#9CA3AF] hover:text-[#F9FAFB]'
                    }`}
                  >
                    <div>{p === 'gemini' ? 'Google Gemini' : 'Planit Amplify'}</div>
                    <div className="text-[10px] opacity-75">
                      {p === 'gemini' ? 'gemini-2.5-flash / pro' : 'Enterprise Completion API'}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  API Endpoint URL
                </label>
                <input
                  type="text"
                  value={draft.ai.aiUrl}
                  onChange={(e) =>
                    setDraft({ ...draft, ai: { ...draft.ai, aiUrl: e.target.value } })
                  }
                  className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  Model ID
                </label>
                <input
                  type="text"
                  value={draft.ai.aiModelId}
                  onChange={(e) =>
                    setDraft({ ...draft, ai: { ...draft.ai, aiModelId: e.target.value } })
                  }
                  placeholder={draft.ai.provider === 'gemini' ? 'gemini-2.5-flash' : 'Model UUID'}
                  className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>
            </div>

            {/* Secrets Card */}
            <div className="rounded-md border border-[#1F2937] bg-[#0B0F19]/80 p-3.5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#F9FAFB]">
                <KeyRound className="h-3.5 w-3.5 text-[#F59E0B]" />
                API Credentials (stored in git-ignored <code className="text-[#22D3EE]">secrets.yaml</code>)
              </div>

              {draft.ai.provider === 'gemini' ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-[#9CA3AF]">
                      Gemini API Key Status:{' '}
                      {clearGeminiKey ? (
                        <strong className="text-[#F59E0B]">Will be cleared on save</strong>
                      ) : draft.ai.hasGeminiKey ? (
                        <strong className="text-[#10B981]">
                          Saved ({draft.ai.geminiKeyMasked})
                        </strong>
                      ) : draft.ai.hasGeminiEnvVar ? (
                        <strong className="text-[#06B6D4]">Using GEMINI_API_KEY env var</strong>
                      ) : (
                        <strong className="text-[#EF4444]">Not configured</strong>
                      )}
                    </span>
                    {draft.ai.hasGeminiKey && !clearGeminiKey && (
                      <button
                        type="button"
                        onClick={() => {
                          setClearGeminiKey(true);
                          setNewGeminiKey('');
                        }}
                        className="text-[11px] text-[#EF4444] hover:underline"
                      >
                        Clear saved key
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    autoComplete="off"
                    value={newGeminiKey}
                    onChange={(e) => {
                      setNewGeminiKey(e.target.value);
                      if (e.target.value) setClearGeminiKey(false);
                    }}
                    placeholder={
                      draft.ai.hasGeminiKey
                        ? 'Leave blank to keep existing key, or paste new key to replace...'
                        : 'Paste your Gemini API key (AIza...)'
                    }
                    className="w-full rounded-md border border-[#1F2937] bg-[#111827] px-2.5 py-1.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                    <span className="text-[#9CA3AF]">
                      Amplify Token Status:{' '}
                      {clearAmplifyToken ? (
                        <strong className="text-[#F59E0B]">Will be cleared on save</strong>
                      ) : draft.ai.hasAmplifyToken ? (
                        <strong className="text-[#10B981]">
                          Saved ({draft.ai.amplifyTokenMasked})
                        </strong>
                      ) : (
                        <strong className="text-[#EF4444]">Not configured</strong>
                      )}
                    </span>
                    {draft.ai.hasAmplifyToken && !clearAmplifyToken && (
                      <button
                        type="button"
                        onClick={() => {
                          setClearAmplifyToken(true);
                          setNewAmplifyToken('');
                        }}
                        className="text-[11px] text-[#EF4444] hover:underline"
                      >
                        Clear saved token
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    autoComplete="off"
                    value={newAmplifyToken}
                    onChange={(e) => {
                      setNewAmplifyToken(e.target.value);
                      if (e.target.value) setClearAmplifyToken(false);
                    }}
                    placeholder={
                      draft.ai.hasAmplifyToken
                        ? 'Leave blank to keep existing token, or paste new token to replace...'
                        : 'Paste your Amplify API token...'
                    }
                    className="w-full rounded-md border border-[#1F2937] bg-[#111827] px-2.5 py-1.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Collapsible Prompt Template */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowPromptEditor((v) => !v)}
                className="text-xs font-medium text-[#22D3EE] hover:underline"
              >
                {showPromptEditor ? 'Hide' : 'Edit'} Static Report AI Prompt Template
              </button>
              {showPromptEditor && (
                <textarea
                  rows={10}
                  value={draft.ai.aiPromptTemplate}
                  onChange={(e) =>
                    setDraft({ ...draft, ai: { ...draft.ai, aiPromptTemplate: e.target.value } })
                  }
                  className="mt-2 w-full rounded-md border border-[#1F2937] bg-[#0B0F19] p-2.5 font-mono text-[11px] text-[#E5E7EB] focus:border-[#06B6D4] focus:outline-none"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: LABEL EXCLUSIONS */}
      {subTab === 'exclusions' && (
        <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
              Global Label Exclusions
            </h3>
            <p className="text-[11px] text-[#9CA3AF]">
              Transactions matching these exact labels are hidden from KPIs, tables, and charts.
            </p>
          </div>

          <div className="flex gap-2 max-w-lg">
            <input
              type="text"
              value={newExclusion}
              onChange={(e) => setNewExclusion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddExclusion()}
              placeholder="Add JMeter label to exclude (e.g. c_Thinktime)"
              className="flex-1 rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleAddExclusion}
              disabled={!newExclusion.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-[#06B6D4]/20 px-3 py-1.5 text-xs font-medium text-[#22D3EE] hover:bg-[#06B6D4]/30 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {draft.exclusions.labels.map((lbl) => (
              <span
                key={lbl}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1 text-xs text-[#E5E7EB]"
              >
                <span>{lbl}</span>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      exclusions: {
                        ...draft.exclusions,
                        labels: draft.exclusions.labels.filter((x) => x !== lbl),
                      },
                    })
                  }
                  className="text-[#9CA3AF] hover:text-[#EF4444]"
                  title="Remove exclusion"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          <div className="border-t border-[#1F2937] pt-3">
            <div className="text-[11px] font-medium text-[#9CA3AF] mb-1.5">
              Built-in Hardcoded Exclusions (always excluded):
            </div>
            <div className="flex flex-wrap gap-2">
              {draft.exclusions.hardcoded.map((h) => (
                <span
                  key={h}
                  className="rounded-full border border-[#EF4444]/30 bg-[#EF4444]/10 px-2.5 py-0.5 text-[11px] text-[#FCA5A5]"
                >
                  *{h}*
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: GENERAL & PATHS */}
      {subTab === 'general' && (
        <div className="rounded-lg border border-[#1F2937] bg-[#111827] p-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                Project Name
              </label>
              <input
                type="text"
                value={draft.general.project}
                onChange={(e) =>
                  setDraft({ ...draft, general: { ...draft.general, project: e.target.value } })
                }
                placeholder="e.g. ECAN Performance"
                className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                Report Version
              </label>
              <input
                type="text"
                value={draft.general.version}
                onChange={(e) =>
                  setDraft({ ...draft, general: { ...draft.general, version: e.target.value } })
                }
                className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                Static HTML Default Theme
              </label>
              <select
                value={draft.general.reportTheme}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    general: {
                      ...draft.general,
                      reportTheme: e.target.value === 'light' ? 'light' : 'cyber-slate',
                    },
                  })
                }
                className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
              >
                <option value="cyber-slate">Cyber-Slate (Dark)</option>
                <option value="light">Classic Light</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 border-t border-[#1F2937] pt-3">
            <div>
              <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                Display Timezone (IANA)
              </label>
              <input
                list="perf-delta-tz-list"
                value={draft.general.displayTimezone}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    general: { ...draft.general, displayTimezone: e.target.value },
                  })
                }
                className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
              />
              <datalist id="perf-delta-tz-list">
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
            </div>

            <div className="flex items-end pb-1.5">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-[#E5E7EB]">
                <input
                  type="checkbox"
                  checked={draft.general.showTimezoneAbbr}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      general: { ...draft.general, showTimezoneAbbr: e.target.checked },
                    })
                  }
                  className="h-4 w-4 accent-[#06B6D4]"
                />
                Show timezone abbreviation (e.g. NZDT / UTC)
              </label>
            </div>
          </div>

          <div className="space-y-3 border-t border-[#1F2937] pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Workspace File Paths
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  DuckDB Vault Path
                </label>
                <input
                  type="text"
                  value={draft.general.databasePath}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      general: { ...draft.general, databasePath: e.target.value },
                    })
                  }
                  className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 font-mono text-[11px] text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  SLA YAML Path
                </label>
                <input
                  type="text"
                  value={draft.general.slaFilePath}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      general: { ...draft.general, slaFilePath: e.target.value },
                    })
                  }
                  className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 font-mono text-[11px] text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#9CA3AF] mb-1">
                  Static Reports Output Dir
                </label>
                <input
                  type="text"
                  value={draft.general.outputDir}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      general: { ...draft.general, outputDir: e.target.value },
                    })
                  }
                  className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 font-mono text-[11px] text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Admin Password Rotation */}
          <form onSubmit={handleChangePassword} className="space-y-3 border-t border-[#1F2937] pt-3">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              <KeyRound className="h-3.5 w-3.5 text-[#F59E0B]" />
              Admin Account Security
            </div>
            {pwMsg && (
              <div
                className={`rounded border px-3 py-1.5 text-xs ${
                  pwMsg.ok
                    ? 'border-[#10B981]/40 bg-[#10B981]/10 text-[#34D399]'
                    : 'border-[#EF4444]/40 bg-[#EF4444]/10 text-[#FCA5A5]'
                }`}
              >
                {pwMsg.text}
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                type="password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                placeholder="Current password"
                required
                className="rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
              />
              <input
                type="password"
                value={nextPw}
                onChange={(e) => setNextPw(e.target.value)}
                placeholder="New password (min 6 chars)"
                required
                minLength={6}
                className="rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
              />
              <button
                type="submit"
                disabled={updatingPw || !curPw || nextPw.length < 6}
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-[#06B6D4]/40 bg-[#06B6D4]/15 px-3 py-1.5 text-xs font-semibold text-[#22D3EE] hover:bg-[#06B6D4]/25 disabled:opacity-40"
              >
                {updatingPw ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                Update Password
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sticky Unsaved Changes Bar */}
      {isDirty && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-[#06B6D4]/50 bg-[#111827]/95 px-4 py-2.5 shadow-2xl backdrop-blur">
          <span className="text-xs font-medium text-[#F9FAFB]">You have unsaved changes</span>
          <button
            type="button"
            onClick={handleDiscard}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1 text-xs text-[#9CA3AF] hover:text-[#F9FAFB]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#06B6D4] px-3 py-1 text-xs font-semibold text-[#0B0F19] hover:bg-[#22D3EE] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save &amp; Apply
          </button>
        </div>
      )}
    </div>
  );
};
