import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  MessageCircle,
  Phone,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { FIREBASE_PROJECT_ID } from '../lib/firebase';
import { PWAInstallButton } from './PWAComponents';

export const LoginScreen: React.FC = () => {
  const {
    signInWithGoogle,
    signInWithPhonePassword,
    registerTeacherWithPhonePassword,
    authError,
    authProviderDisabled,
    clearAuthError,
  } = useApp();

  const [showPhoneForm, setShowPhoneForm] = useState(false);
  const [mode, setMode] = useState<'login' | 'register_teacher'>('login');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const switchMode = (next: 'login' | 'register_teacher') => {
    setMode(next);
    setLocalError(null);
    clearAuthError();
  };

  const handleGoogleLogin = async () => {
    setLocalError(null);
    clearAuthError();
    setGoogleSubmitting(true);
    try {
      await signInWithGoogle();
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (mode === 'register_teacher') {
      if (!fullName.trim()) {
        setLocalError('Vui lòng nhập họ và tên giáo viên.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Mật khẩu nhập lại không khớp.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signInWithPhonePassword(phone, password);
      } else {
        await registerTeacherWithPhonePassword(fullName, phone, password);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const displayedError = localError || authError;

  return (
    <div className="min-h-screen bg-[#FDFBFC] flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-5 py-4 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/src/assets/images/smart_teaching_emblem_1795217994518.jpg"
            alt="Biểu tượng Sổ Dạy Học Thông Minh"
            referrerPolicy="no-referrer"
            className="w-9 h-9 rounded-xl object-cover border border-pink-100 shrink-0"
          />
          <span className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap truncate">
            Smart Teaching
          </span>
        </div>
        <div className="shrink-0">
          <PWAInstallButton compact />
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-5 py-6 lg:py-10 flex items-center">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          <section className="lg:col-span-6 flex flex-col justify-center">
            <p className="text-xs font-semibold text-[#BE185D] tracking-wide">
              Sổ Dạy Học Thông Minh · Dành riêng cho Giáo viên &amp; Trợ giảng
            </p>
            <h1
              className="mt-2.5 text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-[1.15]"
              style={{ textWrap: 'balance' }}
            >
              Quản lý lớp học thêm nhẹ nhàng, gửi tin Zalo phụ huynh trong 1 chạm
            </h1>
            <p className="mt-3 text-sm text-slate-600 leading-relaxed max-w-xl">
              Giáo viên và trợ giảng dùng chung một sổ dạy học trực tuyến để điểm danh nhanh, nhập báo cáo BTVN cả lớp và sao chép tin nhắn nhận xét gửi thẳng qua Zalo cho phụ huynh.
            </p>

            {/* Primary Login Card: Google 1-Click + Optional Phone/Password */}
            <div className="mt-6 rounded-2xl bg-white border border-pink-200/80 p-5 sm:p-6 shadow-xs space-y-4">
              <div className="space-y-2.5">
                <button
                  type="button"
                  onClick={() => void handleGoogleLogin()}
                  disabled={googleSubmitting || submitting}
                  className="w-full min-h-[50px] px-5 rounded-xl bg-[#DB2777] text-white font-semibold text-sm hover:bg-[#BE185D] active:scale-[0.99] transition-all inline-flex items-center justify-center gap-3 shadow-sm disabled:opacity-60 cursor-pointer"
                >
                  <span className="w-6 h-6 rounded-full bg-white inline-flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                  </span>
                  <span>
                    {googleSubmitting
                      ? 'Đang mở cửa sổ Google...'
                      : 'Đăng nhập bằng Google (Giáo viên & Trợ giảng)'}
                  </span>
                </button>
                <p className="text-xs text-slate-600 leading-relaxed">
                  <strong>Vào ngay trong 1 chạm:</strong> Giáo viên chính bấm đăng nhập bằng Gmail để mở sổ lớp học. Trợ giảng sau khi được Giáo viên thêm Gmail trong mục <em>Cài đặt → Quản lý Trợ giảng</em> cũng bấm nút này để tự động vào dùng chung dữ liệu.
                </p>
              </div>

              {displayedError && (
                <div className="text-xs sm:text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 space-y-2">
                  <p className="font-medium">{displayedError}</p>
                  {authProviderDisabled && (
                    <div className="pt-2 border-t border-rose-200 text-xs text-rose-900 space-y-1.5">
                      <p className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Nếu vẫn muốn bật thêm đăng nhập bằng SĐT &amp; Mật khẩu:</span>
                      </p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Mở Firebase Console → <strong>Authentication</strong> → <strong>Sign-in method</strong>.</li>
                        <li>Chọn <strong>Email/Password</strong> → gạt nút <strong>Enable (Bật)</strong> → nhấn <strong>Save (Lưu)</strong>.</li>
                      </ol>
                      <a
                        href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 font-semibold text-[#BE185D] hover:underline pt-1"
                      >
                        <span>Mở cài đặt Firebase Authentication</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Optional Phone + Password collapsible section */}
              <div className="pt-3 border-t border-pink-100">
                <button
                  type="button"
                  onClick={() => setShowPhoneForm((prev) => !prev)}
                  className="w-full min-h-[38px] px-3 rounded-xl text-xs font-semibold text-slate-600 hover:bg-pink-50/70 hover:text-slate-900 flex items-center justify-between gap-2 transition-colors cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-[#DB2777]" />
                    <span>Hoặc đăng nhập bằng SĐT &amp; Mật khẩu (nếu đã được cấp)</span>
                  </span>
                  {showPhoneForm ? (
                    <ChevronUp className="w-4 h-4 shrink-0" />
                  ) : (
                    <ChevronDown className="w-4 h-4 shrink-0" />
                  )}
                </button>

                {showPhoneForm && (
                  <div className="mt-3 pt-3 border-t border-pink-100 space-y-3.5">
                    <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#FDFBFC] border border-pink-100">
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          mode === 'login'
                            ? 'bg-slate-900 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Đăng nhập SĐT
                      </button>
                      <button
                        type="button"
                        onClick={() => switchMode('register_teacher')}
                        className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                          mode === 'register_teacher'
                            ? 'bg-slate-900 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Tạo TK Giáo viên
                      </button>
                    </div>

                    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
                      {mode === 'register_teacher' && (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Họ và tên giáo viên *
                          </label>
                          <input
                            type="text"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="VD: Cô Trần Thương"
                            autoComplete="name"
                            className="w-full min-h-[42px] rounded-xl border border-pink-200 px-3.5 text-sm focus:outline-none focus:border-[#DB2777]"
                            required
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Số điện thoại *
                        </label>
                        <div className="relative">
                          <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="tel"
                            inputMode="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="VD: 0912 345 678"
                            autoComplete="username"
                            className="w-full min-h-[42px] pl-10 pr-3.5 rounded-xl border border-pink-200 text-sm font-mono-num focus:outline-none focus:border-[#DB2777]"
                            required
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          {mode === 'login' ? 'Mật khẩu *' : 'Mật khẩu (tối thiểu 6 ký tự) *'}
                        </label>
                        <div className="relative">
                          <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Nhập mật khẩu..."
                            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                            className="w-full min-h-[42px] pl-10 pr-11 rounded-xl border border-pink-200 text-sm focus:outline-none focus:border-[#DB2777]"
                            required
                            minLength={6}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((prev) => !prev)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[34px] min-w-[34px] rounded-lg text-slate-500 hover:bg-pink-50 inline-flex items-center justify-center cursor-pointer"
                            aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {mode === 'register_teacher' && (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Nhập lại mật khẩu *
                          </label>
                          <div className="relative">
                            <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={confirmPassword}
                              onChange={(e) => setConfirmPassword(e.target.value)}
                              placeholder="Nhập lại mật khẩu..."
                              autoComplete="new-password"
                              className="w-full min-h-[42px] pl-10 pr-3.5 rounded-xl border border-pink-200 text-sm focus:outline-none focus:border-[#DB2777]"
                              required
                              minLength={6}
                            />
                          </div>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={submitting || googleSubmitting}
                        className="w-full min-h-[42px] px-5 rounded-xl bg-slate-900 text-white font-semibold text-xs sm:text-sm hover:bg-slate-800 transition-all inline-flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
                      >
                        {mode === 'register_teacher' && <UserPlus className="w-4 h-4 shrink-0" />}
                        <span>
                          {submitting
                            ? 'Đang xử lý...'
                            : mode === 'login'
                            ? 'Đăng nhập bằng SĐT & Mật khẩu'
                            : 'Tạo tài khoản bằng SĐT'}
                        </span>
                      </button>
                    </form>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-pink-100 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <BookOpen className="w-4 h-4 text-[#DB2777] shrink-0" />
                  <span>Giáo viên chính</span>
                </div>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Quản lý lớp, học sinh, báo cáo BTVN bảng nhanh, thống kê học phí và phân quyền trợ giảng.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <UserCheck className="w-4 h-4 text-[#15803D] shrink-0" />
                  <span>Trợ giảng</span>
                </div>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Cùng điểm danh, chấm bài tập về nhà và soạn tin gửi phụ huynh trên sổ dùng chung thời gian thực.
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <MessageCircle className="w-4 h-4 text-[#DB2777] shrink-0" />
                  <span>Phụ huynh (Zalo)</span>
                </div>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Không cần tải app hay đăng nhập — nhận báo cáo BTVN &amp; nhận xét trực tiếp qua Zalo.
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
              <ShieldCheck className="w-4 h-4 text-[#15803D] shrink-0" />
              <span>
                Bảo mật dữ liệu lớp học riêng tư bằng Firebase Authentication &amp; Firestore Security Rules.
              </span>
            </div>
          </section>

          <section className="lg:col-span-6 flex">
            <div className="w-full rounded-3xl overflow-hidden border border-pink-100 bg-white flex flex-col justify-between min-h-[260px] lg:min-h-[540px]">
              {!imgFailed ? (
                <img
                  src="/src/assets/images/smart_teaching_hero_1795217995155.jpg"
                  alt="Bàn làm việc giáo viên với sổ kế hoạch bài giảng và nhánh bạch đàn"
                  referrerPolicy="no-referrer"
                  onError={() => setImgFailed(true)}
                  className="w-full h-full object-cover flex-1"
                />
              ) : (
                <div className="flex-1 bg-gradient-to-br from-[#FCE7F3] via-white to-[#ECFDF5] flex flex-col items-center justify-center p-8 text-center">
                  <BookOpen className="w-12 h-12 text-[#DB2777] mb-3" />
                  <p className="text-base font-semibold text-slate-800">
                    Sổ Dạy Học Thông Minh – Smart Teaching
                  </p>
                </div>
              )}
              <div className="p-5 bg-white border-t border-pink-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                <span>Đồng bộ thời gian thực giữa Giáo viên &amp; Trợ giảng</span>
                <span className="font-medium text-[#15803D]">Hỗ trợ cài đặt PWA</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};
