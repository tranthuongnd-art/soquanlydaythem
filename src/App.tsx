import React, { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarCheck2,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  RotateCcw,
  Settings,
  Users,
} from 'lucide-react';
import { AppProvider, useApp } from './context/AppContext';
import { authEmailToPhone, formatPhoneReadable } from './lib/firebase';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginScreen } from './components/LoginScreen';
import { OfflineIndicator, PWAInstallButton } from './components/PWAComponents';
import { TeacherDashboard, TeacherTab } from './components/TeacherDashboard';
import { ClassesPage } from './components/ClassesPage';
import { StudentsPage } from './components/StudentsPage';
import { SessionsPage } from './components/SessionsPage';
import { HomeworkPage } from './components/HomeworkPage';
import { StatisticsPage } from './components/StatisticsPage';
import { SettingsPage } from './components/SettingsPage';
import { StudentParentPortal } from './components/StudentParentPortal';

const TEACHER_NAV: Array<{ id: TeacherTab; label: string; shortLabel: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Tổng quan', shortLabel: 'Tổng quan', icon: LayoutDashboard },
  { id: 'sessions', label: 'Buổi học & AI', shortLabel: 'Buổi học', icon: CalendarCheck2 },
  { id: 'classes', label: 'Lớp học', shortLabel: 'Lớp học', icon: BookOpen },
  { id: 'students', label: 'Học sinh', shortLabel: 'Học sinh', icon: Users },
  { id: 'homework', label: 'Bài tập & TB', shortLabel: 'Bài tập', icon: ClipboardList },
  { id: 'stats', label: 'Thống kê', shortLabel: 'Thống kê', icon: BarChart3 },
  { id: 'settings', label: 'Cài đặt & Sao lưu', shortLabel: 'Cài đặt', icon: Settings },
];

const MOBILE_BOTTOM_TABS: TeacherTab[] = ['dashboard', 'sessions', 'classes', 'students', 'stats'];

