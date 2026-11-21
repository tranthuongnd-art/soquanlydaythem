import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  clampString,
  db,
  generateIssuedPassword,
  handleFirestoreError,
  makeDeterministicPairId,
  makeDeterministicSessionId,
  makeSafeId,
  normalizeEmail,
  normalizeEmailList,
  normalizePhone,
  normalizeUidList,
  OperationType,
  phoneToAuthEmail,
  provisionPhoneAccount,
  storage,
} from '../lib/firebase';
import {
  AssessmentRecord,
  AssistantRecord,
  AttendanceRecord,
  AttendanceStatus,
  AttitudeRating,
  ClassEnrollment,
  Classroom,
  FIELD_LIMITS,
  HomeworkCheckStatus,
  HomeworkRecord,
  HomeworkScope,
  HomeworkSubmission,
  IssuedCredentialItem,
  NotificationCategory,
  NotificationRecord,
  ParentMessage,
  ParentMessageStatus,
  ParentRecord,
  Schedule,
  SessionRecord,
  SessionStatus,
  SessionType,
  Student,
  StudentSessionReview,
  StudentStatus,
  SubmissionStatus,
  TeacherProfile,
  TuitionRule,
} from '../types';

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDefaultParentName(studentFullName: string): string {
  const cleanName = clampString(studentFullName, FIELD_LIMITS.NAME - 10);
  return cleanName ? `Phụ huynh ${cleanName}` : 'Phụ huynh';
}

