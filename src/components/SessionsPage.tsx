import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookCheck,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  LayoutGrid,
  Lock,
  MessageSquareText,
  Phone,
  Plus,
  RefreshCw,
  Save,
  Send,
  Share2,
  Sparkles,
  Table2,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { formatPhoneReadable, toZaloUrl } from '../lib/firebase';
import {
  confirmParentMessageSent,
  createOrOpenSession,
  getSessionPrivateNote,
  getStudentReviewPrivateNote,
  markAllPresent,
  saveSessionPrivateNote,
  saveStudentReviewPrivateNote,
  todayISO,
  updateSession,
  upsertAttendance,
  upsertParentMessage,
  upsertStudentReview,
} from '../services/firestoreService';
import {
  buildClassHomeworkReportText,
  buildStructuredParentMessage,
  synthesizeParentReviewWithAI,
  SynthesizeReviewRequest,
} from '../services/aiService';
import {
  ATTENDANCE_STATUS_VI,
  ATTITUDE_RATING_VI,
  AttendanceStatus,
  AttitudeRating,
  HOMEWORK_CHECK_VI,
  HomeworkCheckStatus,
  PARENT_MESSAGE_STATUS_VI,
  SessionType,
  Student,
} from '../types';

interface SessionsPageProps {
  initialSessionId?: string | null;
}

type WorkspaceTab = 'table' | 'homework_report' | 'messages';
type EntryViewMode = 'table' | 'cards';

interface StudentRowDraft {
  attendanceStatus: AttendanceStatus;
  attendanceReason: string;
  homeworkStatus: HomeworkCheckStatus;
  homeworkNote: string;
  attitudeRating: AttitudeRating;
  attitudeComment: string;
  testScoreText: string;
  testMaxScoreText: string;
  weakTopics: string;
  parentPrivateMessage: string;
  visibleToStudent: boolean;
}

function isAbsentStatus(status: AttendanceStatus): boolean {
  return status === 'absent_excused' || status === 'absent_unexcused';
}

function parseScoreText(raw: string): number | undefined {
  const trimmed = raw.trim().replace(',', '.');
  if (!trimmed) return undefined;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.min(1000, num);
}

