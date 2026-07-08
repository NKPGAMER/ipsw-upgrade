import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundarySection extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundarySection]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-sm">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-[#ff3b30]/15 flex items-center justify-center">
              <span className="text-2xl">&#9888;</span>
            </div>
            <p className="text-[14px] text-[#ff453a] font-medium mb-2">Đã xảy ra lỗi</p>
            <p className="text-[12px] text-[#7a7a7a] mb-4 break-all">
              {this.state.error?.message || "Lỗi không xác định"}
            </p>
            <button
              onClick={this.handleRetry}
              className="px-5 py-2 rounded-full bg-[#0066cc] hover:bg-[#0071e3] text-white text-[13px] font-medium transition-colors cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
