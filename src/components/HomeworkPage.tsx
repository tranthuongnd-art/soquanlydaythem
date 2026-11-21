import React, { useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  CheckCircle2,
  CheckSquare,
  ClipboardList,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  MessageCircle,
  Phone,
  Plus,
  Save,
  Search,
  Send,
  Square,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatPhoneReadable, toZaloUrl } from '../lib/firebase';
import {
  createHomework,
  createNotification,
  deleteHomework,
  gradeHomeworkSubmission,
  todayISO,
  uploadAttachmentFile,
} from '../services/firestoreService';
import { HomeworkRecord, HomeworkScope, NotificationCategory, Student } from '../types';

const ALL_CLASSES_FILTER = '__ALL__';

const NOTIFICATION_CATEGORY_VI: Record<NotificationCategory, string> = {
  general: 'THÔNG BÁO',
  schedule: 'THÔNG BÁO LỊCH HỌC',
  homework: 'NHẮC BÀI TẬP VỀ NHÀ',
  review: 'THÔNG BÁO TÌNH HÌNH HỌC TẬP',
};

const ZALO_NOTIFICATION_TEMPLATES: {
  label: string;
  category: NotificationCategory;
  title: string;
  body: string;
}[] = [
  {
    label: 'Lịch học / Học bù',
    category: 'schedule',
    title: 'Thông báo lịch học bù tuần này',
    body: 'Kính gửi Quý phụ huynh,\nLớp có lịch học bù vào Thứ ... ngày ... lúc ...h... - ...h.... Nhờ Quý phụ huynh sắp xếp thời gian đưa đón các con đầy đủ. Xin cảm ơn Quý phụ huynh!',
  },
  {
    label: 'Nhắc BTVN',
    category: 'homework',
    title: 'Nhắc hoàn thành bài tập về nhà',
    body: 'Kính gửi Quý phụ huynh,\nNhờ bố mẹ nhắc các con hoàn thành đầy đủ bài tập về nhà trước buổi học tới và mang theo vở bài tập khi đến lớp. Cảm ơn Quý phụ huynh đã đồng hành cùng cô/thầy!',
  },
  {
    label: 'Lịch kiểm tra',
    category: 'review',
    title: 'Thông báo lịch kiểm tra định kỳ',
    body: 'Kính gửi Quý phụ huynh,\nBuổi học tới lớp sẽ có bài kiểm tra nhỏ đánh giá kiến thức đã học. Nhờ Quý phụ huynh nhắc các con ôn lại vở ghi và các dạng bài đã chữa trên lớp.',
  },
  {
    label: 'Thông báo học phí',
    category: 'general',
    title: 'Thông báo tổng hợp số buổi & học phí tháng',
    body: 'Kính gửi Quý phụ huynh,\nCô/thầy xin gửi thông báo tổng hợp lịch học và học phí tháng này của các con. Nếu có thắc mắc về số buổi học, Quý phụ huynh nhắn tin trực tiếp giúp cô/thầy nhé. Trân trọng cảm ơn!',
  },
];

function getHomeworkAssignedStudentIds(hw: HomeworkRecord): string[] {
  if (hw.scope !== 'individual') return [];
  if (Array.isArray(hw.assignedStudentIds) && hw.assignedStudentIds.length > 0) {
    return hw.assignedStudentIds;
  }
  return hw.assignedStudentId ? [hw.assignedStudentId] : [];
}

function buildHomeworkZaloText(
  hw: HomeworkRecord,
  className: string,
  targetStudents: Student[]
): string {
  const lines: string[] = [];
  lines.push(`📚 THÔNG BÁO BÀI TẬP VỀ NHÀ – ${className || 'Lớp học'}`);
  lines.push(`• Bài tập: ${hw.title}`);
  lines.push(`• Hạn hoàn thành: ${hw.dueDate}`);
  if (hw.scope === 'individual' && targetStudents.length > 0) {
    lines.push(`• Học sinh cần làm: ${targetStudents.map((s) => s.fullName).join(', ')}`);
  } else {
    lines.push('• Đối tượng: Cả lớp');
  }
  if (hw.description?.trim()) {
    lines.push(`\nNội dung yêu cầu:\n${hw.description.trim()}`);
  }
  if (hw.attachmentUrl?.trim()) {
    lines.push(`\n📎 Tài liệu / ảnh bài tập: ${hw.attachmentUrl.trim()}`);
  }
  lines.push('\nNhờ Quý phụ huynh nhắc con hoàn thành đầy đủ trước buổi học tới. Xin cảm ơn Quý phụ huynh!');
  return lines.join('\n');
}

function buildNotificationZaloText(params: {
  title: string;
  body: string;
  className?: string;
  category: NotificationCategory;
}): string {
  const prefix = NOTIFICATION_CATEGORY_VI[params.category] || 'THÔNG BÁO';
  const scopeLabel = params.className ? ` – ${params.className}` : '';
  const titleLine = params.title.trim() ? `${params.title.trim()}\n` : '';
  return `📢 ${prefix}${scopeLabel}\n${titleLine}\n${params.body.trim()}`.trim();
}

