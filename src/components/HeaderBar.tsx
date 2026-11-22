import type { AppSection } from '../types/darkroom';
import { Upload } from 'lucide-react';

interface HeaderBarProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  onImportClick: () => void;
}

const LOGO_SRC = '/assets/aistudio/WhatsApp_Image_2026-11-22_at_11.16.17_PM_7f4b49a8.jpeg';

export function HeaderBar({
  activeSection,
  onSelectSection,
  onImportClick,
}: HeaderBarProps) {
  const navItems: { id: AppSection; label: string }[] = [
    { id: 'darkroom', label: 'Darkroom' },
    { id: 'contact-sheet', label: 'Contact Sheet' },
    { id: 'guide', label: 'Film Guide' },
  ];

  return (
    <header className="shrink-0 bg-[#101012]">
      <div className="h-13 sm:h-14 border-b border-white/[0.06] px-3.5 sm:px-6 flex items-center justify-between gap-3 sm:gap-6">
        <button
          type="button"
          onClick={() => onSelectSection('darkroom')}
          className="flex items-center gap-2.5 sm:gap-3 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E59A28] rounded py-0.5"
        >
          <img
            src={LOGO_SRC}
            alt="NEGORA logo"
            className="h-8 sm:h-10 w-auto object-contain mix-blend-lighten shrink-0"
          />
          <div className="flex flex-col">
            <span
              className="text-sm sm:text-[15px] font-bold tracking-wider text-zinc-100 leading-none"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              NEGORA
            </span>
            <span className="text-[11px] text-zinc-400 leading-none mt-1 hidden sm:block">
              Turn Negatives into Memories
            </span>
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

        <div className="shrink-0">
          <button
            type="button"
            onClick={onImportClick}
            className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 sm:py-1.5 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
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
