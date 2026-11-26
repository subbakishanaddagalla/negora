import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || 'An unexpected darkroom error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('NEGORA ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen w-full bg-[#0E0E10] text-zinc-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-xl border border-white/[0.08] bg-[#141416] p-6 space-y-4">
            <h1
              className="text-lg font-bold text-zinc-100"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Something went wrong
            </h1>
            <p className="text-xs text-zinc-400 leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-md bg-[#E59A28] hover:bg-[#eda93f] text-[#0E0E10] text-xs font-semibold transition-colors"
            >
              Reload NEGORA
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
