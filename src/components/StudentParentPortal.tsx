import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Award,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  KeyRound,
  MessageSquareText,
  Send,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { changeOwnPassword, normalizePhone } from '../lib/firebase';
import { submitStudentHomework } from '../services/firestoreService';
import {
  ATTENDANCE_STATUS_VI,
  ATTITUDE_RATING_VI,
  DAY_OF_WEEK_LABELS,
  HOMEWORK_CHECK_VI,
  HomeworkRecord,
} from '../types';

export const StudentParentPortal: React.FC = () => {
  const {
    effectiveRole,
    previewMode,
    classes,
    students,
    enrollments,
    schedules,
    attendance,
    homework,
    submissions,
    assessments,
    reviews,
    notifications,
    parentMessages,
  } = useApp();

  const isParent = effectiveRole === 'PARENT';
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'overview' | 'homework' | 'reviews' | 'notifications'>('overview');
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [submittingHwId, setSubmittingHwId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Change password modal for logged-in Student/Parent
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  // Filter strictly to authorized students (or previewed child/parent in teacher preview)
  const visibleStudents = useMemo(() => {
    if (previewMode) {
      if (previewMode.activeRole === 'STUDENT' && previewMode.studentId) {
        return students.filter((s) => s.id === previewMode.studentId);
      }
      if (previewMode.activeRole === 'PARENT' && previewMode.parentPhone) {
        return students.filter(
          (s) =>
            normalizePhone(s.motherPhone) === previewMode.parentPhone ||
            normalizePhone(s.fatherPhone) === previewMode.parentPhone
        );
      }
    }
    return students;
  }, [students, previewMode]);

  const currentStudent = useMemo(() => {
    return visibleStudents.find((s) => s.id === selectedChildId) ?? visibleStudents[0] ?? null;
  }, [visibleStudents, selectedChildId]);

  const enrolledClassIds = useMemo(() => {
    if (!currentStudent) return new Set<string>();
    return new Set(
      enrollments
        .filter((e) => e.studentId === currentStudent.id && e.status === 'active')
        .map((e) => e.classId)
    );
  }, [enrollments, currentStudent]);

  const studentSchedules = useMemo(
    () =>
      schedules
        .filter((s) => s.active && enrolledClassIds.has(s.classId))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime)),
    [schedules, enrolledClassIds]
  );

  const studentAttendance = useMemo(
    () =>
      currentStudent
        ? attendance
            .filter((a) => a.studentId === currentStudent.id)
            .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
        : [],
    [attendance, currentStudent]
  );

  const studentAssessments = useMemo(
    () =>
      currentStudent
        ? assessments
            .filter((a) => a.studentId === currentStudent.id)
            .sort((a, b) => b.assessedDate.localeCompare(a.assessedDate))
        : [],
    [assessments, currentStudent]
  );

  const studentHomework = useMemo(() => {
    if (!currentStudent) return [];
    return homework
      .filter(
        (hw) =>
          (hw.scope === 'class' && enrolledClassIds.has(hw.classId)) ||
          (hw.scope === 'individual' &&
            (hw.assignedStudentId === currentStudent.id ||
              (hw.assignedStudentIds?.includes(currentStudent.id) ?? false)))
      )
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }, [homework, currentStudent, enrolledClassIds]);

  const studentReviews = useMemo(() => {
    if (!currentStudent) return [];
    return reviews
      .filter((r) => r.studentId === currentStudent.id && (isParent || r.visibleToStudent))
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  }, [reviews, currentStudent, isParent]);

  const studentParentMessages = useMemo(() => {
    if (!currentStudent || !isParent) return [];
    return parentMessages
      .filter((m) => m.studentId === currentStudent.id && (m.status === 'approved' || m.status === 'sent'))
      .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate));
  }, [parentMessages, currentStudent, isParent]);

  const studentNotifications = useMemo(() => {
    if (!currentStudent) return [];
    return notifications.filter(
      (n) => !n.classId || enrolledClassIds.has(n.classId) || n.studentId === currentStudent.id
    );
  }, [notifications, currentStudent, enrolledClassIds]);

  const handleSubmitOnlineHomework = async (hw: HomeworkRecord) => {
    if (!currentStudent) return;
    const text = (answerDrafts[hw.id] ?? '').trim();
    if (!text) return;
    if (previewMode) {
      setNotice('Bạn đang ở chế độ xem trước của Giáo viên. Học sinh đăng nhập bằng số điện thoại riêng sẽ nộp bài trực tiếp tại đây.');
      return;
    }
    setSubmittingHwId(hw.id);
    try {
      await submitStudentHomework(hw, currentStudent, text);
      setNotice(`Đã nộp bài "${hw.title}" thành công!`);
    } finally {
      setSubmittingHwId(null);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    if (newPwd.trim().length < 6) {
      setPwdError('Mật khẩu mới cần có ít nhất 6 ký tự.');
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdError('Mật khẩu xác nhận không khớp.');
      return;
    }
    setChangingPwd(true);
    try {
      await changeOwnPassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setShowPwdModal(false);
      setNotice('Đã đổi mật khẩu đăng nhập thành công.');
    } catch (err) {
      setPwdError(err instanceof Error ? err.message : 'Không thể đổi mật khẩu. Vui lòng thử lại.');
    } finally {
      setChangingPwd(false);
    }
  };

  if (!currentStudent) {
    return (
      <div className="rounded-2xl bg-white border border-pink-100 p-8 text-center space-y-2">
        <Users className="w-8 h-8 text-[#DB2777] mx-auto" />
        <h2 className="text-base font-bold text-slate-900">Chưa có hồ sơ học sinh được liên kết</h2>
        <p className="text-sm text-slate-600 max-w-md mx-auto">
          Vui lòng liên hệ giáo viên phụ trách để cấp và liên kết tài khoản theo số điện thoại với hồ sơ học sinh.
        </p>
      </div>
    );
  }

  const presentTotal = studentAttendance.filter((a) => a.status === 'present' || a.status === 'late' || a.status === 'makeup').length;

  return (
    <div className="space-y-6">
      {/* Header + Multi-Child Selector for Parents */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-[#BE185D]">
            {isParent ? 'Cổng thông tin Phụ huynh' : 'Cổng học tập Học sinh'}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            {currentStudent.fullName}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5 font-mono-num">
            {currentStudent.studentCode} · {currentStudent.schoolClass || 'Học sinh'} · {enrolledClassIds.size} lớp học thêm
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isParent && visibleStudents.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500 whitespace-nowrap">Chọn con:</span>
              <select
                value={currentStudent.id}
                onChange={(e) => setSelectedChildId(e.target.value)}
                className="min-h-[42px] rounded-xl border border-pink-200 bg-white px-3 text-sm font-semibold text-slate-900"
              >
                {visibleStudents.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.fullName} ({child.studentCode})
                  </option>
                ))}
              </select>
            </div>
          )}
          {!previewMode && (
            <button
              onClick={() => {
                setPwdError(null);
                setShowPwdModal(true);
              }}
              className="min-h-[42px] px-3.5 rounded-xl border border-pink-200 bg-white text-xs font-semibold text-slate-700 hover:bg-pink-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <KeyRound className="w-3.5 h-3.5 text-[#DB2777]" />
              <span>Đổi mật khẩu</span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold hover:underline">
            Đóng
          </button>
        </div>
      )}

      {/* Portal Navigation Tabs */}
      <div className="flex overflow-x-auto gap-1 p-1 rounded-xl bg-pink-50 border border-pink-100">
        {[
          { id: 'overview', label: 'Lịch học & Điểm danh', icon: CalendarDays },
          { id: 'homework', label: `Bài tập (${studentHomework.length})`, icon: ClipboardList },
          { id: 'reviews', label: isParent ? 'Nhận xét giáo viên' : 'Điểm & Nhận xét', icon: MessageSquareText },
          { id: 'notifications', label: `Thông báo (${studentNotifications.length})`, icon: Bell },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`min-h-[42px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              <Icon className="w-3.5 h-3.5 text-[#DB2777]" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white border border-pink-100 p-4">
              <p className="text-xs text-slate-500">Buổi có mặt / học bù</p>
              <p className="mt-1.5 text-2xl font-bold font-mono-num text-[#15803D]">{presentTotal}</p>
            </div>
            <div className="rounded-2xl bg-white border border-pink-100 p-4">
              <p className="text-xs text-slate-500">Bài kiểm tra đã có điểm</p>
              <p className="mt-1.5 text-2xl font-bold font-mono-num text-slate-900">{studentAssessments.length}</p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-2xl bg-[#FFF1F5] border border-pink-200 p-4">
              <p className="text-xs text-[#BE185D]">Bài tập đang theo dõi</p>
              <p className="mt-1.5 text-2xl font-bold font-mono-num text-[#BE185D]">{studentHomework.length}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#DB2777]" />
                <h2 className="text-base font-semibold text-slate-900">Lịch học cá nhân hàng tuần</h2>
              </div>
              {studentSchedules.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">Chưa có lịch học định kỳ.</p>
              ) : (
                <div className="divide-y divide-pink-50">
                  {studentSchedules.map((sch) => (
                    <div key={sch.id} className="py-3 flex items-center justify-between gap-2 text-sm">
                      <div>
                        <p className="font-semibold text-slate-900">{classMap.get(sch.classId)?.name}</p>
                        <p className="text-xs text-slate-500">{sch.room || classMap.get(sch.classId)?.room}</p>
                      </div>
                      <span className="text-xs font-mono-num font-semibold text-[#15803D] whitespace-nowrap">
                        {DAY_OF_WEEK_LABELS[sch.dayOfWeek]} · {sch.startTime}–{sch.endTime}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-900">Lịch sử điểm danh gần đây</h2>
              {studentAttendance.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">Chưa có bản ghi điểm danh.</p>
              ) : (
                <div className="divide-y divide-pink-50">
                  {studentAttendance.slice(0, 10).map((a) => (
                    <div key={a.id} className="py-3 flex items-center justify-between gap-2 text-sm">
                      <div>
                        <p className="font-medium text-slate-900">{classMap.get(a.classId)?.name}</p>
                        <p className="text-xs font-mono-num text-slate-500">{a.sessionDate}</p>
                      </div>
                      <span
                        className={`text-xs font-semibold ${
                          a.status === 'present' || a.status === 'makeup'
                            ? 'text-[#15803D]'
                            : a.status === 'late'
                            ? 'text-amber-700'
                            : 'text-rose-700'
                        }`}
                      >
                        {ATTENDANCE_STATUS_VI[a.status]}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {activeTab === 'homework' && (
        <div className="space-y-4">
          {studentHomework.length === 0 ? (
            <div className="rounded-2xl bg-white border border-pink-100 p-8 text-center text-sm text-slate-500">
              Hiện chưa có bài tập nào được giao.
            </div>
          ) : (
            studentHomework.map((hw) => {
              const sub = submissions.find(
                (s) => s.homeworkId === hw.id && s.studentId === currentStudent.id
              );
              const draft = answerDrafts[hw.id] ?? sub?.answerText ?? '';
              return (
                <article key={hw.id} className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-slate-500">
                        {classMap.get(hw.classId)?.name} · Hạn nộp{' '}
                        <span className="font-mono-num font-semibold text-[#BE185D]">{hw.dueDate}</span>
                      </p>
                      <h3 className="mt-1 text-base font-bold text-slate-900">{hw.title}</h3>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        sub?.status === 'reviewed'
                          ? 'text-[#15803D]'
                          : sub?.status === 'submitted'
                          ? 'text-[#BE185D]'
                          : 'text-slate-500'
                      }`}
                    >
                      {sub?.status === 'reviewed'
                        ? `Đã chấm${sub.score !== undefined ? ` (${sub.score} điểm)` : ''}`
                        : sub?.status === 'submitted'
                        ? 'Đã nộp bài'
                        : 'Chưa nộp'}
                    </span>
                  </div>

                  {hw.description && <p className="text-sm text-slate-700 whitespace-pre-line">{hw.description}</p>}

                  {sub?.teacherFeedback && (
                    <div className="rounded-xl bg-[#ECFDF5] border border-emerald-200 p-3 text-xs text-emerald-950">
                      <span className="font-semibold">Nhận xét của giáo viên:</span> {sub.teacherFeedback}
                    </div>
                  )}

                  {/* Online Homework Submission for Student */}
                  {!isParent && sub?.status !== 'reviewed' && (
                    <div className="pt-2 space-y-2">
                      <textarea
                        rows={3}
                        value={draft}
                        onChange={(e) => setAnswerDrafts((p) => ({ ...p, [hw.id]: e.target.value }))}
                        placeholder="Nhập câu trả lời hoặc tóm tắt bài làm trực tuyến để nộp giáo viên..."
                        className="w-full rounded-xl border border-pink-200 p-3 text-sm"
                      />
                      <button
                        onClick={() => void handleSubmitOnlineHomework(hw)}
                        disabled={submittingHwId === hw.id || !draft.trim()}
                        className="min-h-[42px] px-4 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] disabled:opacity-40 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{submittingHwId === hw.id ? 'Đang nộp...' : sub ? 'Cập nhật bài nộp' : 'Nộp bài trực tuyến'}</span>
                      </button>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </div>
      )}

      {activeTab === 'reviews' && (
        <div className="space-y-6">
          {/* Scores */}
          <section className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-[#15803D]" />
              <h2 className="text-base font-semibold text-slate-900">Bảng điểm kiểm tra</h2>
            </div>
            {studentAssessments.length === 0 ? (
              <p className="text-sm text-slate-500">Chưa có điểm kiểm tra nào.</p>
            ) : (
              <div className="divide-y divide-pink-50">
                {studentAssessments.map((as) => (
                  <div key={as.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{as.title}</p>
                      <p className="text-xs text-slate-500 font-mono-num">
                        {as.assessedDate} {as.comment ? `· ${as.comment}` : ''}
                      </p>
                    </div>
                    <span className="text-base font-bold font-mono-num text-[#15803D]">
                      {as.score}/{as.maxScore}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* AI Parent Messages (Parent only) */}
          {isParent && (
            <section className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
              <h2 className="text-base font-semibold text-slate-900">Tin nhắn nhận xét từ giáo viên</h2>
              {studentParentMessages.length === 0 ? (
                <p className="text-sm text-slate-500">Chưa có tin nhắn nhận xét nào được gửi.</p>
              ) : (
                <div className="space-y-4">
                  {studentParentMessages.map((msg) => (
                    <div key={msg.id} className="rounded-xl bg-[#FDFBFC] border border-pink-100 p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-semibold text-slate-800">{msg.className}</span>
                        <span className="font-mono-num">{msg.sessionDate}</span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{msg.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Session Reviews */}
          <section className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">Nhận xét từng buổi học</h2>
            {studentReviews.length === 0 ? (
              <p className="text-sm text-slate-500">Chưa có nhận xét nào.</p>
            ) : (
              <div className="divide-y divide-pink-50">
                {studentReviews.map((r) => (
                  <div key={r.id} className="py-3.5 space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-slate-900">{classMap.get(r.classId)?.name}</p>
                      <span className="text-xs font-mono-num text-slate-500">{r.sessionDate}</span>
                    </div>
                    <p className="text-xs text-slate-600">
                      BTVN: <span className="font-semibold text-slate-800">{HOMEWORK_CHECK_VI[r.homeworkStatus]}</span>
                      {r.homeworkNote ? ` (${r.homeworkNote})` : ''} · Ý thức: {ATTITUDE_RATING_VI[r.attitudeRating]}
                    </p>
                    {r.attitudeComment && <p className="text-sm text-slate-700">{r.attitudeComment}</p>}
                    {r.weakTopics && (
                      <p className="text-xs text-amber-800">Kiến thức cần luyện thêm: {r.weakTopics}</p>
                    )}
                    {isParent && r.parentPrivateMessage && (
                      <p className="text-xs text-[#BE185D] font-medium">
                        Nhắn riêng phụ huynh: {r.parentPrivateMessage}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'notifications' && (
        <section className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Thông báo từ giáo viên</h2>
          {studentNotifications.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="w-7 h-7 text-[#15803D] mx-auto mb-2" />
              <p className="text-sm text-slate-500">Chưa có thông báo mới.</p>
            </div>
          ) : (
            <div className="divide-y divide-pink-50">
              {studentNotifications.map((n) => (
                <div key={n.id} className="py-3.5 space-y-1">
                  <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                  <p className="text-sm text-slate-700 whitespace-pre-line">{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {showPwdModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={(e) => void handleChangePassword(e)}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-pink-100"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#DB2777]" />
                <h3 className="text-base font-bold text-slate-900">Đổi mật khẩu đăng nhập</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPwdModal(false)}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {pwdError && (
              <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{pwdError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Mật khẩu hiện tại *</label>
              <input
                type="password"
                value={currentPwd}
                onChange={(e) => setCurrentPwd(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Mật khẩu mới *</label>
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                minLength={6}
                placeholder="Ít nhất 6 ký tự"
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Xác nhận mật khẩu mới *</label>
              <input
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                minLength={6}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                required
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowPwdModal(false)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={changingPwd}
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D]"
              >
                {changingPwd ? 'Đang lưu...' : 'Lưu mật khẩu'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
