import { ArrowRight } from 'lucide-react';

interface FilmGuideViewProps {
  onReturnToDarkroom: () => void;
  creatorName?: string;
}

const SHORTCUTS = [
  { key: 'Cmd / Ctrl + V', action: 'Paste an image negative directly from your clipboard' },
  { key: 'Cmd / Ctrl + Z', action: 'Undo last adjustment on the active frame' },
  { key: 'Cmd / Ctrl + Shift + Z', action: 'Redo previously undone adjustment' },
  { key: 'Space', action: 'Toggle between Developed Positive and Raw Negative' },
  { key: 'B', action: 'Activate Pick Film Base eyedropper' },
  { key: 'G', action: 'Activate Pick Neutral Gray white-balance eyedropper' },
  { key: 'H', action: 'Activate Spot Heal brush for dust & scratches' },
  { key: 'D', action: 'Activate Dodge & Burn exposure brush' },
  { key: 'C', action: 'Open Crop, Aspect Ratio, Straighten & Strip Splitter' },
  { key: 'P', action: 'Open 4-Corner Perspective Straightener' },
  { key: 'J', action: 'Toggle highlight & shadow clipping warning overlay' },
  { key: 'U', action: 'Toggle Rule-of-Thirds alignment grid' },
  { key: 'R', action: 'Rotate active frame 90° clockwise' },
  { key: 'F', action: 'Flip horizontally (for emulsion-side scans)' },
  { key: '← / →', action: 'Select previous or next frame on the filmstrip' },
  { key: 'Esc', action: 'Cancel active tool or overlay' },
];

