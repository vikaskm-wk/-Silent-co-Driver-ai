import React, { Component, ReactNode, ErrorInfo } from 'react';
import { AlertCircle } from 'lucide-react';

interface LocalErrorBoundaryProps {
  children: ReactNode;
  onReset: () => void;
}

interface LocalErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class LocalErrorBoundary extends Component<LocalErrorBoundaryProps, LocalErrorBoundaryState> {
  state: LocalErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  constructor(props: LocalErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): LocalErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Local Error Boundary caught a render crash:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#0D0F12] select-none">
          <div className="w-full max-w-md bg-[#13161A] border border-[#E53935]/30 rounded-lg p-6 shadow-2xl text-left">
            <div className="flex items-center gap-3 mb-4 text-[#E53935]">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h2 className="text-sm font-bold tracking-wider uppercase font-mono">ANALYSIS ERROR</h2>
            </div>
            <p className="text-sm text-[#F1F3F5] mb-6 font-sans">
              Audio processing failed.
            </p>
            {this.state.error && (
              <div className="bg-[#0D0F12] border border-[#292F35] p-3 rounded mb-6 overflow-auto text-xs max-h-40 font-mono text-[#E53935]">
                <span className="font-bold block mb-1">TECHNICAL ERROR:</span>
                {this.state.error.message || String(this.state.error)}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 py-2.5 bg-[#E53935] hover:bg-[#F04A46] text-white font-bold text-xs uppercase tracking-widest rounded transition-colors cursor-pointer text-center"
              >
                [ RETRY ANALYSIS ]
              </button>
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="flex-1 py-2.5 bg-[#1C2025] hover:bg-[#252B31] text-[#A6ADB7] hover:text-white font-bold text-xs uppercase tracking-widest rounded border border-[#292F35] transition-colors cursor-pointer text-center"
              >
                [ START NEW SESSION ]
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
