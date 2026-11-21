import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  CheckSquare,
  Copy,
  Edit3,
  ExternalLink,
  KeyRound,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  FIREBASE_PROJECT_ID,
  formatPhoneReadable,
  generateIssuedPassword,
  normalizePhone,
  toZaloUrl,
} from '../lib/firebase';
import {
  createManualAssessment,
  createStudent,
  deleteStudent,
  deleteStudentsBulk,
  enrollStudentInClass,
  formatDefaultParentName,
  provisionAccountsForStudent,
  removeStudentFromClass,
  syncClassMemberEmails,
  todayISO,
  updateStudent,
} from '../services/firestoreService';
import {
  ATTENDANCE_STATUS_VI,
  ATTITUDE_RATING_VI,
  HOMEWORK_CHECK_VI,
  IssuedCredentialItem,
  STUDENT_STATUS_VI,
  Student,
  StudentStatus,
} from '../types';
import { BulkAddStudentsModal } from './BulkAddStudentsModal';

export const StudentsPage: React.FC = () => {
  const {
    workspaceTeacherId,
    classes,
    students,
    enrollments,
    attendance,
    assessments,
    reviews,
    homework,
    submissions,
  } = useApp();

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('');
  const [detailTab, setDetailTab] = useState<'info' | 'attendance' | 'scores' | 'reviews' | 'homework'>('info');
  const [notice, setNotice] = useState<string | null>(null);

  // Confirm delete student modal (replaces blocked window.confirm)
  const [confirmDeleteStudent, setConfirmDeleteStudent] = useState<Student | null>(null);
  const [deletingStudent, setDeletingStudent] = useState(false);

  // Bulk select & bulk delete students
  const [bulkSelectMode, setBulkSelectMode] = useState(false);
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [deletingBulk, setDeletingBulk] = useState(false);

  // Bulk add modal
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Student form modal
  const [showModal, setShowModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [formCode, setFormCode] = useState('');
  const [formName, setFormName] = useState('');
  const [formDob, setFormDob] = useState('');
  const [formSchoolClass, setFormSchoolClass] = useState('');
  const [formParentName, setFormParentName] = useState('');
  const [formStudentPhone, setFormStudentPhone] = useState('');
  const [formFatherPhone, setFormFatherPhone] = useState('');
  const [formMotherPhone, setFormMotherPhone] = useState('');
  const [formContact, setFormContact] = useState('');
  const [formStartDate, setFormStartDate] = useState(todayISO());
  const [formStatus, setFormStatus] = useState<StudentStatus>('active');
  const [formClassIds, setFormClassIds] = useState<string[]>([]);
  const [formProvisionNow, setFormProvisionNow] = useState(false);
  const [formInitialPassword, setFormInitialPassword] = useState(() => generateIssuedPassword(8));
  const [saving, setSaving] = useState(false);

  // Provision existing student accounts modal
  const [provisionTarget, setProvisionTarget] = useState<Student | null>(null);
  const [provStudent, setProvStudent] = useState(true);
  const [provParents, setProvParents] = useState(false);
  const [provPasswordMode, setProvPasswordMode] = useState<'shared' | 'random'>('shared');
  const [provSharedPassword, setProvSharedPassword] = useState(() => generateIssuedPassword(8));
  const [provisioning, setProvisioning] = useState(false);

  // Post-provisioning credentials sheet modal
  const [issuedCredentials, setIssuedCredentials] = useState<IssuedCredentialItem[]>([]);
  const [issuedProviderDisabled, setIssuedProviderDisabled] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Quick manual score modal
  const [showScoreForm, setShowScoreForm] = useState(false);
  const [scoreTitle, setScoreTitle] = useState('');
  const [scoreClassId, setScoreClassId] = useState('');
  const [scoreValue, setScoreValue] = useState('');
  const [scoreMax, setScoreMax] = useState('10');
  const [scoreDate, setScoreDate] = useState(todayISO());
  const [scoreComment, setScoreComment] = useState('');

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const studentClassesMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const e of enrollments) {
      if (e.status === 'active') {
        const list = map.get(e.studentId) ?? [];
        list.push(e.classId);
        map.set(e.studentId, list);
      }
    }
    return map;
  }, [enrollments]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .filter((st) => {
        if (classFilter !== 'all') {
          const enrolled = studentClassesMap.get(st.id) ?? [];
          if (!enrolled.includes(classFilter)) return false;
        }
        if (!q) return true;
        return (
          st.fullName.toLowerCase().includes(q) ||
          st.studentCode.toLowerCase().includes(q) ||
          st.parentName.toLowerCase().includes(q) ||
          (st.studentPhone ?? '').includes(q) ||
          (st.motherPhone ?? '').includes(q) ||
          (st.fatherPhone ?? '').includes(q)
        );
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [students, search, classFilter, studentClassesMap]);

  const selectedStudent = useMemo(() => {
    return students.find((s) => s.id === selectedStudentId) ?? filteredStudents[0] ?? null;
  }, [students, selectedStudentId, filteredStudents]);

  const openCreateModal = () => {
    setEditingStudent(null);
    setFormCode(`HS-2026-${String(students.length + 1).padStart(3, '0')}`);
    setFormName('');
    setFormDob('');
    setFormSchoolClass('');
    setFormParentName('');
    setFormStudentPhone('');
    setFormFatherPhone('');
    setFormMotherPhone('');
    setFormContact('');
    setFormStartDate(todayISO());
    setFormStatus('active');
    setFormClassIds(classes[0] ? [classes[0].id] : []);
    setFormProvisionNow(false);
    setFormInitialPassword(generateIssuedPassword(8));
    setShowModal(true);
  };

  const openEditModal = (st: Student) => {
    setEditingStudent(st);
    setFormCode(st.studentCode);
    setFormName(st.fullName);
    setFormDob(st.dateOfBirth ?? '');
    setFormSchoolClass(st.schoolClass ?? '');
    setFormParentName(st.parentName);
    setFormStudentPhone(st.studentPhone ?? '');
    setFormFatherPhone(st.fatherPhone ?? '');
    setFormMotherPhone(st.motherPhone ?? '');
    setFormContact(st.contactInfo ?? '');
    setFormStartDate(st.startDate);
    setFormStatus(st.status);
    setFormClassIds(studentClassesMap.get(st.id) ?? []);
    setShowModal(true);
  };

  const toggleClassSelection = (classId: string) => {
    setFormClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId]
    );
  };

  const handleSaveStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !formName.trim()) return;
    if (!editingStudent && formProvisionNow && formInitialPassword.trim().length < 6) {
      setNotice('Mật khẩu cấp ban đầu cần tối thiểu 6 ký tự.');
      return;
    }

    setSaving(true);
    try {
      let savedStudent: Student;
      const resolvedParentName =
        formParentName.trim() || formatDefaultParentName(formName);

      if (editingStudent) {
        await updateStudent(editingStudent.id, {
          studentCode: formCode,
          fullName: formName,
          dateOfBirth: formDob,
          schoolClass: formSchoolClass,
          parentName: resolvedParentName,
          studentPhone: formStudentPhone,
          fatherPhone: formFatherPhone,
          motherPhone: formMotherPhone,
          contactInfo: formContact,
          startDate: formStartDate,
          status: formStatus,
        });
        savedStudent = {
          ...editingStudent,
          studentCode: formCode,
          fullName: formName,
          parentName: resolvedParentName,
          studentPhone: formStudentPhone,
          fatherPhone: formFatherPhone,
          motherPhone: formMotherPhone,
        };
        const previousClassIds = studentClassesMap.get(editingStudent.id) ?? [];
        for (const cId of formClassIds) {
          await enrollStudentInClass(workspaceTeacherId, cId, savedStudent);
        }
        for (const oldId of previousClassIds) {
          if (!formClassIds.includes(oldId)) {
            await removeStudentFromClass(oldId, editingStudent.id);
          }
        }
        const mergedStudents = students.map((s) => (s.id === savedStudent.id ? savedStudent : s));
        const nextEnrollments = [
          ...enrollments.filter((e) => !(e.studentId === savedStudent.id && !formClassIds.includes(e.classId))),
          ...formClassIds
            .filter((cId) => !previousClassIds.includes(cId))
            .map((cId) => ({
              id: `${cId}_${savedStudent.id}`,
              teacherId: workspaceTeacherId,
              classId: cId,
              studentId: savedStudent.id,
              studentEmail: savedStudent.studentEmail,
              studentUid: savedStudent.studentUid,
              parentEmails: savedStudent.parentEmails,
              parentUids: savedStudent.parentUids,
              status: 'active' as const,
              enrolledAt: todayISO(),
            })),
        ];
        for (const cId of Array.from(new Set([...previousClassIds, ...formClassIds]))) {
          await syncClassMemberEmails(workspaceTeacherId, cId, mergedStudents, nextEnrollments);
        }
        setNotice(`Đã cập nhật hồ sơ học sinh ${formName}.`);
      } else {
        savedStudent = await createStudent(workspaceTeacherId, {
          studentCode: formCode,
          fullName: formName,
          dateOfBirth: formDob,
          schoolClass: formSchoolClass,
          parentName: resolvedParentName,
          studentPhone: formStudentPhone,
          fatherPhone: formFatherPhone,
          motherPhone: formMotherPhone,
          contactInfo: formContact,
          startDate: formStartDate,
          status: formStatus,
        });

        const hasStudentPhone = normalizePhone(formStudentPhone).length >= 8;

        if (formProvisionNow && hasStudentPhone) {
          const provRes = await provisionAccountsForStudent(workspaceTeacherId, savedStudent, {
            provisionStudent: true,
            provisionParents: false,
            passwordMode: 'shared',
            sharedPassword: formInitialPassword.trim(),
          });
          savedStudent = provRes.updatedStudent;
          if (provRes.credentials.length > 0) {
            setIssuedCredentials(provRes.credentials);
            setIssuedProviderDisabled(provRes.providerDisabled);
          }
        }

        const nextEnrollments = [...enrollments];
        for (const cId of formClassIds) {
          await enrollStudentInClass(workspaceTeacherId, cId, savedStudent);
          nextEnrollments.push({
            id: `${cId}_${savedStudent.id}`,
            teacherId: workspaceTeacherId,
            classId: cId,
            studentId: savedStudent.id,
            studentEmail: savedStudent.studentEmail,
            studentUid: savedStudent.studentUid,
            parentEmails: savedStudent.parentEmails,
            parentUids: savedStudent.parentUids,
            status: 'active',
            enrolledAt: todayISO(),
          });
        }
        for (const cId of formClassIds) {
          await syncClassMemberEmails(workspaceTeacherId, cId, [...students, savedStudent], nextEnrollments);
        }
        setSelectedStudentId(savedStudent.id);
        setNotice(`Đã thêm học sinh ${formName} thành công.`);
      }
      setShowModal(false);
    } finally {
      setSaving(false);
    }
  };

  const handleProvisionExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !provisionTarget) return;
    if (provPasswordMode === 'shared' && provSharedPassword.trim().length < 6) {
      setNotice('Mật khẩu cấp ban đầu cần tối thiểu 6 ký tự.');
      return;
    }
    setProvisioning(true);
    try {
      const res = await provisionAccountsForStudent(workspaceTeacherId, provisionTarget, {
        provisionStudent: provStudent,
        provisionParents: provParents,
        passwordMode: provPasswordMode,
        sharedPassword: provSharedPassword.trim(),
      });
      const enrolledClassIds = studentClassesMap.get(provisionTarget.id) ?? [];
      const updatedStudents = students.map((s) => (s.id === res.updatedStudent.id ? res.updatedStudent : s));
      for (const cId of enrolledClassIds) {
        await syncClassMemberEmails(workspaceTeacherId, cId, updatedStudents, enrollments);
      }
      setProvisionTarget(null);
      if (res.credentials.length > 0) {
        setIssuedCredentials(res.credentials);
        setIssuedProviderDisabled(res.providerDisabled);
      } else {
        setNotice('Học sinh và phụ huynh này đã có tài khoản hoặc chưa nhập số điện thoại hợp lệ.');
      }
    } finally {
      setProvisioning(false);
    }
  };

  const copyCredentialText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // ignore
    }
  };

  const handleConfirmDeleteStudent = async () => {
    if (!confirmDeleteStudent || !workspaceTeacherId) return;
    setDeletingStudent(true);
    try {
      const name = confirmDeleteStudent.fullName;
      await deleteStudent(confirmDeleteStudent.id, workspaceTeacherId);
      if (selectedStudentId === confirmDeleteStudent.id) {
        setSelectedStudentId('');
      }
      setSelectedBulkIds((prev) => prev.filter((id) => id !== confirmDeleteStudent.id));
      setConfirmDeleteStudent(null);
      setNotice(`Đã xóa hồ sơ học sinh ${name}.`);
    } catch (err) {
      setNotice(err instanceof Error ? `Không thể xóa học sinh: ${err.message}` : 'Không thể xóa học sinh.');
    } finally {
      setDeletingStudent(false);
    }
  };

  const toggleBulkStudentId = (studentId: string) => {
    setSelectedBulkIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const filteredIds = useMemo(() => filteredStudents.map((s) => s.id), [filteredStudents]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedBulkIds.includes(id));

  const toggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredIds);
      setSelectedBulkIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      setSelectedBulkIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
    }
  };

  const selectedBulkStudents = useMemo(() => {
    const idSet = new Set(selectedBulkIds);
    return students.filter((s) => idSet.has(s.id));
  }, [students, selectedBulkIds]);

  const handleConfirmBulkDelete = async () => {
    if (!workspaceTeacherId || selectedBulkIds.length === 0) return;
    setDeletingBulk(true);
    try {
      const idsToDelete = [...selectedBulkIds];
      const idSet = new Set(idsToDelete);
      const { deletedCount, affectedClassIds } = await deleteStudentsBulk(
        workspaceTeacherId,
        idsToDelete
      );

      const remainingStudents = students.filter((s) => !idSet.has(s.id));
      const remainingEnrollments = enrollments.filter((e) => !idSet.has(e.studentId));
      for (const cId of affectedClassIds) {
        await syncClassMemberEmails(workspaceTeacherId, cId, remainingStudents, remainingEnrollments);
      }

      if (idSet.has(selectedStudentId)) {
        setSelectedStudentId('');
      }
      setSelectedBulkIds([]);
      setBulkSelectMode(false);
      setConfirmBulkDelete(false);
      setNotice(`Đã xóa thành công ${deletedCount} học sinh khỏi hệ thống.`);
    } catch (err) {
      setNotice(
        err instanceof Error
          ? `Không thể xóa nhiều học sinh: ${err.message}`
          : 'Không thể xóa nhiều học sinh.'
      );
    } finally {
      setDeletingBulk(false);
    }
  };

  const handleAddScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !selectedStudent || !scoreTitle.trim() || !scoreClassId) return;
    await createManualAssessment(workspaceTeacherId, scoreClassId, selectedStudent, {
      title: scoreTitle,
      score: Number(scoreValue),
      maxScore: Number(scoreMax) || 10,
      assessedDate: scoreDate,
      comment: scoreComment,
    });
    setShowScoreForm(false);
    setScoreTitle('');
    setScoreValue('');
    setScoreComment('');
    setNotice(`Đã lưu điểm kiểm tra cho ${selectedStudent.fullName}.`);
  };

  // Student history datasets
  const stAttendance = useMemo(
    () =>
      selectedStudent
        ? attendance
            .filter((a) => a.studentId === selectedStudent.id)
            .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
        : [],
    [attendance, selectedStudent]
  );

  const stAssessments = useMemo(
    () =>
      selectedStudent
        ? assessments
            .filter((a) => a.studentId === selectedStudent.id)
            .sort((a, b) => b.assessedDate.localeCompare(a.assessedDate))
        : [],
    [assessments, selectedStudent]
  );

  const stReviews = useMemo(
    () =>
      selectedStudent
        ? reviews
            .filter((r) => r.studentId === selectedStudent.id)
            .sort((a, b) => b.sessionDate.localeCompare(a.sessionDate))
        : [],
    [reviews, selectedStudent]
  );

  const stHomework = useMemo(() => {
    if (!selectedStudent) return [];
    const enrolledIds = new Set(studentClassesMap.get(selectedStudent.id) ?? []);
    return homework
      .filter(
        (hw) =>
          (hw.scope === 'class' && enrolledIds.has(hw.classId)) ||
          (hw.scope === 'individual' &&
            (hw.assignedStudentId === selectedStudent.id ||
              (hw.assignedStudentIds?.includes(selectedStudent.id) ?? false)))
      )
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  }, [homework, selectedStudent, studentClassesMap]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Hồ sơ học sinh</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý thông tin liên hệ, phân lớp đa môn, lịch sử điểm danh và kiểm tra
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {students.length > 0 && (
            <button
              onClick={() => {
                setBulkSelectMode((prev) => {
                  if (prev) setSelectedBulkIds([]);
                  return !prev;
                });
              }}
              className={`min-h-[44px] px-4 rounded-xl border text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
                bulkSelectMode
                  ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
                  : 'bg-white border-pink-200 text-slate-700 hover:bg-pink-50'
              }`}
            >
              <CheckSquare className="w-4 h-4" />
              <span>{bulkSelectMode ? 'Hủy chọn' : 'Xóa nhiều'}</span>
            </button>
          )}
          <button
            onClick={() => setShowBulkModal(true)}
            className="min-h-[44px] px-4 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-sm font-semibold hover:bg-emerald-100 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Users className="w-4 h-4" />
            <span>Thêm nhiều học sinh</span>
          </button>
          <button
            onClick={openCreateModal}
            className="min-h-[44px] px-4 rounded-xl bg-[#DB2777] text-white text-sm font-medium hover:bg-[#BE185D] transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Thêm học sinh</span>
          </button>
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

      {/* Search & Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên học sinh, mã HS, phụ huynh hoặc số điện thoại..."
            className="w-full min-h-[44px] pl-10 pr-4 rounded-xl border border-pink-200 bg-white text-sm"
          />
        </div>
        <select
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
          className="min-h-[44px] rounded-xl border border-pink-200 bg-white px-3.5 text-sm sm:w-64"
        >
          <option value="all">Tất cả các lớp ({students.length})</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {bulkSelectMode && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/80 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={toggleSelectAllFiltered}
              className="min-h-[38px] px-3 rounded-xl bg-white border border-rose-200 text-xs font-semibold text-slate-800 hover:bg-rose-50 inline-flex items-center gap-1.5 cursor-pointer"
            >
              {allFilteredSelected ? (
                <CheckSquare className="w-4 h-4 text-rose-600" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>
                {allFilteredSelected
                  ? 'Bỏ chọn tất cả'
                  : `Chọn tất cả (${filteredStudents.length})`}
              </span>
            </button>
            <span className="text-sm font-semibold text-rose-900">
              Đã chọn <span className="font-mono-num">{selectedBulkIds.length}</span> học sinh
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSelectedBulkIds([]);
                setBulkSelectMode(false);
              }}
              className="min-h-[38px] px-3.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="button"
              disabled={selectedBulkIds.length === 0}
              onClick={() => setConfirmBulkDelete(true)}
              className="min-h-[38px] px-4 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-40 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Xóa {selectedBulkIds.length} học sinh</span>
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Student List */}
        <section className="lg:col-span-4 space-y-2">
          {filteredStudents.length === 0 ? (
            <div className="rounded-2xl bg-white border border-pink-100 p-6 text-center text-sm text-slate-500">
              Không tìm thấy học sinh phù hợp.
            </div>
          ) : (
            filteredStudents.map((st) => {
              const isSelected = selectedStudent?.id === st.id;
              const isBulkChecked = selectedBulkIds.includes(st.id);
              const enrolledIds = studentClassesMap.get(st.id) ?? [];
              return (
                <button
                  key={st.id}
                  onClick={() => {
                    if (bulkSelectMode) {
                      toggleBulkStudentId(st.id);
                    } else {
                      setSelectedStudentId(st.id);
                    }
                  }}
                  className={`w-full text-left rounded-2xl p-4 border transition-colors cursor-pointer flex items-start gap-3 ${
                    bulkSelectMode && isBulkChecked
                      ? 'bg-rose-50/70 border-rose-400'
                      : !bulkSelectMode && isSelected
                      ? 'bg-[#FFF1F5] border-[#DB2777]'
                      : 'bg-white border-pink-100 hover:border-pink-200'
                  }`}
                >
                  {bulkSelectMode && (
                    <span className="mt-0.5 shrink-0">
                      {isBulkChecked ? (
                        <CheckSquare className="w-4 h-4 text-rose-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900 truncate">{st.fullName}</p>
                      <span className="text-xs font-mono-num text-slate-500 shrink-0">{st.studentCode}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 truncate">
                      {enrolledIds.length} lớp học thêm · {STUDENT_STATUS_VI[st.status]}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </section>

        {/* Student Profile & History */}
        <section className="lg:col-span-8">
          {!selectedStudent ? (
            <div className="rounded-2xl bg-white border border-pink-100 p-10 text-center text-sm text-slate-500">
              Chọn học sinh bên trái để xem hồ sơ chi tiết và lịch sử học tập.
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-pink-100 overflow-hidden">
              <div className="p-5 border-b border-pink-100 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-mono-num text-[#BE185D] font-semibold">
                    {selectedStudent.studentCode} · {STUDENT_STATUS_VI[selectedStudent.status]}
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-slate-900">{selectedStudent.fullName}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Lớp chính khóa: {selectedStudent.schoolClass || 'Chưa cập nhật'} · Bắt đầu học:{' '}
                    {selectedStudent.startDate}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    onClick={() => {
                      setProvisionTarget(selectedStudent);
                      setProvStudent(normalizePhone(selectedStudent.studentPhone).length >= 8 && !selectedStudent.studentUid);
                      setProvParents(false);
                      setProvPasswordMode('shared');
                      setProvSharedPassword(generateIssuedPassword(8));
                    }}
                    className="min-h-[40px] px-3.5 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-xs font-semibold text-[#15803D] hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Cấp TK Học sinh</span>
                  </button>
                  <button
                    onClick={() => openEditModal(selectedStudent)}
                    className="min-h-[40px] px-3.5 rounded-xl border border-pink-200 text-xs font-semibold text-slate-800 hover:bg-pink-50 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-[#DB2777]" />
                    <span>Sửa hồ sơ</span>
                  </button>
                  <button
                    onClick={() => setConfirmDeleteStudent(selectedStudent)}
                    className="min-h-[40px] min-w-[40px] rounded-xl border border-rose-200 text-rose-700 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer"
                    aria-label="Xóa học sinh"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Detail Tabs */}
              <div className="flex overflow-x-auto gap-1 px-4 pt-3 border-b border-pink-100 bg-[#FDFBFC]">
                {[
                  { id: 'info', label: 'Thông tin chung' },
                  { id: 'attendance', label: `Điểm danh (${stAttendance.length})` },
                  { id: 'scores', label: `Kiểm tra (${stAssessments.length})` },
                  { id: 'reviews', label: `Nhận xét (${stReviews.length})` },
                  { id: 'homework', label: `Bài tập (${stHomework.length})` },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setDetailTab(tab.id as typeof detailTab)}
                    className={`min-h-[40px] px-3.5 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      detailTab === tab.id
                        ? 'border-[#DB2777] text-[#BE185D]'
                        : 'border-transparent text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {detailTab === 'info' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
                    <div className="space-y-3">
                      <h3 className="text-xs font-semibold text-slate-500">Thông tin học sinh</h3>
                      <div className="space-y-2 text-slate-700">
                        <p className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>Ngày sinh: {selectedStudent.dateOfBirth || 'Chưa cập nhật'}</span>
                        </p>
                        <p className="flex items-center gap-2 font-mono-num">
                          <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>
                            SĐT học sinh:{' '}
                            {selectedStudent.studentPhone
                              ? formatPhoneReadable(selectedStudent.studentPhone)
                              : 'Chưa có'}
                          </span>
                        </p>
                        <p className="flex items-center gap-2 text-xs">
                          <KeyRound className="w-4 h-4 text-slate-400 shrink-0" />
                          <span
                            className={
                              selectedStudent.studentUid
                                ? 'font-semibold text-[#15803D]'
                                : 'text-slate-500'
                            }
                          >
                            {selectedStudent.studentUid
                              ? 'Đã cấp tài khoản đăng nhập Học sinh'
                              : 'Chưa cấp tài khoản đăng nhập Học sinh'}
                          </span>
                        </p>
                        <div className="pt-1">
                          <p className="text-xs font-semibold text-slate-500 mb-1.5">Lớp học thêm đang theo học</p>
                          {(studentClassesMap.get(selectedStudent.id) ?? []).length === 0 ? (
                            <p className="text-xs text-slate-500">Chưa đăng ký lớp nào.</p>
                          ) : (
                            <ul className="space-y-1">
                              {(studentClassesMap.get(selectedStudent.id) ?? []).map((cId) => (
                                <li key={cId} className="flex items-center gap-2 text-xs text-slate-800">
                                  <BookOpen className="w-3.5 h-3.5 text-[#15803D]" />
                                  <span>{classMap.get(cId)?.name ?? cId}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-xs font-semibold text-slate-500">Phụ huynh &amp; Liên hệ Zalo</h3>
                      <div className="space-y-2.5 text-slate-700">
                        <p className="flex items-center gap-2">
                          <User className="w-4 h-4 text-slate-400 shrink-0" />
                          <span>
                            {/^phụ huynh/i.test(selectedStudent.parentName)
                              ? selectedStudent.parentName
                              : `Phụ huynh: ${selectedStudent.parentName}`}
                          </span>
                        </p>
                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono-num">
                          <span className="inline-flex items-center gap-2">
                            <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>
                              SĐT Zalo mẹ:{' '}
                              {selectedStudent.motherPhone
                                ? formatPhoneReadable(selectedStudent.motherPhone)
                                : 'Chưa có'}
                            </span>
                          </span>
                          {toZaloUrl(selectedStudent.motherPhone) && (
                            <a
                              href={toZaloUrl(selectedStudent.motherPhone) ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-[32px] px-2.5 rounded-lg bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-sans font-semibold hover:bg-emerald-100 inline-flex items-center gap-1"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>Nhắn Zalo</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono-num">
                          <span className="inline-flex items-center gap-2">
                            <Phone className="w-4 h-4 text-slate-400 shrink-0" />
                            <span>
                              SĐT Zalo bố:{' '}
                              {selectedStudent.fatherPhone
                                ? formatPhoneReadable(selectedStudent.fatherPhone)
                                : 'Chưa có'}
                            </span>
                          </span>
                          {toZaloUrl(selectedStudent.fatherPhone) && (
                            <a
                              href={toZaloUrl(selectedStudent.fatherPhone) ?? '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-[32px] px-2.5 rounded-lg bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-sans font-semibold hover:bg-emerald-100 inline-flex items-center gap-1"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>Nhắn Zalo</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                        <p className="text-xs text-[#15803D] bg-[#ECFDF5]/60 border border-emerald-100 rounded-xl px-3 py-2">
                          Phụ huynh nhận báo cáo BTVN, nhận xét buổi học và thông báo trực tiếp qua Zalo — không cần tải app.
                        </p>
                        {selectedStudent.contactInfo && (
                          <p className="text-xs text-slate-600 bg-[#FDFBFC] border border-pink-100 rounded-xl p-3">
                            {selectedStudent.contactInfo}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {detailTab === 'attendance' && (
                  <div className="divide-y divide-pink-50">
                    {stAttendance.length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-500">Chưa có lịch sử điểm danh.</p>
                    ) : (
                      stAttendance.map((a) => (
                        <div key={a.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                          <div>
                            <p className="font-medium text-slate-900">
                              {classMap.get(a.classId)?.name || 'Lớp học'}
                            </p>
                            <p className="text-xs text-slate-500 font-mono-num">
                              {a.sessionDate} · {a.sessionType === 'makeup' ? 'Buổi học bù' : 'Buổi chính khóa'}
                              {a.reason ? ` · ${a.reason}` : ''}
                            </p>
                          </div>
                          <span
                            className={`text-xs font-semibold whitespace-nowrap ${
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
                      ))
                    )}
                  </div>
                )}

                {detailTab === 'scores' && (
                  <div className="space-y-4">
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          setScoreClassId((studentClassesMap.get(selectedStudent.id) ?? [])[0] ?? classes[0]?.id ?? '');
                          setShowScoreForm(true);
                        }}
                        className="min-h-[38px] px-3.5 rounded-xl bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Award className="w-3.5 h-3.5" />
                        <span>Nhập điểm kiểm tra</span>
                      </button>
                    </div>
                    {stAssessments.length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-500">Chưa có điểm kiểm tra nào.</p>
                    ) : (
                      <div className="divide-y divide-pink-50">
                        {stAssessments.map((as) => (
                          <div key={as.id} className="py-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{as.title}</p>
                              <p className="text-xs text-slate-500">
                                {classMap.get(as.classId)?.name} · {as.assessedDate}
                                {as.comment ? ` · ${as.comment}` : ''}
                              </p>
                            </div>
                            <span className="text-base font-bold font-mono-num text-[#15803D] shrink-0">
                              {as.score}/{as.maxScore}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'reviews' && (
                  <div className="divide-y divide-pink-50">
                    {stReviews.length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-500">Chưa có nhận xét buổi học nào.</p>
                    ) : (
                      stReviews.map((r) => (
                        <div key={r.id} className="py-3.5 space-y-1 text-sm">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-semibold text-slate-900">
                              {classMap.get(r.classId)?.name} · <span className="font-mono-num">{r.sessionDate}</span>
                            </p>
                            <span className="text-xs text-slate-600">
                              BTVN: <strong className="text-slate-800">{HOMEWORK_CHECK_VI[r.homeworkStatus]}</strong>
                            </span>
                          </div>
                          {r.homeworkNote && (
                            <p className="text-xs text-[#BE185D] bg-pink-50/70 rounded-lg px-2.5 py-1">
                              Chi tiết BTVN: {r.homeworkNote}
                            </p>
                          )}
                          <p className="text-xs text-slate-600">
                            Ý thức: {ATTITUDE_RATING_VI[r.attitudeRating]}
                            {r.attitudeComment ? ` — ${r.attitudeComment}` : ''}
                          </p>
                          {r.weakTopics && (
                            <p className="text-xs text-amber-800">Kiến thức cần củng cố: {r.weakTopics}</p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}

                {detailTab === 'homework' && (
                  <div className="divide-y divide-pink-50">
                    {stHomework.length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-500">Chưa có bài tập được giao.</p>
                    ) : (
                      stHomework.map((hw) => {
                        const sub = submissions.find(
                          (s) => s.homeworkId === hw.id && s.studentId === selectedStudent.id
                        );
                        return (
                          <div key={hw.id} className="py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900 truncate">{hw.title}</p>
                              <p className="text-xs text-slate-500 font-mono-num">
                                Hạn nộp: {hw.dueDate} ·{' '}
                                {hw.scope === 'individual'
                                  ? (hw.assignedStudentIds?.length ?? 0) > 1
                                    ? `Bài nhóm (${hw.assignedStudentIds?.length} HS)`
                                    : 'Bài riêng'
                                  : 'Bài cả lớp'}
                              </p>
                            </div>
                            <span
                              className={`text-xs font-semibold whitespace-nowrap ${
                                sub?.status === 'reviewed'
                                  ? 'text-[#15803D]'
                                  : sub?.status === 'submitted'
                                  ? 'text-[#BE185D]'
                                  : 'text-slate-500'
                              }`}
                            >
                              {sub?.status === 'reviewed'
                                ? `Đã chấm${sub.score !== undefined ? ` (${sub.score}đ)` : ''}`
                                : sub?.status === 'submitted'
                                ? 'Đã nộp'
                                : 'Chưa nộp'}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Create / Edit Student Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
          <form
            onSubmit={(e) => void handleSaveStudent(e)}
            className="w-full sm:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-pink-100"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {editingStudent ? 'Cập nhật hồ sơ học sinh' : 'Thêm học sinh mới'}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mã học sinh nội bộ *</label>
                <input
                  type="text"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Họ và tên *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Ngày sinh</label>
                <input
                  type="date"
                  value={formDob}
                  onChange={(e) => setFormDob(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Lớp chính khóa</label>
                <input
                  type="text"
                  value={formSchoolClass}
                  onChange={(e) => setFormSchoolClass(e.target.value)}
                  placeholder="VD: 9A1 - THCS..."
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Tên phụ huynh (tự động: Phụ huynh + tên con)
                </label>
                <input
                  type="text"
                  value={formParentName}
                  onChange={(e) => setFormParentName(e.target.value)}
                  placeholder={
                    formName.trim() ? `Phụ huynh ${formName.trim()}` : 'Phụ huynh + tên học sinh'
                  }
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Trạng thái học tập</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as StudentStatus)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3.5 text-sm"
                >
                  <option value="active">Đang học</option>
                  <option value="paused">Tạm nghỉ</option>
                  <option value="completed">Đã hoàn thành</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SĐT Zalo mẹ
                </label>
                <input
                  type="tel"
                  value={formMotherPhone}
                  onChange={(e) => setFormMotherPhone(e.target.value)}
                  placeholder="VD: 0912345678"
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SĐT Zalo bố
                </label>
                <input
                  type="tel"
                  value={formFatherPhone}
                  onChange={(e) => setFormFatherPhone(e.target.value)}
                  placeholder="VD: 0987654321"
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  SĐT học sinh (tùy chọn)
                </label>
                <input
                  type="tel"
                  value={formStudentPhone}
                  onChange={(e) => setFormStudentPhone(e.target.value)}
                  placeholder="Tùy chọn, VD: 0901234567"
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Ngày bắt đầu học</label>
                <input
                  type="date"
                  value={formStartDate}
                  onChange={(e) => setFormStartDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                  required
                />
              </div>
            </div>

            {!editingStudent && (
              <div className="rounded-xl border border-emerald-200 bg-[#ECFDF5]/70 p-3.5 space-y-2">
                <label className="flex items-center gap-2.5 text-xs font-semibold text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formProvisionNow}
                    onChange={(e) => setFormProvisionNow(e.target.checked)}
                    className="accent-[#15803D]"
                  />
                  <span>Cấp tài khoản đăng nhập cho Học sinh (tùy chọn — Phụ huynh chỉ cần gửi qua Zalo)</span>
                </label>
                {formProvisionNow && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={formInitialPassword}
                      onChange={(e) => setFormInitialPassword(e.target.value)}
                      minLength={6}
                      placeholder="Mật khẩu cấp ban đầu (tối thiểu 6 ký tự)"
                      className="flex-1 min-h-[40px] rounded-xl border border-emerald-200 bg-white px-3 text-sm font-mono-num"
                    />
                    <button
                      type="button"
                      onClick={() => setFormInitialPassword(generateIssuedPassword(8))}
                      className="min-h-[40px] px-3 rounded-xl border border-emerald-200 bg-white text-xs font-semibold text-[#15803D] hover:bg-emerald-50 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Tạo ngẫu nhiên</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Thông tin liên hệ thêm</label>
              <input
                type="text"
                value={formContact}
                onChange={(e) => setFormContact(e.target.value)}
                placeholder="VD: Gửi nhận xét qua Zalo mẹ sau 19h"
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
              />
            </div>

            {/* Multi-class enrollment selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Lớp học thêm tham gia (hỗ trợ chọn nhiều lớp)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {classes
                  .filter((c) => c.status === 'active')
                  .map((c) => {
                    const checked = formClassIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs cursor-pointer ${
                          checked ? 'bg-pink-50 border-[#DB2777] text-slate-900 font-semibold' : 'border-pink-100 text-slate-700'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleClassSelection(c.id)}
                          className="accent-[#DB2777]"
                        />
                        <span className="truncate">{c.name}</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D]"
              >
                {saving ? 'Đang lưu...' : 'Lưu hồ sơ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quick Manual Score Modal */}
      {showScoreForm && selectedStudent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={(e) => void handleAddScore(e)}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-pink-100"
          >
            <h3 className="text-lg font-bold text-slate-900">Nhập điểm kiểm tra – {selectedStudent.fullName}</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Lớp học</label>
              <select
                value={scoreClassId}
                onChange={(e) => setScoreClassId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                required
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tên bài kiểm tra *</label>
              <input
                type="text"
                value={scoreTitle}
                onChange={(e) => setScoreTitle(e.target.value)}
                placeholder="VD: Kiểm tra 15 phút đại số"
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Điểm *</label>
                <input
                  type="number"
                  step="0.25"
                  min={0}
                  value={scoreValue}
                  onChange={(e) => setScoreValue(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Thang điểm</label>
                <input
                  type="number"
                  min={1}
                  value={scoreMax}
                  onChange={(e) => setScoreMax(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Ngày</label>
                <input
                  type="date"
                  value={scoreDate}
                  onChange={(e) => setScoreDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-2 text-xs font-mono-num"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nhận xét ngắn</label>
              <input
                type="text"
                value={scoreComment}
                onChange={(e) => setScoreComment(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowScoreForm(false)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold"
              >
                Lưu điểm
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Provision Accounts Modal for Existing Student */}
      {provisionTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={(e) => void handleProvisionExisting(e)}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-pink-100"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[#15803D]" />
                <h3 className="text-base font-bold text-slate-900">
                  Cấp tài khoản – {provisionTarget.fullName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setProvisionTarget(null)}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 bg-[#ECFDF5]/70 border border-emerald-200 rounded-xl px-3 py-2.5 leading-relaxed">
              Phụ huynh <strong>không cần tải app</strong> — bạn có thể gửi thông báo và nhận xét trực tiếp qua Zalo. Chỉ cần cấp tài khoản nếu muốn Học sinh đăng nhập nộp bài trực tuyến.
            </p>

            <div className="space-y-2 text-xs text-slate-700">
              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-pink-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={provStudent}
                  onChange={(e) => setProvStudent(e.target.checked)}
                  className="accent-[#15803D]"
                />
                <span>
                  Cấp TK Học sinh ({provisionTarget.studentPhone || 'Chưa có SĐT học sinh'})
                </span>
              </label>
              <label className="flex items-center gap-2.5 p-3 rounded-xl border border-slate-100 text-slate-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={provParents}
                  onChange={(e) => setProvParents(e.target.checked)}
                  className="accent-[#15803D]"
                />
                <span>
                  Tùy chọn: Cấp TK Phụ huynh ({provisionTarget.motherPhone || provisionTarget.fatherPhone || 'Chưa có SĐT'})
                </span>
              </label>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">Chế độ mật khẩu cấp ban đầu</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setProvPasswordMode('shared')}
                  className={`flex-1 min-h-[38px] rounded-xl text-xs font-semibold border cursor-pointer ${
                    provPasswordMode === 'shared'
                      ? 'bg-[#FFF1F5] border-[#DB2777] text-[#BE185D]'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  Mật khẩu tùy chọn
                </button>
                <button
                  type="button"
                  onClick={() => setProvPasswordMode('random')}
                  className={`flex-1 min-h-[38px] rounded-xl text-xs font-semibold border cursor-pointer ${
                    provPasswordMode === 'random'
                      ? 'bg-[#FFF1F5] border-[#DB2777] text-[#BE185D]'
                      : 'border-slate-200 text-slate-600'
                  }`}
                >
                  Ngẫu nhiên từng TK
                </button>
              </div>
              {provPasswordMode === 'shared' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={provSharedPassword}
                    onChange={(e) => setProvSharedPassword(e.target.value)}
                    minLength={6}
                    className="flex-1 min-h-[42px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setProvSharedPassword(generateIssuedPassword(8))}
                    className="min-h-[42px] px-3 rounded-xl border border-pink-200 text-xs font-semibold text-[#BE185D] hover:bg-pink-50 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setProvisionTarget(null)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={provisioning || (!provParents && !provStudent)}
                className="min-h-[44px] px-5 rounded-xl bg-[#15803D] text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-40"
              >
                {provisioning ? 'Đang cấp TK...' : 'Cấp tài khoản'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Issued Credentials Modal */}
      {issuedCredentials.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-emerald-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[#15803D]" />
                <h3 className="text-base font-bold text-slate-900">Phiếu cấp tài khoản đăng nhập</h3>
              </div>
              <button
                onClick={() => {
                  setIssuedCredentials([]);
                  setIssuedProviderDisabled(false);
                }}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {issuedProviderDisabled && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <p>
                    Cần bật phương thức <strong>Email/Password</strong> trong Firebase Console để cấp tài khoản bằng Số điện thoại + Mật khẩu.
                  </p>
                </div>
                <a
                  href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-semibold text-amber-900 underline"
                >
                  <span>Mở Firebase Authentication</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            <p className="text-xs text-slate-600">
              Hệ thống không lưu mật khẩu thô trên cơ sở dữ liệu. Hãy sao chép thông tin bên dưới để gửi cho Phụ huynh/Học sinh ngay:
            </p>

            <div className="space-y-2.5 max-h-72 overflow-y-auto">
              {issuedCredentials.map((cred, idx) => {
                const key = `${cred.role}_${cred.phone}_${idx}`;
                const shareText = `Sổ Dạy Học Thông Minh – Smart Teaching\nTài khoản ${
                  cred.role === 'PARENT' ? 'Phụ huynh' : 'Học sinh'
                } (${cred.studentName}):\n- SĐT đăng nhập: ${cred.phone}\n- Mật khẩu: ${cred.password}`;
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-pink-100 bg-[#FDFBFC] p-3.5 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 text-xs space-y-0.5">
                      <p className="font-semibold text-slate-900">
                        {cred.role === 'PARENT' ? 'Phụ huynh' : 'Học sinh'} · {cred.ownerLabel}
                      </p>
                      <p className="font-mono-num text-slate-700">
                        SĐT: <strong>{formatPhoneReadable(cred.phone)}</strong> · MK:{' '}
                        <strong className="text-[#BE185D]">{cred.password || '—'}</strong>
                      </p>
                      {cred.note && <p className="text-[11px] text-slate-500">{cred.note}</p>}
                    </div>
                    {cred.status === 'created' && (
                      <button
                        onClick={() => void copyCredentialText(key, shareText)}
                        className="min-h-[36px] px-3 rounded-lg bg-white border border-pink-200 text-xs font-semibold text-[#BE185D] hover:bg-pink-50 inline-flex items-center gap-1 shrink-0 cursor-pointer"
                      >
                        {copiedKey === key ? <Check className="w-3.5 h-3.5 text-[#15803D]" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === key ? 'Đã chép' : 'Sao chép'}</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => {
                  setIssuedCredentials([]);
                  setIssuedProviderDisabled(false);
                }}
                className="min-h-[42px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] cursor-pointer"
              >
                Đã lưu thông tin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Student Modal */}
      {confirmDeleteStudent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-rose-100 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Xác nhận xóa học sinh</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Bạn có chắc muốn xóa hồ sơ học sinh <strong>{confirmDeleteStudent.fullName}</strong> (
                  {confirmDeleteStudent.studentCode}) không?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteStudent(null)}
                disabled={deletingStudent}
                className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteStudent(null)}
                disabled={deletingStudent}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteStudent()}
                disabled={deletingStudent}
                className="min-h-[42px] px-5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deletingStudent ? 'Đang xóa...' : 'Xóa học sinh'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Bulk Delete Students Modal */}
      {confirmBulkDelete && selectedBulkStudents.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-rose-100 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  Xác nhận xóa {selectedBulkStudents.length} học sinh
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Các hồ sơ học sinh dưới đây và đăng ký lớp học của họ sẽ bị xóa vĩnh viễn khỏi Cloud Firestore:
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(false)}
                disabled={deletingBulk}
                className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-pink-100 bg-[#FDFBFC] p-3 space-y-1.5 text-xs text-slate-700">
              {selectedBulkStudents.slice(0, 12).map((st) => (
                <div key={st.id} className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 truncate">{st.fullName}</span>
                  <span className="font-mono-num text-slate-500 shrink-0">{st.studentCode}</span>
                </div>
              ))}
              {selectedBulkStudents.length > 12 && (
                <p className="text-slate-500 pt-1">
                  ... và {selectedBulkStudents.length - 12} học sinh khác
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmBulkDelete(false)}
                disabled={deletingBulk}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmBulkDelete()}
                disabled={deletingBulk}
                className="min-h-[42px] px-5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deletingBulk
                  ? 'Đang xóa...'
                  : `Xóa ${selectedBulkStudents.length} học sinh`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add Students Modal */}
      <BulkAddStudentsModal
        open={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        defaultClassIds={classFilter !== 'all' ? [classFilter] : classes[0] ? [classes[0].id] : []}
        onCompleted={({ createdCount, provisionedCount }) => {
          setNotice(
            `Đã thêm đồng loạt ${createdCount} học sinh${
              provisionedCount > 0 ? ` và cấp ${provisionedCount} tài khoản đăng nhập.` : '.'
            }`
          );
        }}
      />
    </div>
  );
};