export function isValidSafeUrl(url: string): boolean {
  if (!url.trim()) return true;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function uploadAttachmentFile(
  teacherId: string,
  folder: 'homework' | 'submissions',
  file: File
): Promise<string> {
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Dung lượng ảnh tối đa là 5MB.');
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_').slice(0, 80);
  const path = `smart_teaching/${teacherId}/${folder}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}

// =========================================================
// TEACHER PROFILE & SETTINGS
// =========================================================
export async function saveTeacherProfile(
  teacherId: string,
  email: string,
  input: {
    fullName: string;
    phone?: string;
    subjectSpecialty?: string;
    tuitionRule: TuitionRule;
    defaultFeePerSession?: number;
  }
): Promise<void> {
  const docRef = doc(db, 'teachers', teacherId);
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, {
        teacherId,
        fullName: clampString(input.fullName, FIELD_LIMITS.NAME) || 'Giáo viên',
        email: normalizeEmail(email),
        phone: clampString(input.phone, FIELD_LIMITS.PHONE),
        subjectSpecialty: clampString(input.subjectSpecialty, FIELD_LIMITS.NAME),
        tuitionRule: input.tuitionRule,
        defaultFeePerSession: Math.max(0, Number(input.defaultFeePerSession) || 150000),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(docRef, {
        fullName: clampString(input.fullName, FIELD_LIMITS.NAME) || 'Giáo viên',
        phone: clampString(input.phone, FIELD_LIMITS.PHONE),
        subjectSpecialty: clampString(input.subjectSpecialty, FIELD_LIMITS.NAME),
        tuitionRule: input.tuitionRule,
        defaultFeePerSession: Math.max(0, Number(input.defaultFeePerSession) || 150000),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `teachers/${teacherId}`);
  }
}

// =========================================================
// CLASSES & SCHEDULES
// =========================================================
export async function createClassroom(
  teacherId: string,
  input: {
    name: string;
    subject: string;
    gradeLevel: string;
    room?: string;
    feePerSession?: number;
  }
): Promise<string> {
  const id = makeSafeId('cls');
  const docRef = doc(db, 'classes', id);
  try {
    await setDoc(docRef, {
      id,
      teacherId,
      name: clampString(input.name, FIELD_LIMITS.NAME),
      subject: clampString(input.subject, FIELD_LIMITS.SHORT_TEXT),
      gradeLevel: clampString(input.gradeLevel, FIELD_LIMITS.STUDENT_CODE),
      room: clampString(input.room, FIELD_LIMITS.SHORT_TEXT),
      feePerSession: Math.max(0, Number(input.feePerSession) || 150000),
      status: 'active',
      memberEmails: [],
      memberUids: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `classes/${id}`);
  }
}

export async function updateClassroom(
  classId: string,
  updates: Partial<
    Pick<Classroom, 'name' | 'subject' | 'gradeLevel' | 'room' | 'feePerSession' | 'status' | 'memberEmails' | 'memberUids'>
  >
): Promise<void> {
  const docRef = doc(db, 'classes', classId);
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.name !== undefined) clean.name = clampString(updates.name, FIELD_LIMITS.NAME);
  if (updates.subject !== undefined) clean.subject = clampString(updates.subject, FIELD_LIMITS.SHORT_TEXT);
  if (updates.gradeLevel !== undefined) clean.gradeLevel = clampString(updates.gradeLevel, FIELD_LIMITS.STUDENT_CODE);
  if (updates.room !== undefined) clean.room = clampString(updates.room, FIELD_LIMITS.SHORT_TEXT);
  if (updates.feePerSession !== undefined) clean.feePerSession = Math.max(0, Number(updates.feePerSession) || 0);
  if (updates.status !== undefined) clean.status = updates.status;
  if (updates.memberEmails !== undefined) clean.memberEmails = normalizeEmailList(updates.memberEmails, 100);
  if (updates.memberUids !== undefined) clean.memberUids = normalizeUidList(updates.memberUids, 100);
  try {
    await updateDoc(docRef, clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `classes/${classId}`);
  }
}

export async function deleteClassroom(classId: string, teacherId?: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'classes', classId));
    if (teacherId) {
      try {
        const [schSnap, enrSnap] = await Promise.all([
          getDocs(query(collection(db, 'schedules'), where('teacherId', '==', teacherId))),
          getDocs(query(collection(db, 'class_enrollments'), where('teacherId', '==', teacherId))),
        ]);
        const docsToDelete = [
          ...schSnap.docs.filter((d) => d.data().classId === classId),
          ...enrSnap.docs.filter((d) => d.data().classId === classId),
        ];
        if (docsToDelete.length > 0) {
          const batch = writeBatch(db);
          for (const d of docsToDelete.slice(0, 400)) {
            batch.delete(d.ref);
          }
          await batch.commit();
        }
      } catch (cleanupErr) {
        console.warn('Dọn lịch/đăng ký sau khi xóa lớp:', cleanupErr);
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `classes/${classId}`);
  }
}

export async function createSchedule(
  teacherId: string,
  classId: string,
  input: { dayOfWeek: number; startTime: string; endTime: string; room?: string },
  memberEmails: string[],
  memberUids: string[] = []
): Promise<string> {
  const id = makeSafeId('sch');
  try {
    await setDoc(doc(db, 'schedules', id), {
      id,
      teacherId,
      classId,
      dayOfWeek: Math.max(0, Math.min(6, Math.trunc(input.dayOfWeek))),
      startTime: clampString(input.startTime, 10),
      endTime: clampString(input.endTime, 10),
      room: clampString(input.room, FIELD_LIMITS.SHORT_TEXT),
      active: true,
      memberEmails: normalizeEmailList(memberEmails, 100),
      memberUids: normalizeUidList(memberUids, 100),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `schedules/${id}`);
  }
}

export async function updateSchedule(
  scheduleId: string,
  updates: Partial<Pick<Schedule, 'dayOfWeek' | 'startTime' | 'endTime' | 'room' | 'active' | 'memberEmails' | 'memberUids'>>
): Promise<void> {
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.dayOfWeek !== undefined) clean.dayOfWeek = Math.max(0, Math.min(6, Math.trunc(updates.dayOfWeek)));
  if (updates.startTime !== undefined) clean.startTime = clampString(updates.startTime, 10);
  if (updates.endTime !== undefined) clean.endTime = clampString(updates.endTime, 10);
  if (updates.room !== undefined) clean.room = clampString(updates.room, FIELD_LIMITS.SHORT_TEXT);
  if (updates.active !== undefined) clean.active = Boolean(updates.active);
  if (updates.memberEmails !== undefined) clean.memberEmails = normalizeEmailList(updates.memberEmails, 100);
  if (updates.memberUids !== undefined) clean.memberUids = normalizeUidList(updates.memberUids, 100);
  try {
    await updateDoc(doc(db, 'schedules', scheduleId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `schedules/${scheduleId}`);
  }
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'schedules', scheduleId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `schedules/${scheduleId}`);
  }
}

// =========================================================
// STUDENTS, PARENTS & ENROLLMENTS (MULTI-CLASS, MULTI-CHILD, PHONE+PASSWORD)
// =========================================================
export async function syncClassMemberEmails(
  teacherId: string,
  classId: string,
  allStudents: Student[],
  allEnrollments: ClassEnrollment[]
): Promise<string[]> {
  const activeStudentIds = new Set(
    allEnrollments
      .filter((e) => e.classId === classId && e.status === 'active')
      .map((e) => e.studentId)
  );
  const emails: string[] = [];
  const uids: string[] = [];
  for (const st of allStudents) {
    if (activeStudentIds.has(st.id)) {
      if (st.studentEmail) emails.push(st.studentEmail);
      if (st.studentUid) uids.push(st.studentUid);
      for (const pe of st.parentEmails || []) emails.push(pe);
      for (const pu of st.parentUids || []) uids.push(pu);
    }
  }
  const normalizedEmails = normalizeEmailList(emails, 100);
  const normalizedUids = normalizeUidList(uids, 100);

  try {
    await updateDoc(doc(db, 'classes', classId), {
      memberEmails: normalizedEmails,
      memberUids: normalizedUids,
      updatedAt: serverTimestamp(),
    });
    const [schSnap, sesSnap, hwSnap] = await Promise.all([
      getDocs(query(collection(db, 'schedules'), where('teacherId', '==', teacherId), where('classId', '==', classId))),
      getDocs(query(collection(db, 'sessions'), where('teacherId', '==', teacherId), where('classId', '==', classId))),
      getDocs(query(collection(db, 'homework'), where('teacherId', '==', teacherId), where('classId', '==', classId))),
    ]);
    const studentById = new Map(allStudents.map((st) => [st.id, st]));
    const batch = writeBatch(db);
    let count = 0;
    for (const d of [...schSnap.docs, ...sesSnap.docs]) {
      batch.update(d.ref, {
        memberEmails: normalizedEmails,
        memberUids: normalizedUids,
        updatedAt: serverTimestamp(),
      });
      count++;
      if (count >= 400) break;
    }
    for (const d of hwSnap.docs) {
      if (count >= 400) break;
      const hwData = d.data();
      if (hwData.scope === 'individual') {
        const assignedIds = Array.isArray(hwData.assignedStudentIds) && hwData.assignedStudentIds.length > 0
          ? (hwData.assignedStudentIds as string[])
          : hwData.assignedStudentId
          ? [String(hwData.assignedStudentId)]
          : [];
        const targetStudents = assignedIds
          .map((sid) => studentById.get(sid))
          .filter((s): s is Student => Boolean(s));
        const indEmails = normalizeEmailList(
          targetStudents.flatMap((s) => [s.studentEmail, ...(s.parentEmails || [])]),
          100
        );
        const indUids = normalizeUidList(
          targetStudents.flatMap((s) => [s.studentUid, ...(s.parentUids || [])]),
          100
        );
        batch.update(d.ref, {
          memberEmails: indEmails,
          memberUids: indUids,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.update(d.ref, {
          memberEmails: normalizedEmails,
          memberUids: normalizedUids,
          updatedAt: serverTimestamp(),
        });
      }
      count++;
    }
    if (count > 0) await batch.commit();
  } catch (err) {
    console.warn('Đồng bộ thành viên lớp:', err);
  }
  return normalizedEmails;
}

export async function syncStudentAccessAcrossRecords(
  teacherId: string,
  student: Student
): Promise<void> {
  const studentEmail = normalizeEmail(student.studentEmail);
  const studentUid = clampString(student.studentUid, FIELD_LIMITS.ID);
  const parentEmails = normalizeEmailList(student.parentEmails, 2);
  const parentUids = normalizeUidList(student.parentUids, 2);

  try {
    const [enrSnap, attSnap, asSnap, revSnap, msgSnap, subSnap] = await Promise.all([
      getDocs(query(collection(db, 'class_enrollments'), where('teacherId', '==', teacherId), where('studentId', '==', student.id))),
      getDocs(query(collection(db, 'attendance'), where('teacherId', '==', teacherId), where('studentId', '==', student.id))),
      getDocs(query(collection(db, 'assessments'), where('teacherId', '==', teacherId), where('studentId', '==', student.id))),
      getDocs(query(collection(db, 'student_session_reviews'), where('teacherId', '==', teacherId), where('studentId', '==', student.id))),
      getDocs(query(collection(db, 'parent_messages'), where('teacherId', '==', teacherId), where('studentId', '==', student.id))),
      getDocs(query(collection(db, 'homework_submissions'), where('teacherId', '==', teacherId), where('studentId', '==', student.id))),
    ]);

    const batch = writeBatch(db);
    let count = 0;

    for (const d of [...enrSnap.docs, ...attSnap.docs, ...asSnap.docs, ...revSnap.docs, ...subSnap.docs]) {
      batch.update(d.ref, {
        studentEmail,
        studentUid,
        parentEmails,
        parentUids,
        updatedAt: serverTimestamp(),
      });
      count++;
      if (count >= 400) break;
    }

    for (const d of msgSnap.docs) {
      if (count >= 450) break;
      if (d.data().status !== 'sent') {
        batch.update(d.ref, {
          parentEmails,
          parentUids,
          updatedAt: serverTimestamp(),
        });
        count++;
      }
    }

    if (count > 0) await batch.commit();
  } catch (err) {
    console.warn('Đồng bộ quyền truy cập học sinh:', err);
  }
}

function makeParentDocId(teacherId: string, phoneDigits: string): string {
  const prefix = teacherId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
  if (phoneDigits.length >= 8) {
    return `par_${prefix}_${phoneDigits}`.slice(0, 120);
  }
  return makeSafeId('par');
}

export interface CreateStudentInput {
  studentCode: string;
  fullName: string;
  dateOfBirth?: string;
  schoolClass?: string;
  parentName: string;
  studentPhone?: string;
  fatherPhone?: string;
  motherPhone?: string;
  contactInfo?: string;
  studentEmail?: string;
  studentUid?: string;
  parentEmails?: string[];
  parentUids?: string[];
  startDate: string;
  status?: StudentStatus;
}

export async function createStudent(
  teacherId: string,
  input: CreateStudentInput
): Promise<Student> {
  const id = makeSafeId('stu');
  const studentPhone = normalizePhone(input.studentPhone);
  const motherPhone = normalizePhone(input.motherPhone);
  const fatherPhone = normalizePhone(input.fatherPhone);

  const derivedStudentEmail =
    normalizeEmail(input.studentEmail) || (studentPhone ? phoneToAuthEmail(studentPhone) : '');

  const derivedParentEmails = normalizeEmailList(
    [
      ...(input.parentEmails ?? []),
      motherPhone ? phoneToAuthEmail(motherPhone) : '',
      fatherPhone ? phoneToAuthEmail(fatherPhone) : '',
    ],
    2
  );

  // Reuse existing parent authUids if teacher already registered that parent phone on a sibling
  const parentPhones = Array.from(new Set([motherPhone, fatherPhone].filter((p) => p.length >= 8))).slice(0, 2);
  const resolvedParentUids = new Set<string>(normalizeUidList(input.parentUids ?? [], 2));

  for (const pPhone of parentPhones) {
    const pId = makeParentDocId(teacherId, pPhone);
    try {
      const pSnap = await getDoc(doc(db, 'parents', pId));
      if (pSnap.exists()) {
        const existingAuthUid = String(pSnap.data().authUid ?? '').trim();
        if (existingAuthUid) resolvedParentUids.add(existingAuthUid);
      }
    } catch {
      // ignore lookup error
    }
  }

  const parentUids = Array.from(resolvedParentUids).slice(0, 2);
  const studentUid = clampString(input.studentUid, FIELD_LIMITS.ID);

  const cleanFullName = clampString(input.fullName, FIELD_LIMITS.NAME);
  const resolvedParentName =
    clampString(input.parentName, FIELD_LIMITS.NAME) || formatDefaultParentName(cleanFullName);

  const payload = {
    id,
    teacherId,
    studentCode: clampString(input.studentCode, FIELD_LIMITS.STUDENT_CODE) || `HS-${Date.now().toString().slice(-4)}`,
    fullName: cleanFullName,
    dateOfBirth: clampString(input.dateOfBirth, 20),
    schoolClass: clampString(input.schoolClass, FIELD_LIMITS.SCHOOL_CLASS),
    parentName: resolvedParentName,
    studentPhone: clampString(input.studentPhone, FIELD_LIMITS.PHONE),
    fatherPhone: clampString(input.fatherPhone, FIELD_LIMITS.PHONE),
    motherPhone: clampString(input.motherPhone, FIELD_LIMITS.PHONE),
    contactInfo: clampString(input.contactInfo, FIELD_LIMITS.CONTACT),
    studentEmail: derivedStudentEmail,
    studentUid,
    parentEmails: derivedParentEmails,
    parentUids,
    startDate: clampString(input.startDate, 20) || todayISO(),
    status: input.status ?? 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'students', id), payload);

    // Upsert parent documents for motherPhone & fatherPhone (supports 1 parent -> multiple children)
    const phonesToUpsert = parentPhones.length > 0 ? parentPhones : [''];
    for (let idx = 0; idx < phonesToUpsert.length; idx++) {
      const pPhone = phonesToUpsert[idx];
      const parentId = makeParentDocId(teacherId, pPhone);
      const parentRef = doc(db, 'parents', parentId);
      const parentEmail = pPhone ? phoneToAuthEmail(pPhone) : derivedParentEmails[0] ?? '';
      const matchedUid = parentUids[idx] ?? '';
      const parentSnap = await getDoc(parentRef);
      if (parentSnap.exists()) {
        const existingIds = (parentSnap.data().studentIds as string[]) || [];
        const merged = Array.from(new Set([...existingIds, id])).slice(0, 10);
        const existingUid = String(parentSnap.data().authUid ?? '');
        await updateDoc(parentRef, {
          fullName: clampString(input.parentName, FIELD_LIMITS.NAME) || (parentSnap.data().fullName as string) || resolvedParentName,
          phone: clampString(pPhone || input.motherPhone || input.fatherPhone, FIELD_LIMITS.PHONE),
          email: parentEmail,
          authUid: matchedUid || existingUid,
          studentIds: merged,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(parentRef, {
          id: parentId,
          teacherId,
          fullName: resolvedParentName,
          email: parentEmail,
          authUid: matchedUid,
          phone: clampString(pPhone || input.motherPhone || input.fatherPhone, FIELD_LIMITS.PHONE),
          relationship: pPhone && pPhone === fatherPhone && pPhone !== motherPhone ? 'Bố' : 'Phụ huynh',
          studentIds: [id],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    return {
      ...payload,
      createdAt: undefined,
      updatedAt: undefined,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `students/${id}`);
  }
}

export async function provisionAccountsForStudent(
  teacherId: string,
  student: Student,
  options: {
    provisionStudent: boolean;
    provisionParents: boolean;
    passwordMode: 'shared' | 'random';
    sharedPassword: string;
    knownParentUidCache?: Map<string, string>;
  }
): Promise<{
  updatedStudent: Student;
  credentials: IssuedCredentialItem[];
  providerDisabled: boolean;
}> {
  const credentials: IssuedCredentialItem[] = [];
  let providerDisabled = false;
  let nextStudentUid = student.studentUid ?? '';
  const nextParentUids = new Set<string>(student.parentUids ?? []);
  const cache = options.knownParentUidCache ?? new Map<string, string>();

  const pickPassword = () =>
    options.passwordMode === 'random'
      ? generateIssuedPassword(8)
      : options.sharedPassword.trim() || generateIssuedPassword(8);

  // 1. Provision Student phone account
  const studentDigits = normalizePhone(student.studentPhone);
  if (options.provisionStudent && studentDigits.length >= 8 && !nextStudentUid) {
    const pwd = pickPassword();
    const res = await provisionPhoneAccount({
      phone: studentDigits,
      password: pwd,
      displayName: student.fullName,
    });
    if (res.status === 'created' && res.uid) {
      nextStudentUid = res.uid;
      credentials.push({
        studentName: student.fullName,
        role: 'STUDENT',
        ownerLabel: student.fullName,
        phone: studentDigits,
        password: pwd,
        status: 'created',
      });
    } else if (res.status === 'provider_disabled') {
      providerDisabled = true;
      credentials.push({
        studentName: student.fullName,
        role: 'STUDENT',
        ownerLabel: student.fullName,
        phone: studentDigits,
        password: '',
        status: 'provider_disabled',
        note: res.message,
      });
    } else if (res.status === 'already_exists') {
      credentials.push({
        studentName: student.fullName,
        role: 'STUDENT',
        ownerLabel: student.fullName,
        phone: studentDigits,
        password: '(Giữ nguyên mật khẩu cũ)',
        status: 'already_exists',
        note: res.message,
      });
    } else {
      credentials.push({
        studentName: student.fullName,
        role: 'STUDENT',
        ownerLabel: student.fullName,
        phone: studentDigits,
        password: '',
        status: 'error',
        note: res.message,
      });
    }
  }

  // 2. Provision Parent phone account(s) (motherPhone & fatherPhone, deduplicated)
  const parentPhones = Array.from(
    new Set(
      [normalizePhone(student.motherPhone), normalizePhone(student.fatherPhone)].filter(
        (p) => p.length >= 8
      )
    )
  ).slice(0, 2);

  if (options.provisionParents && !providerDisabled) {
    for (const pDigits of parentPhones) {
      // Check in-batch cache or existing parent doc first (supports 1 parent -> multiple children!)
      let existingUid = cache.get(pDigits) ?? '';
      const parentId = makeParentDocId(teacherId, pDigits);
      if (!existingUid) {
        try {
          const pSnap = await getDoc(doc(db, 'parents', parentId));
          if (pSnap.exists()) {
            existingUid = String(pSnap.data().authUid ?? '').trim();
          }
        } catch {
          // ignore
        }
      }

      if (existingUid) {
        nextParentUids.add(existingUid);
        cache.set(pDigits, existingUid);
        credentials.push({
          studentName: student.fullName,
          role: 'PARENT',
          ownerLabel: student.parentName,
          phone: pDigits,
          password: '(Dùng chung TK đã cấp trước đó)',
          status: 'already_exists',
          note: 'Đã tự động liên kết với tài khoản phụ huynh có sẵn',
        });
        continue;
      }

      const pwd = pickPassword();
      const res = await provisionPhoneAccount({
        phone: pDigits,
        password: pwd,
        displayName: student.parentName || `Phụ huynh ${student.fullName}`,
      });

      if (res.status === 'created' && res.uid) {
        nextParentUids.add(res.uid);
        cache.set(pDigits, res.uid);
        // Save authUid onto parent doc so siblings reuse it seamlessly
        try {
          const pRef = doc(db, 'parents', parentId);
          const pSnap = await getDoc(pRef);
          if (pSnap.exists()) {
            await updateDoc(pRef, { authUid: res.uid, updatedAt: serverTimestamp() });
          }
        } catch {
          // ignore
        }
        credentials.push({
          studentName: student.fullName,
          role: 'PARENT',
          ownerLabel: student.parentName,
          phone: pDigits,
          password: pwd,
          status: 'created',
        });
      } else if (res.status === 'provider_disabled') {
        providerDisabled = true;
        credentials.push({
          studentName: student.fullName,
          role: 'PARENT',
          ownerLabel: student.parentName,
          phone: pDigits,
          password: '',
          status: 'provider_disabled',
          note: res.message,
        });
        break;
      } else if (res.status === 'already_exists') {
        credentials.push({
          studentName: student.fullName,
          role: 'PARENT',
          ownerLabel: student.parentName,
          phone: pDigits,
          password: '(Giữ nguyên mật khẩu cũ)',
          status: 'already_exists',
          note: res.message,
        });
      } else {
        credentials.push({
          studentName: student.fullName,
          role: 'PARENT',
          ownerLabel: student.parentName,
          phone: pDigits,
          password: '',
          status: 'error',
          note: res.message,
        });
      }
    }
  }

  const finalParentUids = Array.from(nextParentUids).slice(0, 2);
  const changed =
    nextStudentUid !== (student.studentUid ?? '') ||
    JSON.stringify(finalParentUids) !== JSON.stringify(student.parentUids ?? []);

  let updatedStudent = student;
  if (changed) {
    await updateStudent(student.id, {
      studentUid: nextStudentUid,
      parentUids: finalParentUids,
    });
    updatedStudent = {
      ...student,
      studentUid: nextStudentUid,
      parentUids: finalParentUids,
    };
    await syncStudentAccessAcrossRecords(teacherId, updatedStudent);
  }

  return { updatedStudent, credentials, providerDisabled };
}

export async function updateStudent(
  studentId: string,
  updates: Partial<
    Pick<
      Student,
      | 'studentCode'
      | 'fullName'
      | 'dateOfBirth'
      | 'schoolClass'
      | 'parentName'
      | 'studentPhone'
      | 'fatherPhone'
      | 'motherPhone'
      | 'contactInfo'
      | 'studentEmail'
      | 'studentUid'
      | 'parentEmails'
      | 'parentUids'
      | 'startDate'
      | 'status'
    >
  >
): Promise<void> {
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.studentCode !== undefined) clean.studentCode = clampString(updates.studentCode, FIELD_LIMITS.STUDENT_CODE);
  if (updates.fullName !== undefined) clean.fullName = clampString(updates.fullName, FIELD_LIMITS.NAME);
  if (updates.dateOfBirth !== undefined) clean.dateOfBirth = clampString(updates.dateOfBirth, 20);
  if (updates.schoolClass !== undefined) clean.schoolClass = clampString(updates.schoolClass, FIELD_LIMITS.SCHOOL_CLASS);
  if (updates.parentName !== undefined) {
    clean.parentName =
      clampString(updates.parentName, FIELD_LIMITS.NAME) ||
      formatDefaultParentName(updates.fullName ?? '');
  }
  if (updates.studentPhone !== undefined) clean.studentPhone = clampString(updates.studentPhone, FIELD_LIMITS.PHONE);
  if (updates.fatherPhone !== undefined) clean.fatherPhone = clampString(updates.fatherPhone, FIELD_LIMITS.PHONE);
  if (updates.motherPhone !== undefined) clean.motherPhone = clampString(updates.motherPhone, FIELD_LIMITS.PHONE);
  if (updates.contactInfo !== undefined) clean.contactInfo = clampString(updates.contactInfo, FIELD_LIMITS.CONTACT);
  if (updates.studentEmail !== undefined) clean.studentEmail = normalizeEmail(updates.studentEmail);
  if (updates.studentUid !== undefined) clean.studentUid = clampString(updates.studentUid, FIELD_LIMITS.ID);
  if (updates.parentEmails !== undefined) clean.parentEmails = normalizeEmailList(updates.parentEmails, 2);
  if (updates.parentUids !== undefined) clean.parentUids = normalizeUidList(updates.parentUids, 2);
  if (updates.startDate !== undefined) clean.startDate = clampString(updates.startDate, 20);
  if (updates.status !== undefined) clean.status = updates.status;

  try {
    await updateDoc(doc(db, 'students', studentId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `students/${studentId}`);
  }
}

export async function deleteStudent(studentId: string, teacherId?: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'students', studentId));
    if (teacherId) {
      try {
        const enrSnap = await getDocs(
          query(collection(db, 'class_enrollments'), where('teacherId', '==', teacherId))
        );
        const docsToDelete = enrSnap.docs.filter((d) => d.data().studentId === studentId);
        if (docsToDelete.length > 0) {
          const batch = writeBatch(db);
          for (const d of docsToDelete.slice(0, 400)) {
            batch.delete(d.ref);
          }
          await batch.commit();
        }
      } catch (cleanupErr) {
        console.warn('Dọn đăng ký lớp sau khi xóa học sinh:', cleanupErr);
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `students/${studentId}`);
  }
}

export async function deleteStudentsBulk(
  teacherId: string,
  studentIds: string[]
): Promise<{ deletedCount: number; affectedClassIds: string[] }> {
  const uniqueIds = Array.from(new Set(studentIds.filter((id) => id.trim().length > 0)));
  if (uniqueIds.length === 0) return { deletedCount: 0, affectedClassIds: [] };

  const idSet = new Set(uniqueIds);
  const affectedClassIds = new Set<string>();

  try {
    const enrollmentRefsToDelete: Array<ReturnType<typeof doc>> = [];
    try {
      const enrSnap = await getDocs(
        query(collection(db, 'class_enrollments'), where('teacherId', '==', teacherId))
      );
      for (const d of enrSnap.docs) {
        const sId = String(d.data().studentId ?? '');
        if (idSet.has(sId)) {
          enrollmentRefsToDelete.push(d.ref);
          const cId = String(d.data().classId ?? '');
          if (cId) affectedClassIds.add(cId);
        }
      }
    } catch (cleanupErr) {
      console.warn('Tra cứu đăng ký lớp khi xóa nhiều học sinh:', cleanupErr);
    }

    const allRefs = [
      ...uniqueIds.map((sId) => doc(db, 'students', sId)),
      ...enrollmentRefsToDelete,
    ];

    for (let i = 0; i < allRefs.length; i += 400) {
      const batch = writeBatch(db);
      for (const refDoc of allRefs.slice(i, i + 400)) {
        batch.delete(refDoc);
      }
      await batch.commit();
    }

    return {
      deletedCount: uniqueIds.length,
      affectedClassIds: Array.from(affectedClassIds),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `students/bulk(${uniqueIds.length})`);
  }
}

export async function enrollStudentInClass(
  teacherId: string,
  classId: string,
  student: Student
): Promise<string> {
  const id = makeDeterministicPairId(classId, student.id);
  const refDoc = doc(db, 'class_enrollments', id);
  try {
    const snap = await getDoc(refDoc);
    if (snap.exists()) {
      await updateDoc(refDoc, {
        status: 'active',
        studentEmail: normalizeEmail(student.studentEmail),
        studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
        parentEmails: normalizeEmailList(student.parentEmails, 2),
        parentUids: normalizeUidList(student.parentUids, 2),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(refDoc, {
        id,
        teacherId,
        classId,
        studentId: student.id,
        studentEmail: normalizeEmail(student.studentEmail),
        studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
        parentEmails: normalizeEmailList(student.parentEmails, 2),
        parentUids: normalizeUidList(student.parentUids, 2),
        status: 'active',
        enrolledAt: todayISO(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `class_enrollments/${id}`);
  }
}

export async function transferStudentClass(
  teacherId: string,
  fromClassId: string,
  toClassId: string,
  student: Student
): Promise<void> {
  if (fromClassId === toClassId) return;
  const oldId = makeDeterministicPairId(fromClassId, student.id);
  try {
    const oldRef = doc(db, 'class_enrollments', oldId);
    const oldSnap = await getDoc(oldRef);
    if (oldSnap.exists()) {
      await updateDoc(oldRef, {
        status: 'transferred',
        updatedAt: serverTimestamp(),
      });
    }
    await enrollStudentInClass(teacherId, toClassId, student);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `class_enrollments/${oldId}`);
  }
}

export async function removeStudentFromClass(classId: string, studentId: string): Promise<void> {
  const id = makeDeterministicPairId(classId, studentId);
  try {
    await updateDoc(doc(db, 'class_enrollments', id), {
      status: 'withdrawn',
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `class_enrollments/${id}`);
  }
}

// =========================================================
// SESSIONS (ANTI-DUPLICATE DETERMINISTIC ID) & PRIVATE NOTES
// =========================================================
export async function createOrOpenSession(
  teacherId: string,
  classroom: Classroom,
  input: {
    sessionDate: string;
    startTime: string;
    endTime: string;
    sessionType: SessionType;
    lessonContent?: string;
    homeworkSummary?: string;
  }
): Promise<string> {
  const id = makeDeterministicSessionId(classroom.id, input.sessionDate, input.startTime);
  const docRef = doc(db, 'sessions', id);
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return id;
    }
    await setDoc(docRef, {
      id,
      teacherId,
      classId: classroom.id,
      className: clampString(classroom.name, FIELD_LIMITS.NAME),
      sessionDate: clampString(input.sessionDate, 20),
      startTime: clampString(input.startTime, 10),
      endTime: clampString(input.endTime, 10),
      sessionType: input.sessionType,
      lessonContent: clampString(input.lessonContent, FIELD_LIMITS.LESSON_CONTENT),
      homeworkSummary: clampString(input.homeworkSummary, FIELD_LIMITS.HOMEWORK_SUMMARY),
      status: 'draft',
      memberEmails: normalizeEmailList(classroom.memberEmails, 100),
      memberUids: normalizeUidList(classroom.memberUids, 100),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `sessions/${id}`);
  }
}

export async function updateSession(
  sessionId: string,
  updates: Partial<
    Pick<
      SessionRecord,
      'className' | 'sessionDate' | 'startTime' | 'endTime' | 'sessionType' | 'lessonContent' | 'homeworkSummary' | 'status'
    >
  >
): Promise<void> {
  const clean: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (updates.className !== undefined) clean.className = clampString(updates.className, FIELD_LIMITS.NAME);
  if (updates.sessionDate !== undefined) clean.sessionDate = clampString(updates.sessionDate, 20);
  if (updates.startTime !== undefined) clean.startTime = clampString(updates.startTime, 10);
  if (updates.endTime !== undefined) clean.endTime = clampString(updates.endTime, 10);
  if (updates.sessionType !== undefined) clean.sessionType = updates.sessionType;
  if (updates.lessonContent !== undefined) clean.lessonContent = clampString(updates.lessonContent, FIELD_LIMITS.LESSON_CONTENT);
  if (updates.homeworkSummary !== undefined) clean.homeworkSummary = clampString(updates.homeworkSummary, FIELD_LIMITS.HOMEWORK_SUMMARY);
  if (updates.status !== undefined) clean.status = updates.status as SessionStatus;

  try {
    await updateDoc(doc(db, 'sessions', sessionId), clean);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `sessions/${sessionId}`);
  }
}

export async function getSessionPrivateNote(sessionId: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'sessions', sessionId, 'teacher_notes', 'private'));
    return snap.exists() ? String(snap.data().note ?? '') : '';
  } catch {
    return '';
  }
}

export async function saveSessionPrivateNote(
  teacherId: string,
  sessionId: string,
  note: string
): Promise<void> {
  const refDoc = doc(db, 'sessions', sessionId, 'teacher_notes', 'private');
  try {
    await setDoc(refDoc, {
      teacherId,
      note: clampString(note, FIELD_LIMITS.PRIVATE_NOTE),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `sessions/${sessionId}/teacher_notes/private`);
  }
}

// =========================================================
// ATTENDANCE & STUDENT SESSION REVIEWS (ISOLATED PER STUDENT)
// =========================================================
export async function upsertAttendance(
  teacherId: string,
  session: SessionRecord,
  student: Student,
  status: AttendanceStatus,
  reason = ''
): Promise<void> {
  const id = makeDeterministicPairId(session.id, student.id);
  const docRef = doc(db, 'attendance', id);
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await updateDoc(docRef, {
        status,
        reason: clampString(reason, FIELD_LIMITS.REASON),
        studentEmail: normalizeEmail(student.studentEmail),
        studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
        parentEmails: normalizeEmailList(student.parentEmails, 2),
        parentUids: normalizeUidList(student.parentUids, 2),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        id,
        teacherId,
        sessionId: session.id,
        classId: session.classId,
        studentId: student.id,
        sessionDate: session.sessionDate,
        sessionType: session.sessionType,
        status,
        reason: clampString(reason, FIELD_LIMITS.REASON),
        studentEmail: normalizeEmail(student.studentEmail),
        studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
        parentEmails: normalizeEmailList(student.parentEmails, 2),
        parentUids: normalizeUidList(student.parentUids, 2),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `attendance/${id}`);
  }
}

export async function markAllPresent(
  teacherId: string,
  session: SessionRecord,
  students: Student[]
): Promise<void> {
  await Promise.all(
    students.map((st) =>
      upsertAttendance(teacherId, session, st, session.sessionType === 'makeup' ? 'makeup' : 'present', '')
    )
  );
}

export async function upsertStudentReview(
  teacherId: string,
  session: SessionRecord,
  student: Student,
  input: {
    homeworkStatus: HomeworkCheckStatus;
    homeworkNote?: string;
    attitudeRating: AttitudeRating;
    attitudeComment?: string;
    hasTestScore: boolean;
    testScore?: number;
    testMaxScore?: number;
    weakTopics?: string;
    parentPrivateMessage?: string;
    visibleToStudent?: boolean;
  }
): Promise<string> {
  const id = makeDeterministicPairId(session.id, student.id);
  const docRef = doc(db, 'student_session_reviews', id);
  const baseFields: Record<string, unknown> = {
    homeworkStatus: input.homeworkStatus,
    homeworkNote: clampString(input.homeworkNote, FIELD_LIMITS.HOMEWORK_NOTE),
    attitudeRating: input.attitudeRating,
    attitudeComment: clampString(input.attitudeComment, FIELD_LIMITS.COMMENT),
    hasTestScore: Boolean(input.hasTestScore),
    weakTopics: clampString(input.weakTopics, FIELD_LIMITS.WEAK_TOPICS),
    parentPrivateMessage: clampString(input.parentPrivateMessage, FIELD_LIMITS.PRIVATE_MSG),
    visibleToStudent: input.visibleToStudent ?? true,
    studentEmail: normalizeEmail(student.studentEmail),
    studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
    parentEmails: normalizeEmailList(student.parentEmails, 2),
    parentUids: normalizeUidList(student.parentUids, 2),
    updatedAt: serverTimestamp(),
  };

  if (input.hasTestScore && typeof input.testScore === 'number' && !Number.isNaN(input.testScore)) {
    baseFields.testScore = Math.max(0, Math.min(1000, input.testScore));
    baseFields.testMaxScore = Math.max(1, Math.min(1000, input.testMaxScore ?? 10));
  }

  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await updateDoc(docRef, baseFields);
    } else {
      await setDoc(docRef, {
        id,
        teacherId,
        sessionId: session.id,
        classId: session.classId,
        studentId: student.id,
        sessionDate: session.sessionDate,
        ...baseFields,
        createdAt: serverTimestamp(),
      });
    }

    if (input.hasTestScore && typeof input.testScore === 'number' && !Number.isNaN(input.testScore)) {
      const assessId = makeDeterministicPairId(`as_${session.id}`, student.id);
      const assessRef = doc(db, 'assessments', assessId);
      const assessSnap = await getDoc(assessRef);
      const maxScore = Math.max(1, Math.min(1000, input.testMaxScore ?? 10));
      if (assessSnap.exists()) {
        await updateDoc(assessRef, {
          score: Math.max(0, Math.min(1000, input.testScore)),
          maxScore,
          comment: clampString(input.attitudeComment, 500),
          studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
          parentUids: normalizeUidList(student.parentUids, 2),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(assessRef, {
          id: assessId,
          teacherId,
          classId: session.classId,
          sessionId: session.id,
          studentId: student.id,
          title: `Kiểm tra buổi ${session.sessionDate}`,
          score: Math.max(0, Math.min(1000, input.testScore)),
          maxScore,
          assessedDate: session.sessionDate,
          comment: clampString(input.attitudeComment, 500),
          studentEmail: normalizeEmail(student.studentEmail),
          studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
          parentEmails: normalizeEmailList(student.parentEmails, 2),
          parentUids: normalizeUidList(student.parentUids, 2),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `student_session_reviews/${id}`);
  }
}

export async function getStudentReviewPrivateNote(reviewId: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, 'student_session_reviews', reviewId, 'private_notes', 'private'));
    return snap.exists() ? String(snap.data().note ?? '') : '';
  } catch {
    return '';
  }
}

export async function saveStudentReviewPrivateNote(
  teacherId: string,
  reviewId: string,
  note: string
): Promise<void> {
  const refDoc = doc(db, 'student_session_reviews', reviewId, 'private_notes', 'private');
  try {
    await setDoc(refDoc, {
      teacherId,
      note: clampString(note, FIELD_LIMITS.PRIVATE_NOTE),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `student_session_reviews/${reviewId}/private_notes/private`);
  }
}

// =========================================================
// PARENT MESSAGES (AI SYNTHESIS + APPROVAL + RELIABLE SEND)
// =========================================================
export async function upsertParentMessage(
  teacherId: string,
  session: SessionRecord,
  student: Student,
  content: string,
  status: Exclude<ParentMessageStatus, 'sent'>
): Promise<string> {
  const id = makeDeterministicPairId(session.id, student.id);
  const docRef = doc(db, 'parent_messages', id);
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await updateDoc(docRef, {
        content: clampString(content, FIELD_LIMITS.MESSAGE_CONTENT),
        status,
        parentEmails: normalizeEmailList(student.parentEmails, 2),
        parentUids: normalizeUidList(student.parentUids, 2),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        id,
        teacherId,
        sessionId: session.id,
        classId: session.classId,
        studentId: student.id,
        sessionDate: session.sessionDate,
        className: clampString(session.className, FIELD_LIMITS.NAME),
        studentName: clampString(student.fullName, FIELD_LIMITS.NAME),
        content: clampString(content, FIELD_LIMITS.MESSAGE_CONTENT),
        status,
        parentEmails: normalizeEmailList(student.parentEmails, 2),
        parentUids: normalizeUidList(student.parentUids, 2),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `parent_messages/${id}`);
  }
}

export async function confirmParentMessageSent(
  messageId: string,
  content: string,
  channel: string
): Promise<void> {
  const docRef = doc(db, 'parent_messages', messageId);
  try {
    await updateDoc(docRef, {
      content: clampString(content, FIELD_LIMITS.MESSAGE_CONTENT),
      status: 'sent',
      sentChannel: clampString(channel, 60),
      sentConfirmedAt: new Date().toISOString(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `parent_messages/${messageId}`);
  }
}

// =========================================================
// HOMEWORK & SUBMISSIONS
// =========================================================
export async function createHomework(
  teacherId: string,
  classroom: Classroom,
  input: {
    title: string;
    description?: string;
    scope: HomeworkScope;
    assignedStudentId?: string;
    assignedStudent?: Student;
    assignedStudents?: Student[];
    dueDate: string;
    attachmentUrl?: string;
    attachmentName?: string;
    targetSkills?: string[];
  }
): Promise<string> {
  const id = makeSafeId('hw');
  const resolvedAssignedStudents: Student[] =
    input.scope === 'individual'
      ? input.assignedStudents && input.assignedStudents.length > 0
        ? input.assignedStudents
        : input.assignedStudent
        ? [input.assignedStudent]
        : []
      : [];

  const assignedStudentIds = Array.from(
    new Set(
      resolvedAssignedStudents
        .map((st) => clampString(st.id, FIELD_LIMITS.ID))
        .filter(Boolean)
    )
  ).slice(0, 100);

  if (
    input.scope === 'individual' &&
    assignedStudentIds.length === 0 &&
    input.assignedStudentId
  ) {
    assignedStudentIds.push(clampString(input.assignedStudentId, FIELD_LIMITS.ID));
  }

  const primaryAssignedStudentId =
    input.scope === 'individual'
      ? assignedStudentIds.length === 1
        ? assignedStudentIds[0]
        : ''
      : '';

  const memberEmails =
    input.scope === 'individual' && resolvedAssignedStudents.length > 0
      ? normalizeEmailList(
          resolvedAssignedStudents.flatMap((st) => [st.studentEmail, ...(st.parentEmails || [])]),
          100
        )
      : normalizeEmailList(classroom.memberEmails, 100);
  const memberUids =
    input.scope === 'individual' && resolvedAssignedStudents.length > 0
      ? normalizeUidList(
          resolvedAssignedStudents.flatMap((st) => [st.studentUid, ...(st.parentUids || [])]),
          100
        )
      : normalizeUidList(classroom.memberUids, 100);

  const safeAttachmentUrl =
    input.attachmentUrl && isValidSafeUrl(input.attachmentUrl)
      ? clampString(input.attachmentUrl, FIELD_LIMITS.URL)
      : '';

  try {
    await setDoc(doc(db, 'homework', id), {
      id,
      teacherId,
      classId: classroom.id,
      title: clampString(input.title, 200),
      description: clampString(input.description, FIELD_LIMITS.DESCRIPTION),
      scope: input.scope,
      assignedStudentId: primaryAssignedStudentId,
      assignedStudentIds: input.scope === 'individual' ? assignedStudentIds : [],
      dueDate: clampString(input.dueDate, 20),
      attachmentUrl: safeAttachmentUrl,
      attachmentName: clampString(input.attachmentName, 200),
      targetSkills: (input.targetSkills ?? []).map((s) => clampString(s, 80)).filter(Boolean).slice(0, 10),
      generationSource: 'teacher_manual',
      memberEmails,
      memberUids,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `homework/${id}`);
  }
}

export async function deleteHomework(homeworkId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'homework', homeworkId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `homework/${homeworkId}`);
  }
}

export async function submitStudentHomework(
  homework: HomeworkRecord,
  student: Student,
  answerText: string,
  attachmentUrl = ''
): Promise<void> {
  const id = makeDeterministicPairId(homework.id, student.id);
  const docRef = doc(db, 'homework_submissions', id);
  const safeUrl = attachmentUrl && isValidSafeUrl(attachmentUrl) ? clampString(attachmentUrl, FIELD_LIMITS.URL) : '';
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await updateDoc(docRef, {
        answerText: clampString(answerText, FIELD_LIMITS.ANSWER_TEXT),
        attachmentUrl: safeUrl,
        status: 'submitted',
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(docRef, {
        id,
        teacherId: homework.teacherId,
        homeworkId: homework.id,
        classId: homework.classId,
        studentId: student.id,
        status: 'submitted',
        answerText: clampString(answerText, FIELD_LIMITS.ANSWER_TEXT),
        attachmentUrl: safeUrl,
        teacherFeedback: '',
        studentEmail: normalizeEmail(student.studentEmail),
        studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
        parentEmails: normalizeEmailList(student.parentEmails, 2),
        parentUids: normalizeUidList(student.parentUids, 2),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `homework_submissions/${id}`);
  }
}

export async function gradeHomeworkSubmission(
  teacherId: string,
  homework: HomeworkRecord,
  student: Student,
  input: {
    status: SubmissionStatus;
    teacherFeedback: string;
    score?: number;
  }
): Promise<void> {
  const id = makeDeterministicPairId(homework.id, student.id);
  const docRef = doc(db, 'homework_submissions', id);
  const cleanFields: Record<string, unknown> = {
    status: input.status,
    teacherFeedback: clampString(input.teacherFeedback, FIELD_LIMITS.HOMEWORK_SUMMARY),
    studentEmail: normalizeEmail(student.studentEmail),
    studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
    parentEmails: normalizeEmailList(student.parentEmails, 2),
    parentUids: normalizeUidList(student.parentUids, 2),
    updatedAt: serverTimestamp(),
  };
  if (typeof input.score === 'number' && !Number.isNaN(input.score)) {
    cleanFields.score = Math.max(0, Math.min(100, input.score));
  }
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      await updateDoc(docRef, cleanFields);
    } else {
      await setDoc(docRef, {
        id,
        teacherId,
        homeworkId: homework.id,
        classId: homework.classId,
        studentId: student.id,
        answerText: '',
        attachmentUrl: '',
        ...cleanFields,
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `homework_submissions/${id}`);
  }
}

// =========================================================
// NOTIFICATIONS & ASSESSMENTS
// =========================================================
export async function createNotification(
  teacherId: string,
  input: {
    classId?: string;
    studentId?: string;
    title: string;
    body: string;
    category: NotificationCategory;
    recipientEmails: string[];
    recipientUids?: string[];
  }
): Promise<string> {
  const id = makeSafeId('noti');
  try {
    await setDoc(doc(db, 'notifications', id), {
      id,
      teacherId,
      classId: clampString(input.classId, FIELD_LIMITS.ID),
      studentId: clampString(input.studentId, FIELD_LIMITS.ID),
      title: clampString(input.title, 160),
      body: clampString(input.body, FIELD_LIMITS.LESSON_CONTENT),
      category: input.category,
      recipientEmails: normalizeEmailList(input.recipientEmails, 100),
      recipientUids: normalizeUidList(input.recipientUids ?? [], 100),
      readByEmails: [],
      readByUids: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `notifications/${id}`);
  }
}

export async function createManualAssessment(
  teacherId: string,
  classId: string,
  student: Student,
  input: {
    title: string;
    score: number;
    maxScore: number;
    assessedDate: string;
    comment?: string;
  }
): Promise<string> {
  const id = makeSafeId('as');
  try {
    await setDoc(doc(db, 'assessments', id), {
      id,
      teacherId,
      classId,
      sessionId: '',
      studentId: student.id,
      title: clampString(input.title, 160),
      score: Math.max(0, Math.min(1000, Number(input.score) || 0)),
      maxScore: Math.max(1, Math.min(1000, Number(input.maxScore) || 10)),
      assessedDate: clampString(input.assessedDate, 20) || todayISO(),
      comment: clampString(input.comment, 500),
      studentEmail: normalizeEmail(student.studentEmail),
      studentUid: clampString(student.studentUid, FIELD_LIMITS.ID),
      parentEmails: normalizeEmailList(student.parentEmails, 2),
      parentUids: normalizeUidList(student.parentUids, 2),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `assessments/${id}`);
  }
}

// =========================================================
// CLOUD BACKUP & RESTORE
// =========================================================
export interface WorkspaceBackupPayload {
  version: string;
  exportedAt: string;
  teacherProfile: TeacherProfile | null;
  classes: Classroom[];
  students: Student[];
  parents: ParentRecord[];
  enrollments: ClassEnrollment[];
  schedules: Schedule[];
  sessions: SessionRecord[];
  attendance: AttendanceRecord[];
  homework: HomeworkRecord[];
  submissions: HomeworkSubmission[];
  assessments: AssessmentRecord[];
  reviews: StudentSessionReview[];
  notifications: NotificationRecord[];
  parentMessages: ParentMessage[];
}

export function stripTimestamps<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'createdAt' || k === 'updatedAt') continue;
    result[k] = v;
  }
  return result;
}

export async function restoreWorkspaceBackup(
  teacherId: string,
  backup: WorkspaceBackupPayload
): Promise<{ restoredCount: number }> {
  let restoredCount = 0;

  const orderedGroups: Array<{ col: string; items: Array<Record<string, unknown>> }> = [
    { col: 'classes', items: (backup.classes ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'students', items: (backup.students ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'parents', items: (backup.parents ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'class_enrollments', items: (backup.enrollments ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'schedules', items: (backup.schedules ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'sessions', items: (backup.sessions ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'attendance', items: (backup.attendance ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'homework', items: (backup.homework ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'homework_submissions', items: (backup.submissions ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'assessments', items: (backup.assessments ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'student_session_reviews', items: (backup.reviews ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'notifications', items: (backup.notifications ?? []) as unknown as Array<Record<string, unknown>> },
    { col: 'parent_messages', items: (backup.parentMessages ?? []) as unknown as Array<Record<string, unknown>> },
  ];

  for (const group of orderedGroups) {
    for (const raw of group.items) {
      const id = String(raw.id ?? '');
      if (!id) continue;
      const clean = stripTimestamps(raw);
      clean.teacherId = teacherId;

      // Ensure backward compatibility with backups created before UID fields existed
      if (['classes', 'schedules', 'sessions', 'homework'].includes(group.col) && !Array.isArray(clean.memberUids)) {
        clean.memberUids = [];
      }
      if (
        ['students', 'class_enrollments', 'attendance', 'homework_submissions', 'assessments', 'student_session_reviews', 'parent_messages'].includes(group.col) &&
        !Array.isArray(clean.parentUids)
      ) {
        clean.parentUids = [];
      }
      if (group.col === 'notifications') {
        if (!Array.isArray(clean.recipientUids)) clean.recipientUids = [];
        if (!Array.isArray(clean.readByUids)) clean.readByUids = [];
      }

      const refDoc = doc(db, group.col, id);
      try {
        const snap = await getDoc(refDoc);
        if (!snap.exists()) {
          await setDoc(refDoc, {
            ...clean,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          restoredCount++;
        }
      } catch (err) {
        console.warn(`Bỏ qua bản ghi ${group.col}/${id} khi phục hồi:`, err);
      }
    }
  }

  return { restoredCount };
}

// =========================================================
// TEACHING ASSISTANTS (TRỢ GIẢNG DÙNG CHUNG KHÔNG GIAN)
// =========================================================
export interface AddAssistantResult {
  assistant: AssistantRecord;
  issuedPhone?: string;
  issuedPassword?: string;
  accountStatus?: 'created' | 'already_exists' | 'provider_disabled' | 'invalid' | 'error';
  accountNote?: string;
}

export async function addTeachingAssistant(
  teacherId: string,
  input: {
    fullName: string;
    email?: string;
    phone?: string;
    loginMethod: 'google' | 'phone';
    password?: string;
  }
): Promise<AddAssistantResult> {
  const fullName = clampString(input.fullName, FIELD_LIMITS.NAME);
  if (!fullName) {
    throw new Error('Vui lòng nhập họ và tên trợ giảng.');
  }

  const cleanPhone = normalizePhone(input.phone);
  let resolvedEmail = normalizeEmail(input.email);
  let assistantUid = '';
  let issuedPassword: string | undefined;
  let accountStatus: AddAssistantResult['accountStatus'];
  let accountNote: string | undefined;

  if (input.loginMethod === 'google') {
    if (!resolvedEmail || !resolvedEmail.includes('@')) {
      throw new Error('Vui lòng nhập địa chỉ Gmail hợp lệ của trợ giảng (VD: trogiang@gmail.com).');
    }
  } else {
    if (cleanPhone.length < 8) {
      throw new Error('Vui lòng nhập số điện thoại hợp lệ cho trợ giảng (tối thiểu 8 chữ số).');
    }
    resolvedEmail = phoneToAuthEmail(cleanPhone);
    const pwd = input.password?.trim() && input.password.trim().length >= 6
      ? input.password.trim()
      : generateIssuedPassword();
    issuedPassword = pwd;

    const prov = await provisionPhoneAccount({
      phone: cleanPhone,
      password: pwd,
      displayName: fullName,
    });
    accountStatus = prov.status;
    accountNote = prov.message;
    if (prov.status === 'provider_disabled') {
      throw new Error(
        'Firebase chưa bật đăng nhập Email/Password. Bạn hãy chọn mục "Mời bằng Gmail (Google 1 chạm)" để trợ giảng vào được ngay lập tức!'
      );
    }
    if (prov.status === 'already_exists') {
      throw new Error(
        'Số điện thoại này đã được đăng ký tài khoản trước đó. Hãy dùng Gmail của trợ giảng hoặc số điện thoại khác.'
      );
    }
    if (prov.status !== 'created' || !prov.uid) {
      throw new Error(prov.message || 'Không thể khởi tạo tài khoản trợ giảng.');
    }
    assistantUid = prov.uid;
  }

  const id = makeSafeId('asst');
  const record: AssistantRecord = {
    id,
    teacherId,
    fullName,
    email: clampString(resolvedEmail, FIELD_LIMITS.EMAIL),
    phone: clampString(cleanPhone, FIELD_LIMITS.PHONE),
    assistantUid: clampString(assistantUid, FIELD_LIMITS.ID),
    status: 'active',
  };

  try {
    await setDoc(doc(db, 'assistants', id), {
      ...record,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // If UID is already provisioned (phone+password), immediately activate teacher_staff gate
    if (assistantUid) {
      const staffId = `${teacherId}_${assistantUid}`;
      await setDoc(doc(db, 'teacher_staff', staffId), {
        id: staffId,
        teacherId,
        assistantUid,
        assistantId: id,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    return {
      assistant: record,
      issuedPhone: cleanPhone || undefined,
      issuedPassword,
      accountStatus,
      accountNote,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `assistants/${id}`);
  }
}

export async function deleteTeachingAssistant(
  teacherId: string,
  assistant: AssistantRecord
): Promise<void> {
  try {
    if (assistant.assistantUid) {
      const staffId = `${teacherId}_${assistant.assistantUid}`;
      await deleteDoc(doc(db, 'teacher_staff', staffId)).catch(() => {});
    }
    await deleteDoc(doc(db, 'assistants', assistant.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `assistants/${assistant.id}`);
  }
}
