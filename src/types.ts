export type UserRole = 'TEACHER' | 'ASSISTANT' | 'STUDENT' | 'PARENT';

export type TuitionRule = 'present_and_makeup' | 'present_only' | 'present_makeup_unexcused';

export type StudentStatus = 'active' | 'paused' | 'completed';
export type ClassStatus = 'active' | 'archived';
export type EnrollmentStatus = 'active' | 'transferred' | 'withdrawn';
export type SessionType = 'regular' | 'makeup';
export type SessionStatus = 'draft' | 'completed';
export type AttendanceStatus = 'present' | 'late' | 'absent_excused' | 'absent_unexcused' | 'makeup';
export type HomeworkScope = 'class' | 'individual';
export type SubmissionStatus = 'pending' | 'submitted' | 'reviewed' | 'late';
export type HomeworkCheckStatus = 'done_well' | 'done' | 'incomplete' | 'not_done' | 'not_applicable';
export type AttitudeRating = 'excellent' | 'good' | 'needs_focus' | 'not_applicable';
export type NotificationCategory = 'schedule' | 'homework' | 'review' | 'general';
export type ParentMessageStatus = 'not_created' | 'created' | 'approved' | 'sent';

export interface FirestoreTimestampLike {
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
}

export interface UserProfile {
  uid: string;
  email: string;
  phone?: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  teacherId?: string;
  linkedStudentIds?: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface TeacherProfile {
  teacherId: string;
  fullName: string;
  email: string;
  phone?: string;
  subjectSpecialty?: string;
  tuitionRule: TuitionRule;
  defaultFeePerSession?: number;
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface AssistantRecord {
  id: string;
  teacherId: string;
  fullName: string;
  email: string;
  phone?: string;
  assistantUid?: string;
  status: 'active' | 'revoked';
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface Student {
  id: string;
  teacherId: string;
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
  parentEmails: string[];
  parentUids: string[];
  startDate: string;
  status: StudentStatus;
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface ParentRecord {
  id: string;
  teacherId: string;
  fullName: string;
  email?: string;
  authUid?: string;
  phone?: string;
  relationship?: string;
  studentIds: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface Classroom {
  id: string;
  teacherId: string;
  name: string;
  subject: string;
  gradeLevel: string;
  room?: string;
  feePerSession?: number;
  status: ClassStatus;
  memberEmails: string[];
  memberUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface ClassEnrollment {
  id: string;
  teacherId: string;
  classId: string;
  studentId: string;
  studentEmail?: string;
  studentUid?: string;
  parentEmails: string[];
  parentUids: string[];
  status: EnrollmentStatus;
  enrolledAt: string;
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface Schedule {
  id: string;
  teacherId: string;
  classId: string;
  dayOfWeek: number; // 0 = Chủ Nhật, 1 = Thứ 2 ... 6 = Thứ 7
  startTime: string;
  endTime: string;
  room?: string;
  active: boolean;
  memberEmails: string[];
  memberUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface SessionRecord {
  id: string;
  teacherId: string;
  classId: string;
  className: string;
  sessionDate: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  sessionType: SessionType;
  lessonContent?: string;
  homeworkSummary?: string;
  status: SessionStatus;
  memberEmails: string[];
  memberUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface AttendanceRecord {
  id: string;
  teacherId: string;
  sessionId: string;
  classId: string;
  studentId: string;
  sessionDate: string;
  sessionType: SessionType;
  status: AttendanceStatus;
  reason?: string;
  studentEmail?: string;
  studentUid?: string;
  parentEmails: string[];
  parentUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface HomeworkRecord {
  id: string;
  teacherId: string;
  classId: string;
  sessionId?: string;
  title: string;
  description?: string;
  scope: HomeworkScope;
  assignedStudentId?: string;
  assignedStudentIds?: string[];
  dueDate: string;
  attachmentUrl?: string;
  attachmentName?: string;
  targetSkills?: string[];
  generationSource: 'teacher_manual' | 'ai_personalized_v2';
  memberEmails: string[];
  memberUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface HomeworkSubmission {
  id: string;
  teacherId: string;
  homeworkId: string;
  classId: string;
  studentId: string;
  status: SubmissionStatus;
  answerText?: string;
  attachmentUrl?: string;
  teacherFeedback?: string;
  score?: number;
  studentEmail?: string;
  studentUid?: string;
  parentEmails: string[];
  parentUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface AssessmentRecord {
  id: string;
  teacherId: string;
  classId: string;
  sessionId?: string;
  studentId: string;
  title: string;
  score: number;
  maxScore: number;
  assessedDate: string;
  comment?: string;
  studentEmail?: string;
  studentUid?: string;
  parentEmails: string[];
  parentUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface StudentSessionReview {
  id: string;
  teacherId: string;
  sessionId: string;
  classId: string;
  studentId: string;
  sessionDate: string;
  homeworkStatus: HomeworkCheckStatus;
  homeworkNote?: string;
  attitudeRating: AttitudeRating;
  attitudeComment?: string;
  testScore?: number;
  testMaxScore?: number;
  hasTestScore: boolean;
  weakTopics?: string;
  parentPrivateMessage?: string;
  visibleToStudent: boolean;
  studentEmail?: string;
  studentUid?: string;
  parentEmails: string[];
  parentUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface NotificationRecord {
  id: string;
  teacherId: string;
  classId?: string;
  studentId?: string;
  title: string;
  body: string;
  category: NotificationCategory;
  recipientEmails: string[];
  recipientUids: string[];
  readByEmails: string[];
  readByUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface ParentMessage {
  id: string;
  teacherId: string;
  sessionId: string;
  classId: string;
  studentId: string;
  sessionDate: string;
  className: string;
  studentName: string;
  content: string;
  status: ParentMessageStatus;
  sentChannel?: string;
  sentConfirmedAt?: string;
  parentEmails: string[];
  parentUids: string[];
  createdAt?: FirestoreTimestampLike;
  updatedAt?: FirestoreTimestampLike;
}

export interface IssuedCredentialItem {
  studentName: string;
  role: 'STUDENT' | 'PARENT';
  ownerLabel: string;
  phone: string;
  password: string;
  status: 'created' | 'already_exists' | 'provider_disabled' | 'error';
  note?: string;
}

// Blueprint-synchronized field length limits
export const FIELD_LIMITS = {
  ID: 128,
  EMAIL: 160,
  NAME: 120,
  PHONE: 30,
  SHORT_TEXT: 80,
  STUDENT_CODE: 40,
  SCHOOL_CLASS: 60,
  CONTACT: 300,
  REASON: 300,
  HOMEWORK_NOTE: 500,
  WEAK_TOPICS: 500,
  COMMENT: 600,
  PRIVATE_MSG: 1000,
  HOMEWORK_SUMMARY: 1500,
  LESSON_CONTENT: 2000,
  DESCRIPTION: 3000,
  PRIVATE_NOTE: 3000,
  MESSAGE_CONTENT: 4000,
  ANSWER_TEXT: 4000,
  URL: 1000,
} as const;

export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  0: 'Chủ nhật',
  1: 'Thứ 2',
  2: 'Thứ 3',
  3: 'Thứ 4',
  4: 'Thứ 5',
  5: 'Thứ 6',
  6: 'Thứ 7',
};

export const ATTENDANCE_STATUS_VI: Record<AttendanceStatus, string> = {
  present: 'Có mặt',
  late: 'Đi muộn',
  absent_excused: 'Nghỉ có phép',
  absent_unexcused: 'Nghỉ không phép',
  makeup: 'Học bù',
};

export const HOMEWORK_CHECK_VI: Record<HomeworkCheckStatus, string> = {
  done_well: 'Làm tốt',
  done: 'Đầy đủ',
  incomplete: 'Làm thiếu',
  not_done: 'Chưa làm',
  not_applicable: 'Không kiểm tra',
};

export const ATTITUDE_RATING_VI: Record<AttitudeRating, string> = {
  excellent: 'Tập trung tốt',
  good: 'Nghiêm túc',
  needs_focus: 'Cần tập trung hơn',
  not_applicable: 'Không áp dụng',
};

export const PARENT_MESSAGE_STATUS_VI: Record<ParentMessageStatus, string> = {
  not_created: 'Chưa tạo',
  created: 'Đã tạo',
  approved: 'Đã duyệt',
  sent: 'Đã gửi',
};

export const TUITION_RULE_VI: Record<TuitionRule, string> = {
  present_and_makeup: 'Tính buổi có mặt, đi muộn và học bù',
  present_only: 'Chỉ tính buổi có mặt và đi muộn',
  present_makeup_unexcused: 'Tính có mặt, đi muộn, học bù và nghỉ không phép',
};

export const STUDENT_STATUS_VI: Record<StudentStatus, string> = {
  active: 'Đang học',
  paused: 'Tạm nghỉ',
  completed: 'Đã hoàn thành',
};