export function FilmGuideView({ onReturnToDarkroom, creatorName = '' }: FilmGuideViewProps) {
  return (
    <main className="flex-1 min-h-0 overflow-y-auto darkroom-scroll bg-[#0E0E10]">
      <div className="max-w-[980px] mx-auto px-4 sm:px-6 py-7 sm:py-10 space-y-10 sm:space-y-12">
        {/* Intro */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-6 sm:gap-8 border-b border-zinc-800/90 pb-8">
          <div className="space-y-4 max-w-2xl">
            <h1
              className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100 text-balance"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Turn Negatives into Memories
            </h1>
            <p className="text-sm sm:text-base text-zinc-300 leading-relaxed">
              Simply inverting RGB values turns a C-41 color negative cyan and muddy.
              NEGORA models physical film transmittance, neutralizes the orange
              coupler mask, and lets you straighten, split strips, curve-grade, and
              archive every roll directly in your browser.
            </p>
            <div className="pt-1">
              <button
                type="button"
                onClick={onReturnToDarkroom}
                className="inline-flex items-center gap-2 px-4 py-2.5 sm:py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors"
              >
                Open Darkroom
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <img
            src="/assets/aistudio/WhatsApp_Image_2026-11-22_at_11.16.17_PM_7f4b49a8.jpeg"
            alt="NEGORA — Turn Negatives into Memories"
            className="w-40 sm:w-56 h-auto object-contain mix-blend-lighten shrink-0 self-center md:self-auto"
          />
        </section>

        {/* Three-step optical process */}
        <section className="space-y-6">
          <h2
            className="text-xl font-semibold text-zinc-100"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            01. How the optical inversion works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-5 rounded-lg border border-zinc-800 bg-[#141416] space-y-2">
              <span className="font-mono text-xs text-[#E59A28]">Step 01</span>
              <h3 className="text-sm font-semibold text-zinc-100">
                Film Base Neutralization
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Unexposed rebate borders reveal the exact orange mask color of the film
                stock. Dividing each pixel by this base reference removes color cast
                before inversion.
              </p>
            </div>

            <div className="p-5 rounded-lg border border-zinc-800 bg-[#141416] space-y-2">
              <span className="font-mono text-xs text-[#E59A28]">Step 02</span>
              <h3 className="text-sm font-semibold text-zinc-100">
                Logarithmic Density Mapping
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Silver halide and dye clouds absorb light exponentially. Computing{' '}
                <span className="font-mono text-zinc-200">-log(T)</span> converts raw
                scanner brightness directly back into linear scene exposure stops.
              </p>
            </div>

            <div className="p-5 rounded-lg border border-zinc-800 bg-[#141416] space-y-2">
              <span className="font-mono text-xs text-[#E59A28]">Step 03</span>
              <h3 className="text-sm font-semibold text-zinc-100">
                Curves, Retouching &amp; Framing
              </h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Fine-tune RGB tone curves, split-tone color wheels, spot-heal dust
                specks, save custom presets, and export EXIF-tagged prints, contact
                sheet PDFs, or full ZIP rolls.
              </p>
            </div>
          </div>
        </section>

        {/* Practical Digitizing Guide */}
        <section className="space-y-4">
          <h2
            className="text-xl font-semibold text-zinc-100"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            02. Scanning old negatives with a phone or camera
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-[#141416] divide-y divide-zinc-800/80">
            <div className="p-5 flex flex-col sm:flex-row sm:items-start gap-4">
              <span className="font-mono text-xs text-zinc-500 shrink-0 w-28">
                Backlight
              </span>
              <p className="text-sm text-zinc-300 leading-relaxed">
                Place a tablet or monitor displaying a pure white screen underneath a
                sheet of frosted acrylic or tracing paper, then lay the film strip flat.
                If corners darken, raise Backlight Falloff in the inspector.
              </p>
            </div>
            <div className="p-5 flex flex-col sm:flex-row sm:items-start gap-4">
              <span className="font-mono text-xs text-zinc-500 shrink-0 w-28">
                Strip &amp; Skew
              </span>
              <p className="text-sm text-zinc-300 leading-relaxed">
                If your phone capture was tilted or shows multiple frames in one strip,
                use <span className="font-mono text-zinc-100">Warp (P)</span> to snap the
                4 corners square, then{' '}
                <span className="font-mono text-zinc-100">Crop (C)</span> with Auto-Frame
                or Split Strip to separate each photo automatically.
              </p>
            </div>
            <div className="p-5 flex flex-col sm:flex-row sm:items-start gap-4">
              <span className="font-mono text-xs text-zinc-500 shrink-0 w-28">
                Mirroring
              </span>
              <p className="text-sm text-zinc-300 leading-relaxed">
                If text or street signs appear backwards after converting, press{' '}
                <span className="font-mono text-zinc-100">F</span> or click the Flip
                Horizontal button in the toolbar.
              </p>
            </div>
            <div className="p-5 flex flex-col sm:flex-row sm:items-start gap-4">
              <span className="font-mono text-xs text-zinc-500 shrink-0 w-28">
                RAW &amp; Camera
              </span>
              <p className="text-sm text-zinc-300 leading-relaxed">
                Import PNG, JPEG, WebP, 16-bit TIFF, or Camera RAW (DNG, CR2, NEF, ARW)
                files, paste from clipboard, or use the built-in Camera Scanner for live
                lightbox previews. Use Sign in to sync rolls and presets across
                devices.
              </p>
            </div>
          </div>
        </section>

        {/* Keyboard Shortcuts */}
        <section className="space-y-4">
          <h2
            className="text-xl font-semibold text-zinc-100"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            03. Keyboard shortcuts
          </h2>
          <div className="rounded-lg border border-zinc-800 bg-[#141416] overflow-hidden">
            <table className="w-full text-left border-collapse text-sm">
              <tbody className="divide-y divide-zinc-800/80">
                {SHORTCUTS.map((item) => (
                  <tr key={item.key} className="hover:bg-zinc-900/50">
                    <td className="py-3 px-4 w-48 font-mono text-xs text-[#E59A28]">
                      {item.key}
                    </td>
                    <td className="py-3 px-4 text-zinc-300">{item.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {creatorName.trim() && (
          <footer className="pt-6 border-t border-zinc-800/80 flex items-center justify-between text-xs text-zinc-500">
            <span>NEGORA — Turn Negatives into Memories</span>
            <span className="text-zinc-300">Created by {creatorName.trim()}</span>
          </footer>
        )}
      </div>
    </main>
  );
}
