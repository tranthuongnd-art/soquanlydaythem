import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  FIREBASE_PROJECT_ID,
  generateIssuedPassword,
  normalizePhone,
} from '../lib/firebase';
import {
  downloadStudentImportTemplate,
  exportIssuedCredentialsToExcel,
  parseStudentsFromExcel,
} from '../services/exportService';
import {
  createStudent,
  enrollStudentInClass,
  provisionAccountsForStudent,
  syncClassMemberEmails,
  todayISO,
} from '../services/firestoreService';
import { IssuedCredentialItem, Student } from '../types';

interface BulkRowDraft {
  key: string;
  studentCode: string;
  fullName: string;
  schoolClass: string;
  parentName: string;
  motherPhone: string;
  fatherPhone: string;
  studentPhone: string;
  dateOfBirth: string;
}

interface BulkAddStudentsModalProps {
  open: boolean;
  onClose: () => void;
  defaultClassIds?: string[];
  onCompleted?: (summary: { createdCount: number; provisionedCount: number }) => void;
}

function makeEmptyRow(index: number): BulkRowDraft {
  return {
    key: `row_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
    studentCode: '',
    fullName: '',
    schoolClass: '',
    parentName: '',
    motherPhone: '',
    fatherPhone: '',
    studentPhone: '',
    dateOfBirth: '',
  };
}

function parsePastedLines(text: string): BulkRowDraft[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  return lines
    .map((line, idx): BulkRowDraft | null => {
      // Support Tab (Excel/Sheets), pipe |, semicolon ;, or comma ,
      const delimiter = line.includes('\t')
        ? '\t'
        : line.includes('|')
        ? '|'
        : line.includes(';')
        ? ';'
        : ',';
      const cols = line.split(delimiter).map((c) => c.trim());
      const fullName = cols[0] ?? '';
      if (!fullName) return null;

      // Smart detect: if column 3 is already a phone number (user omitted parent name), shift phone columns cleanly
      const col2 = cols[2] ?? '';
      const col2IsPhone =
        normalizePhone(col2).length >= 8 && !/[a-zA-Z\u00C0-\u1EF9]/.test(col2);

      if (col2IsPhone) {
        return {
          ...makeEmptyRow(idx),
          fullName,
          schoolClass: cols[1] ?? '',
          parentName: '',
          motherPhone: col2,
          fatherPhone: cols[3] ?? '',
          studentPhone: cols[4] ?? '',
          dateOfBirth: cols[5] ?? '',
        };
      }

      return {
        ...makeEmptyRow(idx),
        fullName,
        schoolClass: cols[1] ?? '',
        parentName: col2,
        motherPhone: cols[3] ?? '',
        fatherPhone: cols[4] ?? '',
        studentPhone: cols[5] ?? '',
        dateOfBirth: cols[6] ?? '',
      };
    })
    .filter((r): r is BulkRowDraft => r !== null);
}

export const BulkAddStudentsModal: React.FC<BulkAddStudentsModalProps> = ({
  open,
  onClose,
  defaultClassIds = [],
  onCompleted,
}) => {
  const { workspaceTeacherId, classes, students, enrollments } = useApp();
  const [inputTab, setInputTab] = useState<'table' | 'paste' | 'excel'>('table');
  const [rows, setRows] = useState<BulkRowDraft[]>(() =>
    Array.from({ length: 5 }, (_, i) => makeEmptyRow(i))
  );
  const [pasteText, setPasteText] = useState('');
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>(defaultClassIds);
  const [startDate, setStartDate] = useState(todayISO());

  // Provisioning options (Parents use Zalo directly, so account provisioning is optional & off by default)
  const [autoProvision, setAutoProvision] = useState(false);
  const [provisionParents, setProvisionParents] = useState(false);
  const [provisionStudents, setProvisionStudents] = useState(true);
  const [passwordMode, setPasswordMode] = useState<'shared' | 'random'>('shared');
  const [sharedPassword, setSharedPassword] = useState(() => generateIssuedPassword(8));

  // Progress & result state
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<{
    createdCount: number;
    credentials: IssuedCredentialItem[];
    providerDisabled: boolean;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const excelInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedClassIds(
        defaultClassIds.length > 0 ? defaultClassIds : classes[0] ? [classes[0].id] : []
      );
      setResultSummary(null);
      setErrorMsg(null);
      setSaving(false);
      setProgress({ current: 0, total: 0 });
    }
  }, [open, defaultClassIds, classes]);

  const validRows = useMemo(
    () => rows.filter((r) => r.fullName.trim().length > 0),
    [rows]
  );

  const pastedPreviewCount = useMemo(
    () => parsePastedLines(pasteText).length,
    [pasteText]
  );

  if (!open) return null;

  const updateRow = (key: string, field: keyof BulkRowDraft, value: string) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const addRows = (count: number) => {
    setRows((prev) => [
      ...prev,
      ...Array.from({ length: count }, (_, idx) => makeEmptyRow(prev.length + idx)),
    ]);
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length <= 1 ? [makeEmptyRow(0)] : prev.filter((r) => r.key !== key)));
  };

  const toggleClass = (classId: string) => {
    setSelectedClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  const handleApplyPaste = () => {
    const parsed = parsePastedLines(pasteText);
    if (parsed.length === 0) {
      setErrorMsg('Chưa có dòng học sinh hợp lệ nào trong nội dung dán.');
      return;
    }
    setErrorMsg(null);
    setRows((prev) => {
      const filledPrev = prev.filter((r) => r.fullName.trim().length > 0);
      return [...filledPrev, ...parsed];
    });
    setPasteText('');
    setInputTab('table');
  };

  const handleExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const imported = await parseStudentsFromExcel(file);
      if (imported.length === 0) {
        setErrorMsg('Không tìm thấy học sinh nào trong file. Hãy kiểm tra lại cột "Họ tên".');
        return;
      }
      const mapped: BulkRowDraft[] = imported.map((item, idx) => ({
        key: `imp_${Date.now()}_${idx}`,
        studentCode: item.studentCode,
        fullName: item.fullName,
        schoolClass: item.schoolClass,
        parentName: item.parentName,
        motherPhone: item.motherPhone,
        fatherPhone: item.fatherPhone,
        studentPhone: item.studentPhone,
        dateOfBirth: item.dateOfBirth,
      }));
      setRows((prev) => {
        const filledPrev = prev.filter((r) => r.fullName.trim().length > 0);
        return [...filledPrev, ...mapped];
      });
      setInputTab('table');
    } catch {
      setErrorMsg('Không đọc được file bảng tính. Vui lòng dùng file .xlsx hoặc .csv hợp lệ.');
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const handleBatchSave = async () => {
    if (!workspaceTeacherId) return;
    const rowsToSave = validRows;
    if (rowsToSave.length === 0) {
      setErrorMsg('Vui lòng nhập ít nhất 1 học sinh (có Họ và tên).');
      return;
    }
    if (autoProvision && passwordMode === 'shared' && sharedPassword.trim().length < 6) {
      setErrorMsg('Mật khẩu cấp ban đầu phải có tối thiểu 6 ký tự.');
      return;
    }

    setErrorMsg(null);
    setSaving(true);
    setProgress({ current: 0, total: rowsToSave.length });

    const createdStudents: Student[] = [];
    const allCredentials: IssuedCredentialItem[] = [];
    let anyProviderDisabled = false;
    const knownParentUidCache = new Map<string, string>();

    const nextBaseIndex = students.length + 1;
    const newEnrollments = [...enrollments];

    try {
      for (let i = 0; i < rowsToSave.length; i++) {
        const r = rowsToSave[i];
        setProgress({ current: i + 1, total: rowsToSave.length });

        const code =
          r.studentCode.trim() ||
          `HS-2026-${String(nextBaseIndex + i).padStart(3, '0')}`;

        let created = await createStudent(workspaceTeacherId, {
          studentCode: code,
          fullName: r.fullName.trim(),
          dateOfBirth: r.dateOfBirth.trim(),
          schoolClass: r.schoolClass.trim(),
          parentName: r.parentName.trim() || `Phụ huynh ${r.fullName.trim()}`,
          studentPhone: r.studentPhone.trim(),
          motherPhone: r.motherPhone.trim(),
          fatherPhone: r.fatherPhone.trim(),
          startDate,
          status: 'active',
        });

        if (autoProvision && !anyProviderDisabled) {
          const provRes = await provisionAccountsForStudent(workspaceTeacherId, created, {
            provisionStudent: provisionStudents,
            provisionParents: provisionParents,
            passwordMode,
            sharedPassword: sharedPassword.trim(),
            knownParentUidCache,
          });
          created = provRes.updatedStudent;
          allCredentials.push(...provRes.credentials);
          if (provRes.providerDisabled) {
            anyProviderDisabled = true;
          }
        }

        createdStudents.push(created);

        for (const cId of selectedClassIds) {
          await enrollStudentInClass(workspaceTeacherId, cId, created);
          newEnrollments.push({
            id: `${cId}_${created.id}`,
            teacherId: workspaceTeacherId,
            classId: cId,
            studentId: created.id,
            studentEmail: created.studentEmail,
            studentUid: created.studentUid,
            parentEmails: created.parentEmails,
            parentUids: created.parentUids,
            status: 'active',
            enrolledAt: todayISO(),
          });
        }
      }

      // Sync class member UIDs/emails once per selected class after all students are created
      const mergedStudents = [...students, ...createdStudents];
      for (const cId of selectedClassIds) {
        await syncClassMemberEmails(workspaceTeacherId, cId, mergedStudents, newEnrollments);
      }

      const provisionedCount = allCredentials.filter((c) => c.status === 'created').length;
      setResultSummary({
        createdCount: createdStudents.length,
        credentials: allCredentials,
        providerDisabled: anyProviderDisabled,
      });
      onCompleted?.({ createdCount: createdStudents.length, provisionedCount });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? `Lỗi khi lưu đồng loạt: ${err.message}` : 'Không thể lưu danh sách học sinh.'
      );
    } finally {
      setSaving(false);
    }
  };

  const formatCredentialMessage = (item: IssuedCredentialItem) => {
    const roleLabel = item.role === 'PARENT' ? 'Phụ huynh' : 'Học sinh';
    return `Thông tin đăng nhập Sổ Dạy Học Thông Minh (${roleLabel} – em ${item.studentName}):\n- Số điện thoại: ${item.phone}\n- Mật khẩu được cấp: ${item.password}\n(Anh/chị có thể đổi mật khẩu sau khi đăng nhập)`;
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleCopyAllCredentials = () => {
    if (!resultSummary) return;
    const lines = resultSummary.credentials
      .filter((c) => c.status === 'created' || c.status === 'already_exists')
      .map(formatCredentialMessage)
      .join('\n\n---\n\n');
    void copyText(lines, 'all');
  };

  const handleCloseAndReset = () => {
    setRows(Array.from({ length: 5 }, (_, i) => makeEmptyRow(i)));
    setPasteText('');
    setResultSummary(null);
    setErrorMsg(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
      <div className="w-full sm:max-w-5xl max-h-[94vh] flex flex-col rounded-t-3xl sm:rounded-2xl bg-white border border-pink-100 overflow-hidden shadow-xl">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-pink-100 flex items-center justify-between gap-3 shrink-0 bg-[#FDFBFC]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#FFF1F5] border border-pink-200 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4 text-[#DB2777]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 truncate">
                Thêm đồng loạt nhiều học sinh
              </h3>
              <p className="text-xs text-slate-500 truncate">
                Nhập nhiều dòng, dán từ Zalo/Excel hoặc tải bảng tính · Tự động cấp SĐT &amp; mật khẩu đăng nhập
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCloseAndReset}
            disabled={saving}
            className="min-h-[40px] min-w-[40px] rounded-xl hover:bg-pink-50 inline-flex items-center justify-center cursor-pointer shrink-0"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {resultSummary ? (
            /* Post-Save Credentials Handout Screen */
            <div className="space-y-4">
              <div className="rounded-2xl bg-[#ECFDF5] border border-emerald-200 p-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#15803D] shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-emerald-950">
                    Đã thêm thành công {resultSummary.createdCount} học sinh vào hệ thống!
                  </p>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    {resultSummary.credentials.filter((c) => c.status === 'created').length > 0
                      ? `Đã tự động cấp ${resultSummary.credentials.filter((c) => c.status === 'created').length} tài khoản đăng nhập mới. Hãy sao chép hoặc xuất Excel phiếu tài khoản bên dưới ngay (mật khẩu chỉ hiển thị một lần để đảm bảo bảo mật).`
                      : 'Hồ sơ học sinh và phân lớp đã được đồng bộ lên đám mây.'}
                  </p>
                </div>
              </div>

              {resultSummary.providerDisabled && (
                <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-950 space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>Hồ sơ học sinh đã lưu, nhưng chưa cấp được tài khoản do Firebase chưa bật Email/Password:</span>
                  </p>
                  <p>
                    Mở Firebase Console → Authentication → Sign-in method → bật <strong>Email/Password</strong>, sau đó nhấn nút <strong>Cấp tài khoản</strong> trong hồ sơ từng học sinh.
                  </p>
                  <a
                    href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-[#BE185D] hover:underline"
                  >
                    <span>Mở cài đặt Firebase Authentication</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              )}

              {resultSummary.credentials.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-900">
                      Phiếu cấp tài khoản đăng nhập ({resultSummary.credentials.length})
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleCopyAllCredentials}
                        className="min-h-[38px] px-3.5 rounded-xl bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {copiedKey === 'all' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === 'all' ? 'Đã sao chép tất cả' : 'Sao chép tất cả (Zalo)'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void exportIssuedCredentialsToExcel(resultSummary.credentials)}
                        className="min-h-[38px] px-3.5 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Xuất Excel phiếu TK</span>
                      </button>
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-pink-100">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FDFBFC] border-b border-pink-100 text-slate-600">
                        <tr>
                          <th className="py-2.5 px-3 font-semibold">Học sinh</th>
                          <th className="py-2.5 px-3 font-semibold">Vai trò</th>
                          <th className="py-2.5 px-3 font-semibold">SĐT đăng nhập</th>
                          <th className="py-2.5 px-3 font-semibold">Mật khẩu được cấp</th>
                          <th className="py-2.5 px-3 font-semibold">Trạng thái</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-pink-50">
                        {resultSummary.credentials.map((item, idx) => {
                          const k = `cred_${idx}`;
                          return (
                            <tr key={k}>
                              <td className="py-2.5 px-3 font-semibold text-slate-900">{item.studentName}</td>
                              <td className="py-2.5 px-3 text-slate-700">
                                {item.role === 'PARENT' ? 'Phụ huynh' : 'Học sinh'}
                              </td>
                              <td className="py-2.5 px-3 font-mono-num font-semibold text-slate-900">
                                {item.phone}
                              </td>
                              <td className="py-2.5 px-3 font-mono-num text-[#BE185D] font-semibold">
                                {item.password || '—'}
                              </td>
                              <td className="py-2.5 px-3">
                                <span
                                  className={`font-semibold ${
                                    item.status === 'created'
                                      ? 'text-[#15803D]'
                                      : item.status === 'already_exists'
                                      ? 'text-slate-600'
                                      : 'text-rose-700'
                                  }`}
                                >
                                  {item.status === 'created'
                                    ? 'Mới cấp'
                                    : item.status === 'already_exists'
                                    ? 'Đã có sẵn'
                                    : item.note || 'Lỗi'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {item.status === 'created' && (
                                  <button
                                    type="button"
                                    onClick={() => void copyText(formatCredentialMessage(item), k)}
                                    className="px-2.5 py-1.5 rounded-lg border border-pink-200 text-[#BE185D] hover:bg-pink-50 inline-flex items-center gap-1 cursor-pointer"
                                  >
                                    {copiedKey === k ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                    <span>{copiedKey === k ? 'Đã chép' : 'Chép'}</span>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Shared Batch Settings */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Class enrollment & start date */}
                <div className="lg:col-span-6 rounded-2xl bg-[#FDFBFC] border border-pink-100 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-slate-800">1. Phân lớp áp dụng chung</p>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      aria-label="Ngày bắt đầu học"
                      className="min-h-[34px] rounded-lg border border-pink-200 bg-white px-2.5 text-xs font-mono-num"
                    />
                  </div>
                  {classes.filter((c) => c.status === 'active').length === 0 ? (
                    <p className="text-xs text-slate-500">Chưa có lớp đang mở (vẫn có thể thêm hồ sơ học sinh trước).</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {classes
                        .filter((c) => c.status === 'active')
                        .map((c) => {
                          const checked = selectedClassIds.includes(c.id);
                          return (
                            <label
                              key={c.id}
                              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                                checked
                                  ? 'bg-[#FFF1F5] border-[#DB2777] text-[#BE185D] font-semibold'
                                  : 'bg-white border-pink-100 text-slate-700 hover:border-pink-200'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleClass(c.id)}
                                className="accent-[#DB2777]"
                              />
                              <span>{c.name}</span>
                            </label>
                          );
                        })}
                    </div>
                  )}
                </div>

                {/* Account Provisioning Settings (Optional — Parents receive notifications via Zalo) */}
                <div className="lg:col-span-6 rounded-2xl bg-[#FDFBFC] border border-pink-100 p-4 space-y-2.5">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoProvision}
                      onChange={(e) => setAutoProvision(e.target.checked)}
                      className="accent-[#DB2777] w-4 h-4"
                    />
                    <KeyRound className="w-4 h-4 text-[#DB2777] shrink-0" />
                    <span className="text-xs font-bold text-slate-800">
                      2. Cấp tài khoản đăng nhập (tùy chọn cho Học sinh)
                    </span>
                  </label>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Phụ huynh nhận thông báo &amp; nhận xét trực tiếp qua <strong>Zalo</strong>, không cần tải app hay tạo tài khoản. Chỉ cần lưu SĐT Zalo mẹ/bố trong bảng dưới.
                  </p>

                  {autoProvision && (
                    <div className="space-y-2.5 pl-1 pt-1">
                      <div className="flex flex-wrap gap-3 text-xs text-slate-700">
                        <label className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={provisionStudents}
                            onChange={(e) => setProvisionStudents(e.target.checked)}
                            className="accent-[#15803D]"
                          />
                          <span>Cấp TK Học sinh (SĐT học sinh)</span>
                        </label>
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-500">
                          <input
                            type="checkbox"
                            checked={provisionParents}
                            onChange={(e) => setProvisionParents(e.target.checked)}
                            className="accent-[#15803D]"
                          />
                          <span>Cấp TK Phụ huynh (chỉ khi cần dùng app)</span>
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={passwordMode}
                          onChange={(e) => setPasswordMode(e.target.value as 'shared' | 'random')}
                          className="min-h-[38px] rounded-xl border border-pink-200 bg-white px-2.5 text-xs"
                        >
                          <option value="shared">Dùng mật khẩu cấp chung ban đầu</option>
                          <option value="random">Sinh mật khẩu ngẫu nhiên riêng từng TK</option>
                        </select>

                        {passwordMode === 'shared' && (
                          <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
                            <input
                              type="text"
                              value={sharedPassword}
                              onChange={(e) => setSharedPassword(e.target.value)}
                              placeholder="Mật khẩu >= 6 ký tự"
                              className="flex-1 min-h-[38px] rounded-xl border border-pink-200 bg-white px-3 text-xs font-mono-num"
                            />
                            <button
                              type="button"
                              onClick={() => setSharedPassword(generateIssuedPassword(8))}
                              className="min-h-[38px] min-w-[38px] rounded-xl border border-pink-200 bg-white hover:bg-pink-50 inline-flex items-center justify-center cursor-pointer"
                              title="Tạo mật khẩu ngẫu nhiên"
                            >
                              <RefreshCw className="w-3.5 h-3.5 text-[#DB2777]" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Input Method Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-xl bg-[#FDFBFC] border border-pink-100 p-1 gap-1">
                  <button
                    type="button"
                    onClick={() => setInputTab('table')}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                      inputTab === 'table' ? 'bg-[#DB2777] text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Table2 className="w-3.5 h-3.5" />
                    <span>Bảng nhập nhanh ({validRows.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputTab('paste')}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                      inputTab === 'paste' ? 'bg-[#DB2777] text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span>Dán danh sách</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputTab('excel')}
                    className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                      inputTab === 'excel' ? 'bg-[#DB2777] text-white' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Từ file Excel/CSV</span>
                  </button>
                </div>

                {inputTab === 'table' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => addRows(1)}
                      className="min-h-[36px] px-3 rounded-xl border border-pink-200 bg-white text-xs font-semibold text-[#BE185D] hover:bg-pink-50 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ 1 dòng</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => addRows(5)}
                      className="min-h-[36px] px-3 rounded-xl border border-emerald-200 bg-[#ECFDF5] text-xs font-semibold text-[#15803D] hover:bg-emerald-100 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ 5 dòng</span>
                    </button>
                  </div>
                )}
              </div>

              {errorMsg && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2.5 text-xs text-rose-800 font-medium">
                  {errorMsg}
                </div>
              )}

              {/* Tab 1: Editable Table / Mobile Cards */}
              {inputTab === 'table' && (
                <div className="space-y-3">
                  {/* Desktop table */}
                  <div className="hidden md:block overflow-x-auto rounded-xl border border-pink-100">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#FDFBFC] border-b border-pink-100 text-slate-600">
                        <tr>
                          <th className="py-2.5 px-2.5 w-8 text-center">#</th>
                          <th className="py-2.5 px-2 font-semibold min-w-[165px]">Họ và tên HS *</th>
                          <th className="py-2.5 px-2 font-semibold w-24">Lớp</th>
                          <th className="py-2.5 px-2 font-semibold min-w-[155px]">Phụ huynh (tự động)</th>
                          <th className="py-2.5 px-2 font-semibold min-w-[125px]">SĐT Zalo mẹ</th>
                          <th className="py-2.5 px-2 font-semibold min-w-[125px]">SĐT Zalo bố</th>
                          <th className="py-2.5 px-2 font-semibold min-w-[125px]">SĐT học sinh</th>
                          <th className="py-2.5 px-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-pink-50">
                        {rows.map((row, idx) => (
                          <tr key={row.key} className="hover:bg-pink-50/20">
                            <td className="py-2 px-2.5 text-center font-mono-num text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="py-1.5 px-1.5">
                              <input
                                type="text"
                                value={row.fullName}
                                onChange={(e) => updateRow(row.key, 'fullName', e.target.value)}
                                placeholder="Nguyễn Minh Quân"
                                className="w-full min-h-[36px] rounded-lg border border-pink-200 px-2.5 text-xs focus:outline-none focus:border-[#DB2777]"
                              />
                            </td>
                            <td className="py-1.5 px-1.5">
                              <input
                                type="text"
                                value={row.schoolClass}
                                onChange={(e) => updateRow(row.key, 'schoolClass', e.target.value)}
                                placeholder="9A1"
                                className="w-full min-h-[36px] rounded-lg border border-pink-200 px-2 text-xs"
                              />
                            </td>
                            <td className="py-1.5 px-1.5">
                              <input
                                type="text"
                                value={row.parentName}
                                onChange={(e) => updateRow(row.key, 'parentName', e.target.value)}
                                placeholder={
                                  row.fullName.trim()
                                    ? `Phụ huynh ${row.fullName.trim()}`
                                    : 'Phụ huynh + tên con'
                                }
                                className="w-full min-h-[36px] rounded-lg border border-pink-200 px-2.5 text-xs"
                              />
                            </td>
                            <td className="py-1.5 px-1.5">
                              <input
                                type="tel"
                                value={row.motherPhone}
                                onChange={(e) => updateRow(row.key, 'motherPhone', e.target.value)}
                                placeholder="0912..."
                                className="w-full min-h-[36px] rounded-lg border border-pink-200 px-2.5 text-xs font-mono-num"
                              />
                            </td>
                            <td className="py-1.5 px-1.5">
                              <input
                                type="tel"
                                value={row.fatherPhone}
                                onChange={(e) => updateRow(row.key, 'fatherPhone', e.target.value)}
                                placeholder="Tùy chọn"
                                className="w-full min-h-[36px] rounded-lg border border-pink-200 px-2.5 text-xs font-mono-num"
                              />
                            </td>
                            <td className="py-1.5 px-1.5">
                              <input
                                type="tel"
                                value={row.studentPhone}
                                onChange={(e) => updateRow(row.key, 'studentPhone', e.target.value)}
                                placeholder="Tùy chọn"
                                className="w-full min-h-[36px] rounded-lg border border-pink-200 px-2.5 text-xs font-mono-num"
                              />
                            </td>
                            <td className="py-1.5 px-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => removeRow(row.key)}
                                className="min-h-[32px] min-w-[32px] rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 inline-flex items-center justify-center cursor-pointer"
                                aria-label="Xóa dòng"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile stacked cards */}
                  <div className="md:hidden space-y-3">
                    {rows.map((row, idx) => (
                      <div key={row.key} className="rounded-xl border border-pink-100 bg-[#FDFBFC] p-3.5 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#BE185D]">Học sinh #{idx + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeRow(row.key)}
                            className="text-xs text-rose-600 inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Xóa</span>
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={row.fullName}
                            onChange={(e) => updateRow(row.key, 'fullName', e.target.value)}
                            placeholder="Họ và tên HS *"
                            className="col-span-2 min-h-[40px] rounded-lg border border-pink-200 bg-white px-3 text-xs"
                          />
                          <input
                            type="text"
                            value={row.schoolClass}
                            onChange={(e) => updateRow(row.key, 'schoolClass', e.target.value)}
                            placeholder="Lớp (VD: 9A1)"
                            className="min-h-[40px] rounded-lg border border-pink-200 bg-white px-3 text-xs"
                          />
                          <input
                            type="text"
                            value={row.parentName}
                            onChange={(e) => updateRow(row.key, 'parentName', e.target.value)}
                            placeholder={
                              row.fullName.trim()
                                ? `Phụ huynh ${row.fullName.trim()}`
                                : 'Phụ huynh + tên con (tự động)'
                            }
                            className="min-h-[40px] rounded-lg border border-pink-200 bg-white px-3 text-xs"
                          />
                          <input
                            type="tel"
                            value={row.motherPhone}
                            onChange={(e) => updateRow(row.key, 'motherPhone', e.target.value)}
                            placeholder="SĐT mẹ (TK PH)"
                            className="min-h-[40px] rounded-lg border border-pink-200 bg-white px-3 text-xs font-mono-num"
                          />
                          <input
                            type="tel"
                            value={row.fatherPhone}
                            onChange={(e) => updateRow(row.key, 'fatherPhone', e.target.value)}
                            placeholder="SĐT bố (tùy chọn)"
                            className="min-h-[40px] rounded-lg border border-pink-200 bg-white px-3 text-xs font-mono-num"
                          />
                          <input
                            type="tel"
                            value={row.studentPhone}
                            onChange={(e) => updateRow(row.key, 'studentPhone', e.target.value)}
                            placeholder="SĐT học sinh (TK HS, tùy chọn)"
                            className="col-span-2 min-h-[40px] rounded-lg border border-pink-200 bg-white px-3 text-xs font-mono-num"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Tab 2: Quick Paste */}
              {inputTab === 'paste' && (
                <div className="space-y-3">
                  <div className="rounded-xl bg-[#FDFBFC] border border-pink-100 p-3.5 text-xs text-slate-600 space-y-1">
                    <p className="font-semibold text-slate-800">
                      Mỗi học sinh 1 dòng — hỗ trợ copy trực tiếp từ Excel, Google Sheets hoặc Zalo:
                    </p>
                    <p className="font-mono-num text-[11px] text-slate-500">
                      Họ tên | Lớp chính khóa | SĐT mẹ | SĐT bố | SĐT học sinh
                    </p>
                    <p className="text-[11px] text-slate-500">
                      (Tên phụ huynh tự động điền "Phụ huynh + tên con". Hỗ trợ dấu phẩy, chấm phẩy, gạch đứng | hoặc Tab.)
                    </p>
                  </div>
                  <textarea
                    rows={8}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={`Nguyễn Minh Quân | 9A1 | 0912345601 | 0912345602 | 0988111001\nTrần Khánh Linh | 9A1 | 0912345603\nLê Hoàng Nam | 9A2 | 0912345604`}
                    className="w-full rounded-xl border border-pink-200 p-3.5 text-xs font-mono-num leading-relaxed focus:outline-none focus:border-[#DB2777]"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-600">
                      Nhận diện được <strong className="text-[#BE185D]">{pastedPreviewCount}</strong> học sinh
                    </span>
                    <button
                      type="button"
                      onClick={handleApplyPaste}
                      disabled={pastedPreviewCount === 0}
                      className="min-h-[40px] px-4 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] disabled:opacity-40 cursor-pointer"
                    >
                      Đưa {pastedPreviewCount} học sinh vào bảng kiểm tra
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 3: Excel/CSV Upload */}
              {inputTab === 'excel' && (
                <div className="rounded-2xl border border-dashed border-pink-300 bg-[#FDFBFC] p-6 text-center space-y-4">
                  <FileSpreadsheet className="w-10 h-10 text-[#15803D] mx-auto" />
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-slate-900">
                      Nhập đồng loạt từ file Excel (.xlsx) hoặc CSV
                    </p>
                    <p className="text-xs text-slate-600 max-w-md mx-auto">
                      Sau khi tải lên, toàn bộ danh sách sẽ hiển thị ở Bảng nhập nhanh để bạn kiểm tra lại SĐT và cấp mật khẩu đồng loạt.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => void downloadStudentImportTemplate()}
                      className="min-h-[42px] px-4 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center gap-2 cursor-pointer"
                    >
                      <Download className="w-4 h-4 text-[#15803D]" />
                      <span>Tải file Excel mẫu</span>
                    </button>
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.csv"
                      onChange={(e) => void handleExcelFile(e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => excelInputRef.current?.click()}
                      className="min-h-[42px] px-4 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] inline-flex items-center gap-2 cursor-pointer"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Chọn file Excel / CSV</span>
                    </button>
                  </div>
                </div>
              )}

              {saving && progress.total > 0 && (
                <div className="rounded-xl bg-[#FFF1F5] border border-pink-200 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-[#BE185D]">
                    <span>Đang lưu hồ sơ &amp; cấp tài khoản đăng nhập...</span>
                    <span className="font-mono-num">
                      {progress.current} / {progress.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-pink-100 overflow-hidden">
                    <div
                      className="h-full bg-[#DB2777] transition-all duration-200"
                      style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-pink-100 bg-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          {resultSummary ? (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={handleCloseAndReset}
                className="min-h-[44px] px-6 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] cursor-pointer"
              >
                Hoàn tất
              </button>
            </div>
          ) : (
            <>
              <div className="text-xs text-slate-500">
                Sẵn sàng thêm <strong className="text-slate-900">{validRows.length}</strong> học sinh
                {autoProvision && validRows.length > 0 && (
                  <span>
                    {' '}· dự kiến cấp TK cho{' '}
                    <strong className="text-[#15803D]">
                      {
                        validRows.filter(
                          (r) =>
                            (provisionParents && (normalizePhone(r.motherPhone).length >= 8 || normalizePhone(r.fatherPhone).length >= 8)) ||
                            (provisionStudents && normalizePhone(r.studentPhone).length >= 8)
                        ).length
                      }
                    </strong>{' '}
                    hồ sơ có SĐT
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={handleCloseAndReset}
                  disabled={saving}
                  className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={() => void handleBatchSave()}
                  disabled={saving || validRows.length === 0}
                  className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] disabled:opacity-50 inline-flex items-center gap-2 cursor-pointer"
                >
                  <Users className="w-4 h-4" />
                  <span>
                    {saving
                      ? `Đang lưu (${progress.current}/${progress.total})...`
                      : `Lưu đồng loạt ${validRows.length} học sinh`}
                  </span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