export const HomeworkPage: React.FC = () => {
  const { workspaceTeacherId, classes, students, enrollments, homework, submissions, notifications } = useApp();
  const [activeTab, setActiveTab] = useState<'homework' | 'notifications'>('homework');
  const [selectedHwId, setSelectedHwId] = useState<string>('');
  const [notice, setNotice] = useState<string | null>(null);

  // Create homework modal (supports multi-student batch assignment in 1 shared form)
  const [showHwModal, setShowHwModal] = useState(false);
  const [hwClassId, setHwClassId] = useState('');
  const [hwScope, setHwScope] = useState<HomeworkScope>('individual');
  const [hwStudentIds, setHwStudentIds] = useState<string[]>([]);
  const [hwStudentSearch, setHwStudentSearch] = useState('');
  const [hwFormError, setHwFormError] = useState<string | null>(null);
  const [hwTitle, setHwTitle] = useState('');
  const [hwDesc, setHwDesc] = useState('');
  const [hwDueDate, setHwDueDate] = useState(todayISO());
  const [hwSkills, setHwSkills] = useState('');
  const [hwAttachmentUrl, setHwAttachmentUrl] = useState('');
  const [hwAttachmentName, setHwAttachmentName] = useState('');
  const [uploadingImg, setUploadingImg] = useState(false);
  const [savingHw, setSavingHw] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Grading draft state
  const [feedbackDraft, setFeedbackDraft] = useState<Record<string, string>>({});
  const [scoreDraft, setScoreDraft] = useState<Record<string, string>>({});
  const [savingAllGrades, setSavingAllGrades] = useState(false);
  const [confirmDeleteHwId, setConfirmDeleteHwId] = useState<{ id: string; title: string } | null>(null);
  const [deletingHw, setDeletingHw] = useState(false);

  // Notification form (Zalo-first parent announcements)
  const [notiClassId, setNotiClassId] = useState('');
  const [notiCategory, setNotiCategory] = useState<NotificationCategory>('general');
  const [notiTitle, setNotiTitle] = useState('');
  const [notiBody, setNotiBody] = useState('');
  const [sendingNoti, setSendingNoti] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [sentZaloStudentIds, setSentZaloStudentIds] = useState<Record<string, boolean>>({});
  const [activeZaloDispatch, setActiveZaloDispatch] = useState<{
    classId: string;
    title: string;
    body: string;
    category: NotificationCategory;
  } | null>(null);

  const activeClasses = useMemo(
    () => classes.filter((c) => c.status === 'active'),
    [classes]
  );
  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);
  const studentMap = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const studentActiveClassIdsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const enr of enrollments) {
      if (enr.status !== 'active') continue;
      const list = map.get(enr.studentId) ?? [];
      if (!list.includes(enr.classId)) list.push(enr.classId);
      map.set(enr.studentId, list);
    }
    return map;
  }, [enrollments]);

  const sortedHomework = useMemo(
    () => [...homework].sort((a, b) => b.dueDate.localeCompare(a.dueDate)),
    [homework]
  );

  const selectedHw = useMemo(
    () => homework.find((h) => h.id === selectedHwId) ?? sortedHomework[0] ?? null,
    [homework, selectedHwId, sortedHomework]
  );

  const targetStudentsForSelectedHw = useMemo(() => {
    if (!selectedHw) return [];
    if (selectedHw.scope === 'individual') {
      const assignedIds = getHomeworkAssignedStudentIds(selectedHw);
      return assignedIds
        .map((id) => studentMap.get(id))
        .filter((s): s is Student => Boolean(s))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    }
    const ids = new Set(
      enrollments
        .filter((e) => e.classId === selectedHw.classId && e.status === 'active')
        .map((e) => e.studentId)
    );
    return students.filter((s) => ids.has(s.id)).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [selectedHw, enrollments, students, studentMap]);

  // Selectable students in the Create Homework modal (by chosen class OR across all classes)
  const selectableStudentsForForm = useMemo(() => {
    let base: Student[];
    if (!hwClassId || hwClassId === ALL_CLASSES_FILTER) {
      base = students.filter((s) => s.status === 'active');
    } else {
      const ids = new Set(
        enrollments
          .filter((e) => e.classId === hwClassId && e.status === 'active')
          .map((e) => e.studentId)
      );
      base = students.filter((s) => ids.has(s.id));
    }
    const q = hwStudentSearch.trim().toLowerCase();
    const filtered = q
      ? base.filter(
          (st) =>
            st.fullName.toLowerCase().includes(q) ||
            st.studentCode.toLowerCase().includes(q) ||
            (st.schoolClass ?? '').toLowerCase().includes(q)
        )
      : base;
    return filtered.sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [hwClassId, enrollments, students, hwStudentSearch]);

  const selectedStudentObjects = useMemo(
    () =>
      hwStudentIds
        .map((id) => studentMap.get(id))
        .filter((s): s is Student => Boolean(s)),
    [hwStudentIds, studentMap]
  );

  const allVisibleSelected =
    selectableStudentsForForm.length > 0 &&
    selectableStudentsForForm.every((st) => hwStudentIds.includes(st.id));

  const openCreateHomeworkModal = (defaultScope: HomeworkScope = 'individual') => {
    setHwFormError(null);
    setHwScope(defaultScope);
    setHwClassId(activeClasses[0]?.id ?? '');
    setHwStudentIds([]);
    setHwStudentSearch('');
    setShowHwModal(true);
  };

  const toggleStudentSelection = (studentId: string) => {
    setHwFormError(null);
    setHwStudentIds((prev) =>
      prev.includes(studentId) ? prev.filter((id) => id !== studentId) : [...prev, studentId]
    );
  };

  const handleToggleSelectAllVisible = () => {
    setHwFormError(null);
    const visibleIds = selectableStudentsForForm.map((st) => st.id);
    if (allVisibleSelected) {
      const visibleSet = new Set(visibleIds);
      setHwStudentIds((prev) => prev.filter((id) => !visibleSet.has(id)));
    } else {
      setHwStudentIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const handleClassFilterChange = (nextClassId: string) => {
    setHwClassId(nextClassId);
    setHwFormError(null);
    // Keep only selected students belonging to the newly selected specific class
    if (nextClassId && nextClassId !== ALL_CLASSES_FILTER) {
      const allowedIds = new Set(
        enrollments
          .filter((e) => e.classId === nextClassId && e.status === 'active')
          .map((e) => e.studentId)
      );
      setHwStudentIds((prev) => prev.filter((id) => allowedIds.has(id)));
    }
  };

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !workspaceTeacherId) return;
    setUploadingImg(true);
    try {
      const url = await uploadAttachmentFile(workspaceTeacherId, 'homework', file);
      setHwAttachmentUrl(url);
      setHwAttachmentName(file.name);
      setNotice('Đã tải ảnh đính kèm lên Firebase Cloud Storage thành công.');
    } catch (err) {
      setNotice(
        err instanceof Error
          ? `Không thể tải ảnh lên Storage (${err.message}). Bạn có thể dán trực tiếp liên kết ảnh https:// bên dưới.`
          : 'Không thể tải ảnh lên Storage.'
      );
    } finally {
      setUploadingImg(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleCreateHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !hwTitle.trim()) return;
    setHwFormError(null);

    const parsedSkills = hwSkills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (hwScope === 'class') {
      const cls = classMap.get(hwClassId);
      if (!cls) {
        setHwFormError('Vui lòng chọn lớp học để giao bài tập.');
        return;
      }
      setSavingHw(true);
      try {
        const id = await createHomework(workspaceTeacherId, cls, {
          title: hwTitle,
          description: hwDesc,
          scope: 'class',
          dueDate: hwDueDate,
          attachmentUrl: hwAttachmentUrl,
          attachmentName: hwAttachmentName,
          targetSkills: parsedSkills,
        });
        setSelectedHwId(id);
        setShowHwModal(false);
        setHwTitle('');
        setHwDesc('');
        setHwSkills('');
        setHwAttachmentUrl('');
        setHwAttachmentName('');
        setHwStudentIds([]);
        setNotice(`Đã giao bài tập chung cho lớp ${cls.name}.`);
      } finally {
        setSavingHw(false);
      }
      return;
    }

    // Multi-student assignment via 1 shared form
    if (selectedStudentObjects.length === 0) {
      setHwFormError('Vui lòng tích chọn ít nhất 1 học sinh để giao bài tập.');
      return;
    }

    setSavingHw(true);
    try {
      if (hwClassId && hwClassId !== ALL_CLASSES_FILTER) {
        const cls = classMap.get(hwClassId);
        if (!cls) {
          setHwFormError('Không tìm thấy lớp học đã chọn.');
          return;
        }
        const id = await createHomework(workspaceTeacherId, cls, {
          title: hwTitle,
          description: hwDesc,
          scope: 'individual',
          assignedStudents: selectedStudentObjects,
          dueDate: hwDueDate,
          attachmentUrl: hwAttachmentUrl,
          attachmentName: hwAttachmentName,
          targetSkills: parsedSkills,
        });
        setSelectedHwId(id);
        setNotice(
          selectedStudentObjects.length === 1
            ? `Đã giao bài tập riêng cho em ${selectedStudentObjects[0].fullName}.`
            : `Đã giao chung 1 bài tập cho ${selectedStudentObjects.length} học sinh đã chọn trong lớp ${cls.name}.`
        );
      } else {
        // Group chosen students across multiple classes by their primary active class
        const fallbackClass = activeClasses[0] ?? classes[0];
        if (!fallbackClass) {
          setHwFormError('Cần có ít nhất 1 lớp học trước khi giao bài tập.');
          return;
        }
        const groupedByClass = new Map<string, Student[]>();
        for (const st of selectedStudentObjects) {
          const enrolledIds = studentActiveClassIdsMap.get(st.id) ?? [];
          const targetClassId =
            enrolledIds.find((cid) => classMap.has(cid)) ?? fallbackClass.id;
          const bucket = groupedByClass.get(targetClassId) ?? [];
          bucket.push(st);
          groupedByClass.set(targetClassId, bucket);
        }

        const createdIds = await Promise.all(
          Array.from(groupedByClass.entries()).map(([cid, groupStudents]) => {
            const cls = classMap.get(cid) ?? fallbackClass;
            return createHomework(workspaceTeacherId, cls, {
              title: hwTitle,
              description: hwDesc,
              scope: 'individual',
              assignedStudents: groupStudents,
              dueDate: hwDueDate,
              attachmentUrl: hwAttachmentUrl,
              attachmentName: hwAttachmentName,
              targetSkills: parsedSkills,
            });
          })
        );

        if (createdIds[0]) setSelectedHwId(createdIds[0]);
        setNotice(
          groupedByClass.size > 1
            ? `Đã giao bài tập cho ${selectedStudentObjects.length} học sinh thuộc ${groupedByClass.size} lớp học qua 1 lần nhập.`
            : `Đã giao bài tập cho ${selectedStudentObjects.length} học sinh đã chọn.`
        );
      }

      setShowHwModal(false);
      setHwTitle('');
      setHwDesc('');
      setHwSkills('');
      setHwAttachmentUrl('');
      setHwAttachmentName('');
      setHwStudentIds([]);
      setHwStudentSearch('');
    } finally {
      setSavingHw(false);
    }
  };

  const handleGrade = async (studentId: string) => {
    if (!workspaceTeacherId || !selectedHw) return;
    const st = studentMap.get(studentId);
    if (!st) return;
    const key = `${selectedHw.id}_${studentId}`;
    const existing = submissions.find((s) => s.homeworkId === selectedHw.id && s.studentId === studentId);
    const feedback = feedbackDraft[key] ?? existing?.teacherFeedback ?? '';
    const scoreRaw = scoreDraft[key] ?? (existing?.score !== undefined ? String(existing.score) : '');
    await gradeHomeworkSubmission(workspaceTeacherId, selectedHw, st, {
      status: 'reviewed',
      teacherFeedback: feedback,
      score: scoreRaw.trim() !== '' ? Number(scoreRaw) : undefined,
    });
    setNotice(`Đã lưu nhận xét bài làm cho em ${st.fullName}.`);
  };

  const handleGradeAllDrafted = async () => {
    if (!workspaceTeacherId || !selectedHw) return;
    const studentsWithInput = targetStudentsForSelectedHw.filter((st) => {
      const key = `${selectedHw.id}_${st.id}`;
      return feedbackDraft[key] !== undefined || scoreDraft[key] !== undefined;
    });
    const targets = studentsWithInput.length > 0 ? studentsWithInput : targetStudentsForSelectedHw;
    if (targets.length === 0) return;

    setSavingAllGrades(true);
    try {
      await Promise.all(
        targets.map((st) => {
          const key = `${selectedHw.id}_${st.id}`;
          const existing = submissions.find(
            (s) => s.homeworkId === selectedHw.id && s.studentId === st.id
          );
          const feedback = feedbackDraft[key] ?? existing?.teacherFeedback ?? '';
          const scoreRaw =
            scoreDraft[key] ?? (existing?.score !== undefined ? String(existing.score) : '');
          return gradeHomeworkSubmission(workspaceTeacherId, selectedHw, st, {
            status: 'reviewed',
            teacherFeedback: feedback,
            score: scoreRaw.trim() !== '' ? Number(scoreRaw) : undefined,
          });
        })
      );
      setNotice(`Đã lưu nhận xét bài tập cho ${targets.length} học sinh.`);
    } finally {
      setSavingAllGrades(false);
    }
  };

  const handleCopyText = async (key: string, text: string, feedbackMsg?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      if (feedbackMsg) setNotice(feedbackMsg);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2200);
    } catch {
      setNotice('Không thể tự động sao chép. Vui lòng chọn và sao chép trực tiếp nội dung.');
    }
  };

  // Current Zalo message & target parent list (uses live draft if typing, otherwise the last saved/loaded notification)
  const currentZaloSource = useMemo(() => {
    if (notiTitle.trim() || notiBody.trim()) {
      return {
        classId: notiClassId,
        title: notiTitle,
        body: notiBody,
        category: notiCategory,
      };
    }
    return activeZaloDispatch;
  }, [notiClassId, notiTitle, notiBody, notiCategory, activeZaloDispatch]);

  const currentZaloText = useMemo(() => {
    if (!currentZaloSource) return '';
    return buildNotificationZaloText({
      title: currentZaloSource.title,
      body: currentZaloSource.body,
      className: currentZaloSource.classId ? classMap.get(currentZaloSource.classId)?.name : undefined,
      category: currentZaloSource.category,
    });
  }, [currentZaloSource, classMap]);

  const zaloTargetStudents = useMemo(() => {
    const targetClassId = currentZaloSource?.classId ?? notiClassId;
    if (!targetClassId) {
      return students
        .filter((s) => s.status === 'active')
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    }
    const ids = new Set(
      enrollments
        .filter((e) => e.classId === targetClassId && e.status === 'active')
        .map((e) => e.studentId)
    );
    return students
      .filter((s) => ids.has(s.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [currentZaloSource, notiClassId, students, enrollments]);

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !notiTitle.trim() || !notiBody.trim()) return;
    setSendingNoti(true);
    try {
      const targetClass = classMap.get(notiClassId);
      const recipients = targetClass
        ? targetClass.memberEmails
        : Array.from(new Set(classes.flatMap((c) => c.memberEmails)));
      const recipientUids = targetClass
        ? targetClass.memberUids || []
        : Array.from(new Set(classes.flatMap((c) => c.memberUids || [])));
      await createNotification(workspaceTeacherId, {
        classId: notiClassId || '',
        title: notiTitle,
        body: notiBody,
        category: notiCategory,
        recipientEmails: recipients,
        recipientUids,
      });
      const savedDispatch = {
        classId: notiClassId || '',
        title: notiTitle,
        body: notiBody,
        category: notiCategory,
      };
      setActiveZaloDispatch(savedDispatch);
      setSentZaloStudentIds({});
      const formatted = buildNotificationZaloText({
        title: savedDispatch.title,
        body: savedDispatch.body,
        className: targetClass?.name,
        category: savedDispatch.category,
      });
      try {
        await navigator.clipboard.writeText(formatted);
      } catch {
        // Ignore clipboard errors on restricted contexts
      }
      setNotiTitle('');
      setNotiBody('');
      setNotice(
        'Đã lưu lịch sử thông báo và tự động sao chép nội dung — bạn có thể dán ngay vào nhóm Zalo hoặc nhấn Mở Zalo từng phụ huynh bên phải!'
      );
    } finally {
      setSendingNoti(false);
    }
  };

  const formatHomeworkAudience = (hw: HomeworkRecord): string => {
    if (hw.scope === 'class') return 'Cả lớp';
    const assignedIds = getHomeworkAssignedStudentIds(hw);
    if (assignedIds.length === 0) return 'Giao riêng';
    if (assignedIds.length === 1) {
      return `Giao riêng: ${studentMap.get(assignedIds[0])?.fullName ?? '1 học sinh'}`;
    }
    const previewNames = assignedIds
      .slice(0, 2)
      .map((id) => studentMap.get(id)?.fullName)
      .filter(Boolean)
      .join(', ');
    const remaining = assignedIds.length - 2;
    return `Nhóm ${assignedIds.length} HS${
      previewNames ? `: ${previewNames}${remaining > 0 ? ` +${remaining}` : ''}` : ''
    }`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bài tập &amp; Thông báo</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Chọn nhiều học sinh cùng lúc hoặc cả lớp để giao bài tập qua một biểu mẫu chung, theo dõi bài nộp và nhận xét
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openCreateHomeworkModal('individual')}
            className="min-h-[44px] px-4 rounded-xl bg-[#DB2777] text-white text-sm font-medium hover:bg-[#BE185D] inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Giao bài tập mới</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold hover:underline shrink-0">
            Đóng
          </button>
        </div>
      )}

      {/* Segmented Tabs */}
      <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-pink-50 border border-pink-100">
        <button
          type="button"
          onClick={() => setActiveTab('homework')}
          className={`min-h-[40px] px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'homework' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <ClipboardList className="w-4 h-4 text-[#DB2777]" />
          <span>Quản lý bài tập ({homework.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('notifications')}
          className={`min-h-[40px] px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
            activeTab === 'notifications' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
          }`}
        >
          <Bell className="w-4 h-4 text-[#15803D]" />
          <span>Thông báo Zalo PH ({notifications.length})</span>
        </button>
      </div>

      {activeTab === 'homework' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Homework list */}
          <section className="lg:col-span-4 space-y-2.5">
            {sortedHomework.length === 0 ? (
              <div className="rounded-2xl bg-white border border-pink-100 p-6 text-center text-sm text-slate-500">
                Chưa có bài tập nào được giao.
              </div>
            ) : (
              sortedHomework.map((hw) => {
                const isSelected = selectedHw?.id === hw.id;
                return (
                  <button
                    key={hw.id}
                    type="button"
                    onClick={() => setSelectedHwId(hw.id)}
                    className={`w-full text-left rounded-2xl p-4 border transition-colors cursor-pointer ${
                      isSelected ? 'bg-[#FFF1F5] border-[#DB2777]' : 'bg-white border-pink-100 hover:border-pink-200'
                    }`}
                  >
                    <p className="text-sm font-semibold text-slate-900">{hw.title}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {classMap.get(hw.classId)?.name} · {formatHomeworkAudience(hw)}
                    </p>
                    <p className="mt-1 text-xs font-mono-num text-[#BE185D]">Hạn nộp: {hw.dueDate}</p>
                  </button>
                );
              })
            )}
          </section>

          {/* Homework Details & Submissions */}
          <section className="lg:col-span-8">
            {!selectedHw ? (
              <div className="rounded-2xl bg-white border border-pink-100 p-10 text-center text-sm text-slate-500">
                Chọn một bài tập bên trái để xem chi tiết và chấm bài nộp.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-slate-500">
                        {classMap.get(selectedHw.classId)?.name} ·{' '}
                        {selectedHw.scope === 'class'
                          ? 'Bài tập chung cả lớp'
                          : getHomeworkAssignedStudentIds(selectedHw).length > 1
                          ? `Giao cho ${getHomeworkAssignedStudentIds(selectedHw).length} học sinh được chọn`
                          : 'Bài tập cá nhân'}{' '}
                        · Hạn nộp{' '}
                        <span className="font-mono-num text-[#BE185D] font-semibold">{selectedHw.dueDate}</span>
                      </p>
                      <h2 className="mt-1 text-lg font-bold text-slate-900">{selectedHw.title}</h2>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopyText(
                            `hw_zalo_${selectedHw.id}`,
                            buildHomeworkZaloText(
                              selectedHw,
                              classMap.get(selectedHw.classId)?.name ?? '',
                              targetStudentsForSelectedHw
                            ),
                            'Đã sao chép tin nhắn giao bài tập — dán ngay vào nhóm Zalo phụ huynh!'
                          )
                        }
                        className="min-h-[38px] px-3 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>
                          {copiedKey === `hw_zalo_${selectedHw.id}`
                            ? 'Đã chép Zalo!'
                            : 'Sao chép gửi Zalo'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDeleteHwId({ id: selectedHw.id, title: selectedHw.title })
                        }
                        className="min-h-[38px] min-w-[38px] rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer shrink-0"
                        aria-label="Xóa bài tập"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {selectedHw.scope === 'individual' && targetStudentsForSelectedHw.length > 1 && (
                    <div className="rounded-xl bg-[#FDFBFC] border border-pink-100 px-3 py-2 text-xs text-slate-700">
                      <span className="font-semibold text-[#BE185D]">Danh sách học sinh nhận bài: </span>
                      {targetStudentsForSelectedHw.map((st) => st.fullName).join(', ')}
                    </div>
                  )}
                  {selectedHw.description && (
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                      {selectedHw.description}
                    </p>
                  )}
                  {selectedHw.targetSkills && selectedHw.targetSkills.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Kiến thức trọng tâm (sẵn sàng AI cá nhân hóa):{' '}
                      <span className="text-slate-800 font-medium">{selectedHw.targetSkills.join(' · ')}</span>
                    </p>
                  )}
                  {selectedHw.attachmentUrl && (
                    <div className="pt-2">
                      <a
                        href={selectedHw.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-xs font-semibold text-[#BE185D] hover:underline"
                      >
                        <ImageIcon className="w-4 h-4" />
                        <span>{selectedHw.attachmentName || 'Xem ảnh đính kèm'}</span>
                      </a>
                    </div>
                  )}
                </div>

                {/* Submissions Table */}
                <div className="rounded-2xl bg-white border border-pink-100 p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-slate-900">
                      Trạng thái nộp bài &amp; Nhận xét ({targetStudentsForSelectedHw.length} học sinh)
                    </h3>
                    {targetStudentsForSelectedHw.length > 1 && (
                      <button
                        type="button"
                        onClick={() => void handleGradeAllDrafted()}
                        disabled={savingAllGrades}
                        className="min-h-[38px] px-3.5 rounded-xl bg-[#15803D] text-white text-xs font-semibold hover:bg-emerald-800 disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>{savingAllGrades ? 'Đang lưu...' : 'Lưu tất cả nhận xét'}</span>
                      </button>
                    )}
                  </div>
                  <div className="divide-y divide-pink-50">
                    {targetStudentsForSelectedHw.map((st) => {
                      const sub = submissions.find(
                        (s) => s.homeworkId === selectedHw.id && s.studentId === st.id
                      );
                      const key = `${selectedHw.id}_${st.id}`;
                      return (
                        <div key={st.id} className="py-4 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-900">
                              {st.fullName}{' '}
                              <span className="text-xs font-mono-num font-normal text-slate-500">
                                · {st.studentCode}
                              </span>
                            </p>
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
                                ? 'Đã nhận xét'
                                : sub?.status === 'submitted'
                                ? 'Đã nộp bài'
                                : 'Chưa nộp'}
                            </span>
                          </div>

                          {sub?.answerText && (
                            <p className="text-xs text-slate-700 bg-[#FDFBFC] border border-pink-100 rounded-xl p-3 whitespace-pre-line">
                              Bài làm của học sinh: {sub.answerText}
                            </p>
                          )}

                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            <input
                              type="text"
                              value={feedbackDraft[key] ?? sub?.teacherFeedback ?? ''}
                              onChange={(e) => setFeedbackDraft((p) => ({ ...p, [key]: e.target.value }))}
                              placeholder="Nhận xét bài làm của giáo viên..."
                              className="sm:col-span-7 min-h-[40px] rounded-xl border border-pink-200 px-3 text-xs"
                            />
                            <input
                              type="number"
                              step="0.5"
                              min={0}
                              max={100}
                              value={scoreDraft[key] ?? (sub?.score !== undefined ? String(sub.score) : '')}
                              onChange={(e) => setScoreDraft((p) => ({ ...p, [key]: e.target.value }))}
                              placeholder="Điểm"
                              className="sm:col-span-2 min-h-[40px] rounded-xl border border-pink-200 px-2.5 text-xs font-mono-num"
                            />
                            <button
                              type="button"
                              onClick={() => void handleGrade(st.id)}
                              className="sm:col-span-3 min-h-[40px] rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Lưu nhận xét</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Zalo Announcement Composer */}
          <form
            onSubmit={(e) => void handleSendNotification(e)}
            className="lg:col-span-5 rounded-2xl bg-white border border-pink-100 p-5 space-y-4 h-fit"
          >
            <div>
              <h2 className="text-base font-bold text-slate-900">Soạn thông báo gửi Zalo phụ huynh</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Phụ huynh không cần tải app — soạn 1 lần, sao chép gửi nhóm Zalo hoặc bấm mở Zalo từng phụ huynh.
              </p>
            </div>

            {/* Quick Templates */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-500">Mẫu soạn nhanh:</p>
              <div className="flex flex-wrap gap-1.5">
                {ZALO_NOTIFICATION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    onClick={() => {
                      setNotiCategory(tpl.category);
                      setNotiTitle(tpl.title);
                      setNotiBody(tpl.body);
                    }}
                    className="min-h-[32px] px-2.5 rounded-lg bg-pink-50 border border-pink-100 text-xs font-medium text-[#BE185D] hover:bg-pink-100 cursor-pointer"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Lớp nhận thông báo</label>
              <select
                value={notiClassId}
                onChange={(e) => setNotiClassId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
              >
                <option value="">Tất cả các lớp đang dạy</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    Lớp: {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Phân loại</label>
              <select
                value={notiCategory}
                onChange={(e) => setNotiCategory(e.target.value as NotificationCategory)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
              >
                <option value="general">Thông báo chung</option>
                <option value="schedule">Lịch học / Học bù</option>
                <option value="homework">Nhắc bài tập</option>
                <option value="review">Nhận xét / Kiểm tra</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tiêu đề *</label>
              <input
                type="text"
                value={notiTitle}
                onChange={(e) => setNotiTitle(e.target.value)}
                placeholder="VD: Thông báo lịch học bù thứ 5 tuần này"
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Nội dung tin nhắn Zalo *</label>
              <textarea
                rows={5}
                value={notiBody}
                onChange={(e) => setNotiBody(e.target.value)}
                placeholder="Nhập nội dung gửi phụ huynh..."
                className="w-full rounded-xl border border-pink-200 p-3 text-sm leading-relaxed"
                required
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="submit"
                disabled={sendingNoti}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>{sendingNoti ? 'Đang lưu...' : 'Lưu & Sao chép Zalo'}</span>
              </button>
              {currentZaloText && (
                <button
                  type="button"
                  onClick={() =>
                    void handleCopyText(
                      'zalo_draft_copy',
                      currentZaloText,
                      'Đã sao chép tin nhắn — dán ngay vào nhóm Zalo lớp!'
                    )
                  }
                  className="min-h-[44px] px-3.5 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Copy className="w-4 h-4" />
                  <span>{copiedKey === 'zalo_draft_copy' ? 'Đã chép!' : 'Chép ngay'}</span>
                </button>
              )}
            </div>
          </form>

          {/* Right: Live Zalo Dispatch Panel + History */}
          <div className="lg:col-span-7 space-y-5">
            {/* Live Zalo Send Hub */}
            <section className="rounded-2xl bg-white border border-emerald-200 p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-[#15803D]" />
                    <span>Gửi nhanh qua Zalo ({zaloTargetStudents.length} phụ huynh)</span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Bấm <strong>Sao chép gửi nhóm Zalo</strong> hoặc bấm <strong>Mở Zalo</strong> từng phụ huynh (tự động sao chép sẵn nội dung).
                  </p>
                </div>
                {currentZaloText && (
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopyText(
                        'zalo_group_copy',
                        currentZaloText,
                        'Đã sao chép thông báo — bạn có thể dán ngay vào nhóm Zalo lớp!'
                      )
                    }
                    className="min-h-[40px] px-3.5 rounded-xl bg-[#15803D] text-white text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>
                      {copiedKey === 'zalo_group_copy' ? 'Đã sao chép!' : 'Sao chép gửi nhóm Zalo'}
                    </span>
                  </button>
                )}
              </div>

              {currentZaloText ? (
                <pre className="rounded-xl bg-[#FDFBFC] border border-pink-100 p-3.5 text-xs sm:text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed max-h-48 overflow-y-auto">
                  {currentZaloText}
                </pre>
              ) : (
                <div className="rounded-xl bg-[#FDFBFC] border border-dashed border-pink-200 p-4 text-xs text-slate-500 text-center">
                  Chọn mẫu nhanh hoặc gõ nội dung ở bên trái để xem trước tin nhắn Zalo và gửi tới từng phụ huynh.
                </div>
              )}

              {/* Per-Parent Zalo Dispatch List */}
              {zaloTargetStudents.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">
                      Gửi riêng từng phụ huynh (
                      {Object.values(sentZaloStudentIds).filter(Boolean).length}/{zaloTargetStudents.length} đã gửi)
                    </span>
                    {Object.values(sentZaloStudentIds).some(Boolean) && (
                      <button
                        type="button"
                        onClick={() => setSentZaloStudentIds({})}
                        className="text-xs text-[#BE185D] hover:underline cursor-pointer"
                      >
                        Đặt lại dấu tick
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-pink-50 rounded-xl border border-pink-100">
                    {zaloTargetStudents.map((st) => {
                      const motherZalo = toZaloUrl(st.motherPhone);
                      const fatherZalo = toZaloUrl(st.fatherPhone);
                      const primaryZalo = motherZalo || fatherZalo;
                      const isSent = Boolean(sentZaloStudentIds[st.id]);

                      return (
                        <div
                          key={st.id}
                          className={`p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                            isSent ? 'bg-emerald-50/40' : 'bg-white'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-slate-900 truncate">{st.fullName}</p>
                              {isSent && (
                                <span className="text-[11px] font-semibold text-[#15803D] inline-flex items-center gap-0.5">
                                  <Check className="w-3 h-3" />
                                  <span>Đã gửi</span>
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 truncate">
                              {/^phụ huynh/i.test(st.parentName)
                                ? st.parentName
                                : `Phụ huynh ${st.fullName}`}
                              {st.motherPhone ? ` · Mẹ: ${formatPhoneReadable(st.motherPhone)}` : ''}
                              {st.fatherPhone ? ` · Bố: ${formatPhoneReadable(st.fatherPhone)}` : ''}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {primaryZalo ? (
                              <>
                                <a
                                  href={primaryZalo}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => {
                                    if (currentZaloText) {
                                      void handleCopyText(
                                        `zalo_st_${st.id}`,
                                        currentZaloText,
                                        `Đã sao chép thông báo và mở Zalo phụ huynh em ${st.fullName}!`
                                      );
                                    }
                                    setSentZaloStudentIds((prev) => ({ ...prev, [st.id]: true }));
                                  }}
                                  className="min-h-[34px] px-3 rounded-lg bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span>{motherZalo ? 'Chép & Mở Zalo mẹ' : 'Chép & Mở Zalo bố'}</span>
                                </a>
                                {motherZalo && fatherZalo && (
                                  <a
                                    href={fatherZalo}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => {
                                      if (currentZaloText) {
                                        void handleCopyText(
                                          `zalo_st_dad_${st.id}`,
                                          currentZaloText,
                                          `Đã sao chép thông báo và mở Zalo bố em ${st.fullName}!`
                                        );
                                      }
                                      setSentZaloStudentIds((prev) => ({ ...prev, [st.id]: true }));
                                    }}
                                    className="min-h-[34px] px-2.5 rounded-lg border border-emerald-200 bg-white text-[#15803D] text-xs font-medium hover:bg-emerald-50 inline-flex items-center gap-1"
                                  >
                                    <Phone className="w-3 h-3" />
                                    <span>Zalo bố</span>
                                  </a>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-slate-400 italic">Chưa có SĐT Zalo PH</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {/* Saved Notification History */}
            <section className="rounded-2xl bg-white border border-pink-100 p-5 space-y-3">
              <h2 className="text-base font-bold text-slate-900">Lịch sử thông báo đã soạn</h2>
              {notifications.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">Chưa có thông báo nào được lưu.</p>
              ) : (
                <div className="divide-y divide-pink-50">
                  {notifications.map((n) => {
                    const clsName = n.classId ? classMap.get(n.classId)?.name : undefined;
                    const formattedZalo = buildNotificationZaloText({
                      title: n.title,
                      body: n.body,
                      className: clsName,
                      category: n.category,
                    });
                    return (
                      <div key={n.id} className="py-3.5 space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {clsName ?? 'Tất cả các lớp'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyText(
                                  `hist_${n.id}`,
                                  formattedZalo,
                                  'Đã sao chép thông báo — dán ngay vào Zalo!'
                                )
                              }
                              className="min-h-[32px] px-2.5 rounded-lg bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copiedKey === `hist_${n.id}` ? 'Đã chép' : 'Chép Zalo'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveZaloDispatch({
                                  classId: n.classId || '',
                                  title: n.title,
                                  body: n.body,
                                  category: n.category,
                                });
                                setNotiClassId(n.classId || '');
                                setNotiTitle('');
                                setNotiBody('');
                                setSentZaloStudentIds({});
                                setNotice('Đã nạp thông báo lên khung Gửi nhanh qua Zalo bên trên.');
                              }}
                              className="min-h-[32px] px-2.5 rounded-lg border border-pink-200 bg-white text-[#BE185D] text-xs font-semibold hover:bg-pink-50 cursor-pointer"
                            >
                              Gửi từng PH
                            </button>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{n.body}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* Create Homework Modal (Unified Multi-Student & Class Form) */}
      {showHwModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={(e) => void handleCreateHomework(e)}
            className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-pink-100"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Giao bài tập mới</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chọn nhiều học sinh cùng lúc hoặc cả lớp để giao chung qua một biểu mẫu duy nhất
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHwModal(false)}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {hwFormError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-800">
                {hwFormError}
              </div>
            )}

            {/* Scope Toggle */}
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-pink-50 border border-pink-100">
              <button
                type="button"
                onClick={() => {
                  setHwScope('individual');
                  setHwFormError(null);
                }}
                className={`min-h-[42px] rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  hwScope === 'individual'
                    ? 'bg-white text-[#BE185D] shadow-xs border border-pink-100'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-4 h-4" />
                <span>Chọn nhiều học sinh</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setHwScope('class');
                  setHwFormError(null);
                  if (!hwClassId || hwClassId === ALL_CLASSES_FILTER) {
                    setHwClassId(activeClasses[0]?.id ?? '');
                  }
                }}
                className={`min-h-[42px] rounded-lg text-xs sm:text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  hwScope === 'class'
                    ? 'bg-white text-[#15803D] shadow-xs border border-emerald-100'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ClipboardList className="w-4 h-4" />
                <span>Giao chung cả lớp</span>
              </button>
            </div>

            {/* Class selector */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {hwScope === 'class' ? 'Lớp học *' : 'Lọc danh sách học sinh theo lớp'}
              </label>
              <select
                value={hwClassId}
                onChange={(e) => handleClassFilterChange(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                required={hwScope === 'class'}
              >
                {hwScope === 'individual' ? (
                  <option value={ALL_CLASSES_FILTER}>
                    Tất cả các lớp (chọn học sinh từ nhiều lớp cùng lúc)
                  </option>
                ) : (
                  <option value="">Chọn lớp...</option>
                )}
                {activeClasses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Multi-Student Selector Box */}
            {hwScope === 'individual' && (
              <div className="rounded-2xl border border-pink-200 bg-[#FDFBFC] p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-semibold text-slate-800">
                    Chọn học sinh nhận bài tập{' '}
                    <span className="font-mono-num text-[#BE185D]">
                      (Đã chọn {hwStudentIds.length} em)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleToggleSelectAllVisible}
                      disabled={selectableStudentsForForm.length === 0}
                      className="min-h-[34px] px-2.5 rounded-lg bg-white border border-pink-200 text-xs font-semibold text-[#BE185D] hover:bg-pink-50 disabled:opacity-40 cursor-pointer"
                    >
                      {allVisibleSelected
                        ? 'Bỏ chọn danh sách này'
                        : `Chọn tất cả (${selectableStudentsForForm.length})`}
                    </button>
                    {hwStudentIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setHwStudentIds([])}
                        className="min-h-[34px] px-2.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 cursor-pointer"
                      >
                        Xóa chọn
                      </button>
                    )}
                  </div>
                </div>

                {/* Search students */}
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={hwStudentSearch}
                    onChange={(e) => setHwStudentSearch(e.target.value)}
                    placeholder="Tìm nhanh theo tên, mã HS hoặc lớp chính khóa..."
                    className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-pink-200 bg-white text-xs sm:text-sm"
                  />
                </div>

                {/* Checkbox list */}
                <div className="max-h-52 overflow-y-auto rounded-xl border border-pink-100 bg-white divide-y divide-pink-50">
                  {selectableStudentsForForm.length === 0 ? (
                    <p className="py-6 text-center text-xs text-slate-500">
                      Không có học sinh nào phù hợp trong lớp này.
                    </p>
                  ) : (
                    selectableStudentsForForm.map((st) => {
                      const checked = hwStudentIds.includes(st.id);
                      const enrolledNames = (studentActiveClassIdsMap.get(st.id) ?? [])
                        .map((cid) => classMap.get(cid)?.name)
                        .filter(Boolean)
                        .join(', ');
                      return (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => toggleStudentSelection(st.id)}
                          className={`w-full min-h-[44px] px-3 py-2 text-left flex items-center gap-3 transition-colors cursor-pointer ${
                            checked ? 'bg-[#FFF1F5]' : 'hover:bg-pink-50/40'
                          }`}
                        >
                          {checked ? (
                            <CheckSquare className="w-4 h-4 text-[#DB2777] shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900 truncate">
                                {st.fullName}
                              </span>
                              <span className="text-[11px] font-mono-num text-slate-500 shrink-0">
                                {st.studentCode}
                              </span>
                            </div>
                            {(enrolledNames || st.schoolClass) && (
                              <p className="text-[11px] text-slate-500 truncate">
                                {enrolledNames || st.schoolClass}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>

                {/* Selected students summary tags */}
                {selectedStudentObjects.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selectedStudentObjects.map((st) => (
                      <span
                        key={st.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-[#FFF1F5] border border-pink-200 px-2.5 py-1 text-xs font-medium text-[#BE185D]"
                      >
                        <span>{st.fullName}</span>
                        <button
                          type="button"
                          onClick={() => toggleStudentSelection(st.id)}
                          aria-label={`Bỏ chọn ${st.fullName}`}
                          className="hover:text-rose-800 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tiêu đề bài tập *</label>
              <input
                type="text"
                value={hwTitle}
                onChange={(e) => setHwTitle(e.target.value)}
                placeholder="VD: Phiếu bài tập tuần 14 – Hình học đường tròn"
                className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3.5 text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Hướng dẫn &amp; nội dung chi tiết
              </label>
              <textarea
                rows={3}
                value={hwDesc}
                onChange={(e) => setHwDesc(e.target.value)}
                placeholder="Nhập đề bài, yêu cầu trình bày hoặc ghi chú chung cho tất cả học sinh được chọn..."
                className="w-full rounded-xl border border-pink-200 p-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Hạn nộp *</label>
                <input
                  type="date"
                  value={hwDueDate}
                  onChange={(e) => setHwDueDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Kiến thức trọng tâm (phân cách bằng dấu phẩy)
                </label>
                <input
                  type="text"
                  value={hwSkills}
                  onChange={(e) => setHwSkills(e.target.value)}
                  placeholder="Vi-ét, Hệ phương trình"
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-slate-700">
                Đính kèm hình ảnh đề bài (tùy chọn)
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => void handleUploadImage(e)}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadingImg}
                  className="min-h-[42px] px-3.5 rounded-xl border border-pink-200 bg-pink-50 text-[#BE185D] text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploadingImg ? 'Đang tải...' : 'Tải ảnh lên Cloud Storage'}</span>
                </button>
                <input
                  type="url"
                  value={hwAttachmentUrl}
                  onChange={(e) => setHwAttachmentUrl(e.target.value)}
                  placeholder="Hoặc dán liên kết ảnh https://..."
                  className="flex-1 min-h-[42px] rounded-xl border border-pink-200 px-3 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowHwModal(false)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={savingHw || (hwScope === 'individual' && hwStudentIds.length === 0)}
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold hover:bg-[#BE185D] disabled:opacity-45 cursor-pointer"
              >
                {savingHw
                  ? 'Đang giao...'
                  : hwScope === 'class'
                  ? 'Giao bài cho cả lớp'
                  : hwStudentIds.length > 0
                  ? `Giao bài cho ${hwStudentIds.length} học sinh`
                  : 'Chọn học sinh để giao bài'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Delete Homework Modal */}
      {confirmDeleteHwId && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-rose-100 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Xác nhận xóa bài tập</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Bạn có chắc muốn xóa bài tập <strong>{confirmDeleteHwId.title}</strong>?
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmDeleteHwId(null)}
                disabled={deletingHw}
                className="min-h-[36px] min-w-[36px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteHwId(null)}
                disabled={deletingHw}
                className="min-h-[42px] px-4 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={async () => {
                  setDeletingHw(true);
                  try {
                    await deleteHomework(confirmDeleteHwId.id);
                    setSelectedHwId('');
                    setConfirmDeleteHwId(null);
                    setNotice('Đã xóa bài tập.');
                  } catch (err) {
                    setNotice(err instanceof Error ? err.message : 'Không thể xóa bài tập.');
                  } finally {
                    setDeletingHw(false);
                  }
                }}
                disabled={deletingHw}
                className="min-h-[42px] px-5 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
              >
                {deletingHw ? 'Đang xóa...' : 'Xóa bài tập'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
