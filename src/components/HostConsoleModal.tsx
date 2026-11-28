import { useEffect, useMemo, useState } from 'react';
import type {
  BlockedMemberRecord,
  CloudMemberRecord,
  FeaturedPresetRecord,
  FeedbackRecord,
  SiteConfigRecord,
} from '../lib/cloudSync';
import type { GradingSettings } from '../types/darkroom';
import { extractPresetSettings } from '../lib/presetStorage';
import {
  Ban,
  CheckCircle2,
  Download,
  Inbox,
  Megaphone,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';

type HostTab = 'members' | 'controls' | 'featured' | 'inbox';

interface HostConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostEmail: string;
  members: CloudMemberRecord[];
  blockedMembers: BlockedMemberRecord[];
  siteConfig: SiteConfigRecord;
  featuredPresets: FeaturedPresetRecord[];
  feedbackItems: FeedbackRecord[];
  activeFrameSettings: GradingSettings | null;
  onSaveSiteConfig: (config: Omit<SiteConfigRecord, 'updatedAt'>) => Promise<void>;
  onPublishFeaturedPreset: (
    name: string,
    description: string,
    settings: Partial<GradingSettings>
  ) => Promise<void>;
  onDeleteFeaturedPreset: (id: string) => Promise<void>;
  onUpdateFeedbackStatus: (
    id: string,
    status: 'open' | 'resolved',
    hostNote?: string
  ) => Promise<void>;
  onDeleteFeedback: (id: string) => Promise<void>;
  onBlockMember: (uid: string, email: string, reason?: string) => Promise<void>;
  onUnblockMember: (uid: string) => Promise<void>;
}

