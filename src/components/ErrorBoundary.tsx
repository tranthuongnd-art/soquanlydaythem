import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let readable = error.message || 'Đã xảy ra lỗi không mong muốn.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string; path?: string };
      if (parsed.error) {
        if (parsed.error.includes('Quota exceeded')) {
          readable = 'Hạn mức sử dụng Firestore miễn phí trong ngày đã đạt giới hạn. Hạn mức sẽ tự đặt lại vào ngày mai.';
        } else if (parsed.error.includes('Missing or insufficient permissions')) {
          readable = `Tài khoản của bạn không có quyền thực hiện thao tác (${parsed.operationType ?? 'read'}) trên dữ liệu "${parsed.path ?? ''}".`;
        } else {
          readable = parsed.error;
        }
      }
    } catch {
      // Keep original message
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error): void {
    console.error('ErrorBoundary caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FDFBFC] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white border border-pink-100 rounded-2xl p-6 shadow-sm">
            <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center mb-4">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">Đã xảy ra sự cố kết nối dữ liệu</h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">{this.state.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center gap-2 w-full min-h-[44px] rounded-xl bg-[#DB2777] text-white text-sm font-medium hover:bg-[#BE185D] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Tải lại ứng dụng
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
