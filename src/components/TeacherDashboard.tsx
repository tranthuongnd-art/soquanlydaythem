import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  MessageSquareText,
  Plus,
  UserPlus,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { authEmailToPhone } from '../lib/firebase';
import { createOrOpenSession, todayISO } from '../services/firestoreService';
import { seedSyntheticDemoData } from '../services/seedService';
import { Classroom, DAY_OF_WEEK_LABELS, PARENT_MESSAGE_STATUS_VI } from '../types';

export type TeacherTab =
  | 'dashboard'
  | 'classes'
  | 'students'
  | 'sessions'
  | 'homework'
  | 'stats'
  | 'settings';

interface TeacherDashboardProps {
  onNavigate: (tab: TeacherTab) => void;
  onOpenSession: (sessionId: string) => void;
}

export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ onNavigate, onOpenSession }) => {
  const {
    firebaseUser,
    userProfile,
    teacherProfile,
    workspaceTeacherId,
    isMainTeacher,
    classes,
    students,
    enrollments,
    schedules,
    sessions,
    parentMessages,
    dataLoading,
  } = useApp();

  const [seeding, setSeeding] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const today = todayISO();
  const todayDow = new Date().getDay();

  const activeClasses = useMemo(() => classes.filter((c) => c.status === 'active'), [classes]);
  const activeStudents = useMemo(() => students.filter((s) => s.status === 'active'), [students]);

  const classMap = useMemo(() => {
    const map = new Map<string, Classroom>();
    for (const c of classes) map.set(c.id, c);
    return map;
  }, [classes]);

  const studentCountByClass = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enrollments) {
      if (e.status === 'active') {
        counts.set(e.classId, (counts.get(e.classId) ?? 0) + 1);
      }
    }
    return counts;
  }, [enrollments]);

  const todaySchedules = useMemo(() => {
    return schedules
      .filter((s) => s.active && s.dayOfWeek === todayDow && classMap.get(s.classId)?.status === 'active')
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [schedules, todayDow, classMap]);

  const recentSessions = useMemo(() => {
    return [...sessions]
      .sort((a, b) => `${b.sessionDate}_${b.startTime}`.localeCompare(`${a.sessionDate}_${a.startTime}`))
      .slice(0, 6);
  }, [sessions]);

  const unsentMessages = useMemo(() => {
    return parentMessages
      .filter((m) => m.status !== 'sent')
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  }, [parentMessages]);

  const handleOpenScheduledSession = async (classId: string, startTime: string, endTime: string) => {
    if (!workspaceTeacherId) return;
    const cls = classMap.get(classId);
    if (!cls) return;
    setOpeningId(`${classId}_${startTime}`);
    try {
      const sessionId = await createOrOpenSession(workspaceTeacherId, cls, {
        sessionDate: today,
        startTime,
        endTime,
        sessionType: 'regular',
      });
      onOpenSession(sessionId);
    } catch (err) {
      console.error('Lỗi mở buổi học:', err);
      setStatusNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể mở buổi học hôm nay.',
      });
    } finally {
      setOpeningId(null);
    }
  };

  const handleSeedDemo = async () => {
    if (!firebaseUser || !firebaseUser.email || !isMainTeacher) return;
    setSeeding(true);
    setStatusNotice(null);
    try {
      await seedSyntheticDemoData(
        firebaseUser.uid,
        firebaseUser.email,
        teacherProfile?.fullName || firebaseUser.displayName || 'Giáo viên',
        teacherProfile?.phone || userProfile?.phone || authEmailToPhone(firebaseUser.email)
      );
      setStatusNotice({
        type: 'success',
        text: 'Đã khởi tạo bộ dữ liệu mẫu giả lập lên Cloud Firestore thành công.',
      });
    } catch (err) {
      console.error('Lỗi khởi tạo dữ liệu mẫu:', err);
      const rawMsg = err instanceof Error ? err.message : '';
      setStatusNotice({
        type: 'error',
        text: rawMsg.includes('permission')
          ? 'Không đủ quyền ghi dữ liệu lên Cloud Firestore. Vui lòng thử tải lại trang hoặc đăng nhập lại.'
          : rawMsg || 'Không thể khởi tạo dữ liệu mẫu.',
      });
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Greeting */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-slate-500">
            {DAY_OF_WEEK_LABELS[todayDow]} · {today.split('-').reverse().join('/')}
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
            Chào {userProfile?.displayName || teacherProfile?.fullName || firebaseUser?.displayName || 'giáo viên'}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onNavigate('sessions')}
            className="min-h-[44px] px-4 rounded-xl bg-[#DB2777] text-white text-sm font-medium hover:bg-[#BE185D] transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Mở buổi học</span>
          </button>
          <button
            onClick={() => onNavigate('students')}
            className="min-h-[44px] px-4 rounded-xl bg-white border border-pink-200 text-slate-800 text-sm font-medium hover:bg-pink-50 transition-colors inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4 text-[#DB2777]" />
            <span>Thêm học sinh</span>
          </button>
        </div>
      </div>

      {statusNotice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
            statusNotice.type === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <span>{statusNotice.text}</span>
          <button
            onClick={() => setStatusNotice(null)}
            className={`text-xs font-semibold hover:underline whitespace-nowrap ${
              statusNotice.type === 'error' ? 'text-rose-800' : 'text-emerald-800'
            }`}
          >
            Đóng
          </button>
        </div>
      )}

      {/* Empty Workspace Onboarding */}
      {!dataLoading && classes.length === 0 && (
        <section className="rounded-2xl bg-gradient-to-br from-[#FFF1F5] via-white to-[#ECFDF5] border border-pink-100 p-6">
          <h2 className="text-lg font-semibold text-slate-900">Bắt đầu không gian dạy học đám mây</h2>
          <p className="mt-1.5 text-sm text-slate-600 max-w-2xl leading-relaxed">
            Không gian của bạn chưa có lớp học nào. Bạn có thể tạo lớp học mới ngay hoặc nạp bộ dữ liệu mẫu giả lập (3 lớp, 6 học sinh, lịch dạy hôm nay, bài tập và nhận xét) để kiểm thử toàn bộ quy trình.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {isMainTeacher && (
              <button
                onClick={() => void handleSeedDemo()}
                disabled={seeding}
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] transition-colors inline-flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                <Database className="w-4 h-4" />
                <span>{seeding ? 'Đang tạo dữ liệu mẫu...' : 'Tạo dữ liệu mẫu kiểm thử'}</span>
              </button>
            )}
            <button
              onClick={() => onNavigate('classes')}
              className="min-h-[44px] px-5 rounded-xl bg-white border border-pink-200 text-slate-800 text-sm font-medium hover:bg-pink-50 transition-colors cursor-pointer"
            >
              Tạo lớp học đầu tiên
            </button>
          </div>
        </section>
      )}

      {/* Quick KPI Strip (4 columns desktop, 2 columns mobile) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <button
          onClick={() => onNavigate('classes')}
          className="text-left rounded-2xl bg-white border border-pink-100 p-4 sm:p-5 hover:border-pink-300 transition-colors cursor-pointer"
        >
          <p className="text-xs font-medium text-slate-500">Lớp đang dạy</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900 font-mono-num">
            {activeClasses.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {classes.length - activeClasses.length} lớp lưu trữ
          </p>
        </button>

        <button
          onClick={() => onNavigate('students')}
          className="text-left rounded-2xl bg-white border border-pink-100 p-4 sm:p-5 hover:border-pink-300 transition-colors cursor-pointer"
        >
          <p className="text-xs font-medium text-slate-500">Học sinh đang học</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold text-slate-900 font-mono-num">
            {activeStudents.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">Tổng {students.length} hồ sơ</p>
        </button>

        <button
          onClick={() => onNavigate('sessions')}
          className="text-left rounded-2xl bg-white border border-emerald-100 p-4 sm:p-5 hover:border-emerald-300 transition-colors cursor-pointer"
        >
          <p className="text-xs font-medium text-slate-500">Buổi học đã ghi nhận</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold text-[#15803D] font-mono-num">
            {sessions.length}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {sessions.filter((s) => s.status === 'completed').length} buổi hoàn tất
          </p>
        </button>

        <button
          onClick={() => onNavigate('sessions')}
          className="text-left rounded-2xl bg-[#FFF1F5] border border-pink-200 p-4 sm:p-5 hover:border-pink-300 transition-colors cursor-pointer"
        >
          <p className="text-xs font-medium text-[#BE185D]">Nhận xét chưa gửi</p>
          <p className="mt-2 text-2xl sm:text-3xl font-bold text-[#BE185D] font-mono-num">
            {unsentMessages.length}
          </p>
          <p className="mt-1 text-xs text-pink-800/80">Chờ duyệt hoặc gửi phụ huynh</p>
        </button>
      </section>

      {/* Quick Action Bar */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => onNavigate('sessions')}
          className="min-h-[48px] px-4 rounded-xl bg-white border border-pink-100 hover:bg-pink-50/70 transition-colors flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer"
        >
          <CalendarDays className="w-4 h-4 text-[#DB2777] shrink-0" />
          <span className="truncate">Điểm danh nhanh</span>
        </button>
        <button
          onClick={() => onNavigate('homework')}
          className="min-h-[48px] px-4 rounded-xl bg-white border border-pink-100 hover:bg-emerald-50/70 transition-colors flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer"
        >
          <ClipboardList className="w-4 h-4 text-[#15803D] shrink-0" />
          <span className="truncate">Giao bài tập</span>
        </button>
        <button
          onClick={() => onNavigate('stats')}
          className="min-h-[48px] px-4 rounded-xl bg-white border border-pink-100 hover:bg-pink-50/70 transition-colors flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer"
        >
          <BarChart3 className="w-4 h-4 text-[#DB2777] shrink-0" />
          <span className="truncate">Thống kê &amp; học phí</span>
        </button>
        <button
          onClick={() => onNavigate('classes')}
          className="min-h-[48px] px-4 rounded-xl bg-white border border-pink-100 hover:bg-emerald-50/70 transition-colors flex items-center gap-2.5 text-sm font-medium text-slate-800 cursor-pointer"
        >
          <BookOpen className="w-4 h-4 text-[#15803D] shrink-0" />
          <span className="truncate">Quản lý lớp</span>
        </button>
      </section>

      {/* Main 2-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Today's Schedule */}
        <section className="lg:col-span-7 rounded-2xl bg-white border border-pink-100 p-5">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-pink-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Lịch dạy hôm nay</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Chạm vào lớp để mở ngay sổ điểm danh và nhận xét buổi học
              </p>
            </div>
            <button
              onClick={() => onNavigate('classes')}
              className="text-xs font-semibold text-[#BE185D] hover:underline whitespace-nowrap cursor-pointer"
            >
              Chỉnh lịch
            </button>
          </div>

          {todaySchedules.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-slate-600">Hôm nay chưa có lịch dạy định kỳ nào.</p>
              <button
                onClick={() => onNavigate('sessions')}
                className="mt-3 min-h-[40px] px-4 rounded-xl bg-pink-50 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 transition-colors cursor-pointer"
              >
                Tạo buổi học bù hoặc buổi ngoài lịch
              </button>
            </div>
          ) : (
            <div className="divide-y divide-pink-50">
              {todaySchedules.map((sch) => {
                const cls = classMap.get(sch.classId);
                if (!cls) return null;
                const count = studentCountByClass.get(cls.id) ?? 0;
                const key = `${sch.classId}_${sch.startTime}`;
                const existingToday = sessions.find(
                  (s) => s.classId === cls.id && s.sessionDate === today && s.startTime === sch.startTime
                );

                return (
                  <div
                    key={sch.id}
                    className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{cls.name}</p>
                      <p className="mt-1 text-xs text-slate-500 font-mono-num">
                        {sch.startTime} – {sch.endTime} · {sch.room || cls.room || 'Phòng chính'} · {count} học sinh
                      </p>
                    </div>
                    <button
                      onClick={() => void handleOpenScheduledSession(cls.id, sch.startTime, sch.endTime)}
                      disabled={openingId === key}
                      className="min-h-[44px] px-4 rounded-xl bg-[#ECFDF5] text-[#15803D] border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>
                        {openingId === key
                          ? 'Đang mở...'
                          : existingToday
                          ? existingToday.status === 'completed'
                            ? 'Xem buổi đã xong'
                            : 'Tiếp tục dạy'
                          : 'Bắt đầu buổi học'}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Unsent Parent Messages */}
        <section className="lg:col-span-5 rounded-2xl bg-white border border-pink-100 p-5">
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-pink-100">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Nhận xét chờ gửi phụ huynh</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Chỉ đánh dấu Đã gửi sau khi giáo viên xác nhận
              </p>
            </div>
            <MessageSquareText className="w-4 h-4 text-[#DB2777] shrink-0" />
          </div>

          {unsentMessages.length === 0 ? (
            <div className="py-10 text-center">
              <CheckCircle2 className="w-8 h-8 text-[#15803D] mx-auto mb-2" />
              <p className="text-sm text-slate-600">Tất cả tin nhắn nhận xét đã được gửi.</p>
            </div>
          ) : (
            <div className="divide-y divide-pink-50">
              {unsentMessages.slice(0, 5).map((msg) => (
                <button
                  key={msg.id}
                  onClick={() => onOpenSession(msg.sessionId)}
                  className="w-full py-3.5 text-left hover:bg-pink-50/40 rounded-lg px-2 -mx-2 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{msg.studentName}</p>
                    <p className="mt-0.5 text-xs text-slate-500 truncate">
                      {msg.className} · {msg.sessionDate}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#BE185D] whitespace-nowrap shrink-0">
                    {PARENT_MESSAGE_STATUS_VI[msg.status]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Active Classes + Recent Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-6 rounded-2xl bg-white border border-pink-100 p-5">
          <div className="flex items-center justify-between pb-4 border-b border-pink-100">
            <h2 className="text-base font-semibold text-slate-900">Các lớp đang quản lý</h2>
            <button
              onClick={() => onNavigate('classes')}
              className="text-xs font-semibold text-[#BE185D] hover:underline cursor-pointer"
            >
              Xem tất cả
            </button>
          </div>
          {activeClasses.length === 0 ? (
            <p className="py-8 text-sm text-slate-500 text-center">Chưa có lớp học nào.</p>
          ) : (
            <div className="divide-y divide-pink-50">
              {activeClasses.map((cls) => (
                <div key={cls.id} className="py-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{cls.name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {cls.subject} · {cls.gradeLevel} · {studentCountByClass.get(cls.id) ?? 0} học sinh
                    </p>
                  </div>
                  <span className="text-xs font-mono-num text-slate-600 whitespace-nowrap shrink-0">
                    {(cls.feePerSession ?? 0).toLocaleString('vi-VN')}đ/buổi
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-6 rounded-2xl bg-white border border-pink-100 p-5">
          <div className="flex items-center justify-between pb-4 border-b border-pink-100">
            <h2 className="text-base font-semibold text-slate-900">Buổi học gần đây</h2>
            <button
              onClick={() => onNavigate('sessions')}
              className="text-xs font-semibold text-[#BE185D] hover:underline cursor-pointer"
            >
              Tất cả buổi học
            </button>
          </div>
          {recentSessions.length === 0 ? (
            <p className="py-8 text-sm text-slate-500 text-center">Chưa có buổi học nào được tạo.</p>
          ) : (
            <div className="divide-y divide-pink-50">
              {recentSessions.map((ses) => (
                <button
                  key={ses.id}
                  onClick={() => onOpenSession(ses.id)}
                  className="w-full py-3.5 text-left hover:bg-pink-50/40 rounded-lg px-2 -mx-2 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{ses.className}</p>
                    <p className="mt-0.5 text-xs text-slate-500 font-mono-num">
                      {ses.sessionDate} · {ses.startTime}–{ses.endTime} ·{' '}
                      {ses.sessionType === 'makeup' ? 'Học bù' : 'Chính khóa'}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-semibold whitespace-nowrap shrink-0 ${
                      ses.status === 'completed' ? 'text-[#15803D]' : 'text-amber-700'
                    }`}
                  >
                    {ses.status === 'completed' ? 'Đã hoàn tất' : 'Đang lưu nháp'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
