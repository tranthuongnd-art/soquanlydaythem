import React, { useState } from 'react';
import { Download, Share, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        onClick={() => void install()}
        className={`inline-flex items-center justify-center gap-2 rounded-xl border border-pink-200 bg-pink-50 text-[#BE185D] font-medium hover:bg-pink-100 transition-colors whitespace-nowrap shrink-0 ${
          compact ? 'min-h-[40px] px-3 text-xs' : 'min-h-[44px] px-4 text-sm w-full'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        <span>Cài ứng dụng</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-xl border border-pink-200 bg-white text-slate-700 font-medium hover:bg-pink-50 transition-colors whitespace-nowrap shrink-0 ${
            compact ? 'min-h-[40px] px-3 text-xs' : 'min-h-[44px] px-4 text-sm w-full'
          }`}
        >
          <Share className="w-4 h-4 shrink-0 text-[#DB2777]" />
          <span>Cài lên iPhone</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 border border-pink-100 shadow-lg">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Cài đặt lên màn hình chính</h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                  aria-label="Đóng"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-600 list-decimal list-inside">
                <li>
                  Chạm biểu tượng <strong>Chia sẻ (Share)</strong> trên thanh công cụ Safari.
                </li>
                <li>
                  Cuộn xuống và chọn <strong>Thêm vào MH chính (Add to Home Screen)</strong>.
                </li>
                <li>
                  Nhấn <strong>Thêm</strong> để mở Sổ Dạy Học Thông Minh như ứng dụng di động.
                </li>
              </ol>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-5 w-full min-h-[44px] rounded-xl bg-[#DB2777] text-white text-sm font-medium hover:bg-[#BE185D]"
              >
                Đã hiểu
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 lg:bottom-4 left-4 right-4 sm:right-auto z-50 flex items-center gap-2.5 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-medium text-white shadow-md no-print"
    >
      <WifiOff className="w-4 h-4 shrink-0" />
      <span>Đang ngoại tuyến — Dữ liệu tạm lưu và sẽ tự đồng bộ khi có mạng.</span>
    </div>
  );
};