export const SessionsPage: React.FC<SessionsPageProps> = ({ initialSessionId }) => {
  const {
    firebaseUser,
    workspaceTeacherId,
    teacherProfile,
    classes,
    students,
    enrollments,
    sessions,
    attendance,
    reviews,
    parentMessages,
  } = useApp();

  const [selectedSessionId, setSelectedSessionId] = useState<string>(initialSessionId || '');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('table');
  const [entryViewMode, setEntryViewMode] = useState<EntryViewMode>('table');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newClassId, setNewClassId] = useState('');
  const [newDate, setNewDate] = useState(todayISO());
  const [newStart, setNewStart] = useState('17:30');
  const [newEnd, setNewEnd] = useState('19:00');
  const [newType, setNewType] = useState<SessionType>('regular');

  // General session editable fields (auto-saved)
  const [lessonContent, setLessonContent] = useState('');
  const [homeworkSummary, setHomeworkSummary] = useState('');
  const [sessionPrivateNote, setSessionPrivateNote] = useState('');
  const [autoSaveText, setAutoSaveText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  // Batch review bar
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [batchHw, setBatchHw] = useState<HomeworkCheckStatus>('done');
  const [batchHwNote, setBatchHwNote] = useState('');
  const [batchAttitude, setBatchAttitude] = useState<AttitudeRating>('good');
  const [batchComment, setBatchComment] = useState('');
  const [applyingBatch, setApplyingBatch] = useState(false);

  // Isolated per-student table/card drafts keyed by `${sessionId}_${studentId}`
  const [rowDrafts, setRowDrafts] = useState<Record<string, StudentRowDraft>>({});
  const [dirtyRowKeys, setDirtyRowKeys] = useState<string[]>([]);
  const [savingRows, setSavingRows] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);

  // Per-student isolated states for card details, private notes & parent messages
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);
  const [studentPrivateNotes, setStudentPrivateNotes] = useState<Record<string, string>>({});
  const [aiDrafts, setAiDrafts] = useState<Record<string, string>>({});
  const [aiGeneratingId, setAiGeneratingId] = useState<string | null>(null);
  const [bulkAiProgress, setBulkAiProgress] = useState<{ current: number; total: number } | null>(null);
  const [bulkSavingMsgs, setBulkSavingMsgs] = useState(false);
  const [aiErrorByStudent, setAiErrorByStudent] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [focusedMessageStudentId, setFocusedMessageStudentId] = useState<string | null>(null);
  const [messageFilter, setMessageFilter] = useState<'all' | 'unsent' | 'sent'>('all');
  const [hwReportFilter, setHwReportFilter] = useState<'all' | 'attention' | 'completed' | 'absent'>('all');

  const [confirmSendStudent, setConfirmSendStudent] = useState<{
    student: Student;
    content: string;
  } | null>(null);
  const [sendChannel, setSendChannel] = useState('Zalo phụ huynh');
  const [confirmingSend, setConfirmingSend] = useState(false);

  const autoSaveTimerRef = useRef<number | null>(null);
  const hydratedSessionIdRef = useRef<string>('');

  useEffect(() => {
    if (initialSessionId) {
      setSelectedSessionId(initialSessionId);
    }
  }, [initialSessionId]);

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) =>
        `${b.sessionDate}_${b.startTime}`.localeCompare(`${a.sessionDate}_${a.startTime}`)
      ),
    [sessions]
  );

  const activeSession = useMemo(() => {
    return sessions.find((s) => s.id === selectedSessionId) ?? sortedSessions[0] ?? null;
  }, [sessions, selectedSessionId, sortedSessions]);

  // Hydrate general session fields + teacher private note when activeSession changes
  useEffect(() => {
    if (!activeSession) return;
    if (hydratedSessionIdRef.current !== activeSession.id) {
      hydratedSessionIdRef.current = activeSession.id;
      setLessonContent(activeSession.lessonContent ?? '');
      setHomeworkSummary(activeSession.homeworkSummary ?? '');
      setAutoSaveText('');
      setExpandedStudentId(null);
      setFocusedMessageStudentId(null);
      setDirtyRowKeys([]);
      void getSessionPrivateNote(activeSession.id).then((note) => setSessionPrivateNote(note));
    }
  }, [activeSession]);

  const sessionStudents = useMemo(() => {
    if (!activeSession) return [];
    const activeIds = new Set(
      enrollments
        .filter((e) => e.classId === activeSession.classId && e.status === 'active')
        .map((e) => e.studentId)
    );
    return students
      .filter((s) => activeIds.has(s.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [activeSession, enrollments, students]);

  const attendanceByStudent = useMemo(() => {
    const map = new Map<string, (typeof attendance)[number]>();
    if (!activeSession) return map;
    for (const a of attendance) {
      if (a.sessionId === activeSession.id) map.set(a.studentId, a);
    }
    return map;
  }, [attendance, activeSession]);

  const reviewByStudent = useMemo(() => {
    const map = new Map<string, (typeof reviews)[number]>();
    if (!activeSession) return map;
    for (const r of reviews) {
      if (r.sessionId === activeSession.id) map.set(r.studentId, r);
    }
    return map;
  }, [reviews, activeSession]);

  const parentMsgByStudent = useMemo(() => {
    const map = new Map<string, (typeof parentMessages)[number]>();
    if (!activeSession) return map;
    for (const m of parentMessages) {
      if (m.sessionId === activeSession.id) map.set(m.studentId, m);
    }
    return map;
  }, [parentMessages, activeSession]);

  // Build baseline row draft from Firestore data for a single student
  const getBaselineRow = (studentId: string): StudentRowDraft => {
    const att = attendanceByStudent.get(studentId);
    const rev = reviewByStudent.get(studentId);
    const attStatus: AttendanceStatus = att?.status ?? 'present';
    const absent = isAbsentStatus(attStatus);
    return {
      attendanceStatus: attStatus,
      attendanceReason: att?.reason ?? '',
      homeworkStatus: absent ? 'not_applicable' : rev?.homeworkStatus ?? 'done',
      homeworkNote: absent ? '' : rev?.homeworkNote ?? '',
      attitudeRating: absent ? 'not_applicable' : rev?.attitudeRating ?? 'good',
      attitudeComment: absent ? '' : rev?.attitudeComment ?? '',
      testScoreText: !absent && rev?.hasTestScore && rev?.testScore !== undefined ? String(rev.testScore) : '',
      testMaxScoreText: String(rev?.testMaxScore ?? 10),
      weakTopics: absent ? '' : rev?.weakTopics ?? '',
      parentPrivateMessage: rev?.parentPrivateMessage ?? '',
      visibleToStudent: rev?.visibleToStudent ?? true,
    };
  };

  // Sync Firestore state into rowDrafts for non-dirty rows only (never clobbering active typing)
  useEffect(() => {
    if (!activeSession) return;
    setRowDrafts((prev) => {
      const next = { ...prev };
      const dirtySet = new Set(dirtyRowKeys);
      for (const st of sessionStudents) {
        const key = `${activeSession.id}_${st.id}`;
        if (!dirtySet.has(key)) {
          next[key] = getBaselineRow(st.id);
        }
      }
      return next;
    });
  }, [activeSession, sessionStudents, attendanceByStudent, reviewByStudent, dirtyRowKeys]);

  // Sync saved parent messages into isolated local draft editor map (only when not edited locally)
  useEffect(() => {
    if (!activeSession) return;
    setAiDrafts((prev) => {
      const next = { ...prev };
      for (const st of sessionStudents) {
        const key = `${activeSession.id}_${st.id}`;
        const saved = parentMsgByStudent.get(st.id);
        if (saved && next[key] === undefined) {
          next[key] = saved.content;
        }
      }
      return next;
    });
  }, [activeSession, sessionStudents, parentMsgByStudent]);

  const getRow = (studentId: string): StudentRowDraft => {
    if (!activeSession) return getBaselineRow(studentId);
    const key = `${activeSession.id}_${studentId}`;
    return rowDrafts[key] ?? getBaselineRow(studentId);
  };

  const updateLocalRow = (studentId: string, patch: Partial<StudentRowDraft>): StudentRowDraft => {
    if (!activeSession) return getBaselineRow(studentId);
    const key = `${activeSession.id}_${studentId}`;
    const current = getRow(studentId);
    const merged: StudentRowDraft = { ...current, ...patch };
    if (patch.attendanceStatus !== undefined) {
      if (isAbsentStatus(patch.attendanceStatus)) {
        merged.homeworkStatus = 'not_applicable';
        merged.homeworkNote = '';
        merged.attitudeRating = 'not_applicable';
        merged.attitudeComment = '';
        merged.testScoreText = '';
        merged.weakTopics = '';
      } else if (isAbsentStatus(current.attendanceStatus)) {
        merged.homeworkStatus = 'done';
        merged.attitudeRating = 'good';
      }
    }
    setRowDrafts((prev) => ({ ...prev, [key]: merged }));
    setDirtyRowKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    return merged;
  };

  const persistRowToFirestore = async (student: Student, draftOverride?: StudentRowDraft): Promise<void> => {
    if (!workspaceTeacherId || !activeSession) return;
    const key = `${activeSession.id}_${student.id}`;
    const row = draftOverride ?? getRow(student.id);
    const absent = isAbsentStatus(row.attendanceStatus);
    const parsedScore = absent ? undefined : parseScoreText(row.testScoreText);
    const parsedMaxScore = parseScoreText(row.testMaxScoreText) ?? 10;

    setSavingStudentId(student.id);
    try {
      await Promise.all([
        upsertAttendance(
          workspaceTeacherId,
          activeSession,
          student,
          row.attendanceStatus,
          row.attendanceReason
        ),
        upsertStudentReview(workspaceTeacherId, activeSession, student, {
          homeworkStatus: absent ? 'not_applicable' : row.homeworkStatus,
          homeworkNote: absent ? '' : row.homeworkNote,
          attitudeRating: absent ? 'not_applicable' : row.attitudeRating,
          attitudeComment: absent ? '' : row.attitudeComment,
          hasTestScore: !absent && parsedScore !== undefined,
          testScore: parsedScore,
          testMaxScore: parsedMaxScore > 0 ? parsedMaxScore : 10,
          weakTopics: absent ? '' : row.weakTopics,
          parentPrivateMessage: row.parentPrivateMessage,
          visibleToStudent: row.visibleToStudent,
        }),
      ]);
      setDirtyRowKeys((prev) => prev.filter((k) => k !== key));
    } finally {
      setSavingStudentId((curr) => (curr === student.id ? null : curr));
    }
  };

  const handleSaveAllDirtyRows = async () => {
    if (!workspaceTeacherId || !activeSession) return;
    const targets =
      dirtyRowKeys.length > 0
        ? sessionStudents.filter((st) => dirtyRowKeys.includes(`${activeSession.id}_${st.id}`))
        : sessionStudents;
    if (targets.length === 0) return;

    setSavingRows(true);
    try {
      await Promise.all(targets.map((st) => persistRowToFirestore(st)));
      setNotice(`Đã lưu bảng điểm danh, BTVN và nhận xét cho ${targets.length} học sinh.`);
    } finally {
      setSavingRows(false);
    }
  };

  // Build full synthesis payload for a student using their latest live row state
  const buildStudentPayload = (student: Student): SynthesizeReviewRequest => {
    const row = getRow(student.id);
    const absent = isAbsentStatus(row.attendanceStatus);
    const parsedScore = absent ? undefined : parseScoreText(row.testScoreText);
    const parsedMaxScore = parseScoreText(row.testMaxScoreText) ?? 10;

    return {
      className: activeSession?.className ?? '',
      sessionDate: activeSession?.sessionDate ?? '',
      startTime: activeSession?.startTime ?? '',
      endTime: activeSession?.endTime ?? '',
      sessionType: activeSession?.sessionType ?? 'regular',
      lessonContent,
      homeworkSummary,
      studentName: student.fullName,
      parentName: student.parentName,
      attendanceStatus: row.attendanceStatus,
      attendanceReason: row.attendanceReason,
      homeworkStatus: absent ? 'not_applicable' : row.homeworkStatus,
      homeworkNote: absent ? '' : row.homeworkNote,
      attitudeRating: absent ? 'not_applicable' : row.attitudeRating,
      attitudeComment: absent ? '' : row.attitudeComment,
      hasTestScore: !absent && parsedScore !== undefined,
      testScore: !absent && parsedScore !== undefined ? parsedScore : null,
      testMaxScore: !absent && parsedScore !== undefined ? (parsedMaxScore > 0 ? parsedMaxScore : 10) : null,
      weakTopics: absent ? '' : row.weakTopics,
      parentPrivateMessage: row.parentPrivateMessage,
      teacherName: teacherProfile?.fullName || firebaseUser?.displayName || 'Giáo viên',
    };
  };

  // Always return a visible, ready-to-send parent message (saved/edited OR instant structured template)
  const getVisibleParentMessage = (student: Student): { text: string; isAutoPreview: boolean } => {
    if (!activeSession) return { text: '', isAutoPreview: true };
    const draftKey = `${activeSession.id}_${student.id}`;
    const saved = parentMsgByStudent.get(student.id);
    if (aiDrafts[draftKey] !== undefined) {
      return { text: aiDrafts[draftKey], isAutoPreview: false };
    }
    if (saved?.content) {
      return { text: saved.content, isAutoPreview: false };
    }
    return { text: buildStructuredParentMessage(buildStudentPayload(student)), isAutoPreview: true };
  };

  // Debounced auto-save for session general info + private teacher note
  const scheduleSessionAutoSave = (nextLesson: string, nextHw: string, nextPrivate: string) => {
    if (!activeSession || !workspaceTeacherId) return;
    setAutoSaveText('Đang lưu nháp...');
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(() => {
      void Promise.all([
        updateSession(activeSession.id, {
          lessonContent: nextLesson,
          homeworkSummary: nextHw,
        }),
        saveSessionPrivateNote(workspaceTeacherId, activeSession.id, nextPrivate),
      ]).then(() => {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        setAutoSaveText(`Đã tự lưu nháp lúc ${hh}:${mm}:${ss}`);
      });
    }, 650);
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceTeacherId || !newClassId) return;
    const cls = classes.find((c) => c.id === newClassId);
    if (!cls) return;
    const id = await createOrOpenSession(workspaceTeacherId, cls, {
      sessionDate: newDate,
      startTime: newStart,
      endTime: newEnd,
      sessionType: newType,
    });
    setSelectedSessionId(id);
    setShowCreateModal(false);
    setWorkspaceTab('table');
    setNotice('Đã mở buổi học mới. Bạn có thể nhập nhanh cả lớp ngay trên bảng bên dưới.');
  };

  const handleToggleSessionComplete = async () => {
    if (!activeSession) return;
    if (dirtyRowKeys.length > 0) {
      await handleSaveAllDirtyRows();
    }
    const nextStatus = activeSession.status === 'completed' ? 'draft' : 'completed';
    await updateSession(activeSession.id, {
      lessonContent,
      homeworkSummary,
      status: nextStatus,
    });
    setNotice(
      nextStatus === 'completed'
        ? 'Đã đánh dấu hoàn tất buổi học.'
        : 'Đã chuyển buổi học về trạng thái nháp.'
    );
  };

  const handleMarkAllPresent = async () => {
    if (!workspaceTeacherId || !activeSession) return;
    const statusToSet: AttendanceStatus = activeSession.sessionType === 'makeup' ? 'makeup' : 'present';
    await markAllPresent(workspaceTeacherId, activeSession, sessionStudents);
    setRowDrafts((prev) => {
      const next = { ...prev };
      for (const st of sessionStudents) {
        const key = `${activeSession.id}_${st.id}`;
        const cur = next[key] ?? getBaselineRow(st.id);
        next[key] = {
          ...cur,
          attendanceStatus: statusToSet,
          homeworkStatus: cur.homeworkStatus === 'not_applicable' ? 'done' : cur.homeworkStatus,
          attitudeRating: cur.attitudeRating === 'not_applicable' ? 'good' : cur.attitudeRating,
        };
      }
      return next;
    });
    setNotice(`Đã điểm danh có mặt cho tất cả ${sessionStudents.length} học sinh.`);
  };

  const handleMarkAllHomeworkDone = async () => {
    if (!workspaceTeacherId || !activeSession) return;
    const presentStudents = sessionStudents.filter((st) => !isAbsentStatus(getRow(st.id).attendanceStatus));
    await Promise.all(
      presentStudents.map((st) => {
        const merged = updateLocalRow(st.id, { homeworkStatus: 'done' });
        return persistRowToFirestore(st, merged);
      })
    );
    setNotice(`Đã đánh dấu hoàn thành đầy đủ BTVN cho ${presentStudents.length} học sinh có mặt.`);
  };

  const handleApplyBatchReview = async () => {
    if (!workspaceTeacherId || !activeSession) return;
    setApplyingBatch(true);
    try {
      const presentStudents = sessionStudents.filter((st) => !isAbsentStatus(getRow(st.id).attendanceStatus));
      await Promise.all(
        presentStudents.map((st) => {
          const cur = getRow(st.id);
          const merged = updateLocalRow(st.id, {
            homeworkStatus: batchHw,
            homeworkNote: batchHwNote.trim() || cur.homeworkNote,
            attitudeRating: batchAttitude,
            attitudeComment: batchComment.trim() || cur.attitudeComment,
          });
          return persistRowToFirestore(st, merged);
        })
      );
      setShowBatchPanel(false);
      setNotice(
        `Đã áp dụng BTVN & nhận xét hàng loạt cho ${presentStudents.length} học sinh có mặt (tự bỏ qua học sinh nghỉ).`
      );
    } finally {
      setApplyingBatch(false);
    }
  };

  const handleExpandStudent = (studentId: string) => {
    if (expandedStudentId === studentId) {
      setExpandedStudentId(null);
      return;
    }
    setExpandedStudentId(studentId);
    if (activeSession) {
      const rev = reviewByStudent.get(studentId);
      const revId = rev?.id ?? `${activeSession.id}_${studentId}`;
      void getStudentReviewPrivateNote(revId).then((note) => {
        setStudentPrivateNotes((prev) => ({ ...prev, [revId]: note }));
      });
    }
  };

  const handleSynthesizeAI = async (student: Student) => {
    if (!workspaceTeacherId || !activeSession) return;
    const draftKey = `${activeSession.id}_${student.id}`;
    setAiGeneratingId(student.id);
    setAiErrorByStudent((prev) => ({ ...prev, [student.id]: '' }));

    try {
      // Save any unsaved table edits for this student first
      if (dirtyRowKeys.includes(draftKey)) {
        await persistRowToFirestore(student);
      }
      const result = await synthesizeParentReviewWithAI(buildStudentPayload(student));
      setAiDrafts((prev) => ({ ...prev, [draftKey]: result.message }));
      await upsertParentMessage(workspaceTeacherId, activeSession, student, result.message, 'created');
    } catch (err) {
      setAiErrorByStudent((prev) => ({
        ...prev,
        [student.id]: err instanceof Error ? err.message : 'Lỗi gọi AI tổng hợp nhận xét.',
      }));
    } finally {
      setAiGeneratingId(null);
    }
  };

  const handleBulkSaveQuickMessages = async () => {
    if (!workspaceTeacherId || !activeSession) return;
    const unsentStudents = sessionStudents.filter(
      (st) => parentMsgByStudent.get(st.id)?.status !== 'sent'
    );
    if (unsentStudents.length === 0) {
      setNotice('Tất cả học sinh trong buổi học này đều đã được xác nhận gửi tin nhắn.');
      return;
    }
    setBulkSavingMsgs(true);
    try {
      if (dirtyRowKeys.length > 0) {
        await handleSaveAllDirtyRows();
      }
      await Promise.all(
        unsentStudents.map((st) => {
          const { text } = getVisibleParentMessage(st);
          const draftKey = `${activeSession.id}_${st.id}`;
          setAiDrafts((prev) => ({ ...prev, [draftKey]: text }));
          return upsertParentMessage(workspaceTeacherId, activeSession, st, text, 'approved');
        })
      );
      setNotice(
        `Đã lưu & duyệt sẵn tin nhắn gửi phụ huynh cho ${unsentStudents.length} học sinh. Phụ huynh cũng đã có thể xem trên cổng Phụ huynh.`
      );
    } finally {
      setBulkSavingMsgs(false);
    }
  };

  const handleBulkSynthesizeAI = async () => {
    if (!workspaceTeacherId || !activeSession) return;
    const unsentStudents = sessionStudents.filter(
      (st) => parentMsgByStudent.get(st.id)?.status !== 'sent'
    );
    if (unsentStudents.length === 0) {
      setNotice('Tất cả học sinh đều đã gửi tin nhắn.');
      return;
    }
    if (dirtyRowKeys.length > 0) {
      await handleSaveAllDirtyRows();
    }
    setBulkAiProgress({ current: 0, total: unsentStudents.length });
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < unsentStudents.length; i++) {
      const st = unsentStudents[i];
      setBulkAiProgress({ current: i + 1, total: unsentStudents.length });
      const draftKey = `${activeSession.id}_${st.id}`;
      setAiErrorByStudent((prev) => ({ ...prev, [st.id]: '' }));
      try {
        const result = await synthesizeParentReviewWithAI(buildStudentPayload(st));
        setAiDrafts((prev) => ({ ...prev, [draftKey]: result.message }));
        await upsertParentMessage(workspaceTeacherId, activeSession, st, result.message, 'created');
        successCount++;
      } catch (err) {
        failCount++;
        setAiErrorByStudent((prev) => ({
          ...prev,
          [st.id]: err instanceof Error ? err.message : 'Lỗi gọi AI.',
        }));
      }
    }

    setBulkAiProgress(null);
    setNotice(
      failCount === 0
        ? `AI đã tổng hợp xong tin nhắn nhận xét cho cả ${successCount} học sinh!`
        : `AI đã tạo thành công ${successCount}/${unsentStudents.length} học sinh (${failCount} em gặp lỗi — vẫn có sẵn mẫu tin nhắn chuẩn để gửi ngay).`
    );
  };

  const handleRefreshDraftFromTable = (student: Student) => {
    if (!activeSession) return;
    const draftKey = `${activeSession.id}_${student.id}`;
    const freshText = buildStructuredParentMessage(buildStudentPayload(student));
    setAiDrafts((prev) => ({ ...prev, [draftKey]: freshText }));
    setNotice(`Đã cập nhật lại nội dung tin nhắn của em ${student.fullName} theo bảng nhập mới nhất.`);
  };

  const handleApproveMessage = async (student: Student) => {
    if (!workspaceTeacherId || !activeSession) return;
    const { text } = getVisibleParentMessage(student);
    const trimmed = text.trim();
    if (!trimmed) return;
    const draftKey = `${activeSession.id}_${student.id}`;
    setAiDrafts((prev) => ({ ...prev, [draftKey]: trimmed }));
    await upsertParentMessage(workspaceTeacherId, activeSession, student, trimmed, 'approved');
    setNotice(`Đã lưu & duyệt tin nhắn nhận xét cho phụ huynh em ${student.fullName}.`);
  };

  const handleCopyText = async (key: string, text: string, successToast?: string) => {
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    if (successToast) setNotice(successToast);
    window.setTimeout(() => {
      setCopiedKey((curr) => (curr === key ? null : curr));
    }, 2200);
  };

  const handleDeviceShare = async (student: Student, text: string) => {
    if (!text.trim()) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Nhận xét buổi học – ${student.fullName}`,
          text,
        });
        const msg = parentMsgByStudent.get(student.id);
        if (!msg || msg.status !== 'sent') {
          setSendChannel('Chia sẻ thiết bị (Zalo / SMS)');
          setConfirmSendStudent({ student, content: text });
        }
      } catch {
        // Người dùng hủy chia sẻ -> không đánh dấu đã gửi
      }
    } else {
      await handleCopyText(
        `msg_${student.id}`,
        text,
        `Đã sao chép tin nhắn của em ${student.fullName} — bạn chỉ cần dán vào Zalo gửi phụ huynh.`
      );
    }
  };

  const handleConfirmSent = async () => {
    if (!confirmSendStudent || !workspaceTeacherId || !activeSession) return;
    setConfirmingSend(true);
    try {
      const existingMsg = parentMsgByStudent.get(confirmSendStudent.student.id);
      const messageId =
        existingMsg?.id ??
        (await upsertParentMessage(
          workspaceTeacherId,
          activeSession,
          confirmSendStudent.student,
          confirmSendStudent.content,
          'approved'
        ));
      await confirmParentMessageSent(messageId, confirmSendStudent.content, sendChannel);
      setNotice(
        `Đã xác nhận gửi tin nhắn nhận xét cho phụ huynh em ${confirmSendStudent.student.fullName}.`
      );
      setConfirmSendStudent(null);
    } finally {
      setConfirmingSend(false);
    }
  };

  const jumpToStudentMessage = (studentId: string) => {
    setFocusedMessageStudentId(studentId);
    setMessageFilter('all');
    setWorkspaceTab('messages');
    window.setTimeout(() => {
      const el = document.getElementById(`parent-msg-card-${studentId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  };

  // =========================================================
  // HOMEWORK REPORT METRICS & ZALO REPORT TEXT
  // =========================================================
  const homeworkReportStats = useMemo(() => {
    const items = sessionStudents.map((st) => {
      const row = getRow(st.id);
      const absent = isAbsentStatus(row.attendanceStatus);
      return {
        student: st,
        attendanceStatus: row.attendanceStatus,
        attendanceReason: row.attendanceReason,
        absent,
        homeworkStatus: absent ? ('not_applicable' as HomeworkCheckStatus) : row.homeworkStatus,
        homeworkNote: absent ? '' : row.homeworkNote,
      };
    });

    const presentItems = items.filter((i) => !i.absent);
    const absentItems = items.filter((i) => i.absent);
    const doneWell = presentItems.filter((i) => i.homeworkStatus === 'done_well');
    const done = presentItems.filter((i) => i.homeworkStatus === 'done');
    const incomplete = presentItems.filter((i) => i.homeworkStatus === 'incomplete');
    const notDone = presentItems.filter((i) => i.homeworkStatus === 'not_done');
    const notChecked = presentItems.filter((i) => i.homeworkStatus === 'not_applicable');
    const completedCount = doneWell.length + done.length;
    const completionRate =
      presentItems.length > 0 ? Math.round((completedCount / presentItems.length) * 100) : 0;

    return {
      items,
      presentItems,
      absentItems,
      doneWell,
      done,
      incomplete,
      notDone,
      notChecked,
      completedCount,
      completionRate,
      attentionCount: incomplete.length + notDone.length,
    };
  }, [sessionStudents, rowDrafts, activeSession, attendanceByStudent, reviewByStudent]);

  const classHomeworkReportText = useMemo(() => {
    if (!activeSession) return '';
    return buildClassHomeworkReportText({
      className: activeSession.className,
      sessionDate: activeSession.sessionDate,
      startTime: activeSession.startTime,
      endTime: activeSession.endTime,
      homeworkSummary,
      teacherName: teacherProfile?.fullName || firebaseUser?.displayName || 'Giáo viên',
      rows: homeworkReportStats.items.map((item) => ({
        studentName: item.student.fullName,
        studentCode: item.student.studentCode,
        attendanceStatus: item.attendanceStatus,
        homeworkStatus: item.homeworkStatus,
        homeworkNote: item.homeworkNote,
      })),
    });
  }, [activeSession, homeworkSummary, teacherProfile, firebaseUser, homeworkReportStats]);

  const filteredHomeworkReportItems = useMemo(() => {
    switch (hwReportFilter) {
      case 'attention':
        return homeworkReportStats.items.filter(
          (i) => !i.absent && (i.homeworkStatus === 'incomplete' || i.homeworkStatus === 'not_done')
        );
      case 'completed':
        return homeworkReportStats.items.filter(
          (i) => !i.absent && (i.homeworkStatus === 'done_well' || i.homeworkStatus === 'done')
        );
      case 'absent':
        return homeworkReportStats.items.filter((i) => i.absent);
      default:
        return homeworkReportStats.items;
    }
  }, [homeworkReportStats.items, hwReportFilter]);

  const sentMessagesCount = useMemo(
    () => sessionStudents.filter((st) => parentMsgByStudent.get(st.id)?.status === 'sent').length,
    [sessionStudents, parentMsgByStudent]
  );

  const filteredMessageStudents = useMemo(() => {
    if (messageFilter === 'sent') {
      return sessionStudents.filter((st) => parentMsgByStudent.get(st.id)?.status === 'sent');
    }
    if (messageFilter === 'unsent') {
      return sessionStudents.filter((st) => parentMsgByStudent.get(st.id)?.status !== 'sent');
    }
    return sessionStudents;
  }, [sessionStudents, messageFilter, parentMsgByStudent]);

  const handleCopyAllParentMessages = async () => {
    if (sessionStudents.length === 0) return;
    const combined = sessionStudents
      .map((st, idx) => {
        const { text } = getVisibleParentMessage(st);
        const phones = [st.motherPhone, st.fatherPhone].filter(Boolean).join(' / ');
        return `=== ${idx + 1}. ${st.fullName}${phones ? ` (SĐT PH: ${phones})` : ''} ===\n${text}`;
      })
      .join('\n\n----------------------------------------\n\n');
    await handleCopyText(
      'copy_all_messages',
      combined,
      `Đã sao chép toàn bộ ${sessionStudents.length} tin nhắn gửi phụ huynh!`
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Buổi học &amp; Nhận xét AI</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Nhập nhanh cả lớp trên 1 bảng, báo cáo BTVN chi tiết và xem sẵn toàn bộ tin nhắn gửi phụ huynh
          </p>
        </div>
        <button
          onClick={() => {
            setNewClassId(classes.find((c) => c.status === 'active')?.id ?? '');
            setShowCreateModal(true);
          }}
          className="min-h-[44px] px-4 rounded-xl bg-[#DB2777] text-white text-sm font-medium hover:bg-[#BE185D] inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Tạo buổi học</span>
        </button>
      </div>

      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-xs font-semibold hover:underline shrink-0">
            Đóng
          </button>
        </div>
      )}

      {/* Session Selector Strip */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <select
          value={activeSession?.id ?? ''}
          onChange={(e) => setSelectedSessionId(e.target.value)}
          className="flex-1 min-h-[46px] rounded-xl border border-pink-200 bg-white px-3.5 text-sm font-medium text-slate-900"
        >
          {sortedSessions.length === 0 ? (
            <option value="">Chưa có buổi học nào</option>
          ) : (
            sortedSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sessionDate} ({s.startTime}–{s.endTime}) · {s.className} ·{' '}
                {s.sessionType === 'makeup' ? 'Học bù' : 'Chính khóa'} ·{' '}
                {s.status === 'completed' ? 'Hoàn tất' : 'Nháp'}
              </option>
            ))
          )}
        </select>

        {activeSession && (
          <button
            onClick={() => void handleToggleSessionComplete()}
            className={`min-h-[46px] px-4 rounded-xl text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap ${
              activeSession.status === 'completed'
                ? 'bg-[#ECFDF5] border border-emerald-200 text-[#15803D] hover:bg-emerald-100'
                : 'bg-[#15803D] text-white hover:bg-emerald-800'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{activeSession.status === 'completed' ? 'Buổi học đã hoàn tất' : 'Hoàn tất buổi học'}</span>
          </button>
        )}
      </div>

      {!activeSession ? (
        <div className="rounded-2xl bg-white border border-pink-100 p-10 text-center text-sm text-slate-500">
          Nhấn &ldquo;Tạo buổi học&rdquo; để bắt đầu ghi nhận nội dung bài dạy, điểm danh, báo cáo BTVN và tin nhắn phụ huynh.
        </div>
      ) : (
        <div className="space-y-6">
          {/* General Session Information */}
          <section className="rounded-2xl bg-white border border-pink-100 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-pink-100">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{activeSession.className}</h2>
                <p className="text-xs text-slate-500 font-mono-num mt-0.5">
                  Ngày {activeSession.sessionDate} · {activeSession.startTime} – {activeSession.endTime} ·{' '}
                  {activeSession.sessionType === 'makeup' ? 'Buổi học bù' : 'Buổi định kỳ'} · Sĩ số:{' '}
                  {sessionStudents.length} HS
                </p>
              </div>
              {autoSaveText && (
                <span className="text-xs font-medium text-[#15803D]">{autoSaveText}</span>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Nội dung bài học hôm nay
                </label>
                <textarea
                  rows={2}
                  value={lessonContent}
                  onChange={(e) => {
                    setLessonContent(e.target.value);
                    scheduleSessionAutoSave(e.target.value, homeworkSummary, sessionPrivateNote);
                  }}
                  placeholder="VD: Hệ thức Vi-ét và ứng dụng giải phương trình bậc hai..."
                  className="w-full rounded-xl border border-pink-200 p-3 text-sm leading-relaxed"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Bài tập về nhà giao cho buổi tới
                </label>
                <textarea
                  rows={2}
                  value={homeworkSummary}
                  onChange={(e) => {
                    setHomeworkSummary(e.target.value);
                    scheduleSessionAutoSave(lessonContent, e.target.value, sessionPrivateNote);
                  }}
                  placeholder="VD: Làm phiếu bài tập số 12 từ câu 1 đến câu 6..."
                  className="w-full rounded-xl border border-pink-200 p-3 text-sm leading-relaxed"
                />
              </div>
            </div>

            {/* Private Teacher-Only Session Note */}
            <div className="rounded-xl bg-[#FDFBFC] border border-pink-100 p-3">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1">
                <Lock className="w-3.5 h-3.5 text-[#BE185D]" />
                <span>Ghi chú nội bộ của giáo viên (ẩn hoàn toàn với học sinh và phụ huynh)</span>
              </label>
              <input
                type="text"
                value={sessionPrivateNote}
                onChange={(e) => {
                  setSessionPrivateNote(e.target.value);
                  scheduleSessionAutoSave(lessonContent, homeworkSummary, e.target.value);
                }}
                placeholder="Ghi chú riêng cho giáo viên chuẩn bị buổi sau..."
                className="w-full min-h-[40px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
              />
            </div>
          </section>

          {/* Main Workspace Tabs: Multi-Student Table | Class BTVN Report | Parent Messages */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex overflow-x-auto gap-1.5 p-1.5 rounded-2xl bg-pink-50/90 border border-pink-100">
              <button
                type="button"
                onClick={() => setWorkspaceTab('table')}
                className={`min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  workspaceTab === 'table'
                    ? 'bg-white text-slate-900 shadow-xs border border-pink-100'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table2 className="w-4 h-4 text-[#DB2777]" />
                <span>Bảng nhập cả lớp ({sessionStudents.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceTab('homework_report')}
                className={`min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  workspaceTab === 'homework_report'
                    ? 'bg-white text-slate-900 shadow-xs border border-pink-100'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookCheck className="w-4 h-4 text-[#15803D]" />
                <span>Báo cáo BTVN lớp</span>
                {homeworkReportStats.attentionCount > 0 && (
                  <span className="px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[11px] font-mono-num">
                    {homeworkReportStats.attentionCount} thiếu
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setWorkspaceTab('messages')}
                className={`min-h-[44px] px-4 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  workspaceTab === 'messages'
                    ? 'bg-[#DB2777] text-white shadow-xs'
                    : 'text-slate-700 hover:text-[#BE185D]'
                }`}
              >
                <MessageSquareText
                  className={`w-4 h-4 ${workspaceTab === 'messages' ? 'text-white' : 'text-[#DB2777]'}`}
                />
                <span>
                  Tin nhắn gửi PH ({sentMessagesCount}/{sessionStudents.length})
                </span>
              </button>
            </div>

            {workspaceTab === 'table' && (
              <div className="inline-flex items-center rounded-xl border border-pink-200 bg-white p-1 self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setEntryViewMode('table')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                    entryViewMode === 'table'
                      ? 'bg-[#FFF1F5] text-[#BE185D]'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Table2 className="w-3.5 h-3.5" />
                  <span>Dạng bảng</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEntryViewMode('cards')}
                  className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer ${
                    entryViewMode === 'cards'
                      ? 'bg-[#FFF1F5] text-[#BE185D]'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>Dạng thẻ</span>
                </button>
              </div>
            )}
          </div>

          {/* ========================================================= */}
          {/* TAB 1: MULTI-STUDENT FAST SPREADSHEET TABLE (DEFAULT)     */}
          {/* ========================================================= */}
          {workspaceTab === 'table' && (
            <div className="space-y-4">
              {/* Batch Action Bar */}
              <section className="rounded-2xl bg-white border border-pink-100 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleMarkAllPresent()}
                    className="min-h-[42px] px-3.5 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <CheckCheck className="w-4 h-4" />
                    <span>Tất cả có mặt</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleMarkAllHomeworkDone()}
                    className="min-h-[42px] px-3.5 rounded-xl bg-white border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-50 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <BookCheck className="w-4 h-4" />
                    <span>Tất cả đủ BTVN</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBatchPanel((v) => !v)}
                    className="min-h-[42px] px-3.5 rounded-xl bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 cursor-pointer"
                  >
                    Điền nhanh hàng loạt
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveAllDirtyRows()}
                    disabled={savingRows}
                    className={`min-h-[42px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                      dirtyRowKeys.length > 0
                        ? 'bg-[#15803D] text-white hover:bg-emerald-800'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    }`}
                  >
                    <Save className="w-4 h-4" />
                    <span>
                      {savingRows
                        ? 'Đang lưu bảng...'
                        : dirtyRowKeys.length > 0
                        ? `Lưu bảng (${dirtyRowKeys.length} dòng chưa lưu)`
                        : 'Lưu toàn bộ bảng'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceTab('messages')}
                    className="min-h-[42px] px-4 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <MessageSquareText className="w-4 h-4" />
                    <span>Xem tin nhắn gửi PH ({sessionStudents.length})</span>
                  </button>
                </div>
              </section>

              {showBatchPanel && (
                <section className="rounded-2xl bg-[#FFF1F5] border border-pink-200 p-4 space-y-3">
                  <p className="text-xs font-semibold text-[#BE185D]">
                    Điền nhanh đồng loạt cho tất cả học sinh có mặt (tự động bỏ qua học sinh nghỉ học)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <select
                      value={batchHw}
                      onChange={(e) => setBatchHw(e.target.value as HomeworkCheckStatus)}
                      className="min-h-[42px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                    >
                      <option value="done_well">BTVN: Làm tốt</option>
                      <option value="done">BTVN: Đầy đủ</option>
                      <option value="incomplete">BTVN: Làm thiếu</option>
                      <option value="not_done">BTVN: Chưa làm</option>
                    </select>
                    <input
                      type="text"
                      value={batchHwNote}
                      onChange={(e) => setBatchHwNote(e.target.value)}
                      placeholder="Ghi chú BTVN chung (VD: Đủ 5/5 câu)"
                      className="min-h-[42px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                    />
                    <select
                      value={batchAttitude}
                      onChange={(e) => setBatchAttitude(e.target.value as AttitudeRating)}
                      className="min-h-[42px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                    >
                      <option value="excellent">Ý thức: Tập trung tốt</option>
                      <option value="good">Ý thức: Nghiêm túc</option>
                      <option value="needs_focus">Ý thức: Cần tập trung hơn</option>
                    </select>
                    <input
                      type="text"
                      value={batchComment}
                      onChange={(e) => setBatchComment(e.target.value)}
                      placeholder="Nhận xét chung trên lớp (tùy chọn)"
                      className="min-h-[42px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBatchPanel(false)}
                      className="min-h-[40px] px-3.5 rounded-xl bg-white border border-pink-200 text-xs font-medium cursor-pointer"
                    >
                      Đóng
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleApplyBatchReview()}
                      disabled={applyingBatch}
                      className="min-h-[40px] px-4 rounded-xl bg-[#DB2777] text-white text-xs font-semibold cursor-pointer"
                    >
                      {applyingBatch ? 'Đang áp dụng...' : 'Áp dụng cho cả lớp'}
                    </button>
                  </div>
                </section>
              )}

              {sessionStudents.length === 0 ? (
                <div className="rounded-2xl bg-white border border-pink-100 p-8 text-center text-sm text-slate-500">
                  Lớp này chưa có học sinh đang theo học. Hãy thêm học sinh trong mục Quản lý lớp.
                </div>
              ) : entryViewMode === 'table' ? (
                /* FAST MULTI-STUDENT SPREADSHEET TABLE */
                <section className="rounded-2xl bg-white border border-pink-100 overflow-hidden">
                  <div className="px-4 py-2.5 bg-[#FDFBFC] border-b border-pink-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#DB2777]" />
                      <span>
                        Nhập trực tiếp nhiều học sinh cùng lúc — dữ liệu tự lưu ngay khi rời ô hoặc nhấn{' '}
                        <strong className="text-slate-800">Lưu toàn bộ bảng</strong>.
                      </span>
                    </span>
                    <span className="font-mono-num text-slate-500">
                      Có mặt: {homeworkReportStats.presentItems.length}/{sessionStudents.length}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1140px] border-collapse text-left">
                      <thead>
                        <tr className="bg-pink-50/70 border-b border-pink-100 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                          <th className="py-3 px-3.5 w-48 sticky left-0 z-10 bg-pink-50/95 border-r border-pink-100">
                            Học sinh
                          </th>
                          <th className="py-3 px-2.5 w-36">Điểm danh</th>
                          <th className="py-3 px-2.5 w-60">BTVN &amp; Chi tiết cụ thể</th>
                          <th className="py-3 px-2.5 w-56">Ý thức &amp; Nhận xét lớp</th>
                          <th className="py-3 px-2.5 w-28">Điểm KT</th>
                          <th className="py-3 px-2.5 w-56">Kiến thức yếu / Nhắn PH</th>
                          <th className="py-3 px-3 w-36 text-right">Tin nhắn PH</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-pink-100 text-sm">
                        {sessionStudents.map((st, idx) => {
                          const row = getRow(st.id);
                          const absent = isAbsentStatus(row.attendanceStatus);
                          const rowKey = `${activeSession.id}_${st.id}`;
                          const isDirty = dirtyRowKeys.includes(rowKey);
                          const pMsg = parentMsgByStudent.get(st.id);
                          const msgStatus = pMsg?.status ?? 'not_created';

                          return (
                            <tr
                              key={st.id}
                              className={`align-top transition-colors ${
                                absent
                                  ? 'bg-rose-50/30'
                                  : isDirty
                                  ? 'bg-amber-50/30'
                                  : 'bg-white hover:bg-[#FDFBFC]'
                              }`}
                            >
                              {/* 1. Student Identity */}
                              <td className="py-3 px-3.5 sticky left-0 z-10 bg-inherit border-r border-pink-100">
                                <div className="flex items-start gap-2">
                                  <span className="mt-0.5 text-xs font-mono-num text-slate-400 w-5 shrink-0">
                                    {idx + 1}.
                                  </span>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-slate-900 leading-snug">{st.fullName}</p>
                                    <p className="text-[11px] font-mono-num text-slate-500 mt-0.5">
                                      {st.studentCode}
                                    </p>
                                    <p className="text-[11px] text-slate-500 truncate max-w-[155px]">
                                      {/^phụ huynh/i.test(st.parentName)
                                        ? st.parentName
                                        : `Phụ huynh ${st.fullName}`}
                                    </p>
                                    {savingStudentId === st.id ? (
                                      <span className="text-[10px] font-semibold text-[#15803D]">
                                        Đang lưu...
                                      </span>
                                    ) : isDirty ? (
                                      <span className="text-[10px] font-semibold text-amber-700">
                                        Chưa lưu
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </td>

                              {/* 2. Attendance */}
                              <td className="py-2.5 px-2.5 space-y-1.5">
                                <select
                                  value={row.attendanceStatus}
                                  onChange={(e) => {
                                    const nextStatus = e.target.value as AttendanceStatus;
                                    const merged = updateLocalRow(st.id, { attendanceStatus: nextStatus });
                                    void persistRowToFirestore(st, merged);
                                  }}
                                  className={`w-full min-h-[38px] rounded-lg border px-2 text-xs font-semibold cursor-pointer ${
                                    row.attendanceStatus === 'present' || row.attendanceStatus === 'makeup'
                                      ? 'border-emerald-200 bg-emerald-50/70 text-[#15803D]'
                                      : row.attendanceStatus === 'late'
                                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                                      : 'border-rose-300 bg-rose-50 text-rose-800'
                                  }`}
                                >
                                  <option value="present">Có mặt</option>
                                  <option value="late">Đi muộn</option>
                                  <option value="absent_excused">Nghỉ có phép</option>
                                  <option value="absent_unexcused">Nghỉ không phép</option>
                                  <option value="makeup">Học bù</option>
                                </select>
                                {(absent || row.attendanceStatus === 'late') && (
                                  <input
                                    type="text"
                                    value={row.attendanceReason}
                                    onChange={(e) =>
                                      updateLocalRow(st.id, { attendanceReason: e.target.value })
                                    }
                                    onBlur={() => void persistRowToFirestore(st)}
                                    placeholder={absent ? 'Lý do nghỉ...' : 'Muộn bao lâu...'}
                                    className="w-full min-h-[34px] rounded-lg border border-pink-200 bg-white px-2.5 text-xs"
                                  />
                                )}
                              </td>

                              {/* 3. Homework Status + Specific Homework Note */}
                              <td className="py-2.5 px-2.5 space-y-1.5">
                                {absent ? (
                                  <p className="text-xs text-rose-700/80 italic py-2">
                                    Nghỉ học — không kiểm tra BTVN
                                  </p>
                                ) : (
                                  <>
                                    <select
                                      value={row.homeworkStatus}
                                      onChange={(e) => {
                                        const merged = updateLocalRow(st.id, {
                                          homeworkStatus: e.target.value as HomeworkCheckStatus,
                                        });
                                        void persistRowToFirestore(st, merged);
                                      }}
                                      className={`w-full min-h-[38px] rounded-lg border px-2 text-xs font-semibold cursor-pointer ${
                                        row.homeworkStatus === 'done_well' || row.homeworkStatus === 'done'
                                          ? 'border-emerald-200 bg-emerald-50/60 text-[#15803D]'
                                          : row.homeworkStatus === 'incomplete'
                                          ? 'border-amber-300 bg-amber-50 text-amber-800'
                                          : row.homeworkStatus === 'not_done'
                                          ? 'border-rose-300 bg-rose-50 text-rose-800'
                                          : 'border-slate-200 bg-white text-slate-600'
                                      }`}
                                    >
                                      <option value="done_well">BTVN: Làm tốt</option>
                                      <option value="done">BTVN: Đầy đủ</option>
                                      <option value="incomplete">BTVN: Làm thiếu</option>
                                      <option value="not_done">BTVN: Chưa làm</option>
                                      <option value="not_applicable">Không kiểm tra</option>
                                    </select>
                                    <input
                                      type="text"
                                      value={row.homeworkNote}
                                      onChange={(e) =>
                                        updateLocalRow(st.id, { homeworkNote: e.target.value })
                                      }
                                      onBlur={() => void persistRowToFirestore(st)}
                                      placeholder="Chi tiết BTVN (VD: Thiếu câu 4, sai dấu bài 2...)"
                                      className="w-full min-h-[36px] rounded-lg border border-pink-200 bg-white px-2.5 text-xs placeholder:text-slate-400"
                                    />
                                  </>
                                )}
                              </td>

                              {/* 4. Class Attitude + Comment */}
                              <td className="py-2.5 px-2.5 space-y-1.5">
                                {absent ? (
                                  <p className="text-xs text-rose-700/80 italic py-2">
                                    Tự khóa để AI không suy diễn
                                  </p>
                                ) : (
                                  <>
                                    <select
                                      value={row.attitudeRating}
                                      onChange={(e) => {
                                        const merged = updateLocalRow(st.id, {
                                          attitudeRating: e.target.value as AttitudeRating,
                                        });
                                        void persistRowToFirestore(st, merged);
                                      }}
                                      className={`w-full min-h-[38px] rounded-lg border px-2 text-xs font-semibold cursor-pointer ${
                                        row.attitudeRating === 'excellent'
                                          ? 'border-emerald-200 bg-emerald-50/60 text-[#15803D]'
                                          : row.attitudeRating === 'good'
                                          ? 'border-pink-200 bg-pink-50/50 text-slate-800'
                                          : 'border-amber-300 bg-amber-50 text-amber-800'
                                      }`}
                                    >
                                      <option value="excellent">Tập trung tốt</option>
                                      <option value="good">Nghiêm túc</option>
                                      <option value="needs_focus">Cần tập trung hơn</option>
                                      <option value="not_applicable">Không đánh giá</option>
                                    </select>
                                    <input
                                      type="text"
                                      value={row.attitudeComment}
                                      onChange={(e) =>
                                        updateLocalRow(st.id, { attitudeComment: e.target.value })
                                      }
                                      onBlur={() => void persistRowToFirestore(st)}
                                      placeholder="Nhận xét trên lớp..."
                                      className="w-full min-h-[36px] rounded-lg border border-pink-200 bg-white px-2.5 text-xs placeholder:text-slate-400"
                                    />
                                  </>
                                )}
                              </td>

                              {/* 5. Test Score */}
                              <td className="py-2.5 px-2.5">
                                {absent ? (
                                  <span className="text-xs text-slate-400">—</span>
                                ) : (
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="text"
                                        inputMode="decimal"
                                        value={row.testScoreText}
                                        onChange={(e) =>
                                          updateLocalRow(st.id, { testScoreText: e.target.value })
                                        }
                                        onBlur={() => void persistRowToFirestore(st)}
                                        placeholder="Điểm"
                                        className="w-14 min-h-[38px] rounded-lg border border-pink-200 bg-white px-2 text-xs font-mono-num text-center"
                                      />
                                      <span className="text-xs text-slate-400">/</span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        value={row.testMaxScoreText}
                                        onChange={(e) =>
                                          updateLocalRow(st.id, { testMaxScoreText: e.target.value })
                                        }
                                        onBlur={() => void persistRowToFirestore(st)}
                                        className="w-11 min-h-[38px] rounded-lg border border-slate-200 bg-slate-50 px-1.5 text-xs font-mono-num text-center text-slate-600"
                                      />
                                    </div>
                                    <p className="text-[10px] text-slate-400">Bỏ trống nếu ko KT</p>
                                  </div>
                                )}
                              </td>

                              {/* 6. Weak Topics + Parent Private Message */}
                              <td className="py-2.5 px-2.5 space-y-1.5">
                                {!absent && (
                                  <input
                                    type="text"
                                    value={row.weakTopics}
                                    onChange={(e) =>
                                      updateLocalRow(st.id, { weakTopics: e.target.value })
                                    }
                                    onBlur={() => void persistRowToFirestore(st)}
                                    placeholder="Kiến thức cần củng cố..."
                                    className="w-full min-h-[36px] rounded-lg border border-pink-200 bg-white px-2.5 text-xs placeholder:text-slate-400"
                                  />
                                )}
                                <input
                                  type="text"
                                  value={row.parentPrivateMessage}
                                  onChange={(e) =>
                                    updateLocalRow(st.id, { parentPrivateMessage: e.target.value })
                                  }
                                  onBlur={() => void persistRowToFirestore(st)}
                                  placeholder="Nhắn riêng với bố mẹ..."
                                  className="w-full min-h-[36px] rounded-lg border border-pink-200 bg-[#FFF8FA] px-2.5 text-xs placeholder:text-slate-400"
                                />
                              </td>

                              {/* 7. Parent Message Jump Action */}
                              <td className="py-2.5 px-3 text-right">
                                <div className="flex flex-col items-end gap-1.5">
                                  <span
                                    className={`text-[11px] font-semibold ${
                                      msgStatus === 'sent'
                                        ? 'text-[#15803D]'
                                        : msgStatus === 'approved'
                                        ? 'text-[#BE185D]'
                                        : msgStatus === 'created'
                                        ? 'text-slate-700'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {msgStatus === 'not_created'
                                      ? 'Sẵn mẫu gửi'
                                      : PARENT_MESSAGE_STATUS_VI[msgStatus]}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => jumpToStudentMessage(st.id)}
                                    className="min-h-[36px] px-3 rounded-lg bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                  >
                                    <MessageSquareText className="w-3.5 h-3.5" />
                                    <span>Xem tin PH</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                /* CARD VIEW (OPTIONAL PER-STUDENT MOBILE CARDS) */
                <div className="space-y-4">
                  {sessionStudents.map((st) => {
                    const row = getRow(st.id);
                    const absent = isAbsentStatus(row.attendanceStatus);
                    const isExpanded = expandedStudentId === st.id;
                    const rev = reviewByStudent.get(st.id);
                    const revKey = rev?.id ?? `${activeSession.id}_${st.id}`;
                    const pMsg = parentMsgByStudent.get(st.id);
                    const msgStatus = pMsg?.status ?? 'not_created';
                    const { text: visibleMsg } = getVisibleParentMessage(st);
                    const draftKey = `${activeSession.id}_${st.id}`;

                    return (
                      <article
                        key={st.id}
                        className="rounded-2xl bg-white border border-pink-100 p-4 sm:p-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="min-w-0">
                            <h4 className="text-base font-bold text-slate-900">{st.fullName}</h4>
                            <p className="text-xs text-slate-500 font-mono-num">
                              {st.studentCode} ·{' '}
                              {/^phụ huynh/i.test(st.parentName)
                                ? st.parentName
                                : `Phụ huynh ${st.fullName}`}{' '}
                              · Tin nhắn:{' '}
                              <span
                                className={`font-sans font-semibold ${
                                  msgStatus === 'sent'
                                    ? 'text-[#15803D]'
                                    : msgStatus === 'approved'
                                    ? 'text-[#BE185D]'
                                    : 'text-slate-700'
                                }`}
                              >
                                {msgStatus === 'not_created'
                                  ? 'Đã có mẫu sẵn'
                                  : PARENT_MESSAGE_STATUS_VI[msgStatus]}
                              </span>
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleExpandStudent(st.id)}
                            className="min-h-[40px] px-3 rounded-xl border border-pink-200 text-xs font-semibold text-slate-700 hover:bg-pink-50 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <span>{isExpanded ? 'Thu gọn chi tiết' : 'Điểm & Ghi chú riêng'}</span>
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </button>
                        </div>

                        {/* One-Tap Attendance Controls */}
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                          {(
                            [
                              {
                                id: 'present',
                                label: 'Có mặt',
                                activeCls: 'bg-[#15803D] text-white border-[#15803D]',
                              },
                              {
                                id: 'late',
                                label: 'Đi muộn',
                                activeCls: 'bg-amber-600 text-white border-amber-600',
                              },
                              {
                                id: 'absent_excused',
                                label: 'Nghỉ CP',
                                activeCls: 'bg-rose-600 text-white border-rose-600',
                              },
                              {
                                id: 'absent_unexcused',
                                label: 'Nghỉ KP',
                                activeCls: 'bg-rose-800 text-white border-rose-800',
                              },
                              {
                                id: 'makeup',
                                label: 'Học bù',
                                activeCls: 'bg-emerald-700 text-white border-emerald-700',
                              },
                            ] as const
                          ).map((btn) => {
                            const active = row.attendanceStatus === btn.id;
                            return (
                              <button
                                key={btn.id}
                                type="button"
                                onClick={() => {
                                  const merged = updateLocalRow(st.id, { attendanceStatus: btn.id });
                                  void persistRowToFirestore(st, merged);
                                }}
                                className={`min-h-[44px] rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                                  active
                                    ? btn.activeCls
                                    : 'bg-white border-pink-100 text-slate-700 hover:bg-pink-50'
                                }`}
                              >
                                {btn.label}
                              </button>
                            );
                          })}
                        </div>

                        {absent ? (
                          <div className="rounded-xl bg-rose-50/70 border border-rose-100 px-3.5 py-2.5 text-xs text-rose-900">
                            Học sinh đang ở trạng thái{' '}
                            <strong>{ATTENDANCE_STATUS_VI[row.attendanceStatus]}</strong> — hệ thống tự động tắt
                            đánh giá ý thức trên lớp để AI không suy diễn nhận xét.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-slate-500">Bài tập về nhà (1 chạm)</p>
                              <div className="grid grid-cols-4 gap-1.5">
                                {(['done_well', 'done', 'incomplete', 'not_done'] as HomeworkCheckStatus[]).map(
                                  (hwSt) => {
                                    const active = row.homeworkStatus === hwSt;
                                    return (
                                      <button
                                        key={hwSt}
                                        type="button"
                                        onClick={() => {
                                          const merged = updateLocalRow(st.id, { homeworkStatus: hwSt });
                                          void persistRowToFirestore(st, merged);
                                        }}
                                        className={`min-h-[40px] rounded-lg border text-[11px] font-semibold px-1 cursor-pointer transition-colors ${
                                          active
                                            ? 'bg-emerald-50 border-[#15803D] text-[#15803D]'
                                            : 'bg-white border-pink-100 text-slate-600 hover:bg-pink-50'
                                        }`}
                                      >
                                        {HOMEWORK_CHECK_VI[hwSt]}
                                      </button>
                                    );
                                  }
                                )}
                              </div>
                              <input
                                type="text"
                                value={row.homeworkNote}
                                onChange={(e) => updateLocalRow(st.id, { homeworkNote: e.target.value })}
                                onBlur={() => void persistRowToFirestore(st)}
                                placeholder="Chi tiết BTVN cụ thể (VD: Thiếu câu 4, sai dấu bài 2...)"
                                className="w-full min-h-[40px] rounded-xl border border-pink-200 px-3 text-xs"
                              />
                            </div>

                            <div className="space-y-2">
                              <p className="text-xs font-medium text-slate-500">Ý thức trên lớp (1 chạm)</p>
                              <div className="grid grid-cols-3 gap-1.5">
                                {(['excellent', 'good', 'needs_focus'] as AttitudeRating[]).map((attR) => {
                                  const active = row.attitudeRating === attR;
                                  return (
                                    <button
                                      key={attR}
                                      type="button"
                                      onClick={() => {
                                        const merged = updateLocalRow(st.id, { attitudeRating: attR });
                                        void persistRowToFirestore(st, merged);
                                      }}
                                      className={`min-h-[40px] rounded-lg border text-[11px] font-semibold px-1.5 cursor-pointer transition-colors ${
                                        active
                                          ? 'bg-pink-50 border-[#DB2777] text-[#BE185D]'
                                          : 'bg-white border-pink-100 text-slate-600 hover:bg-pink-50'
                                      }`}
                                    >
                                      {ATTITUDE_RATING_VI[attR]}
                                    </button>
                                  );
                                })}
                              </div>
                              <input
                                type="text"
                                value={row.attitudeComment}
                                onChange={(e) =>
                                  updateLocalRow(st.id, { attitudeComment: e.target.value })
                                }
                                onBlur={() => void persistRowToFirestore(st)}
                                placeholder="Nhận xét chi tiết trên lớp..."
                                className="w-full min-h-[40px] rounded-xl border border-pink-200 px-3 text-xs"
                              />
                            </div>
                          </div>
                        )}

                        {isExpanded && (
                          <div className="pt-3 border-t border-pink-100 space-y-3">
                            {!absent && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Điểm kiểm tra (bỏ trống nếu không có)
                                  </label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      inputMode="decimal"
                                      value={row.testScoreText}
                                      onChange={(e) =>
                                        updateLocalRow(st.id, { testScoreText: e.target.value })
                                      }
                                      onBlur={() => void persistRowToFirestore(st)}
                                      placeholder="Điểm"
                                      className="w-24 min-h-[40px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                                    />
                                    <span className="text-xs text-slate-500">/</span>
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      value={row.testMaxScoreText}
                                      onChange={(e) =>
                                        updateLocalRow(st.id, { testMaxScoreText: e.target.value })
                                      }
                                      onBlur={() => void persistRowToFirestore(st)}
                                      className="w-20 min-h-[40px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                                    Kiến thức còn yếu cần củng cố
                                  </label>
                                  <input
                                    type="text"
                                    value={row.weakTopics}
                                    onChange={(e) =>
                                      updateLocalRow(st.id, { weakTopics: e.target.value })
                                    }
                                    onBlur={() => void persistRowToFirestore(st)}
                                    placeholder="VD: Bước đổi đơn vị phút sang giờ..."
                                    className="w-full min-h-[40px] rounded-xl border border-pink-200 px-3 text-sm"
                                  />
                                </div>
                              </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">
                                  Nhắn gửi riêng cho bố mẹ
                                </label>
                                <input
                                  type="text"
                                  value={row.parentPrivateMessage}
                                  onChange={(e) =>
                                    updateLocalRow(st.id, { parentPrivateMessage: e.target.value })
                                  }
                                  onBlur={() => void persistRowToFirestore(st)}
                                  placeholder="VD: Nhờ gia đình nhắc em làm bài sớm..."
                                  className="w-full min-h-[40px] rounded-xl border border-pink-200 px-3 text-sm"
                                />
                              </div>
                              <div>
                                <label className="flex items-center gap-1 text-xs font-semibold text-slate-700 mb-1">
                                  <Lock className="w-3 h-3 text-[#BE185D]" />
                                  <span>Ghi chú nội bộ riêng (ẩn với HS &amp; PH)</span>
                                </label>
                                <input
                                  type="text"
                                  value={studentPrivateNotes[revKey] ?? ''}
                                  onChange={(e) =>
                                    setStudentPrivateNotes((prev) => ({
                                      ...prev,
                                      [revKey]: e.target.value,
                                    }))
                                  }
                                  onBlur={(e) => {
                                    if (!workspaceTeacherId) return;
                                    void persistRowToFirestore(st).then(() =>
                                      saveStudentReviewPrivateNote(
                                        workspaceTeacherId,
                                        revKey,
                                        e.target.value
                                      )
                                    );
                                  }}
                                  placeholder="Lưu riêng trong sổ tay giáo viên..."
                                  className="w-full min-h-[40px] rounded-xl border border-pink-200 bg-[#FDFBFC] px-3 text-sm"
                                />
                              </div>
                            </div>

                            <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={row.visibleToStudent}
                                onChange={(e) => {
                                  const merged = updateLocalRow(st.id, {
                                    visibleToStudent: e.target.checked,
                                  });
                                  void persistRowToFirestore(st, merged);
                                }}
                                className="accent-[#15803D]"
                              />
                              <span>Cho phép học sinh xem nhận xét công khai của buổi này</span>
                            </label>
                          </div>
                        )}

                        {/* Always-Visible Compact Parent Message Preview on Card */}
                        <div className="pt-3 border-t border-pink-100 space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-700">
                              Tin nhắn gửi phụ huynh (hiển thị sẵn):
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleSynthesizeAI(st)}
                              disabled={aiGeneratingId === st.id || msgStatus === 'sent'}
                              className="min-h-[38px] px-3.5 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>
                                {aiGeneratingId === st.id ? 'AI đang viết...' : 'Viết hay hơn bằng AI'}
                              </span>
                            </button>
                          </div>
                          {aiErrorByStudent[st.id] && (
                            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                              {aiErrorByStudent[st.id]}
                            </p>
                          )}
                          <textarea
                            rows={6}
                            value={visibleMsg}
                            readOnly={msgStatus === 'sent'}
                            onChange={(e) =>
                              setAiDrafts((prev) => ({ ...prev, [draftKey]: e.target.value }))
                            }
                            className={`w-full rounded-xl border p-3 text-xs sm:text-sm leading-relaxed ${
                              msgStatus === 'sent'
                                ? 'bg-emerald-50/40 border-emerald-200 text-slate-700'
                                : 'bg-[#FDFBFC] border-pink-200 text-slate-900'
                            }`}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyText(
                                  `msg_${st.id}`,
                                  visibleMsg,
                                  `Đã sao chép tin nhắn gửi phụ huynh em ${st.fullName}.`
                                )
                              }
                              className="min-h-[38px] px-3.5 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              <span>{copiedKey === `msg_${st.id}` ? 'Đã sao chép!' : 'Sao chép Zalo'}</span>
                            </button>
                            {msgStatus !== 'sent' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSendChannel('Zalo phụ huynh');
                                  setConfirmSendStudent({ student: st, content: visibleMsg });
                                }}
                                className="min-h-[38px] px-3.5 rounded-xl bg-[#15803D] text-white text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>Xác nhận đã gửi</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 2: SPECIFIC CLASS HOMEWORK REPORT                     */}
          {/* ========================================================= */}
          {workspaceTab === 'homework_report' && (
            <div className="space-y-5">
              {/* Summary Metrics Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                <div className="rounded-2xl bg-[#ECFDF5] border border-emerald-200 p-4">
                  <p className="text-xs font-medium text-emerald-800">Tỉ lệ hoàn thành</p>
                  <p className="mt-1 text-2xl font-bold font-mono-num text-[#15803D]">
                    {homeworkReportStats.completionRate}%
                  </p>
                  <p className="text-[11px] text-emerald-700 font-mono-num">
                    {homeworkReportStats.completedCount}/{homeworkReportStats.presentItems.length} có mặt
                  </p>
                </div>
                <div className="rounded-2xl bg-white border border-pink-100 p-4">
                  <p className="text-xs text-slate-500">Làm tốt</p>
                  <p className="mt-1 text-2xl font-bold font-mono-num text-[#15803D]">
                    {homeworkReportStats.doneWell.length}
                  </p>
                </div>
                <div className="rounded-2xl bg-white border border-pink-100 p-4">
                  <p className="text-xs text-slate-500">Đầy đủ</p>
                  <p className="mt-1 text-2xl font-bold font-mono-num text-slate-900">
                    {homeworkReportStats.done.length}
                  </p>
                </div>
                <div className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4">
                  <p className="text-xs text-amber-800">Làm thiếu</p>
                  <p className="mt-1 text-2xl font-bold font-mono-num text-amber-700">
                    {homeworkReportStats.incomplete.length}
                  </p>
                </div>
                <div className="rounded-2xl bg-rose-50/70 border border-rose-200 p-4">
                  <p className="text-xs text-rose-800">Chưa làm</p>
                  <p className="mt-1 text-2xl font-bold font-mono-num text-rose-700">
                    {homeworkReportStats.notDone.length}
                  </p>
                </div>
                <div className="rounded-2xl bg-white border border-slate-200 p-4">
                  <p className="text-xs text-slate-500">Nghỉ học</p>
                  <p className="mt-1 text-2xl font-bold font-mono-num text-slate-600">
                    {homeworkReportStats.absentItems.length}
                  </p>
                </div>
              </div>

              {/* Highlighted Attention List (Incomplete / Not Done) */}
              {homeworkReportStats.attentionCount > 0 && (
                <section className="rounded-2xl bg-amber-50/70 border border-amber-200 p-4 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <h3 className="text-sm font-bold text-amber-950">
                      Học sinh cần lưu ý BTVN ({homeworkReportStats.attentionCount} em)
                    </h3>
                  </div>
                  <div className="divide-y divide-amber-200/70">
                    {[...homeworkReportStats.incomplete, ...homeworkReportStats.notDone].map((item) => (
                      <div
                        key={item.student.id}
                        className="py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-sm"
                      >
                        <div>
                          <span className="font-semibold text-slate-900">{item.student.fullName}</span>
                          <span
                            className={`ml-2 text-xs font-semibold ${
                              item.homeworkStatus === 'not_done' ? 'text-rose-700' : 'text-amber-800'
                            }`}
                          >
                            ({HOMEWORK_CHECK_VI[item.homeworkStatus]})
                          </span>
                          <p className="text-xs text-slate-700 mt-0.5">
                            {item.homeworkNote.trim()
                              ? `Cụ thể: ${item.homeworkNote.trim()}`
                              : 'Chưa ghi chi tiết lỗi/bài thiếu — nhập trực tiếp ở bảng dưới.'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => jumpToStudentMessage(item.student.id)}
                          className="min-h-[34px] px-3 rounded-lg bg-white border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100 self-start sm:self-auto cursor-pointer whitespace-nowrap"
                        >
                          Mở tin nhắn PH
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Detailed Per-Student BTVN Table (Inline Editable) */}
              <section className="rounded-2xl bg-white border border-pink-100 overflow-hidden">
                <div className="p-4 border-b border-pink-100 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Chi tiết kiểm tra BTVN từng học sinh
                    </h3>
                    <p className="text-xs text-slate-500">
                      Cập nhật trực tiếp trạng thái &amp; lỗi cụ thể (VD: làm đủ 5/5 câu, thiếu câu 4b, nhầm dấu...)
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        { id: 'all', label: `Tất cả (${homeworkReportStats.items.length})` },
                        { id: 'attention', label: `Thiếu / Chưa làm (${homeworkReportStats.attentionCount})` },
                        { id: 'completed', label: `Hoàn thành (${homeworkReportStats.completedCount})` },
                        { id: 'absent', label: `Nghỉ (${homeworkReportStats.absentItems.length})` },
                      ] as const
                    ).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setHwReportFilter(f.id)}
                        className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                          hwReportFilter === f.id
                            ? 'bg-[#DB2777] text-white'
                            : 'bg-pink-50 text-slate-700 hover:bg-pink-100'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[780px] border-collapse text-left">
                    <thead>
                      <tr className="bg-[#FDFBFC] border-b border-pink-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                        <th className="py-3 px-4 w-52">Học sinh</th>
                        <th className="py-3 px-3 w-36">Điểm danh</th>
                        <th className="py-3 px-3 w-44">Mức độ BTVN</th>
                        <th className="py-3 px-3">Nhận xét BTVN cụ thể (số câu làm, bài thiếu, lỗi sai)</th>
                        <th className="py-3 px-4 w-28 text-right">Tin nhắn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-pink-100 text-sm">
                      {filteredHomeworkReportItems.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                            Không có học sinh nào trong nhóm lọc này.
                          </td>
                        </tr>
                      ) : (
                        filteredHomeworkReportItems.map((item) => {
                          const st = item.student;
                          const row = getRow(st.id);
                          return (
                            <tr key={st.id} className="hover:bg-[#FDFBFC]">
                              <td className="py-3 px-4">
                                <p className="font-semibold text-slate-900">{st.fullName}</p>
                                <p className="text-[11px] font-mono-num text-slate-500">{st.studentCode}</p>
                              </td>
                              <td className="py-3 px-3">
                                <span
                                  className={`text-xs font-semibold ${
                                    item.absent
                                      ? 'text-rose-700'
                                      : item.attendanceStatus === 'late'
                                      ? 'text-amber-700'
                                      : 'text-[#15803D]'
                                  }`}
                                >
                                  {ATTENDANCE_STATUS_VI[item.attendanceStatus]}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                {item.absent ? (
                                  <span className="text-xs text-slate-400">Chưa kiểm tra</span>
                                ) : (
                                  <select
                                    value={row.homeworkStatus}
                                    onChange={(e) => {
                                      const merged = updateLocalRow(st.id, {
                                        homeworkStatus: e.target.value as HomeworkCheckStatus,
                                      });
                                      void persistRowToFirestore(st, merged);
                                    }}
                                    className={`w-full min-h-[38px] rounded-lg border px-2.5 text-xs font-semibold cursor-pointer ${
                                      row.homeworkStatus === 'done_well' || row.homeworkStatus === 'done'
                                        ? 'border-emerald-200 bg-emerald-50/70 text-[#15803D]'
                                        : row.homeworkStatus === 'incomplete'
                                        ? 'border-amber-300 bg-amber-50 text-amber-800'
                                        : row.homeworkStatus === 'not_done'
                                        ? 'border-rose-300 bg-rose-50 text-rose-800'
                                        : 'border-slate-200 bg-white text-slate-600'
                                    }`}
                                  >
                                    <option value="done_well">Làm tốt</option>
                                    <option value="done">Đầy đủ</option>
                                    <option value="incomplete">Làm thiếu</option>
                                    <option value="not_done">Chưa làm</option>
                                    <option value="not_applicable">Không kiểm tra</option>
                                  </select>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                {item.absent ? (
                                  <span className="text-xs text-slate-400 italic">
                                    {item.attendanceReason || 'Nghỉ học buổi này'}
                                  </span>
                                ) : (
                                  <input
                                    type="text"
                                    value={row.homeworkNote}
                                    onChange={(e) =>
                                      updateLocalRow(st.id, { homeworkNote: e.target.value })
                                    }
                                    onBlur={() => void persistRowToFirestore(st)}
                                    placeholder="Nhập chi tiết (VD: Hoàn thành 6/6 câu, trình bày tốt / Thiếu bài 4b...)"
                                    className="w-full min-h-[38px] rounded-lg border border-pink-200 bg-white px-3 text-xs"
                                  />
                                )}
                              </td>
                              <td className="py-2.5 px-4 text-right">
                                <button
                                  type="button"
                                  onClick={() => jumpToStudentMessage(st.id)}
                                  className="min-h-[36px] px-3 rounded-lg bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 cursor-pointer whitespace-nowrap"
                                >
                                  Tin PH
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Zalo-Ready Class Homework Report Box */}
              <section className="rounded-2xl bg-white border border-emerald-200 p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Bản tổng hợp Báo cáo BTVN gửi nhóm Zalo lớp
                    </h3>
                    <p className="text-xs text-slate-500">
                      Tự động cập nhật theo bảng trên, liệt kê đầy đủ tỉ lệ hoàn thành và chi tiết từng nhóm học sinh
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopyText(
                          'class_hw_report',
                          classHomeworkReportText,
                          'Đã sao chép Báo cáo BTVN cả lớp — bạn có thể dán ngay vào nhóm Zalo phụ huynh!'
                        )
                      }
                      className="min-h-[42px] px-4 rounded-xl bg-[#15803D] text-white text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-4 h-4" />
                      <span>
                        {copiedKey === 'class_hw_report'
                          ? 'Đã sao chép báo cáo!'
                          : 'Sao chép báo cáo BTVN lớp (Zalo)'}
                      </span>
                    </button>
                  </div>
                </div>
                <pre className="rounded-xl bg-[#FDFBFC] border border-pink-100 p-4 text-xs sm:text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                  {classHomeworkReportText}
                </pre>
              </section>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 3: ALWAYS-VISIBLE PARENT MESSAGES CENTER              */}
          {/* ========================================================= */}
          {workspaceTab === 'messages' && (
            <div className="space-y-4">
              {/* Batch Parent Messages Action Bar */}
              <section className="rounded-2xl bg-white border border-pink-100 p-4 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Tin nhắn gửi Phụ huynh ({sentMessagesCount}/{sessionStudents.length} đã gửi)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Mọi học sinh đều đã hiển thị sẵn tin nhắn chuẩn 8 mục (kèm chi tiết BTVN). Bạn có thể sao chép gửi ngay hoặc nhấn AI viết mượt hơn cho cả lớp.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleBulkSaveQuickMessages()}
                      disabled={bulkSavingMsgs || bulkAiProgress !== null}
                      className="min-h-[42px] px-3.5 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      <span>{bulkSavingMsgs ? 'Đang lưu...' : 'Lưu & Duyệt nhanh cả lớp'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleBulkSynthesizeAI()}
                      disabled={bulkAiProgress !== null || bulkSavingMsgs}
                      className="min-h-[42px] px-4 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>
                        {bulkAiProgress
                          ? `AI đang viết (${bulkAiProgress.current}/${bulkAiProgress.total})...`
                          : 'Tổng hợp AI cả lớp'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyAllParentMessages()}
                      className="min-h-[42px] px-3.5 rounded-xl border border-pink-200 bg-white text-slate-700 text-xs font-semibold hover:bg-pink-50 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-4 h-4 text-[#DB2777]" />
                      <span>
                        {copiedKey === 'copy_all_messages'
                          ? 'Đã sao chép cả lớp!'
                          : 'Sao chép tất cả'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Filter bar */}
                <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-pink-100">
                  {(
                    [
                      { id: 'all', label: `Tất cả (${sessionStudents.length})` },
                      {
                        id: 'unsent',
                        label: `Chưa gửi (${sessionStudents.length - sentMessagesCount})`,
                      },
                      { id: 'sent', label: `Đã gửi (${sentMessagesCount})` },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setMessageFilter(f.id)}
                      className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold cursor-pointer ${
                        messageFilter === f.id
                          ? 'bg-pink-100 text-[#BE185D]'
                          : 'bg-slate-50 text-slate-600 hover:bg-pink-50'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </section>

              {filteredMessageStudents.length === 0 ? (
                <div className="rounded-2xl bg-white border border-pink-100 p-8 text-center text-sm text-slate-500">
                  Không có tin nhắn nào trong nhóm lọc này.
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {filteredMessageStudents.map((st) => {
                    const row = getRow(st.id);
                    const absent = isAbsentStatus(row.attendanceStatus);
                    const pMsg = parentMsgByStudent.get(st.id);
                    const msgStatus = pMsg?.status ?? 'not_created';
                    const draftKey = `${activeSession.id}_${st.id}`;
                    const { text: visibleMsg, isAutoPreview } = getVisibleParentMessage(st);
                    const motherZaloUrl = toZaloUrl(st.motherPhone);
                    const fatherZaloUrl = toZaloUrl(st.fatherPhone);
                    const primaryZaloUrl = motherZaloUrl || fatherZaloUrl;
                    const primaryZaloLabel = motherZaloUrl ? 'Zalo mẹ' : 'Zalo bố';
                    const isFocused = focusedMessageStudentId === st.id;

                    return (
                      <article
                        key={st.id}
                        id={`parent-msg-card-${st.id}`}
                        className={`rounded-2xl bg-white border p-5 space-y-3 transition-all ${
                          isFocused
                            ? 'border-[#DB2777] ring-2 ring-pink-200'
                            : msgStatus === 'sent'
                            ? 'border-emerald-200'
                            : 'border-pink-100'
                        }`}
                      >
                        {/* Student & Parent Header */}
                        <div className="flex flex-wrap items-start justify-between gap-2 pb-2.5 border-b border-pink-100">
                          <div className="min-w-0">
                            <h4 className="text-base font-bold text-slate-900">{st.fullName}</h4>
                            <p className="text-xs text-slate-600 mt-0.5">
                              {/^phụ huynh/i.test(st.parentName)
                                ? st.parentName
                                : `Phụ huynh ${st.fullName}`}
                            </p>
                            {(motherZaloUrl || fatherZaloUrl) && (
                              <div className="flex flex-wrap items-center gap-2 mt-1">
                                {motherZaloUrl && st.motherPhone && (
                                  <a
                                    href={motherZaloUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() =>
                                      void handleCopyText(
                                        `msg_${st.id}`,
                                        visibleMsg,
                                        `Đã sao chép tin nhắn em ${st.fullName} và mở Zalo mẹ!`
                                      )
                                    }
                                    className="text-xs font-mono-num text-[#15803D] hover:underline inline-flex items-center gap-1"
                                  >
                                    <Phone className="w-3 h-3 shrink-0" />
                                    <span>Mẹ: {formatPhoneReadable(st.motherPhone)}</span>
                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                  </a>
                                )}
                                {fatherZaloUrl && st.fatherPhone && (
                                  <a
                                    href={fatherZaloUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() =>
                                      void handleCopyText(
                                        `msg_${st.id}`,
                                        visibleMsg,
                                        `Đã sao chép tin nhắn em ${st.fullName} và mở Zalo bố!`
                                      )
                                    }
                                    className="text-xs font-mono-num text-[#15803D] hover:underline inline-flex items-center gap-1"
                                  >
                                    <Phone className="w-3 h-3 shrink-0" />
                                    <span>Bố: {formatPhoneReadable(st.fatherPhone)}</span>
                                    <ExternalLink className="w-3 h-3 shrink-0" />
                                  </a>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-col items-end gap-1">
                            <span
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold ${
                                msgStatus === 'sent'
                                  ? 'bg-[#ECFDF5] text-[#15803D] border border-emerald-200'
                                  : msgStatus === 'approved'
                                  ? 'bg-[#FFF1F5] text-[#BE185D] border border-pink-200'
                                  : msgStatus === 'created'
                                  ? 'bg-pink-50 text-slate-800 border border-pink-100'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {isAutoPreview
                                ? 'Mẫu sẵn sàng gửi'
                                : PARENT_MESSAGE_STATUS_VI[msgStatus]}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {ATTENDANCE_STATUS_VI[row.attendanceStatus]}
                              {!absent ? ` · BTVN: ${HOMEWORK_CHECK_VI[row.homeworkStatus]}` : ''}
                            </span>
                          </div>
                        </div>

                        {aiErrorByStudent[st.id] && (
                          <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">
                            {aiErrorByStudent[st.id]}
                          </p>
                        )}

                        {pMsg?.sentConfirmedAt && (
                          <p className="text-xs font-medium text-[#15803D] bg-emerald-50/70 border border-emerald-200 rounded-xl px-3 py-2">
                            Đã gửi qua {pMsg.sentChannel || 'Zalo phụ huynh'} lúc{' '}
                            {new Date(pMsg.sentConfirmedAt).toLocaleString('vi-VN')}
                          </p>
                        )}

                        {/* Always-Visible Message Editor */}
                        <textarea
                          rows={9}
                          value={visibleMsg}
                          readOnly={msgStatus === 'sent'}
                          onChange={(e) =>
                            setAiDrafts((prev) => ({ ...prev, [draftKey]: e.target.value }))
                          }
                          className={`w-full rounded-xl border p-3 text-sm leading-relaxed ${
                            msgStatus === 'sent'
                              ? 'bg-emerald-50/30 border-emerald-200 text-slate-700'
                              : 'bg-[#FDFBFC] border-pink-200 text-slate-900'
                          }`}
                        />

                        {/* Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {msgStatus !== 'sent' && (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleSynthesizeAI(st)}
                                disabled={aiGeneratingId === st.id || bulkAiProgress !== null}
                                className="min-h-[40px] px-3 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                <span>
                                  {aiGeneratingId === st.id ? 'Đang viết AI...' : 'Viết bằng AI'}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRefreshDraftFromTable(st)}
                                title="Tạo lại nội dung theo dữ liệu mới nhất trên bảng"
                                className="min-h-[40px] px-3 rounded-xl border border-pink-200 bg-white text-slate-700 text-xs font-semibold hover:bg-pink-50 inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <RefreshCw className="w-3.5 h-3.5 text-[#DB2777]" />
                                <span>Đồng bộ bảng</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleApproveMessage(st)}
                                className="min-h-[40px] px-3 rounded-xl bg-pink-50 border border-pink-200 text-[#BE185D] text-xs font-semibold hover:bg-pink-100 inline-flex items-center gap-1.5 cursor-pointer"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Lưu &amp; Duyệt</span>
                              </button>
                            </>
                          )}

                          {primaryZaloUrl && (
                            <a
                              href={primaryZaloUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() =>
                                void handleCopyText(
                                  `msg_${st.id}`,
                                  visibleMsg,
                                  `Đã sao chép tin nhắn em ${st.fullName} — dán (Ctrl+V / Dán) vào cửa sổ ${primaryZaloLabel} vừa mở!`
                                )
                              }
                              className="min-h-[40px] px-3.5 rounded-xl bg-[#ECFDF5] border border-emerald-300 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-1.5"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Sao chép &amp; Mở {primaryZaloLabel}</span>
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyText(
                                `msg_${st.id}`,
                                visibleMsg,
                                `Đã sao chép tin nhắn của em ${st.fullName} — dán ngay vào Zalo phụ huynh!`
                              )
                            }
                            className="min-h-[40px] px-3.5 rounded-xl border border-slate-200 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span>
                              {copiedKey === `msg_${st.id}` ? 'Đã sao chép!' : 'Sao chép'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => void handleDeviceShare(st, visibleMsg)}
                            className="min-h-[40px] px-3 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Chia sẻ</span>
                          </button>

                          {msgStatus !== 'sent' && (
                            <button
                              type="button"
                              onClick={() => {
                                setSendChannel('Zalo phụ huynh');
                                setConfirmSendStudent({
                                  student: st,
                                  content: visibleMsg,
                                });
                              }}
                              className="min-h-[40px] px-3.5 rounded-xl bg-[#15803D] text-white text-xs font-semibold hover:bg-emerald-800 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>Xác nhận đã gửi</span>
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Create Session Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <form
            onSubmit={(e) => void handleCreateSession(e)}
            className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-pink-100"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Mở buổi học mới</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="min-h-[40px] min-w-[40px] rounded-lg hover:bg-slate-100 inline-flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Chọn lớp học *</label>
              <select
                value={newClassId}
                onChange={(e) => setNewClassId(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                required
              >
                <option value="">Chọn lớp...</option>
                {classes
                  .filter((c) => c.status === 'active')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Ngày học</label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Loại buổi học</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as SessionType)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
                >
                  <option value="regular">Buổi định kỳ</option>
                  <option value="makeup">Buổi học bù</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Giờ bắt đầu</label>
                <input
                  type="time"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Giờ kết thúc</label>
                <input
                  type="time"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 rounded-xl bg-[#DB2777] text-white text-sm font-semibold cursor-pointer"
              >
                Mở buổi học
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Reliable Send Confirmation Modal */}
      {confirmSendStudent && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl bg-white p-6 space-y-4 border border-emerald-200">
            <h3 className="text-lg font-bold text-slate-900">Xác nhận đã gửi tin nhắn qua Zalo</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Chỉ xác nhận <strong>Đã gửi</strong> sau khi bạn đã gửi thành công tin nhắn nhận xét tới phụ huynh em{' '}
              <strong>{confirmSendStudent.student.fullName}</strong>. Sau khi xác nhận, hệ thống sẽ lưu lịch sử đã gửi để tiện theo dõi.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Kênh đã gửi</label>
              <select
                value={sendChannel}
                onChange={(e) => setSendChannel(e.target.value)}
                className="w-full min-h-[44px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
              >
                <option value="Zalo phụ huynh">Zalo riêng phụ huynh</option>
                <option value="Nhóm Zalo lớp">Nhóm Zalo lớp</option>
                <option value="Tin nhắn SMS / Messenger">Tin nhắn SMS / Messenger</option>
                <option value="Chia sẻ thiết bị (Zalo / SMS)">Chia sẻ thiết bị (Zalo / SMS)</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSendStudent(null)}
                disabled={confirmingSend}
                className="min-h-[44px] px-4 rounded-xl border border-slate-200 text-sm cursor-pointer"
              >
                Chưa gửi
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmSent()}
                disabled={confirmingSend}
                className="min-h-[44px] px-5 rounded-xl bg-[#15803D] text-white text-sm font-semibold hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
              >
                {confirmingSend ? 'Đang lưu...' : 'Xác nhận Đã gửi'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