const AuthenticatedShell: React.FC = () => {
  const {
    firebaseUser,
    userProfile,
    teacherProfile,
    isMainTeacher,
    effectiveRole,
    previewMode,
    setPreviewMode,
    logout,
  } = useApp();
  const [activeTab, setActiveTab] = useState<TeacherTab>('dashboard');
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);

  const handleOpenSession = (sessionId: string) => {
    setFocusedSessionId(sessionId);
    setActiveTab('sessions');
  };

  const isTeacherView = effectiveRole === 'TEACHER' || effectiveRole === 'ASSISTANT';

  return (
    <div className="min-h-screen bg-[#FDFBFC] flex flex-col lg:flex-row">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-pink-100 p-4 justify-between no-print">
        <div className="space-y-6">
          <div className="flex items-center gap-3 px-2 pt-1">
            <img
              src="/src/assets/images/smart_teaching_emblem_1795217994518.jpg"
              alt="Smart Teaching"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-xl object-cover border border-pink-100 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">Smart Teaching</p>
              <p className="text-[11px] text-slate-500 truncate">Sổ Dạy Học Thông Minh</p>
            </div>
          </div>

          {isTeacherView ? (
            <nav className="space-y-1">
              {TEACHER_NAV.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full min-h-[44px] px-3.5 rounded-xl flex items-center gap-3 text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-[#FFF1F5] text-[#BE185D] font-semibold'
                        : 'text-slate-600 hover:bg-pink-50/50 hover:text-slate-900'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-[#DB2777]' : 'text-slate-400'}`} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          ) : (
            <div className="px-3 py-4 rounded-2xl bg-[#FDFBFC] border border-pink-100 text-xs text-slate-600 space-y-2">
              <p className="font-semibold text-slate-900">
                {effectiveRole === 'PARENT' ? 'Tài khoản Phụ huynh' : 'Tài khoản Học sinh'}
              </p>
              <p>Quyền truy cập được giới hạn riêng cho hồ sơ học sinh đã liên kết.</p>
            </div>
          )}
        </div>

        <div className="space-y-3 pt-4 border-t border-pink-100">
          <PWAInstallButton />
          <div className="px-2 space-y-0.5">
            <p className="text-[11px] font-semibold text-[#BE185D] truncate">
              {isMainTeacher
                ? 'Giáo viên chính'
                : effectiveRole === 'ASSISTANT'
                ? 'Trợ giảng'
                : effectiveRole === 'PARENT'
                ? 'Phụ huynh'
                : 'Học sinh'}
            </p>
            <p className="text-xs font-semibold text-slate-900 truncate">
              {userProfile?.displayName || firebaseUser?.displayName}
            </p>
            <p className="text-[11px] text-slate-500 font-mono-num truncate">
              {formatPhoneReadable(userProfile?.phone || authEmailToPhone(firebaseUser?.email)) ||
                firebaseUser?.email}
            </p>
          </div>
          <button
            onClick={() => void logout()}
            className="w-full min-h-[40px] px-3 rounded-xl border border-pink-100 text-xs font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 inline-flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </aside>

      {/* Mobile Compact Sticky Header (height <= 56px) */}
      <header className="lg:hidden sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-pink-100 px-4 flex items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/src/assets/images/smart_teaching_emblem_1795217994518.jpg"
            alt="Smart Teaching"
            referrerPolicy="no-referrer"
            className="w-8 h-8 rounded-lg object-cover border border-pink-100 shrink-0"
          />
          <span className="text-sm font-bold text-slate-900 truncate">Smart Teaching</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isTeacherView && (
            <>
              <button
                onClick={() => setActiveTab('homework')}
                className={`min-h-[40px] min-w-[40px] rounded-xl inline-flex items-center justify-center ${
                  activeTab === 'homework' ? 'bg-pink-50 text-[#BE185D]' : 'text-slate-600'
                }`}
                aria-label="Bài tập và Thông báo"
              >
                <ClipboardList className="w-4 h-4" />
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`min-h-[40px] min-w-[40px] rounded-xl inline-flex items-center justify-center ${
                  activeTab === 'settings' ? 'bg-pink-50 text-[#BE185D]' : 'text-slate-600'
                }`}
                aria-label="Cài đặt"
              >
                <Settings className="w-4 h-4" />
              </button>
            </>
          )}
          <PWAInstallButton compact />
          <button
            onClick={() => void logout()}
            className="min-h-[40px] min-w-[40px] rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-700 inline-flex items-center justify-center"
            aria-label="Đăng xuất"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={`flex-1 lg:pl-64 ${isTeacherView ? 'pb-24 lg:pb-10' : 'pb-10'}`}>
        {effectiveRole === 'ASSISTANT' && (
          <div className="bg-[#ECFDF5] border-b border-emerald-200 px-4 py-2 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-2 no-print">
            <span>
              Đang truy cập với vai trò <strong>Trợ giảng</strong> · Dùng chung sổ dạy học với{' '}
              <strong>{teacherProfile?.fullName || 'Giáo viên chính'}</strong>
            </span>
          </div>
        )}
        {previewMode && (
          <div className="bg-[#FFF1F5] border-b border-pink-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#BE185D] no-print">
            <span className="font-medium">
              Đang xem trước giao diện{' '}
              <strong>{previewMode.activeRole === 'PARENT' ? 'Phụ huynh' : 'Học sinh'}</strong> (Chế độ kiểm thử của Giáo viên)
            </span>
            <button
              onClick={() => setPreviewMode(null)}
              className="min-h-[34px] px-3 rounded-lg bg-[#DB2777] text-white font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Quay lại Giáo viên</span>
            </button>
          </div>
        )}

        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-7">
          {!isTeacherView ? (
            <StudentParentPortal />
          ) : (
            <>
              {activeTab === 'dashboard' && (
                <TeacherDashboard onNavigate={setActiveTab} onOpenSession={handleOpenSession} />
              )}
              {activeTab === 'classes' && <ClassesPage onOpenSession={handleOpenSession} />}
              {activeTab === 'students' && <StudentsPage />}
              {activeTab === 'sessions' && <SessionsPage initialSessionId={focusedSessionId} />}
              {activeTab === 'homework' && <HomeworkPage />}
              {activeTab === 'stats' && <StatisticsPage />}
              {activeTab === 'settings' && <SettingsPage />}
            </>
          )}
        </div>
      </main>

      {/* Mobile Fixed Bottom Navigation Bar (Teacher role, height <= 64px) */}
      {isTeacherView && (
        <nav
          aria-label="Điều hướng chính"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-pink-100 grid grid-cols-5 items-center h-16 pb-safe no-print"
        >
          {MOBILE_BOTTOM_TABS.map((tabId) => {
            const item = TEACHER_NAV.find((n) => n.id === tabId)!;
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`h-full flex flex-col items-center justify-center gap-1 cursor-pointer ${
                  active ? 'text-[#BE185D]' : 'text-slate-500'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-tight leading-none">
                  {item.shortLabel}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
};

const RootRouter: React.FC = () => {
  const { authReady, firebaseUser, userProfile } = useApp();

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#FDFBFC] flex flex-col items-center justify-center p-6 text-center">
        <img
          src="/src/assets/images/smart_teaching_emblem_1795217994518.jpg"
          alt="Smart Teaching"
          referrerPolicy="no-referrer"
          className="w-12 h-12 rounded-2xl border border-pink-100 mb-3"
        />
        <p className="text-sm font-semibold text-slate-800">Đang kết nối Sổ Dạy Học Thông Minh...</p>
      </div>
    );
  }

  if (!firebaseUser || !userProfile) {
    return <LoginScreen />;
  }

  return <AuthenticatedShell />;
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <RootRouter />
        <OfflineIndicator />
      </AppProvider>
    </ErrorBoundary>
  );
}
