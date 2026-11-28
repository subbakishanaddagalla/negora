import { useState } from 'react';
import type { User } from 'firebase/auth';
import type { FeedbackCategory } from '../lib/cloudSync';
import { MessageSquarePlus, Send, X } from 'lucide-react';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onSignIn: () => Promise<void>;
  onSubmit: (category: FeedbackCategory, message: string) => Promise<void>;
}

export function FeedbackModal({
  isOpen,
  onClose,
  user,
  onSignIn,
  onSubmit,
}: FeedbackModalProps) {
  const [category, setCategory] = useState<FeedbackCategory>('feature');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSend = async () => {
    if (!message.trim()) return;
    setErrorMsg(null);
    setSentNotice(null);
    setIsSending(true);
    try {
      await onSubmit(category, message);
      setMessage('');
      setSentNotice('Thanks! Your message has been sent.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not send feedback.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send Feedback"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-white/[0.08] bg-[#121214] overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="w-4 h-4 text-[#E59A28]" aria-hidden="true" />
            <h2
              className="text-base font-semibold text-zinc-100"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Send Feedback
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close feedback modal"
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!user ? (
            <div className="space-y-3">
              <p className="text-xs text-zinc-300 leading-relaxed">
                Sign in with your Google account to send bug reports, film-stock
                requests, or feature suggestions.
              </p>
              <button
                type="button"
                onClick={() => void onSignIn()}
                className="w-full px-4 py-2.5 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors"
              >
                Sign in with Google
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-xs text-zinc-300 block">Topic</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-0.5 rounded-md bg-[#0B0B0D]">
                  {(
                    [
                      { id: 'feature', label: 'Feature' },
                      { id: 'bug', label: 'Bug' },
                      { id: 'film-stock', label: 'Film Stock' },
                      { id: 'general', label: 'General' },
                    ] as { id: FeedbackCategory; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setCategory(opt.id)}
                      className={`py-1.5 rounded text-[11px] font-medium transition-colors ${
                        category === opt.id
                          ? 'bg-white/[0.1] text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-zinc-300 block">Message</label>
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Share an issue, film stock request, or idea..."
                  className="w-full px-3 py-2 rounded bg-[#0B0B0D] border border-white/[0.08] text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#E59A28] resize-none"
                />
              </div>

              <button
                type="button"
                disabled={isSending || !message.trim()}
                onClick={() => void handleSend()}
                className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors disabled:opacity-45"
              >
                <Send className="w-3.5 h-3.5" aria-hidden="true" />
                {isSending ? 'Sending...' : 'Send Feedback'}
              </button>
            </>
          )}

          {sentNotice && (
            <p className="text-xs text-emerald-300 leading-relaxed break-words">
              {sentNotice}
            </p>
          )}
          {errorMsg && (
            <p className="text-xs text-red-300 leading-relaxed break-words">
              {(() => {
                if (errorMsg.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(errorMsg) as { error?: string };
                    if (parsed.error) return parsed.error;
                  } catch {
                    // Fallback to raw message
                  }
                }
                return errorMsg;
              })()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
