import React, { ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught Error in Component:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 font-sans">
          <div className="max-w-md w-full bg-white rounded-2xl p-6 sm:p-8 shadow-2xl border border-slate-200 text-center space-y-5 animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <div>
              <h2 className="text-xl font-bold text-slate-800">Terjadi Kendala Tampilan</h2>
              <p className="text-xs text-slate-500 font-medium mt-1 leading-relaxed">
                Sistem mengalami gangguan sementara saat memuat data. Jangan khawatir, data Anda tetap aman.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 bg-slate-100/80 rounded-xl border border-slate-200 text-left text-[11px] font-mono text-slate-600 overflow-x-auto max-h-28">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="flex-1 py-3 bg-[#85cc00] hover:bg-[#7bc000] text-slate-800 font-bold text-xs uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer"
              >
                Muat Ulang
              </button>
              <button
                onClick={() => {
                  try {
                    localStorage.removeItem("current_student");
                  } catch (e) {}
                  window.location.href = "/";
                }}
                className="flex-1 py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
              >
                Ke Login
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