function formatRelativeOrDate(ms: number): string {
  if (!ms) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getInitials(name: string, email: string): string {
  const source = name.trim() || email.trim() || 'N';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function csvEscape(val: string | number): string {
  const s = String(val ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function HostConsoleModal({
  isOpen,
  onClose,
  hostEmail,
  members,
  blockedMembers,
  siteConfig,
  featuredPresets,
  feedbackItems,
  activeFrameSettings,
  onSaveSiteConfig,
  onPublishFeaturedPreset,
  onDeleteFeaturedPreset,
  onUpdateFeedbackStatus,
  onDeleteFeedback,
  onBlockMember,
  onUnblockMember,
}: HostConsoleModalProps) {
  const [activeTab, setActiveTab] = useState<HostTab>('members');
  const [search, setSearch] = useState('');
  const [inboxFilter, setInboxFilter] = useState<'all' | 'open' | 'resolved'>('all');

  const [draftConfig, setDraftConfig] = useState<Omit<SiteConfigRecord, 'updatedAt'>>({
    announcementEnabled: siteConfig.announcementEnabled,
    announcementText: siteConfig.announcementText,
    maintenanceMode: siteConfig.maintenanceMode,
    maintenanceMessage: siteConfig.maintenanceMessage,
    cloudSyncEnabled: siteConfig.cloudSyncEnabled,
    cameraScannerEnabled: siteConfig.cameraScannerEnabled,
    creatorName: siteConfig.creatorName,
  });

  const [featuredName, setFeaturedName] = useState('');
  const [featuredDesc, setFeaturedDesc] = useState('');
  const [busyAction, setBusyAction] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraftConfig({
      announcementEnabled: siteConfig.announcementEnabled,
      announcementText: siteConfig.announcementText,
      maintenanceMode: siteConfig.maintenanceMode,
      maintenanceMessage: siteConfig.maintenanceMessage,
      cloudSyncEnabled: siteConfig.cloudSyncEnabled,
      cameraScannerEnabled: siteConfig.cameraScannerEnabled,
      creatorName: siteConfig.creatorName,
    });
  }, [siteConfig]);

  const blockedSet = useMemo(() => {
    const map = new Map<string, BlockedMemberRecord>();
    for (const b of blockedMembers) map.set(b.uid, b);
    return map;
  }, [blockedMembers]);

  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;
    let activeToday = 0;
    let activeWeek = 0;
    let totalFrames = 0;

    for (const m of members) {
      if (m.updatedAt && now - m.updatedAt <= dayMs) activeToday += 1;
      if (m.updatedAt && now - m.updatedAt <= weekMs) activeWeek += 1;
      totalFrames += m.rollCount ?? 0;
    }

    const openReports = feedbackItems.filter((f) => f.status === 'open').length;
    return {
      totalMembers: members.length,
      activeToday,
      activeWeek,
      totalFrames,
      openReports,
      blockedCount: blockedMembers.length,
    };
  }, [blockedMembers.length, feedbackItems, members]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.displayName.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q)
    );
  }, [members, search]);

  const filteredFeedback = useMemo(() => {
    if (inboxFilter === 'all') return feedbackItems;
    return feedbackItems.filter((f) => f.status === inboxFilter);
  }, [feedbackItems, inboxFilter]);

  if (!isOpen) return null;

  const handleExportCsv = () => {
    const headers = [
      'Name',
      'Email',
      'UID',
      'Status',
      'Cloud Presets',
      'Cloud Frames',
      'Joined',
      'Last Active',
    ];
    const rows = members.map((m) => [
      csvEscape(m.displayName),
      csvEscape(m.email),
      csvEscape(m.uid),
      csvEscape(blockedSet.has(m.uid) ? 'Blocked' : 'Active'),
      csvEscape(m.presetCount ?? 0),
      csvEscape(m.rollCount ?? 0),
      csvEscape(m.createdAt ? new Date(m.createdAt).toISOString() : ''),
      csvEscape(m.updatedAt ? new Date(m.updatedAt).toISOString() : ''),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'negora-members.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const runAction = async (fn: () => Promise<void>, successText?: string) => {
    setErrorMsg(null);
    setFeedbackMsg(null);
    setBusyAction(true);
    try {
      await fn();
      if (successText) setFeedbackMsg(successText);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Host action failed.');
    } finally {
      setBusyAction(false);
    }
  };

  const tabs: { id: HostTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'members',
      label: 'Members',
      icon: <Users className="w-3.5 h-3.5" aria-hidden="true" />,
      badge: stats.totalMembers,
    },
    {
      id: 'controls',
      label: 'Site & Toggles',
      icon: <Megaphone className="w-3.5 h-3.5" aria-hidden="true" />,
    },
    {
      id: 'featured',
      label: 'Featured Looks',
      icon: <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />,
      badge: featuredPresets.length,
    },
    {
      id: 'inbox',
      label: 'Inbox',
      icon: <Inbox className="w-3.5 h-3.5" aria-hidden="true" />,
      badge: stats.openReports,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Host Console"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4"
    >
      <div className="w-full max-w-3xl rounded-xl border border-white/[0.08] bg-[#121214] overflow-hidden flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#E59A28]" aria-hidden="true" />
            <h2
              className="text-base font-semibold text-zinc-100"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Host Console
            </h2>
            <span className="hidden sm:inline text-[11px] font-mono text-zinc-500">
              {hostEmail}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close host console"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 border-b border-white/[0.06] bg-[#101012] flex items-center gap-1 overflow-x-auto no-scrollbar shrink-0">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  setFeedbackMsg(null);
                  setErrorMsg(null);
                }}
                className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  active ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span
                    className={`font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded ${
                      tab.id === 'inbox'
                        ? 'bg-[#E59A28]/20 text-[#E59A28]'
                        : 'bg-white/[0.07] text-zinc-300'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-0 h-[2px] bg-[#E59A28]"
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Status / Error Bar */}
        {(feedbackMsg || errorMsg) && (
          <div
            className={`px-5 py-2 text-xs border-b shrink-0 flex items-center justify-between ${
              errorMsg
                ? 'bg-red-950/60 border-red-800/50 text-red-200'
                : 'bg-[#171511] border-[#E59A28]/25 text-amber-200'
            }`}
          >
            <span>{errorMsg || feedbackMsg}</span>
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setFeedbackMsg(null);
              }}
              className="text-[11px] underline underline-offset-2 ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tab Body */}
        <div className="flex-1 min-h-0 overflow-y-auto darkroom-scroll p-5 space-y-5">
          {/* TAB 1: MEMBERS & STATS */}
          {activeTab === 'members' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-3">
                  <div className="text-[11px] text-zinc-500">Total Members</div>
                  <div className="text-lg font-semibold font-mono tabular-nums text-zinc-100 mt-0.5">
                    {stats.totalMembers}
                  </div>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-3">
                  <div className="text-[11px] text-zinc-500">Active Today</div>
                  <div className="text-lg font-semibold font-mono tabular-nums text-[#E59A28] mt-0.5">
                    {stats.activeToday}
                  </div>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-3">
                  <div className="text-[11px] text-zinc-500">Active (7d)</div>
                  <div className="text-lg font-semibold font-mono tabular-nums text-zinc-100 mt-0.5">
                    {stats.activeWeek}
                  </div>
                </div>
                <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-3">
                  <div className="text-[11px] text-zinc-500">Synced Frames</div>
                  <div className="text-lg font-semibold font-mono tabular-nums text-zinc-100 mt-0.5">
                    {stats.totalFrames}
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                <div className="relative flex-1">
                  <Search
                    className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search members by name or email..."
                    className="w-full pl-8 pr-3 py-1.5 rounded bg-[#0B0B0D] border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#E59A28]"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={members.length === 0}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-white/[0.07] hover:bg-white/[0.12] text-zinc-200 text-xs font-medium transition-colors disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  Export CSV
                </button>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] divide-y divide-white/[0.05]">
                {filteredMembers.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-zinc-500">
                    {members.length === 0
                      ? 'No signed-in members recorded yet.'
                      : 'No members match your search.'}
                  </div>
                ) : (
                  filteredMembers.map((member) => {
                    const isSelf =
                      member.email.toLowerCase() === hostEmail.toLowerCase();
                    const isBlocked = blockedSet.has(member.uid);
                    return (
                      <div
                        key={member.uid}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-white/[0.07] border border-white/[0.08] flex items-center justify-center text-[11px] font-semibold text-zinc-200 shrink-0">
                            {getInitials(member.displayName, member.email)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-medium text-zinc-100 truncate">
                                {member.displayName || 'NEGORA Photographer'}
                              </span>
                              {isSelf && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-[#E59A28]/15 text-[#E59A28]">
                                  Host
                                </span>
                              )}
                              {isBlocked && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-500/20 text-red-300">
                                  Blocked
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 truncate">
                              {member.email || member.uid}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                          <div className="text-left sm:text-right space-y-0.5">
                            <div className="text-[11px] text-zinc-300 font-mono tabular-nums">
                              {member.rollCount ?? 0} frames · {member.presetCount ?? 0} presets
                            </div>
                            <div className="text-[10px] text-zinc-500 font-mono tabular-nums">
                              Active {formatRelativeOrDate(member.updatedAt)} · Joined{' '}
                              {formatRelativeOrDate(member.createdAt)}
                            </div>
                          </div>

                          {!isSelf && (
                            <button
                              type="button"
                              disabled={busyAction}
                              onClick={() => {
                                if (isBlocked) {
                                  void runAction(
                                    () => onUnblockMember(member.uid),
                                    `Unblocked ${member.email || member.displayName}.`
                                  );
                                } else {
                                  void runAction(
                                    () =>
                                      onBlockMember(
                                        member.uid,
                                        member.email,
                                        'Cloud sync suspended by host'
                                      ),
                                    `Blocked cloud sync for ${member.email || member.displayName}.`
                                  );
                                }
                              }}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-[11px] font-medium transition-colors whitespace-nowrap disabled:opacity-40 ${
                                isBlocked
                                  ? 'bg-white/[0.08] hover:bg-white/[0.14] text-zinc-100'
                                  : 'bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-800/40'
                              }`}
                            >
                              <Ban className="w-3 h-3" aria-hidden="true" />
                              {isBlocked ? 'Unblock' : 'Block'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: SITE ANNOUNCEMENT & FEATURE TOGGLES */}
          {activeTab === 'controls' && (
            <div className="space-y-5">
              {/* Creator Name / Credit */}
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-100">
                      Creator Name
                    </h3>
                    <p className="text-[11px] text-zinc-500">
                      Display your creator credit in the NEGORA header and Film Guide. Leave blank to hide.
                    </p>
                  </div>
                  {draftConfig.creatorName.trim().length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraftConfig((c) => ({ ...c, creatorName: '' }))
                      }
                      className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
                    >
                      Clear
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  maxLength={80}
                  value={draftConfig.creatorName}
                  onChange={(e) =>
                    setDraftConfig((c) => ({
                      ...c,
                      creatorName: e.target.value,
                    }))
                  }
                  placeholder="e.g. Kishan Addagalla"
                  className="w-full px-3 py-2 rounded bg-[#121214] border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#E59A28]"
                />
              </div>

              {/* Announcement Banner */}
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-100">
                      Global Announcement Banner
                    </h3>
                    <p className="text-[11px] text-zinc-500">
                      Show a live notice strip at the top of NEGORA for all visitors.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-200 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={draftConfig.announcementEnabled}
                      onChange={(e) =>
                        setDraftConfig((c) => ({
                          ...c,
                          announcementEnabled: e.target.checked,
                        }))
                      }
                      className="accent-[#E59A28] w-4 h-4"
                    />
                    Enabled
                  </label>
                </div>

                <input
                  type="text"
                  maxLength={280}
                  value={draftConfig.announcementText}
                  onChange={(e) =>
                    setDraftConfig((c) => ({
                      ...c,
                      announcementText: e.target.value,
                    }))
                  }
                  placeholder="e.g. New featured Portra & Cinestill looks added in Presets!"
                  className="w-full px-3 py-2 rounded bg-[#121214] border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#E59A28]"
                />
              </div>

              {/* Feature Toggles */}
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-4 space-y-3">
                <h3 className="text-xs font-semibold text-zinc-100">
                  Live Feature Toggles
                </h3>

                <label className="flex items-center justify-between gap-3 py-1 cursor-pointer">
                  <div>
                    <div className="text-xs text-zinc-200">Cloud Roll Sync</div>
                    <div className="text-[11px] text-zinc-500">
                      Allow signed-in members to save &amp; load rolls from Firestore.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={draftConfig.cloudSyncEnabled}
                    onChange={(e) =>
                      setDraftConfig((c) => ({
                        ...c,
                        cloudSyncEnabled: e.target.checked,
                      }))
                    }
                    className="accent-[#E59A28] w-4 h-4 shrink-0"
                  />
                </label>

                <label className="flex items-center justify-between gap-3 py-1 border-t border-white/[0.05] pt-3 cursor-pointer">
                  <div>
                    <div className="text-xs text-zinc-200">Camera Lightbox Scanner</div>
                    <div className="text-[11px] text-zinc-500">
                      Show the live camera scan button in the Darkroom and Contact Sheet.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={draftConfig.cameraScannerEnabled}
                    onChange={(e) =>
                      setDraftConfig((c) => ({
                        ...c,
                        cameraScannerEnabled: e.target.checked,
                      }))
                    }
                    className="accent-[#E59A28] w-4 h-4 shrink-0"
                  />
                </label>
              </div>

              {/* Maintenance Mode */}
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-100">
                      Maintenance Mode
                    </h3>
                    <p className="text-[11px] text-zinc-500">
                      Show a maintenance screen to non-host visitors while updating.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-200 cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={draftConfig.maintenanceMode}
                      onChange={(e) =>
                        setDraftConfig((c) => ({
                          ...c,
                          maintenanceMode: e.target.checked,
                        }))
                      }
                      className="accent-[#E59A28] w-4 h-4"
                    />
                    Active
                  </label>
                </div>

                <textarea
                  rows={2}
                  maxLength={280}
                  value={draftConfig.maintenanceMessage}
                  onChange={(e) =>
                    setDraftConfig((c) => ({
                      ...c,
                      maintenanceMessage: e.target.value,
                    }))
                  }
                  className="w-full px-3 py-2 rounded bg-[#121214] border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#E59A28] resize-none"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() =>
                    void runAction(
                      () => onSaveSiteConfig(draftConfig),
                      'Saved site settings live.'
                    )
                  }
                  className="px-4 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  {busyAction ? 'Saving...' : 'Save Site Settings'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: FEATURED PRESETS */}
          {activeTab === 'featured' && (
            <div className="space-y-5">
              <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] p-4 space-y-3">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-100">
                    Publish Active Darkroom Grade as Featured Look
                  </h3>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    Adjust your sliders in the Darkroom, then publish that look for all
                    NEGORA users to apply with one click.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    maxLength={80}
                    value={featuredName}
                    onChange={(e) => setFeaturedName(e.target.value)}
                    placeholder="Preset name (e.g. Cinestill 800T Neon)"
                    className="px-3 py-2 rounded bg-[#121214] border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#E59A28]"
                  />
                  <input
                    type="text"
                    maxLength={160}
                    value={featuredDesc}
                    onChange={(e) => setFeaturedDesc(e.target.value)}
                    placeholder="Short note (e.g. Cool shadows, warm tungsten highlights)"
                    className="px-3 py-2 rounded bg-[#121214] border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#E59A28]"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={
                      busyAction || !featuredName.trim() || !activeFrameSettings
                    }
                    onClick={() => {
                      if (!activeFrameSettings) return;
                      const extracted = extractPresetSettings(activeFrameSettings);
                      void runAction(async () => {
                        await onPublishFeaturedPreset(
                          featuredName,
                          featuredDesc,
                          extracted
                        );
                        setFeaturedName('');
                        setFeaturedDesc('');
                      }, `Published "${featuredName.trim()}" to Featured Looks.`);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors disabled:opacity-45"
                  >
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    Publish Featured Look
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] divide-y divide-white/[0.05]">
                {featuredPresets.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-zinc-500">
                    No featured presets published yet.
                  </div>
                ) : (
                  featuredPresets.map((fp) => (
                    <div
                      key={fp.id}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-zinc-100 truncate">
                          {fp.name}
                        </div>
                        {fp.description && (
                          <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                            {fp.description}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() =>
                          void runAction(
                            () => onDeleteFeaturedPreset(fp.id),
                            `Removed "${fp.name}".`
                          )
                        }
                        aria-label={`Delete ${fp.name}`}
                        className="p-1.5 rounded text-zinc-400 hover:text-red-300 hover:bg-white/[0.06] transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* TAB 4: FEEDBACK INBOX */}
          {activeTab === 'inbox' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 p-0.5 rounded-md bg-[#0B0B0D] border border-white/[0.06]">
                  {(['all', 'open', 'resolved'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setInboxFilter(filter)}
                      className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${
                        inboxFilter === filter
                          ? 'bg-white/[0.1] text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] font-mono text-zinc-500">
                  {filteredFeedback.length} items
                </span>
              </div>

              <div className="rounded-lg border border-white/[0.06] bg-[#0B0B0D] divide-y divide-white/[0.05]">
                {filteredFeedback.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-zinc-500">
                    No feedback or bug reports in this view.
                  </div>
                ) : (
                  filteredFeedback.map((item) => (
                    <div key={item.id} className="p-4 space-y-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-white/[0.07] text-zinc-300">
                              {item.category}
                            </span>
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                item.status === 'resolved'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-[#E59A28]/15 text-[#E59A28]'
                              }`}
                            >
                              {item.status === 'resolved' ? 'Resolved' : 'Open'}
                            </span>
                            <span className="text-xs font-medium text-zinc-100 truncate">
                              {item.authorName}
                            </span>
                            <span className="text-[11px] text-zinc-500 truncate">
                              {item.authorEmail}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-zinc-500">
                            {formatRelativeOrDate(item.createdAt)}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() =>
                              void runAction(() =>
                                onUpdateFeedbackStatus(
                                  item.id,
                                  item.status === 'resolved' ? 'open' : 'resolved'
                                )
                              )
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-zinc-200 transition-colors"
                          >
                            {item.status === 'resolved' ? (
                              <>
                                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                                Reopen
                              </>
                            ) : (
                              <>
                                <CheckCircle2
                                  className="w-3 h-3 text-emerald-400"
                                  aria-hidden="true"
                                />
                                Resolve
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() =>
                              void runAction(() => onDeleteFeedback(item.id))
                            }
                            aria-label="Delete feedback"
                            className="p-1.5 rounded text-zinc-400 hover:text-red-300 hover:bg-white/[0.06] transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {item.message}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
