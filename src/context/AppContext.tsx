import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  authEmailToPhone,
  db,
  handleFirestoreError,
  normalizeEmail,
  normalizePhone,
  OperationType,
  phoneToAuthEmail,
} from '../lib/firebase';
import {
  AssessmentRecord,
  AssistantRecord,
  AttendanceRecord,
  ClassEnrollment,
  Classroom,
  HomeworkRecord,
  HomeworkSubmission,
  NotificationRecord,
  ParentMessage,
  ParentRecord,
  Schedule,
  SessionRecord,
  Student,
  StudentSessionReview,
  TeacherProfile,
  UserProfile,
  UserRole,
} from '../types';

export interface PreviewMode {
  activeRole: UserRole;
  studentId?: string;
  parentPhone?: string;
}

interface AppContextValue {
  firebaseUser: FirebaseUser | null;
  userProfile: UserProfile | null;
  teacherProfile: TeacherProfile | null;
  workspaceTeacherId: string;
  isMainTeacher: boolean;
  authReady: boolean;
  dataLoading: boolean;
  authError: string | null;
  authProviderDisabled: boolean;
  effectiveRole: UserRole;
  previewMode: PreviewMode | null;
  setPreviewMode: (mode: PreviewMode | null) => void;
  signInWithGoogle: () => Promise<void>;
  signInWithPhonePassword: (phone: string, password: string) => Promise<void>;
  registerTeacherWithPhonePassword: (fullName: string, phone: string, password: string) => Promise<void>;
  clearAuthError: () => void;
  logout: () => Promise<void>;
  assistants: AssistantRecord[];
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

const OWNER_EMAIL = 'tranthuongnd@gmail.com';

const AppContext = createContext<AppContextValue | null>(null);

function translateAuthError(err: unknown): { message: string; providerDisabled: boolean } {
  const code = (err as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {
        message: 'Bạn đã đóng cửa sổ đăng nhập Google. Vui lòng nhấn nút lại để tiếp tục.',
        providerDisabled: false,
      };
    case 'auth/popup-blocked':
      return {
        message: 'Trình duyệt đang chặn cửa sổ bật lên (popup). Hãy cho phép popup rồi nhấn Đăng nhập Google lại.',
        providerDisabled: false,
      };
    case 'auth/operation-not-allowed':
      return {
        message:
          'Dự án Firebase hiện chưa bật đăng nhập bằng Mật khẩu (Email/Password). Bạn có thể dùng nút "Đăng nhập nhanh bằng Google" ở ngay phía trên để vào luôn mà không cần cấu hình thêm!',
        providerDisabled: true,
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        message: 'Số điện thoại hoặc mật khẩu không đúng. Vui lòng kiểm tra lại thông tin được cấp.',
        providerDisabled: false,
      };
    case 'auth/email-already-in-use':
      return {
        message: 'Số điện thoại này đã được đăng ký tài khoản. Vui lòng chuyển sang mục Đăng nhập.',
        providerDisabled: false,
      };
    case 'auth/weak-password':
      return {
        message: 'Mật khẩu quá ngắn. Vui lòng nhập tối thiểu 6 ký tự.',
        providerDisabled: false,
      };
    case 'auth/too-many-requests':
      return {
        message: 'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng đợi ít phút rồi thử lại.',
        providerDisabled: false,
      };
    case 'auth/network-request-failed':
      return {
        message: 'Mất kết nối mạng. Vui lòng kiểm tra Internet và thử lại.',
        providerDisabled: false,
      };
    default:
      return {
        message: 'Không thể đăng nhập lúc này. Vui lòng thử lại hoặc dùng nút Đăng nhập bằng Google.',
        providerDisabled: false,
      };
  }
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<TeacherProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authProviderDisabled, setAuthProviderDisabled] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode | null>(null);

