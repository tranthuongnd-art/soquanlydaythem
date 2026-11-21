import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  KeyRound,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  authEmailToPhone,
  changeOwnPassword,
  formatPhoneReadable,
} from '../lib/firebase';
import {
  addTeachingAssistant,
  deleteTeachingAssistant,
  restoreWorkspaceBackup,
  saveTeacherProfile,
  stripTimestamps,
  WorkspaceBackupPayload,
} from '../services/firestoreService';
import { seedSyntheticDemoData } from '../services/seedService';
import { AssistantRecord, TuitionRule } from '../types';

export const SettingsPage: React.FC = () => {
  const {
    firebaseUser,
    userProfile,
    teacherProfile,
    workspaceTeacherId,
    isMainTeacher,
    assistants,
    classes,
    students,
    parents,
    enrollments,
    schedules,
    sessions,
    attendance,
    homework,
    submissions,
    assessments,
    reviews,
    notifications,
    parentMessages,
  } = useApp();

  const [fullName, setFullName] = useState(
    teacherProfile?.fullName || userProfile?.displayName || firebaseUser?.displayName || ''
  );
  const [phone, setPhone] = useState(
    teacherProfile?.phone || userProfile?.phone || authEmailToPhone(firebaseUser?.email) || ''
  );
  const [specialty, setSpecialty] = useState(teacherProfile?.subjectSpecialty || '');
  const [tuitionRule, setTuitionRule] = useState<TuitionRule>(
    teacherProfile?.tuitionRule || 'present_and_makeup'
  );
  const [defaultFee, setDefaultFee] = useState(String(teacherProfile?.defaultFeePerSession ?? 150000));
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Assistant management state (Main Teacher only)
  const [asstMethod, setAsstMethod] = useState<'google' | 'phone'>('google');
  const [asstName, setAsstName] = useState('');
  const [asstEmail, setAsstEmail] = useState('');
  const [asstPhone, setAsstPhone] = useState('');
  const [asstPassword, setAsstPassword] = useState('');
  const [addingAsst, setAddingAsst] = useState(false);
  const [asstError, setAsstError] = useState<string | null>(null);
  const [inviteSummary, setInviteSummary] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Change password state (only relevant for phone+password accounts)
  const isPhoneAuthAccount = useMemo(
    () => Boolean(firebaseUser?.email?.endsWith('@phone.smartteaching.app')),
    [firebaseUser?.email]
  );
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changingPwd, setChangingPwd] = useState(false);
  const [pwdMessage, setPwdMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const sortedAssistants = useMemo(
    () => [...assistants].sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi')),
    [assistants]
  );

  const handleAddAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !isMainTeacher) return;
    setAsstError(null);
    setInviteSummary(null);
    setAddingAsst(true);
    try {
      const res = await addTeachingAssistant(firebaseUser.uid, {
        fullName: asstName,
        email: asstMethod === 'google' ? asstEmail : undefined,
        phone: asstPhone,
        loginMethod: asstMethod,
        password: asstMethod === 'phone' ? asstPassword : undefined,
      });

      const appLink = typeof window !== 'undefined' ? window.location.origin : '';
      if (asstMethod === 'google') {
        setInviteSummary(
          `Chào ${res.assistant.fullName}, cô/thầy đã cấp quyền Trợ giảng trên Sổ Dạy Học Thông Minh.\n` +
            `Em mở đường link: ${appLink}\n` +
            `Bấm "Đăng nhập bằng Google" bằng Gmail: ${res.assistant.email} để vào dùng chung sổ lớp học nhé!`
        );
      } else {
        setInviteSummary(
          `Chào ${res.assistant.fullName}, cô/thầy đã tạo tài khoản Trợ giảng trên Sổ Dạy Học Thông Minh.\n` +
            `Đường link: ${appLink}\n` +
            `Chọn "Đăng nhập bằng SĐT & Mật khẩu"\n` +
            `SĐT: ${formatPhoneReadable(res.issuedPhone || '')}\n` +
            `Mật khẩu: ${res.issuedPassword || ''}`
        );
      }

      setAsstName('');
      setAsstEmail('');
      setAsstPhone('');
      setAsstPassword('');
      setNotice(`Đã thêm trợ giảng ${res.assistant.fullName} vào sổ dạy học dùng chung.`);
    } catch (err) {
      setAsstError(err instanceof Error ? err.message : 'Không thể thêm trợ giảng. Vui lòng thử lại.');
    } finally {
      setAddingAsst(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!inviteSummary) return;
    try {
      await navigator.clipboard.writeText(inviteSummary);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      setNotice('Không thể sao chép tự động. Vui lòng chọn văn bản và sao chép thủ công.');
    }
  };

  const handleRevokeAssistant = async (asst: AssistantRecord) => {
    if (!firebaseUser || !isMainTeacher) return;
    setRevokingId(asst.id);
    try {
      await deleteTeachingAssistant(firebaseUser.uid, asst);
      setConfirmRevokeId(null);
      setNotice(`Đã thu hồi quyền truy cập của trợ giảng ${asst.fullName}.`);
    } catch (err) {
      setAsstError(err instanceof Error ? err.message : 'Không thể thu hồi quyền trợ giảng.');
    } finally {
      setRevokingId(null);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !firebaseUser.email || !isMainTeacher) return;
    setSaving(true);
    try {
      await saveTeacherProfile(firebaseUser.uid, firebaseUser.email, {
        fullName,
        phone,
        subjectSpecialty: specialty,
        tuitionRule,
        defaultFeePerSession: Number(defaultFee) || 150000,
      });
      setNotice('Đã lưu cấu hình giáo viên lên Cloud Firestore.');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMessage(null);
    if (newPwd.trim().length < 6) {
      setPwdMessage({ type: 'error', text: 'Mật khẩu mới cần có ít nhất 6 ký tự.' });
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMessage({ type: 'error', text: 'Mật khẩu xác nhận không khớp.' });
      return;
    }
    setChangingPwd(true);
    try {
      await changeOwnPassword(currentPwd, newPwd);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setPwdMessage({ type: 'success', text: 'Đã đổi mật khẩu đăng nhập thành công.' });
    } catch (err) {
      setPwdMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể đổi mật khẩu. Vui lòng thử lại.',
      });
    } finally {
      setChangingPwd(false);
    }
  };

  const handleExportBackup = () => {
    const payload: WorkspaceBackupPayload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      teacherProfile: teacherProfile
        ? (stripTimestamps(teacherProfile as unknown as Record<string, unknown>) as unknown as typeof teacherProfile)
        : null,
      classes: classes.map((c) => stripTimestamps(c as unknown as Record<string, unknown>) as unknown as typeof c),
      students: students.map((s) => stripTimestamps(s as unknown as Record<string, unknown>) as unknown as typeof s),
      parents: parents.map((p) => stripTimestamps(p as unknown as Record<string, unknown>) as unknown as typeof p),
      enrollments: enrollments.map((e) => stripTimestamps(e as unknown as Record<string, unknown>) as unknown as typeof e),
      schedules: schedules.map((s) => stripTimestamps(s as unknown as Record<string, unknown>) as unknown as typeof s),
      sessions: sessions.map((s) => stripTimestamps(s as unknown as Record<string, unknown>) as unknown as typeof s),
      attendance: attendance.map((a) => stripTimestamps(a as unknown as Record<string, unknown>) as unknown as typeof a),
      homework: homework.map((h) => stripTimestamps(h as unknown as Record<string, unknown>) as unknown as typeof h),
      submissions: submissions.map((s) => stripTimestamps(s as unknown as Record<string, unknown>) as unknown as typeof s),
      assessments: assessments.map((a) => stripTimestamps(a as unknown as Record<string, unknown>) as unknown as typeof a),
      reviews: reviews.map((r) => stripTimestamps(r as unknown as Record<string, unknown>) as unknown as typeof r),
      notifications: notifications.map((n) => stripTimestamps(n as unknown as Record<string, unknown>) as unknown as typeof n),
      parentMessages: parentMessages.map((m) => stripTimestamps(m as unknown as Record<string, unknown>) as unknown as typeof m),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-teaching-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Đã tải xuống bản sao lưu toàn bộ dữ liệu (.json).');
  };

  const handleRestoreBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceTeacherId) return;
    setRestoring(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as WorkspaceBackupPayload;
      const { restoredCount } = await restoreWorkspaceBackup(workspaceTeacherId, parsed);
      setNotice(`Đã phục hồi thành công ${restoredCount} bản ghi chưa tồn tại lên Cloud Firestore.`);
    } catch (err) {
      setNotice(err instanceof Error ? `Lỗi phục hồi bản sao lưu: ${err.message}` : 'File sao lưu không hợp lệ.');
    } finally {
      setRestoring(false);
      if (backupInputRef.current) backupInputRef.current.value = '';
    }
  };

  const handleSeedDemo = async () => {
    if (!firebaseUser || !firebaseUser.email || !isMainTeacher) return;
    setSeeding(true);
    try {
      await seedSyntheticDemoData(
        firebaseUser.uid,
        firebaseUser.email,
        fullName || 'Giáo viên',
        phone || userProfile?.phone || authEmailToPhone(firebaseUser.email)
      );
      setNotice('Đã nạp dữ liệu mẫu giả lập lên đám mây thành công.');
    } catch (err) {
      console.error('Lỗi nạp dữ liệu mẫu:', err);
      setNotice(
        err instanceof Error
          ? `Không thể nạp dữ liệu mẫu: ${err.message}`
          : 'Không thể nạp dữ liệu mẫu.'
      );
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {isMainTeacher ? 'Cài đặt, Trợ giảng & Sao lưu' : 'Thông tin không gian làm việc'}
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {isMainTeacher
            ? 'Cấp quyền cho Trợ giảng dùng chung sổ dạy học, thiết lập hồ sơ giáo viên và sao lưu đám mây'
            : 'Bạn đang làm việc với quyền Trợ giảng trong sổ dạy học dùng chung'}
        </p>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold hover:underline cursor-pointer">
            Đóng
          </button>
        </div>
      )}

      {/* Assistant Workspace View */}
      {!isMainTeacher ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 rounded-2xl bg-white border border-emerald-200 p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <UserCheck className="w-5 h-5 text-[#15803D]" />
              <h2 className="text-base font-bold text-slate-900">Tài khoản Trợ giảng đã kết nối</h2>
            </div>
            <p className="text-sm text-slate-700 leading-relaxed">
              Bạn đang truy cập sổ dạy học của{' '}
              <strong>{teacherProfile?.fullName || 'Giáo viên chính'}</strong>. Mọi thao tác điểm danh, nhập báo cáo BTVN, tạo buổi học, cập nhật danh sách học sinh và soạn tin gửi phụ huynh qua Zalo đều được đồng bộ trực tiếp theo thời gian thực.
            </p>
            <div className="rounded-xl bg-[#FDFBFC] border border-pink-100 p-4 text-xs text-slate-600 space-y-1.5">
              <p>
                <strong>Tên hiển thị:</strong> {userProfile?.displayName || firebaseUser?.displayName}
              </p>
              <p>
                <strong>Tài khoản đăng nhập:</strong>{' '}
                <span className="font-mono-num">
                  {formatPhoneReadable(userProfile?.phone || authEmailToPhone(firebaseUser?.email)) ||
                    firebaseUser?.email}
                </span>
              </p>
              <p>
                <strong>Giáo viên phụ trách:</strong> {teacherProfile?.fullName || 'Giáo viên chính'}
              </p>
            </div>
          </section>

          <section className="lg:col-span-5 rounded-2xl bg-white border border-pink-100 p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Sao lưu dữ liệu</h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Bạn có thể tải nhanh bản sao lưu JSON toàn bộ dữ liệu lớp học về máy khi cần.
            </p>
            <button
              onClick={handleExportBackup}
              className="w-full min-h-[44px] px-4 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Tải bản sao lưu JSON</span>
            </button>
          </section>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left column: Teaching Assistant Management + Teacher Profile */}
          <div className="lg:col-span-7 space-y-5">
            {/* Teaching Assistant Management Panel */}
            <section className="rounded-2xl bg-white border border-pink-200/80 p-5 space-y-4 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#DB2777]" />
                    <h2 className="text-base font-bold text-slate-900">
                      Quản lý Trợ giảng (dùng chung sổ dạy học)
                    </h2>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Chỉ Giáo viên chính và Trợ giảng có trong danh sách dưới đây mới được vào sổ lớp học. Trợ giảng có toàn quyền điểm danh, nhập BTVN và gửi tin nhắn Zalo cho phụ huynh.
                  </p>
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-lg bg-[#FFF1F5] text-[#BE185D] text-xs font-semibold font-mono-num">
                  {sortedAssistants.length} trợ giảng
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#FDFBFC] border border-pink-100">
                <button
                  type="button"
                  onClick={() => {
                    setAsstMethod('google');
                    setAsstError(null);
                  }}
                  className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    asstMethod === 'google'
                      ? 'bg-[#DB2777] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Mời bằng Gmail (Khuyên dùng)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAsstMethod('phone');
                    setAsstError(null);
                  }}
                  className={`min-h-[38px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    asstMethod === 'phone'
                      ? 'bg-[#DB2777] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Cấp SĐT &amp; Mật khẩu
                </button>
              </div>

              <form onSubmit={(e) => void handleAddAssistant(e)} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Họ tên trợ giảng *
                    </label>
                    <input
                      type="text"
                      value={asstName}
                      onChange={(e) => setAsstName(e.target.value)}
                      placeholder="VD: Minh Anh (Trợ giảng)"
                      className="w-full min-h-[42px] rounded-xl border border-pink-200 px-3.5 text-sm"
                      required
                    />
                  </div>

                  {asstMethod === 'google' ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Gmail đăng nhập Google *
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          value={asstEmail}
                          onChange={(e) => setAsstEmail(e.target.value)}
                          placeholder="VD: trogiang@gmail.com"
                          className="w-full min-h-[42px] pl-9 pr-3.5 rounded-xl border border-pink-200 text-sm"
                          required
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        SĐT đăng nhập *
                      </label>
                      <div className="relative">
                        <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="tel"
                          value={asstPhone}
                          onChange={(e) => setAsstPhone(e.target.value)}
                          placeholder="VD: 0987 654 321"
                          className="w-full min-h-[42px] pl-9 pr-3.5 rounded-xl border border-pink-200 text-sm font-mono-num"
                          required
                        />
                      </div>
                    </div>
                  )}
                </div>

                {asstMethod === 'google' ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Số điện thoại liên hệ (tùy chọn)
                    </label>
                    <input
                      type="tel"
                      value={asstPhone}
                      onChange={(e) => setAsstPhone(e.target.value)}
                      placeholder="VD: 0987 654 321"
                      className="w-full min-h-[42px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mật khẩu cấp cho trợ giảng (để trống để tự sinh)
                    </label>
                    <input
                      type="text"
                      value={asstPassword}
                      onChange={(e) => setAsstPassword(e.target.value)}
                      placeholder="Tối thiểu 6 ký tự (hoặc để trống)"
                      className="w-full min-h-[42px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                    />
                  </div>
                )}

                {asstError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                    <span>{asstError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={addingAsst}
                  className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] inline-flex items-center gap-2 disabled:opacity-60 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{addingAsst ? 'Đang thêm trợ giảng...' : 'Thêm trợ giảng vào sổ lớp'}</span>
                </button>
              </form>

              {inviteSummary && (
                <div className="rounded-xl bg-[#ECFDF5] border border-emerald-200 p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#15803D] inline-flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Hướng dẫn gửi qua Zalo cho Trợ giảng:</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyInvite()}
                      className="min-h-[32px] px-3 rounded-lg bg-white border border-emerald-300 text-[#15803D] text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-emerald-50 cursor-pointer"
                    >
                      {copiedInvite ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedInvite ? 'Đã sao chép' : 'Sao chép gửi Zalo'}</span>
                    </button>
                  </div>
                  <pre className="whitespace-pre-wrap text-xs text-slate-800 bg-white/80 rounded-lg p-3 border border-emerald-100 font-sans leading-relaxed">
                    {inviteSummary}
                  </pre>
                </div>
              )}

              {/* Current Assistants List */}
              <div className="pt-3 border-t border-pink-100 space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Danh sách trợ giảng đang có quyền
                </h3>
                {sortedAssistants.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-[#FDFBFC] border border-pink-100 rounded-xl px-4 py-3">
                    Chưa có trợ giảng nào. Nhập Gmail của trợ giảng ở trên — ngay khi trợ giảng bấm "Đăng nhập bằng Google", họ sẽ tự động vào dùng chung toàn bộ lớp học của bạn.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {sortedAssistants.map((asst) => {
                      const isConnected = Boolean(asst.assistantUid);
                      const isPhoneAsst = asst.email.endsWith('@phone.smartteaching.app');
                      const displayContact = isPhoneAsst
                        ? `SĐT: ${formatPhoneReadable(asst.phone || authEmailToPhone(asst.email))}`
                        : asst.email;
                      const isConfirming = confirmRevokeId === asst.id;
                      return (
                        <div
                          key={asst.id}
                          className="rounded-xl border border-pink-100 bg-[#FDFBFC] px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {asst.fullName}
                              </span>
                              <span
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                                  isConnected
                                    ? 'bg-emerald-50 text-[#15803D] border border-emerald-200'
                                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                                }`}
                              >
                                {isConnected ? 'Đã kết nối' : 'Chờ đăng nhập lần đầu'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5 truncate font-mono-num">
                              {displayContact}
                              {!isPhoneAsst && asst.phone ? ` · ${formatPhoneReadable(asst.phone)}` : ''}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isConfirming ? (
                              <>
                                <button
                                  type="button"
                                  disabled={revokingId === asst.id}
                                  onClick={() => void handleRevokeAssistant(asst)}
                                  className="min-h-[34px] px-3 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 cursor-pointer"
                                >
                                  {revokingId === asst.id ? 'Đang xóa...' : 'Xác nhận thu hồi'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmRevokeId(null)}
                                  className="min-h-[34px] px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmRevokeId(asst.id)}
                                className="min-h-[34px] px-3 rounded-lg border border-rose-200 bg-white text-rose-700 text-xs font-semibold hover:bg-rose-50 inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Thu hồi quyền</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Teacher Profile Form */}
            <form
              onSubmit={(e) => void handleSaveProfile(e)}
              className="rounded-2xl bg-white border border-pink-100 p-5 space-y-4"
            >
              <h2 className="text-base font-bold text-slate-900">Hồ sơ giáo viên &amp; Học phí mặc định</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Họ tên giáo viên *</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Số điện thoại liên hệ</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Chuyên môn giảng dạy</label>
                  <input
                    type="text"
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    placeholder="VD: Toán THCS, Tiếng Anh..."
                    className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Học phí mặc định / buổi (VNĐ)</label>
                  <input
                    type="number"
                    min={0}
                    step={10000}
                    value={defaultFee}
                    onChange={(e) => setDefaultFee(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Quy tắc tính buổi học phí</label>
                <select
                  value={tuitionRule}
                  onChange={(e) => setTuitionRule(e.target.value as TuitionRule)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3.5 text-sm"
                >
                  <option value="present_and_makeup">Tính buổi có mặt, đi muộn và học bù</option>
                  <option value="present_only">Chỉ tính buổi có mặt và đi muộn</option>
                  <option value="present_makeup_unexcused">Tính có mặt, đi muộn, học bù và nghỉ không phép</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] inline-flex items-center gap-2 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Đang lưu...' : 'Lưu cài đặt'}</span>
              </button>
            </form>

            {/* Change Password Card (Only for Phone+Password accounts) */}
            {isPhoneAuthAccount && (
              <form
                onSubmit={(e) => void handleChangePassword(e)}
                className="rounded-2xl bg-white border border-pink-100 p-5 space-y-4"
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-[#DB2777]" />
                  <h2 className="text-base font-bold text-slate-900">Đổi mật khẩu đăng nhập</h2>
                </div>
                <p className="text-xs text-slate-500">
                  Số điện thoại đăng nhập hiện tại:{' '}
                  <strong className="font-mono-num text-slate-800">
                    {formatPhoneReadable(userProfile?.phone || authEmailToPhone(firebaseUser?.email)) || 'Chưa rõ'}
                  </strong>
                </p>

                {pwdMessage && (
                  <div
                    className={`rounded-xl px-3.5 py-2.5 text-xs flex items-center gap-2 border ${
                      pwdMessage.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-rose-50 border-rose-200 text-rose-800'
                    }`}
                  >
                    {pwdMessage.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-[#15803D]" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    )}
                    <span>{pwdMessage.text}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Mật khẩu hiện tại *</label>
                    <input
                      type="password"
                      value={currentPwd}
                      onChange={(e) => setCurrentPwd(e.target.value)}
                      className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm"
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
                      className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Nhập lại mật khẩu *</label>
                    <input
                      type="password"
                      value={confirmPwd}
                      onChange={(e) => setConfirmPwd(e.target.value)}
                      minLength={6}
                      className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={changingPwd}
                  className="min-h-[42px] px-4 rounded-xl bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 inline-flex items-center gap-2 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>{changingPwd ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}</span>
                </button>
              </form>
            )}
          </div>

          {/* Right column: Backup, Restore, Demo & Security Summary */}
          <section className="lg:col-span-5 space-y-5">
            <div className="rounded-2xl bg-white border border-pink-100 p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Sao lưu &amp; Phục hồi dữ liệu</h2>
              <p className="text-xs text-slate-600 leading-relaxed">
                Dữ liệu được đồng bộ tự động trên Cloud Firestore giữa Giáo viên và Trợ giảng. Bạn có thể tải bản sao lưu JSON về máy bất cứ lúc nào.
              </p>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <button
                  onClick={handleExportBackup}
                  className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Sao lưu JSON</span>
                </button>
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".json"
                  onChange={(e) => void handleRestoreBackup(e)}
                  className="hidden"
                />
                <button
                  onClick={() => backupInputRef.current?.click()}
                  disabled={restoring}
                  className="flex-1 min-h-[44px] px-4 rounded-xl bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>{restoring ? 'Đang phục hồi...' : 'Phục hồi JSON'}</span>
                </button>
              </div>
              <button
                onClick={() => void handleSeedDemo()}
                disabled={seeding}
                className="w-full min-h-[42px] px-4 rounded-xl border border-slate-200 text-slate-700 text-xs font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Database className="w-4 h-4 text-[#DB2777]" />
                <span>{seeding ? 'Đang tạo dữ liệu mẫu...' : 'Nạp dữ liệu mẫu giả lập để kiểm thử'}</span>
              </button>
            </div>

            <div className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#15803D]" />
                <h2 className="text-base font-bold text-slate-900">Phân quyền &amp; Gửi tin Zalo</h2>
              </div>
              <ul className="text-xs text-slate-600 space-y-2 leading-relaxed">
                <li>
                  • <strong>Chỉ Giáo viên chính &amp; Trợ giảng</strong> đăng nhập vào hệ thống. Khi bạn bấm <em>Thu hồi quyền</em>, trợ giảng sẽ bị ngắt quyền truy cập dữ liệu lớp học ngay lập tức.
                </li>
                <li>
                  • <strong>Phụ huynh không cần tải app hay đăng nhập</strong> — giáo viên và trợ giảng gửi báo cáo BTVN, nhận xét buổi học và thông báo trực tiếp qua <strong>Zalo</strong>.
                </li>
                <li>
                  • Ghi chú nội bộ của giáo viên được lưu tách biệt ở vùng bảo mật riêng, không bao giờ xuất hiện trong tin nhắn gửi phụ huynh.
                </li>
              </ul>
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
