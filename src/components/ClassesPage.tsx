import React, { useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRightLeft,
  CalendarPlus,
  CheckSquare,
  Clock,
  Download,
  Edit3,
  FileSpreadsheet,
  Plus,
  Square,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  createClassroom,
  createOrOpenSession,
  createSchedule,
  createStudent,
  deleteClassroom,
  deleteSchedule,
  deleteStudentsBulk,
  enrollStudentInClass,
  removeStudentFromClass,
  syncClassMemberEmails,
  todayISO,
  transferStudentClass,
  updateClassroom,
} from '../services/firestoreService';
import {
  downloadStudentImportTemplate,
  exportClassStudentsToExcel,
  parseStudentsFromExcel,
} from '../services/exportService';
import { Classroom, DAY_OF_WEEK_LABELS } from '../types';
import { BulkAddStudentsModal } from './BulkAddStudentsModal';

interface ClassesPageProps {
  onOpenSession: (sessionId: string) => void;
}

export const ClassesPage: React.FC<ClassesPageProps> = ({ onOpenSession }) => {
  const { workspaceTeacherId, classes, students, enrollments, schedules } = useApp();
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'active' | 'archived'>('active');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);

  // Delete class confirmation modal (replaces blocked window.confirm)
  const [confirmDeleteClass, setConfirmDeleteClass] = useState<Classroom | null>(null);
  const [deletingClass, setDeletingClass] = useState(false);

  // Bulk select / remove / delete students inside class roster
  const [rosterBulkMode, setRosterBulkMode] = useState(false);
  const [rosterSelectedIds, setRosterSelectedIds] = useState<string[]>([]);
  const [confirmBulkRosterAction, setConfirmBulkRosterAction] = useState<'withdraw' | 'delete' | null>(null);
  const [processingBulkRoster, setProcessingBulkRoster] = useState(false);

  // Class create/edit modal
  const [showClassModal, setShowClassModal] = useState(false);
  const [editingClass, setEditingClass] = useState<Classroom | null>(null);
  const [clsName, setClsName] = useState('');
  const [clsSubject, setClsSubject] = useState('Toán học');
  const [clsGrade, setClsGrade] = useState('Khối 9');
  const [clsRoom, setClsRoom] = useState('');
  const [clsFee, setClsFee] = useState('150000');
  const [savingClass, setSavingClass] = useState(false);

  // Schedule form
  const [schDay, setSchDay] = useState(1);
  const [schStart, setSchStart] = useState('17:30');
  const [schEnd, setSchEnd] = useState('19:00');
  const [schRoom, setSchRoom] = useState('');

  // Makeup session modal
  const [showMakeupModal, setShowMakeupModal] = useState(false);
  const [makeupDate, setMakeupDate] = useState(todayISO());
  const [makeupStart, setMakeupStart] = useState('15:00');
  const [makeupEnd, setMakeupEnd] = useState('16:30');

  // Transfer student modal
  const [transferStudentId, setTransferStudentId] = useState<string | null>(null);
  const [transferTargetClassId, setTransferTargetClassId] = useState('');

  // Enroll existing student picker
  const [enrollStudentId, setEnrollStudentId] = useState('');
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const filteredClasses = useMemo(
    () => classes.filter((c) => c.status === filterStatus).sort((a, b) => a.name.localeCompare(b.name)),
    [classes, filterStatus]
  );

  const activeClass = useMemo(() => {
    const chosen = classes.find((c) => c.id === selectedClassId);
    if (chosen) return chosen;
    return filteredClasses[0] ?? null;
  }, [classes, selectedClassId, filteredClasses]);

  const classEnrollments = useMemo(() => {
    if (!activeClass) return [];
    return enrollments.filter((e) => e.classId === activeClass.id && e.status === 'active');
  }, [enrollments, activeClass]);

  const enrolledStudents = useMemo(() => {
    const ids = new Set(classEnrollments.map((e) => e.studentId));
    return students.filter((s) => ids.has(s.id)).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [students, classEnrollments]);

  const availableStudentsToEnroll = useMemo(() => {
    const ids = new Set(classEnrollments.map((e) => e.studentId));
    return students.filter((s) => !ids.has(s.id) && s.status === 'active');
  }, [students, classEnrollments]);

  const classSchedules = useMemo(() => {
    if (!activeClass) return [];
    return schedules
      .filter((s) => s.classId === activeClass.id)
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  }, [schedules, activeClass]);

  const openCreateModal = () => {
    setEditingClass(null);
    setClsName('');
    setClsSubject('Toán học');
    setClsGrade('Khối 9');
    setClsRoom('Phòng 101');
    setClsFee('150000');
    setShowClassModal(true);
  };

  const openEditModal = (cls: Classroom) => {
    setEditingClass(cls);
    setClsName(cls.name);
    setClsSubject(cls.subject);
    setClsGrade(cls.gradeLevel);
    setClsRoom(cls.room ?? '');
    setClsFee(String(cls.feePerSession ?? 150000));
    setShowClassModal(true);
  };

  const handleSaveClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !clsName.trim()) return;
    setSavingClass(true);
    try {
      if (editingClass) {
        await updateClassroom(editingClass.id, {
          name: clsName,
          subject: clsSubject,
          gradeLevel: clsGrade,
          room: clsRoom,
          feePerSession: Number(clsFee) || 0,
        });
        setNotice({ type: 'success', text: `Đã cập nhật thông tin lớp "${clsName}".` });
      } else {
        const newId = await createClassroom(workspaceTeacherId, {
          name: clsName,
          subject: clsSubject,
          gradeLevel: clsGrade,
          room: clsRoom,
          feePerSession: Number(clsFee) || 0,
        });
        setSelectedClassId(newId);
        setNotice({ type: 'success', text: `Đã tạo lớp "${clsName}" thành công.` });
      }
      setShowClassModal(false);
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể lưu thông tin lớp học.',
      });
    } finally {
      setSavingClass(false);
    }
  };

  const handleToggleArchive = async (cls: Classroom) => {
    try {
      const nextStatus = cls.status === 'active' ? 'archived' : 'active';
      await updateClassroom(cls.id, { status: nextStatus });
      setConfirmDeleteClass(null);
      setNotice({
        type: 'success',
        text:
          nextStatus === 'archived'
            ? `Đã lưu trữ lớp "${cls.name}".`
            : `Đã khôi phục lớp "${cls.name}".`,
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể thay đổi trạng thái lớp.',
      });
    }
  };

  const handleConfirmDeleteClass = async () => {
    if (!confirmDeleteClass || !workspaceTeacherId) return;
    setDeletingClass(true);
    try {
      const targetName = confirmDeleteClass.name;
      await deleteClassroom(confirmDeleteClass.id, workspaceTeacherId);
      if (selectedClassId === confirmDeleteClass.id) {
        setSelectedClassId('');
      }
      setConfirmDeleteClass(null);
      setNotice({ type: 'success', text: `Đã xóa lớp "${targetName}" khỏi hệ thống.` });
    } catch (err) {
      console.error('Lỗi xóa lớp học:', err);
      setNotice({
        type: 'error',
        text: err instanceof Error ? `Không thể xóa lớp học: ${err.message}` : 'Không thể xóa lớp học.',
      });
    } finally {
      setDeletingClass(false);
    }
  };

  const handleAddSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !activeClass) return;
    await createSchedule(
      workspaceTeacherId,
      activeClass.id,
      { dayOfWeek: schDay, startTime: schStart, endTime: schEnd, room: schRoom || activeClass.room },
      activeClass.memberEmails,
      activeClass.memberUids || []
    );
    setNotice({ type: 'success', text: 'Đã thêm lịch học định kỳ.' });
  };

  const handleCreateMakeupSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !activeClass) return;
    const sessionId = await createOrOpenSession(workspaceTeacherId, activeClass, {
      sessionDate: makeupDate,
      startTime: makeupStart,
      endTime: makeupEnd,
      sessionType: 'makeup',
    });
    setShowMakeupModal(false);
    onOpenSession(sessionId);
  };

  const handleEnrollExisting = async () => {
    if (!workspaceTeacherId || !activeClass || !enrollStudentId) return;
    const st = students.find((s) => s.id === enrollStudentId);
    if (!st) return;
    await enrollStudentInClass(workspaceTeacherId, activeClass.id, st);
    const updatedEnrollments = [
      ...enrollments,
      {
        id: `${activeClass.id}_${st.id}`,
        teacherId: workspaceTeacherId,
        classId: activeClass.id,
        studentId: st.id,
        studentEmail: st.studentEmail,
        studentUid: st.studentUid,
        parentEmails: st.parentEmails,
        parentUids: st.parentUids || [],
        status: 'active' as const,
        enrolledAt: todayISO(),
      },
    ];
    await syncClassMemberEmails(workspaceTeacherId, activeClass.id, students, updatedEnrollments);
    setEnrollStudentId('');
    setNotice({ type: 'success', text: `Đã thêm học sinh ${st.fullName} vào lớp.` });
  };

  const handleTransferStudent = async () => {
    if (!workspaceTeacherId || !activeClass || !transferStudentId || !transferTargetClassId) return;
    const st = students.find((s) => s.id === transferStudentId);
    if (!st) return;
    await transferStudentClass(workspaceTeacherId, activeClass.id, transferTargetClassId, st);
    setTransferStudentId(null);
    setTransferTargetClassId('');
    setNotice({ type: 'success', text: `Đã chuyển học sinh ${st.fullName} sang lớp mới.` });
  };

  const handleRemoveFromClass = async (studentId: string, fullName: string) => {
    if (!activeClass || !workspaceTeacherId) return;
    await removeStudentFromClass(activeClass.id, studentId);
    const updatedEnrollments = enrollments.map((e) =>
      e.classId === activeClass.id && e.studentId === studentId ? { ...e, status: 'withdrawn' as const } : e
    );
    await syncClassMemberEmails(workspaceTeacherId, activeClass.id, students, updatedEnrollments);
    setNotice({ type: 'success', text: `Đã rút học sinh ${fullName} khỏi lớp ${activeClass.name}.` });
  };

  const toggleRosterStudentId = (studentId: string) => {
    setRosterSelectedIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const enrolledIdsInClass = useMemo(() => enrolledStudents.map((s) => s.id), [enrolledStudents]);
  const allEnrolledSelected =
    enrolledIdsInClass.length > 0 &&
    enrolledIdsInClass.every((id) => rosterSelectedIds.includes(id));

  const toggleSelectAllRoster = () => {
    if (allEnrolledSelected) {
      setRosterSelectedIds([]);
    } else {
      setRosterSelectedIds(enrolledIdsInClass);
    }
  };

  const handleConfirmBulkRoster = async () => {
    if (!workspaceTeacherId || !activeClass || !confirmBulkRosterAction || rosterSelectedIds.length === 0) return;
    setProcessingBulkRoster(true);
    try {
      const targetIds = rosterSelectedIds.filter((id) => enrolledIdsInClass.includes(id));
      const idSet = new Set(targetIds);

      if (confirmBulkRosterAction === 'withdraw') {
        for (const sId of targetIds) {
          await removeStudentFromClass(activeClass.id, sId);
        }
        const updatedEnrollments = enrollments.map((e) =>
          e.classId === activeClass.id && idSet.has(e.studentId)
            ? { ...e, status: 'withdrawn' as const }
            : e
        );
        await syncClassMemberEmails(workspaceTeacherId, activeClass.id, students, updatedEnrollments);
        setNotice({
          type: 'success',
          text: `Đã rút ${targetIds.length} học sinh khỏi lớp ${activeClass.name}.`,
        });
      } else {
        const { deletedCount, affectedClassIds } = await deleteStudentsBulk(
          workspaceTeacherId,
          targetIds
        );
        const remainingStudents = students.filter((s) => !idSet.has(s.id));
        const remainingEnrollments = enrollments.filter((e) => !idSet.has(e.studentId));
        const classesToSync = Array.from(new Set([activeClass.id, ...affectedClassIds]));
        for (const cId of classesToSync) {
          await syncClassMemberEmails(workspaceTeacherId, cId, remainingStudents, remainingEnrollments);
        }
        setNotice({
          type: 'success',
          text: `Đã xóa vĩnh viễn ${deletedCount} học sinh khỏi hệ thống.`,
        });
      }

      setRosterSelectedIds([]);
      setRosterBulkMode(false);
      setConfirmBulkRosterAction(null);
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể thực hiện thao tác hàng loạt.',
      });
    } finally {
      setProcessingBulkRoster(false);
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceTeacherId || !activeClass) return;
    try {
      const parsed = await parseStudentsFromExcel(file);
      if (parsed.length === 0) {
        setNotice({
          type: 'error',
          text: 'Không tìm thấy dòng học sinh hợp lệ trong file Excel (cần cột "Họ tên").',
        });
        return;
      }
      const createdList = [];
      for (const row of parsed) {
        const st = await createStudent(workspaceTeacherId, {
          ...row,
          startDate: todayISO(),
          status: 'active',
        });
        await enrollStudentInClass(workspaceTeacherId, activeClass.id, st);
        createdList.push(st);
      }
      await syncClassMemberEmails(
        workspaceTeacherId,
        activeClass.id,
        [...students, ...createdList],
        [
          ...enrollments,
          ...createdList.map((st) => ({
            id: `${activeClass.id}_${st.id}`,
            teacherId: workspaceTeacherId,
            classId: activeClass.id,
            studentId: st.id,
            studentEmail: st.studentEmail,
            studentUid: st.studentUid,
            parentEmails: st.parentEmails,
            parentUids: st.parentUids || [],
            status: 'active' as const,
            enrolledAt: todayISO(),
          })),
        ]
      );
      setNotice({
        type: 'success',
        text: `Đã nhập thành công ${createdList.length} học sinh từ Excel vào lớp ${activeClass.name}.`,
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi đọc file Excel.',
      });
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quản lý lớp học</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Thiết lập môn học, lịch dạy định kỳ, buổi học bù và danh sách học sinh
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="min-h-[44px] px-4 rounded-xl bg-[#DB2777] text-white text-sm font-medium hover:bg-[#BE185D] transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Tạo lớp mới</span>
        </button>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm flex items-center justify-between gap-3 ${
            notice.type === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold hover:underline shrink-0">
            Đóng
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Class List */}
        <section className="lg:col-span-4 space-y-3">
          <div className="flex items-center gap-1 p-1 bg-pink-50/80 rounded-xl border border-pink-100">
            <button
              onClick={() => setFilterStatus('active')}
              className={`flex-1 min-h-[40px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filterStatus === 'active' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Đang hoạt động ({classes.filter((c) => c.status === 'active').length})
            </button>
            <button
              onClick={() => setFilterStatus('archived')}
              className={`flex-1 min-h-[40px] rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                filterStatus === 'archived' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Đã lưu trữ ({classes.filter((c) => c.status === 'archived').length})
            </button>
          </div>

          <div className="space-y-2">
            {filteredClasses.length === 0 ? (
              <div className="rounded-2xl bg-white border border-pink-100 p-6 text-center text-sm text-slate-500">
                Chưa có lớp nào trong mục này.
              </div>
            ) : (
              filteredClasses.map((cls) => {
                const isSelected = activeClass?.id === cls.id;
                const count = enrollments.filter((e) => e.classId === cls.id && e.status === 'active').length;
                return (
                  <button
                    key={cls.id}
                    onClick={() => setSelectedClassId(cls.id)}
                    className={`w-full text-left rounded-2xl p-4 border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#FFF1F5] border-[#DB2777]'
                        : 'bg-white border-pink-100 hover:border-pink-200'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{cls.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {cls.subject} · {cls.gradeLevel} · {count} học sinh
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {/* Active Class Details */}
        <section className="lg:col-span-8 space-y-6">
          {!activeClass ? (
            <div className="rounded-2xl bg-white border border-pink-100 p-10 text-center text-sm text-slate-500">
              Chọn một lớp học bên trái hoặc tạo lớp mới để quản lý chi tiết.
            </div>
          ) : (
            <>
              {/* Class Overview Card */}
              <div className="rounded-2xl bg-white border border-pink-100 p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{activeClass.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {activeClass.subject} · {activeClass.gradeLevel} · {activeClass.room || 'Chưa đặt phòng'} ·{' '}
                      <span className="font-mono-num text-slate-700 font-medium">
                        {(activeClass.feePerSession ?? 0).toLocaleString('vi-VN')}đ/buổi
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setShowMakeupModal(true)}
                      className="min-h-[40px] px-3.5 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <CalendarPlus className="w-4 h-4" />
                      <span>Tạo buổi học bù</span>
                    </button>
                    <button
                      onClick={() => openEditModal(activeClass)}
                      className="min-h-[40px] px-3 rounded-xl border border-pink-200 text-slate-700 text-xs font-medium hover:bg-pink-50 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Sửa</span>
                    </button>
                    <button
                      onClick={() => void handleToggleArchive(activeClass)}
                      className="min-h-[40px] px-3 rounded-xl border border-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>{activeClass.status === 'active' ? 'Lưu trữ' : 'Khôi phục'}</span>
                    </button>
                    <button
                      onClick={() => setConfirmDeleteClass(activeClass)}
                      className="min-h-[40px] px-3 rounded-xl border border-rose-200 text-rose-700 text-xs font-medium hover:bg-rose-50 inline-flex items-center gap-1.5 cursor-pointer"
                      title="Xóa lớp"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa lớp</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Recurring Schedules */}
              <div className="rounded-2xl bg-white border border-pink-100 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[#DB2777]" />
                  <h3 className="text-base font-semibold text-slate-900">Lịch học định kỳ hàng tuần</h3>
                </div>

                {classSchedules.length === 0 ? (
                  <p className="text-sm text-slate-500">Chưa thiết lập lịch học định kỳ cho lớp này.</p>
                ) : (
                  <div className="divide-y divide-pink-50">
                    {classSchedules.map((sch) => (
                      <div key={sch.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="text-sm text-slate-800">
                          <span className="font-semibold">{DAY_OF_WEEK_LABELS[sch.dayOfWeek]}</span>
                          <span className="mx-2 text-slate-300">·</span>
                          <span className="font-mono-num">
                            {sch.startTime} – {sch.endTime}
                          </span>
                          {sch.room && (
                            <>
                              <span className="mx-2 text-slate-300">·</span>
                              <span className="text-slate-500">{sch.room}</span>
                            </>
                          )}
                        </div>
                        <button
                          onClick={() => void deleteSchedule(sch.id)}
                          className="min-h-[36px] min-w-[36px] rounded-lg text-slate-400 hover:text-rose-700 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer"
                          aria-label="Xóa lịch"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={(e) => void handleAddSchedule(e)} className="pt-3 border-t border-pink-100 grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <select
                    value={schDay}
                    onChange={(e) => setSchDay(Number(e.target.value))}
                    className="min-h-[42px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <option key={d} value={d}>
                        {DAY_OF_WEEK_LABELS[d]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={schStart}
                    onChange={(e) => setSchStart(e.target.value)}
                    className="min-h-[42px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                    required
                  />
                  <input
                    type="time"
                    value={schEnd}
                    onChange={(e) => setSchEnd(e.target.value)}
                    className="min-h-[42px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                    required
                  />
                  <input
                    type="text"
                    value={schRoom}
                    onChange={(e) => setSchRoom(e.target.value)}
                    placeholder="Phòng học"
                    className="min-h-[42px] rounded-xl border border-pink-200 px-3 text-sm"
                  />
                  <button
                    type="submit"
                    className="col-span-2 sm:col-span-1 min-h-[42px] rounded-xl bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 cursor-pointer"
                  >
                    + Thêm lịch
                  </button>
                </form>
              </div>

              {/* Roster + Excel Import/Export */}
              <div className="rounded-2xl bg-white border border-pink-100 p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#15803D]" />
                    <h3 className="text-base font-semibold text-slate-900">
                      Danh sách học sinh ({enrolledStudents.length})
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {enrolledStudents.length > 0 && (
                      <button
                        onClick={() => {
                          setRosterBulkMode((prev) => {
                            if (prev) setRosterSelectedIds([]);
                            return !prev;
                          });
                        }}
                        className={`min-h-[38px] px-3 rounded-xl border text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                          rosterBulkMode
                            ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                            : 'border-pink-200 bg-white text-slate-700 hover:bg-pink-50'
                        }`}
                      >
                        <CheckSquare className="w-3.5 h-3.5" />
                        <span>{rosterBulkMode ? 'Hủy chọn' : 'Xóa nhiều HS'}</span>
                      </button>
                    )}
                    <button
                      onClick={() => setShowBulkModal(true)}
                      className="min-h-[38px] px-3 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Thêm nhiều HS</span>
                    </button>
                    <button
                      onClick={downloadStudentImportTemplate}
                      className="min-h-[38px] px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-[#15803D]" />
                      <span>Mẫu Excel</span>
                    </button>
                    <input
                      ref={excelInputRef}
                      type="file"
                      accept=".xlsx,.csv"
                      onChange={(e) => void handleExcelUpload(e)}
                      className="hidden"
                    />
                    <button
                      onClick={() => excelInputRef.current?.click()}
                      className="min-h-[38px] px-3 rounded-xl border border-pink-200 bg-pink-50 text-xs font-semibold text-[#BE185D] hover:bg-pink-100 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Nhập Excel</span>
                    </button>
                    <button
                      onClick={() => exportClassStudentsToExcel(activeClass, enrolledStudents)}
                      className="min-h-[38px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-semibold text-[#15803D] hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Xuất Excel</span>
                    </button>
                  </div>
                </div>

                {rosterBulkMode && enrolledStudents.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/75 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={toggleSelectAllRoster}
                        className="min-h-[36px] px-3 rounded-lg bg-white border border-rose-200 text-xs font-semibold text-slate-800 hover:bg-rose-50 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {allEnrolledSelected ? (
                          <CheckSquare className="w-3.5 h-3.5 text-rose-600" />
                        ) : (
                          <Square className="w-3.5 h-3.5 text-slate-400" />
                        )}
                        <span>
                          {allEnrolledSelected
                            ? 'Bỏ chọn tất cả'
                            : `Chọn tất cả (${enrolledStudents.length})`}
                        </span>
                      </button>
                      <span className="text-xs font-semibold text-rose-900">
                        Đã chọn {rosterSelectedIds.filter((id) => enrolledIdsInClass.includes(id)).length} HS
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={rosterSelectedIds.filter((id) => enrolledIdsInClass.includes(id)).length === 0}
                        onClick={() => setConfirmBulkRosterAction('withdraw')}
                        className="min-h-[36px] px-3 rounded-lg bg-white border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40 cursor-pointer"
                      >
                        Rút khỏi lớp ({rosterSelectedIds.filter((id) => enrolledIdsInClass.includes(id)).length})
                      </button>
                      <button
                        type="button"
                        disabled={rosterSelectedIds.filter((id) => enrolledIdsInClass.includes(id)).length === 0}
                        onClick={() => setConfirmBulkRosterAction('delete')}
                        className="min-h-[36px] px-3 rounded-lg bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>
                          Xóa vĩnh viễn ({rosterSelectedIds.filter((id) => enrolledIdsInClass.includes(id)).length})
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Add existing student to class */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={enrollStudentId}
                    onChange={(e) => setEnrollStudentId(e.target.value)}
                    className="flex-1 min-h-[44px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                  >
                    <option value="">Chọn học sinh có sẵn để thêm vào lớp...</option>
                    {availableStudentsToEnroll.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.studentCode} – {st.fullName} ({st.schoolClass || 'Chưa rõ lớp'})
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void handleEnrollExisting()}
                    disabled={!enrollStudentId}
                    className="min-h-[44px] px-4 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] disabled:opacity-40 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Thêm vào lớp</span>
                  </button>
                </div>

                {enrolledStudents.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    Lớp chưa có học sinh. Hãy thêm từ danh sách có sẵn hoặc nhập từ file Excel.
                  </p>
                ) : (
                  <div className="divide-y divide-pink-50">
                    {enrolledStudents.map((st) => {
                      const isChecked = rosterSelectedIds.includes(st.id);
                      return (
                        <div
                          key={st.id}
                          onClick={rosterBulkMode ? () => toggleRosterStudentId(st.id) : undefined}
                          className={`py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                            rosterBulkMode
                              ? `cursor-pointer px-2 -mx-2 rounded-xl transition-colors ${
                                  isChecked ? 'bg-rose-50/70' : 'hover:bg-pink-50/40'
                                }`
                              : ''
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            {rosterBulkMode && (
                              <span className="mt-0.5 shrink-0">
                                {isChecked ? (
                                  <CheckSquare className="w-4 h-4 text-rose-600" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-400" />
                                )}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-slate-900">
                                {st.fullName}{' '}
                                <span className="font-mono-num text-xs font-normal text-slate-500">
                                  · {st.studentCode}
                                </span>
                              </p>
                              <p className="text-xs text-slate-500">
                                {/^phụ huynh/i.test(st.parentName)
                                  ? st.parentName
                                  : `Phụ huynh: ${st.parentName}`}{' '}
                                · {st.motherPhone || st.fatherPhone || 'Chưa có SĐT'}
                              </p>
                            </div>
                          </div>
                          {!rosterBulkMode && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => {
                                  setTransferStudentId(st.id);
                                  setTransferTargetClassId('');
                                }}
                                className="min-h-[36px] px-2.5 rounded-lg border border-pink-200 text-xs font-medium text-slate-700 hover:bg-pink-50 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <ArrowRightLeft className="w-3.5 h-3.5 text-[#DB2777]" />
                                <span>Chuyển lớp</span>
                              </button>
                              <button
                                onClick={() => void handleRemoveFromClass(st.id, st.fullName)}
                                className="min-h-[36px] px-2.5 rounded-lg border border-rose-200 text-xs font-medium text-rose-700 hover:bg-rose-50 cursor-pointer"
                              >
                                Rút lớp
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Create / Edit Class Modal */}
      {showClassModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={(e) => void handleSaveClass(e)}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-pink-100"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {editingClass ? 'Chỉnh sửa lớp học' : 'Tạo lớp học mới'}
              </h3>
              <button
                type="button"
                onClick={() => setShowClassModal(false)}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tên lớp học *</label>
              <input
                type="text"
                value={clsName}
                onChange={(e) => setClsName(e.target.value)}
                placeholder="VD: Toán 9 – Ôn thi vào 10 (Nhóm B)"
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Môn học *</label>
                <input
                  type="text"
                  value={clsSubject}
                  onChange={(e) => setClsSubject(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Khối học *</label>
                <input
                  type="text"
                  value={clsGrade}
                  onChange={(e) => setClsGrade(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phòng học</label>
                <input
                  type="text"
                  value={clsRoom}
                  onChange={(e) => setClsRoom(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Học phí / buổi (VNĐ)</label>
                <input
                  type="number"
                  min={0}
                  step={10000}
                  value={clsFee}
                  onChange={(e) => setClsFee(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowClassModal(false)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingClass}
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D]"
              >
                {savingClass ? 'Đang lưu...' : 'Lưu lớp học'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Makeup Session Modal */}
      {showMakeupModal && activeClass && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={(e) => void handleCreateMakeupSession(e)}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-emerald-100"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Tạo buổi học bù</h3>
              <button
                type="button"
                onClick={() => setShowMakeupModal(false)}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600">Lớp: <strong>{activeClass.name}</strong></p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Ngày học bù</label>
              <input
                type="date"
                value={makeupDate}
                onChange={(e) => setMakeupDate(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Giờ bắt đầu</label>
                <input
                  type="time"
                  value={makeupStart}
                  onChange={(e) => setMakeupStart(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Giờ kết thúc</label>
                <input
                  type="time"
                  value={makeupEnd}
                  onChange={(e) => setMakeupEnd(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm font-mono-num"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMakeupModal(false)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 rounded-xl bg-[#15803D] text-white text-sm font-semibold hover:bg-emerald-800"
              >
                Mở buổi học bù
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Transfer Student Modal */}
      {transferStudentId && activeClass && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-pink-100">
            <h3 className="text-lg font-bold text-slate-900">Chuyển học sinh sang lớp khác</h3>
            <select
              value={transferTargetClassId}
              onChange={(e) => setTransferTargetClassId(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm bg-white"
            >
              <option value="">Chọn lớp đích...</option>
              {classes
                .filter((c) => c.id !== activeClass.id && c.status === 'active')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setTransferStudentId(null)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700"
              >
                Hủy
              </button>
              <button
                onClick={() => void handleTransferStudent()}
                disabled={!transferTargetClassId}
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] disabled:opacity-40"
              >
                Xác nhận chuyển lớp
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Confirm Delete Class Modal */}
      {confirmDeleteClass && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-rose-100 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Xác nhận xóa lớp học</h3>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                  Bạn muốn xóa vĩnh viễn lớp <strong>{confirmDeleteClass.name}</strong>? Lịch học định kỳ và danh sách ghi danh của lớp này cũng sẽ được gỡ bỏ (hồ sơ học sinh vẫn được giữ nguyên).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteClass(null)}
                disabled={deletingClass}
                className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 bg-[#FDFBFC] border border-pink-100 rounded-xl p-3">
              Gợi ý: Nếu muốn giữ lại lịch sử lớp để tra cứu sau này, bạn có thể chọn <strong>Lưu trữ lớp</strong> thay vì xóa vĩnh viễn.
            </p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmDeleteClass(null)}
                disabled={deletingClass}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              {confirmDeleteClass.status === 'active' && (
                <button
                  type="button"
                  onClick={() => void handleToggleArchive(confirmDeleteClass)}
                  disabled={deletingClass}
                  className="min-h-[42px] px-4 rounded-xl border border-pink-200 bg-pink-50 text-sm font-semibold text-[#BE185D] hover:bg-pink-100 cursor-pointer"
                >
                  Lưu trữ lớp
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleConfirmDeleteClass()}
                disabled={deletingClass}
                className="min-h-[42px] px-5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deletingClass ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Bulk Roster Action Modal */}
      {confirmBulkRosterAction && activeClass && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-rose-100 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {confirmBulkRosterAction === 'withdraw'
                    ? `Rút ${rosterSelectedIds.filter((id) => enrolledIdsInClass.includes(id)).length} học sinh khỏi lớp`
                    : `Xóa vĩnh viễn ${rosterSelectedIds.filter((id) => enrolledIdsInClass.includes(id)).length} học sinh`}
                </h3>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                  {confirmBulkRosterAction === 'withdraw'
                    ? `Các học sinh đã chọn sẽ được rút khỏi lớp "${activeClass.name}" nhưng vẫn giữ lại hồ sơ chung.`
                    : 'Toàn bộ hồ sơ các học sinh đã chọn và đăng ký lớp của họ sẽ bị xóa vĩnh viễn khỏi hệ thống.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmBulkRosterAction(null)}
                disabled={processingBulkRoster}
                className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmBulkRosterAction(null)}
                disabled={processingBulkRoster}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmBulkRoster()}
                disabled={processingBulkRoster}
                className="min-h-[42px] px-5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {processingBulkRoster
                  ? 'Đang xử lý...'
                  : confirmBulkRosterAction === 'withdraw'
                  ? 'Xác nhận rút khỏi lớp'
                  : 'Xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeClass && (
        <BulkAddStudentsModal
          open={showBulkModal}
          onClose={() => setShowBulkModal(false)}
          defaultClassIds={[activeClass.id]}
          onCompleted={({ createdCount, provisionedCount }) => {
            setNotice({
              type: 'success',
              text: `Đã thêm đồng loạt ${createdCount} học sinh vào lớp ${activeClass.name}${
                provisionedCount > 0 ? ` và cấp ${provisionedCount} tài khoản đăng nhập.` : '.'
              }`,
            });
          }}
        />
      )}
    </div>
  );
};
