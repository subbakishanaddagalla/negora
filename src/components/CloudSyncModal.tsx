import type { User } from 'firebase/auth';
import { Cloud, CloudDownload, CloudUpload, LogOut, X } from 'lucide-react';

interface CloudSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  authReady: boolean;
  isSyncing: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
  presetCount: number;
  frameCount: number;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onPushRoll: () => Promise<void>;
  onPullRoll: () => Promise<void>;
}

export function CloudSyncModal({
  isOpen,
  onClose,
  user,
  authReady,
  isSyncing,
  statusMessage,
  errorMessage,
  presetCount,
  frameCount,
  onSignIn,
  onSignOut,
  onPushRoll,
  onPullRoll,
}: CloudSyncModalProps) {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cloud roll sync"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-[#121214] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 text-[#E59A28]" aria-hidden="true" />
            <h2
              className="text-base font-semibold text-zinc-100"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Cloud Roll Sync
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cloud sync"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!authReady ? (
            <p className="text-xs text-zinc-400">Checking account status...</p>
          ) : !user ? (
            <div className="space-y-4">
              <p className="text-xs text-zinc-300 leading-relaxed">
                Sign in with Google to back up your calibrated film rolls, metadata,
                and custom grading presets across desktop and mobile devices.
              </p>
              <button
                type="button"
                disabled={isSyncing}
                onClick={() => void onSignIn()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Continue with Google
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 truncate">
                    {user.displayName || 'Photographer'}
                  </div>
                  <div className="text-xs text-zinc-400 truncate">{user.email}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void onSignOut()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-white/[0.05] hover:bg-white/[0.09] text-zinc-300 text-xs transition-colors shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                  Sign out
                </button>
              </div>

              <div className="text-xs text-zinc-400 flex items-center gap-2 font-mono tabular-nums">
                <span>{frameCount} frames in roll</span>
                <span aria-hidden="true">·</span>
                <span>{presetCount} cloud presets</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => void onPushRoll()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
                  {isSyncing ? 'Syncing...' : 'Save Roll to Cloud'}
                </button>

                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={() => void onPullRoll()}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-md bg-white/[0.07] hover:bg-white/[0.12] text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <CloudDownload className="w-3.5 h-3.5" aria-hidden="true" />
                  Load Cloud Roll
                </button>
              </div>
            </div>
          )}

          {statusMessage && (
            <p className="text-xs text-amber-300/90 leading-relaxed">{statusMessage}</p>
          )}
          {errorMessage && (
            <p className="text-xs text-red-300 leading-relaxed">{errorMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
