import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, Upload, X } from 'lucide-react';
import {
  analyzeNegativeImageData,
  createDefaultSettings,
  processNegativeImageData,
} from '../lib/negativeProcessor';

interface CameraScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCaptureCanvas: (canvas: HTMLCanvasElement, name: string) => void;
  onImportFilesClick: () => void;
}

export function CameraScannerModal({
  isOpen,
  onClose,
  onCaptureCanvas,
  onImportFilesClick,
}: CameraScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [liveInvert, setLiveInvert] = useState(true);
  const [filmMode, setFilmMode] = useState<'c41' | 'bw'>('c41');
  const [isReady, setIsReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setIsReady(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      return;
    }

    let cancelled = false;
    setCameraError(null);
    setIsReady(false);

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Camera access is not supported in this browser.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          if (!cancelled) setIsReady(true);
        }
      } catch {
        if (!cancelled) {
          setCameraError(
            'Could not access the camera. Allow camera permissions or import a photo instead.'
          );
        }
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [isOpen, facingMode, stopStream]);

  useEffect(() => {
    if (!isOpen || !isReady) return;

    let lastProcess = 0;
    const renderLoop = (now: number) => {
      const video = videoRef.current;
      const canvas = previewCanvasRef.current;
      if (video && canvas && video.videoWidth > 0 && video.videoHeight > 0) {
        if (!liveInvert) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(video, 0, 0);
        } else if (now - lastProcess > 70) {
          lastProcess = now;
          const maxPreview = 560;
          const scale = Math.min(
            1,
            maxPreview / Math.max(video.videoWidth, video.videoHeight)
          );
          const pw = Math.max(1, Math.round(video.videoWidth * scale));
          const ph = Math.max(1, Math.round(video.videoHeight * scale));

          if (!offscreenRef.current) {
            offscreenRef.current = document.createElement('canvas');
          }
          const off = offscreenRef.current;
          off.width = pw;
          off.height = ph;
          const offCtx = off.getContext('2d');
          if (offCtx) {
            offCtx.drawImage(video, 0, 0, pw, ph);
            const raw = offCtx.getImageData(0, 0, pw, ph);
            const analysis = analyzeNegativeImageData(raw);
            const settings = createDefaultSettings({
              profile: filmMode === 'bw' ? 'bw-silver' : 'c41-standard',
              baseColor: analysis.baseColor,
              borderIgnore: 6,
            });
            const { imageData } = processNegativeImageData(raw, settings);
            canvas.width = pw;
            canvas.height = ph;
            const pCtx = canvas.getContext('2d');
            pCtx?.putImageData(imageData, 0, 0);
          }
        }
      }
      rafRef.current = requestAnimationFrame(renderLoop);
    };

    rafRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isOpen, isReady, liveInvert, filmMode]);

  if (!isOpen) return null;

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = video.videoWidth;
    fullCanvas.height = video.videoHeight;
    const ctx = fullCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    const now = new Date();
    const stamp = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join('');

    onCaptureCanvas(fullCanvas, `Camera Scan ${stamp}`);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera negative scanner"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
    >
      <div className="w-full max-w-2xl rounded-xl border border-white/[0.08] bg-[#121214] overflow-hidden flex flex-col max-h-[92vh]">
        <div className="px-4 sm:px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <h2
              className="text-sm sm:text-base font-semibold text-zinc-100 truncate"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Camera Lightbox Scanner
            </h2>
            <p className="text-[11px] text-zinc-400 truncate">
              Place your film negative over a white backlight screen and capture.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close scanner"
            className="p-2 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="relative bg-[#080809] aspect-[4/3] w-full flex items-center justify-center overflow-hidden">
          <video ref={videoRef} playsInline muted className="hidden" />

          {cameraError ? (
            <div className="p-6 text-center space-y-3 max-w-sm">
              <p className="text-xs text-zinc-300 leading-relaxed">{cameraError}</p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onImportFilesClick();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors"
              >
                <Upload className="w-3.5 h-3.5" />
                Choose Image File
              </button>
            </div>
          ) : (
            <>
              <canvas
                ref={previewCanvasRef}
                className="w-full h-full object-contain block"
              />
              {!isReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-400 bg-[#080809]">
                  <div className="w-6 h-6 rounded-full border-2 border-zinc-800 border-t-[#E59A28] animate-spin" />
                  <span className="text-xs">Starting camera...</span>
                </div>
              )}
              {isReady && (
                <div className="pointer-events-none absolute inset-6 border border-dashed border-white/30 rounded" />
              )}
            </>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3.5 border-t border-white/[0.06] bg-[#101012] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLiveInvert((v) => !v)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                liveInvert
                  ? 'bg-white/[0.1] text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200 bg-white/[0.03]'
              }`}
            >
              {liveInvert ? 'Live Positive' : 'Raw Viewfinder'}
            </button>

            {liveInvert && (
              <div className="flex items-center gap-0.5 p-0.5 rounded bg-[#0B0B0D]">
                <button
                  type="button"
                  onClick={() => setFilmMode('c41')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    filmMode === 'c41'
                      ? 'bg-white/[0.1] text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Color
                </button>
                <button
                  type="button"
                  onClick={() => setFilmMode('bw')}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    filmMode === 'bw'
                      ? 'bg-white/[0.1] text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  B&amp;W
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))
              }
              title="Switch camera"
              aria-label="Switch camera"
              className="p-2 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            disabled={!isReady}
            onClick={handleCapture}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors whitespace-nowrap disabled:opacity-40"
          >
            <Camera className="w-3.5 h-3.5" aria-hidden="true" />
            Capture Negative
          </button>
        </div>
      </div>
    </div>
  );
}