  const [assistants, setAssistants] = useState<AssistantRecord[]>([]);
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [parents, setParents] = useState<ParentRecord[]>([]);
  const [enrollments, setEnrollments] = useState<ClassEnrollment[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [homework, setHomework] = useState<HomeworkRecord[]>([]);
  const [submissions, setSubmissions] = useState<HomeworkSubmission[]>([]);
  const [assessments, setAssessments] = useState<AssessmentRecord[]>([]);
  const [reviews, setReviews] = useState<StudentSessionReview[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [parentMessages, setParentMessages] = useState<ParentMessage[]>([]);

  const clearData = () => {
    setAssistants([]);
    setClasses([]);
    setStudents([]);
    setParents([]);
    setEnrollments([]);
    setSchedules([]);
    setSessions([]);
    setAttendance([]);
    setHomework([]);
    setSubmissions([]);
    setAssessments([]);
    setReviews([]);
    setNotifications([]);
    setParentMessages([]);
    setTeacherProfile(null);
    setPreviewMode(null);
  };

  useEffect(() => {
    const ensureTeacherProfileDoc = async (
      uid: string,
      displayName: string,
      email: string,
      phone: string
    ) => {
      const tRef = doc(db, 'teachers', uid);
      const tSnap = await getDoc(tRef);
      if (!tSnap.exists()) {
        await setDoc(tRef, {
          teacherId: uid,
          fullName: displayName.slice(0, 120) || 'Giáo viên',
          email: email.slice(0, 160),
          phone: phone.slice(0, 30),
          subjectSpecialty: '',
          tuitionRule: 'present_and_makeup',
          defaultFeePerSession: 150000,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    };

    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthError(null);

      if (!user) {
        setUserProfile(null);
        clearData();
        setAuthReady(true);
        return;
      }

      const authEmail = normalizeEmail(user.email) || `${user.uid}@phone.smartteaching.app`;
      const phone = authEmailToPhone(authEmail);
      const isVerifiedOwner = Boolean(user.emailVerified && authEmail === OWNER_EMAIL);

      try {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        // 1. Check if this user is an invited active Teaching Assistant (Trợ giảng)
        // Skip for the verified workspace owner so the main teacher is always TEACHER.
        let activeInvite: AssistantRecord | null = null;
        if (!isVerifiedOwner) {
          try {
            const byUidSnap = await getDocs(
              query(collection(db, 'assistants'), where('assistantUid', '==', user.uid))
            );
            const uidMatch = byUidSnap.docs
              .map((d) => d.data() as AssistantRecord)
              .find((a) => a.status === 'active' && a.teacherId !== user.uid);
            if (uidMatch) {
              activeInvite = uidMatch;
            } else if (user.emailVerified && authEmail.includes('@')) {
              const byEmailSnap = await getDocs(
                query(collection(db, 'assistants'), where('email', '==', authEmail))
              );
              const emailMatch = byEmailSnap.docs
                .map((d) => d.data() as AssistantRecord)
                .find((a) => a.status === 'active' && a.teacherId !== user.uid);
              if (emailMatch) {
                activeInvite = emailMatch;
              }
            }
          } catch {
            activeInvite = null;
          }
        }

        if (activeInvite) {
          // Link Firebase UID onto assistant invite doc (Tier 2 update) if not yet linked
          if (activeInvite.assistantUid !== user.uid && user.emailVerified) {
            await updateDoc(doc(db, 'assistants', activeInvite.id), {
              assistantUid: user.uid,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
          }

          // Ensure teacher_staff lookup gate exists for instant shared-workspace access
          const staffId = `${activeInvite.teacherId}_${user.uid}`;
          const staffRef = doc(db, 'teacher_staff', staffId);
          const staffSnap = await getDoc(staffRef);
          if (!staffSnap.exists()) {
            await setDoc(staffRef, {
              id: staffId,
              teacherId: activeInvite.teacherId,
              assistantUid: user.uid,
              assistantId: activeInvite.id,
              status: 'active',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }

          const resolvedName = (
            activeInvite.fullName ||
            user.displayName ||
            phone ||
            'Trợ giảng'
          ).slice(0, 120);
          const resolvedPhoto = (user.photoURL || '').slice(0, 500);
          const resolvedPhone = (activeInvite.phone || phone || '').slice(0, 30);

          if (userSnap.exists()) {
            const existing = userSnap.data() as UserProfile;
            if (existing.role !== 'ASSISTANT' || existing.teacherId !== activeInvite.teacherId) {
              await updateDoc(userRef, {
                role: 'ASSISTANT',
                teacherId: activeInvite.teacherId,
                displayName: resolvedName,
                phone: resolvedPhone,
                photoURL: resolvedPhoto,
                updatedAt: serverTimestamp(),
              });
            }
            setUserProfile({
              ...existing,
              role: 'ASSISTANT',
              teacherId: activeInvite.teacherId,
              displayName: resolvedName,
              phone: resolvedPhone,
              photoURL: resolvedPhoto,
            });
          } else {
            const assistantProfile: UserProfile = {
              uid: user.uid,
              email: authEmail,
              phone: resolvedPhone,
              displayName: resolvedName,
              photoURL: resolvedPhoto,
              role: 'ASSISTANT',
              teacherId: activeInvite.teacherId,
              linkedStudentIds: [],
            };
            await setDoc(userRef, {
              ...assistantProfile,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
            setUserProfile(assistantProfile);
          }
          return;
        }

        // 2. Existing user document (not an active assistant invite)
        if (userSnap.exists()) {
          const existing = userSnap.data() as UserProfile;

          // Owner recovery: ensure verified main owner always enters as TEACHER
          if (isVerifiedOwner && (existing.role !== 'TEACHER' || existing.teacherId !== user.uid)) {
            const ownerName = (user.displayName || existing.displayName || 'Giáo viên').slice(0, 120);
            await updateDoc(userRef, {
              role: 'TEACHER',
              teacherId: user.uid,
              displayName: ownerName,
              updatedAt: serverTimestamp(),
            });
            await ensureTeacherProfileDoc(user.uid, ownerName, authEmail, phone);
            setUserProfile({
              ...existing,
              role: 'TEACHER',
              teacherId: user.uid,
              displayName: ownerName,
            });
            return;
          }

          // If previously ASSISTANT, verify teacher_staff membership is still active
          if (existing.role === 'ASSISTANT') {
            const staffId = `${existing.teacherId || ''}_${user.uid}`;
            const staffSnap = existing.teacherId
              ? await getDoc(doc(db, 'teacher_staff', staffId)).catch(() => null)
              : null;
            if (!staffSnap || !staffSnap.exists()) {
              // Revoked assistant: cleanly transition back to their own TEACHER workspace
              await updateDoc(userRef, {
                role: 'TEACHER',
                teacherId: user.uid,
                updatedAt: serverTimestamp(),
              });
              await ensureTeacherProfileDoc(
                user.uid,
                existing.displayName || user.displayName || 'Giáo viên',
                authEmail,
                existing.phone || phone
              );
              setUserProfile({
                ...existing,
                role: 'TEACHER',
                teacherId: user.uid,
              });
              return;
            }
          }

          if (existing.role === 'TEACHER') {
            await ensureTeacherProfileDoc(
              user.uid,
              existing.displayName || user.displayName || 'Giáo viên',
              authEmail,
              existing.phone || phone
            );
          }
          setUserProfile(existing);
          return;
        }

        // 3. Brand new user: check optional student/parent UID links, otherwise default to TEACHER
        let detectedRole: UserRole = 'TEACHER';
        let linkedStudentIds: string[] = [];
        let detectedTeacherId = user.uid;

        if (!isVerifiedOwner) {
          try {
            const parentMatches = await getDocs(
              query(collection(db, 'students'), where('parentUids', 'array-contains', user.uid))
            );
            if (!parentMatches.empty) {
              detectedRole = 'PARENT';
              linkedStudentIds = parentMatches.docs.map((d) => d.id).slice(0, 10);
              detectedTeacherId = String(parentMatches.docs[0].data().teacherId ?? '');
            } else {
              const studentMatches = await getDocs(
                query(collection(db, 'students'), where('studentUid', '==', user.uid))
              );
              if (!studentMatches.empty) {
                detectedRole = 'STUDENT';
                linkedStudentIds = studentMatches.docs.map((d) => d.id).slice(0, 10);
                detectedTeacherId = String(studentMatches.docs[0].data().teacherId ?? '');
              }
            }
          } catch {
            detectedRole = 'TEACHER';
          }
        }

        const newProfile: UserProfile = {
          uid: user.uid,
          email: authEmail,
          phone: phone.slice(0, 30),
          displayName: (user.displayName || phone || 'Giáo viên').slice(0, 120),
          photoURL: (user.photoURL || '').slice(0, 500),
          role: detectedRole,
          teacherId: detectedTeacherId,
          linkedStudentIds,
        };

        await setDoc(userRef, {
          ...newProfile,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (detectedRole === 'TEACHER') {
          await ensureTeacherProfileDoc(user.uid, newProfile.displayName, authEmail, phone);
        }
        setUserProfile(newProfile);
      } catch (err) {
        console.error('Lỗi khởi tạo hồ sơ người dùng:', err);
        setAuthError('Không thể tải hồ sơ người dùng từ đám mây. Vui lòng thử lại.');
      } finally {
        setAuthReady(true);
      }
    });

    return () => unsub();
  }, []);

  const workspaceTeacherId = useMemo(() => {
    if (!firebaseUser) return '';
    if (userProfile?.role === 'ASSISTANT' && userProfile.teacherId) {
      return userProfile.teacherId;
    }
    return firebaseUser.uid;
  }, [firebaseUser, userProfile]);

  const isMainTeacher = useMemo(() => {
    return Boolean(userProfile && userProfile.role === 'TEACHER');
  }, [userProfile]);

  // Attach real-time Firestore listeners ONLY when auth is ready and userProfile exists
  useEffect(() => {
    if (!authReady || !firebaseUser || !userProfile) {
      return;
    }

    setDataLoading(true);
    const uid = firebaseUser.uid;
    const role = userProfile.role;
    const targetTeacherId =
      role === 'ASSISTANT' && userProfile.teacherId ? userProfile.teacherId : uid;
    const unsubs: Array<() => void> = [];

    const subscribeQuery = <T,>(
      pathName: string,
      q: ReturnType<typeof query>,
      setter: React.Dispatch<React.SetStateAction<T[]>>
    ) => {
      const unsub = onSnapshot(
        q,
        (snap) => {
          setter(snap.docs.map((d) => ({ ...(d.data() as T) })));
          setDataLoading(false);
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, pathName);
        }
      );
      unsubs.push(unsub);
    };

    if (role === 'TEACHER' || role === 'ASSISTANT') {
      unsubs.push(
        onSnapshot(
          doc(db, 'teachers', targetTeacherId),
          (snap) => {
            if (snap.exists()) setTeacherProfile(snap.data() as TeacherProfile);
          },
          (err) => handleFirestoreError(err, OperationType.GET, `teachers/${targetTeacherId}`)
        )
      );

      if (role === 'TEACHER') {
        subscribeQuery<AssistantRecord>(
          'assistants',
          query(collection(db, 'assistants'), where('teacherId', '==', uid)),
          setAssistants
        );
      } else {
        setAssistants([]);
      }

      subscribeQuery<Classroom>('classes', query(collection(db, 'classes'), where('teacherId', '==', targetTeacherId)), setClasses);
      subscribeQuery<Student>('students', query(collection(db, 'students'), where('teacherId', '==', targetTeacherId)), setStudents);
      subscribeQuery<ParentRecord>('parents', query(collection(db, 'parents'), where('teacherId', '==', targetTeacherId)), setParents);
      subscribeQuery<ClassEnrollment>('class_enrollments', query(collection(db, 'class_enrollments'), where('teacherId', '==', targetTeacherId)), setEnrollments);
      subscribeQuery<Schedule>('schedules', query(collection(db, 'schedules'), where('teacherId', '==', targetTeacherId)), setSchedules);
      subscribeQuery<SessionRecord>('sessions', query(collection(db, 'sessions'), where('teacherId', '==', targetTeacherId)), setSessions);
      subscribeQuery<AttendanceRecord>('attendance', query(collection(db, 'attendance'), where('teacherId', '==', targetTeacherId)), setAttendance);
      subscribeQuery<HomeworkRecord>('homework', query(collection(db, 'homework'), where('teacherId', '==', targetTeacherId)), setHomework);
      subscribeQuery<HomeworkSubmission>('homework_submissions', query(collection(db, 'homework_submissions'), where('teacherId', '==', targetTeacherId)), setSubmissions);
      subscribeQuery<AssessmentRecord>('assessments', query(collection(db, 'assessments'), where('teacherId', '==', targetTeacherId)), setAssessments);
      subscribeQuery<StudentSessionReview>('student_session_reviews', query(collection(db, 'student_session_reviews'), where('teacherId', '==', targetTeacherId)), setReviews);
      subscribeQuery<NotificationRecord>('notifications', query(collection(db, 'notifications'), where('teacherId', '==', targetTeacherId)), setNotifications);
      subscribeQuery<ParentMessage>('parent_messages', query(collection(db, 'parent_messages'), where('teacherId', '==', targetTeacherId)), setParentMessages);
    } else if (role === 'PARENT') {
      subscribeQuery<Student>('students', query(collection(db, 'students'), where('parentUids', 'array-contains', uid)), setStudents);
      subscribeQuery<ParentRecord>('parents', query(collection(db, 'parents'), where('authUid', '==', uid)), setParents);
      subscribeQuery<ClassEnrollment>('class_enrollments', query(collection(db, 'class_enrollments'), where('parentUids', 'array-contains', uid)), setEnrollments);
      subscribeQuery<Classroom>('classes', query(collection(db, 'classes'), where('memberUids', 'array-contains', uid)), setClasses);
      subscribeQuery<Schedule>('schedules', query(collection(db, 'schedules'), where('memberUids', 'array-contains', uid)), setSchedules);
      subscribeQuery<SessionRecord>('sessions', query(collection(db, 'sessions'), where('memberUids', 'array-contains', uid)), setSessions);
      subscribeQuery<AttendanceRecord>('attendance', query(collection(db, 'attendance'), where('parentUids', 'array-contains', uid)), setAttendance);
      subscribeQuery<HomeworkRecord>('homework', query(collection(db, 'homework'), where('memberUids', 'array-contains', uid)), setHomework);
      subscribeQuery<HomeworkSubmission>('homework_submissions', query(collection(db, 'homework_submissions'), where('parentUids', 'array-contains', uid)), setSubmissions);
      subscribeQuery<AssessmentRecord>('assessments', query(collection(db, 'assessments'), where('parentUids', 'array-contains', uid)), setAssessments);
      subscribeQuery<StudentSessionReview>('student_session_reviews', query(collection(db, 'student_session_reviews'), where('parentUids', 'array-contains', uid)), setReviews);
      subscribeQuery<NotificationRecord>('notifications', query(collection(db, 'notifications'), where('recipientUids', 'array-contains', uid)), setNotifications);
      subscribeQuery<ParentMessage>(
        'parent_messages',
        query(collection(db, 'parent_messages'), where('parentUids', 'array-contains', uid), where('status', 'in', ['approved', 'sent'])),
        setParentMessages
      );
    } else {
      // STUDENT role: strictly own UID data + public reviews only
      subscribeQuery<Student>('students', query(collection(db, 'students'), where('studentUid', '==', uid)), setStudents);
      subscribeQuery<ClassEnrollment>('class_enrollments', query(collection(db, 'class_enrollments'), where('studentUid', '==', uid)), setEnrollments);
      subscribeQuery<Classroom>('classes', query(collection(db, 'classes'), where('memberUids', 'array-contains', uid)), setClasses);
      subscribeQuery<Schedule>('schedules', query(collection(db, 'schedules'), where('memberUids', 'array-contains', uid)), setSchedules);
      subscribeQuery<SessionRecord>('sessions', query(collection(db, 'sessions'), where('memberUids', 'array-contains', uid)), setSessions);
      subscribeQuery<AttendanceRecord>('attendance', query(collection(db, 'attendance'), where('studentUid', '==', uid)), setAttendance);
      subscribeQuery<HomeworkRecord>('homework', query(collection(db, 'homework'), where('memberUids', 'array-contains', uid)), setHomework);
      subscribeQuery<HomeworkSubmission>('homework_submissions', query(collection(db, 'homework_submissions'), where('studentUid', '==', uid)), setSubmissions);
      subscribeQuery<AssessmentRecord>('assessments', query(collection(db, 'assessments'), where('studentUid', '==', uid)), setAssessments);
      subscribeQuery<StudentSessionReview>(
        'student_session_reviews',
        query(collection(db, 'student_session_reviews'), where('studentUid', '==', uid), where('visibleToStudent', '==', true)),
        setReviews
      );
      subscribeQuery<NotificationRecord>('notifications', query(collection(db, 'notifications'), where('recipientUids', 'array-contains', uid)), setNotifications);
    }

    return () => {
      for (const fn of unsubs) fn();
    };
  }, [authReady, firebaseUser, userProfile]);

  const signInWithGoogle = async () => {
    setAuthError(null);
    setAuthProviderDisabled(false);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      const translated = translateAuthError(err);
      setAuthError(translated.message);
      setAuthProviderDisabled(translated.providerDisabled);
    }
  };

  const signInWithPhonePassword = async (phone: string, password: string) => {
    setAuthError(null);
    setAuthProviderDisabled(false);
    const digits = normalizePhone(phone);
    if (digits.length < 8) {
      setAuthError('Vui lòng nhập số điện thoại hợp lệ (tối thiểu 8 chữ số).');
      return;
    }
    if (password.trim().length < 6) {
      setAuthError('Mật khẩu cần có tối thiểu 6 ký tự.');
      return;
    }
    const authEmail = phoneToAuthEmail(digits);
    try {
      await signInWithEmailAndPassword(auth, authEmail, password.trim());
    } catch (err) {
      const translated = translateAuthError(err);
      setAuthError(translated.message);
      setAuthProviderDisabled(translated.providerDisabled);
    }
  };

  const registerTeacherWithPhonePassword = async (fullName: string, phone: string, password: string) => {
    setAuthError(null);
    setAuthProviderDisabled(false);
    const cleanName = fullName.trim();
    const digits = normalizePhone(phone);
    if (!cleanName) {
      setAuthError('Vui lòng nhập họ và tên giáo viên.');
      return;
    }
    if (digits.length < 8) {
      setAuthError('Vui lòng nhập số điện thoại hợp lệ (tối thiểu 8 chữ số).');
      return;
    }
    if (password.trim().length < 6) {
      setAuthError('Mật khẩu cần có tối thiểu 6 ký tự.');
      return;
    }
    const authEmail = phoneToAuthEmail(digits);
    try {
      const cred = await createUserWithEmailAndPassword(auth, authEmail, password.trim());
      await updateProfile(cred.user, { displayName: cleanName.slice(0, 120) }).catch(() => {});
    } catch (err) {
      const translated = translateAuthError(err);
      setAuthError(translated.message);
      setAuthProviderDisabled(translated.providerDisabled);
    }
  };

  const clearAuthError = () => {
    setAuthError(null);
    setAuthProviderDisabled(false);
  };

  const logout = async () => {
    await signOut(auth);
  };

  const effectiveRole: UserRole = useMemo(() => {
    if (!userProfile) return 'TEACHER';
    if (userProfile.role === 'TEACHER' && previewMode) {
      return previewMode.activeRole;
    }
    return userProfile.role;
  }, [userProfile, previewMode]);

  const value: AppContextValue = {
    firebaseUser,
    userProfile,
    teacherProfile,
    workspaceTeacherId,
    isMainTeacher,
    authReady,
    dataLoading,
    authError,
    authProviderDisabled,
    effectiveRole,
    previewMode,
    setPreviewMode: (mode) => {
      if (userProfile?.role === 'TEACHER') {
        setPreviewMode(mode);
      }
    },
    signInWithGoogle,
    signInWithPhonePassword,
    registerTeacherWithPhonePassword,
    clearAuthError,
    logout,
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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp phải được dùng bên trong AppProvider');
  return ctx;
}
