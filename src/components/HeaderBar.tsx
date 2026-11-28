import type { User } from 'firebase/auth';
import type { AppSection } from '../types/darkroom';
import { Cloud, LogIn, MessageSquarePlus, ShieldCheck, Upload } from 'lucide-react';

interface HeaderBarProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  onImportClick: () => void;
  cloudUser: User | null;
  onOpenCloudSync: () => void;
  onOpenFeedback: () => void;
  isHost?: boolean;
  hostBadgeCount?: number;
  onOpenHostConsole?: () => void;
  creatorName?: string;
}

const LOGO_SRC = '/assets/aistudio/WhatsApp_Image_2026-11-22_at_11.16.17_PM_7f4b49a8.jpeg';

export function HeaderBar({
  activeSection,
  onSelectSection,
  onImportClick,
  cloudUser,
  onOpenCloudSync,
  onOpenFeedback,
  isHost = false,
  hostBadgeCount = 0,
  onOpenHostConsole,
  creatorName = '',
}: HeaderBarProps) {
  const navItems: { id: AppSection; label: string }[] = [
    { id: 'darkroom', label: 'Darkroom' },
    { id: 'contact-sheet', label: 'Contact Sheet' },
    { id: 'guide', label: 'Film Guide' },
  ];

  const userShortName = cloudUser?.displayName?.split(' ')[0] || 'Synced';

  return (
    <header className="shrink-0 bg-[#101012]">
      <div className="h-13 sm:h-14 border-b border-white/[0.06] px-3.5 sm:px-6 flex items-center justify-between gap-3 sm:gap-6">
        <button
          type="button"
          onClick={() => onSelectSection('darkroom')}
          className="flex items-center gap-2.5 sm:gap-3 text-left whitespace-nowrap min-w-0 shrink sm:shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59A28] rounded py-0.5"
        >
          <img
            src={LOGO_SRC}
            alt="NEGORA logo"
            className="h-8 sm:h-10 w-auto object-contain mix-blend-lighten shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <span
              className="text-sm sm:text-[15px] font-bold tracking-wider text-zinc-100 leading-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              NEGORA
            </span>
            <div className="flex items-center gap-1.5 mt-0.5 leading-snug">
              <span className="text-[11px] text-zinc-400 hidden sm:inline">
                Turn Negatives into Memories
              </span>
              {creatorName.trim() && (
                <>
                  <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-medium text-zinc-200 max-w-[130px] sm:max-w-none truncate sm:overflow-visible">
                    by {creatorName.trim()}
                  </span>
                </>
              )}
            </div>
          </div>
        </button>

        <nav aria-label="Primary" className="hidden md:flex h-full items-center gap-7">
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`relative h-full flex items-center text-[13px] font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59A28] ${
                  isActive
                    ? 'text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-[2px] bg-[#E59A28]"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {isHost && onOpenHostConsole && (
            <button
              type="button"
              onClick={onOpenHostConsole}
              title="Open Host Console"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/[0.06] text-zinc-200 hover:bg-white/[0.1] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59A28]"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#E59A28]" aria-hidden="true" />
              <span className="hidden sm:inline">Host</span>
              {hostBadgeCount > 0 && (
                <span className="font-mono tabular-nums text-[10px] px-1 rounded bg-[#E59A28]/20 text-[#E59A28]">
                  {hostBadgeCount}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onOpenFeedback}
            title="Send feedback or report a bug"
            aria-label="Send feedback"
            className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59A28]"
          >
            <MessageSquarePlus className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onOpenCloudSync}
            title={cloudUser ? `Signed in as ${cloudUser.email}` : 'Sign in to sync rolls and presets'}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59A28] ${
              cloudUser
                ? 'bg-white/[0.06] text-zinc-200 hover:bg-white/[0.1]'
                : 'text-zinc-300 hover:text-zinc-100 hover:bg-white/[0.05] border border-white/[0.08]'
            }`}
          >
            {cloudUser ? (
              <Cloud className="w-3.5 h-3.5 text-[#E59A28]" aria-hidden="true" />
            ) : (
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            <span className={cloudUser ? 'hidden sm:inline' : 'inline'}>
              {cloudUser ? userShortName : 'Sign in'}
            </span>
          </button>

          <button
            type="button"
            onClick={onImportClick}
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Import Negatives</span>
            <span className="sm:hidden">Import</span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Tabs */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden grid grid-cols-3 border-b border-white/[0.06] bg-[#101012]"
      >
        {navItems.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              className={`relative h-10 flex items-center justify-center text-xs font-medium transition-colors whitespace-nowrap ${
                isActive ? 'text-zinc-100' : 'text-zinc-400 active:text-zinc-200'
              }`}
            >
              {item.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 bottom-0 h-[2px] bg-[#E59A28]"
                />
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
