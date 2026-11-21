import { auth } from '../lib/firebase';
import {
  AttendanceStatus,
  AttitudeRating,
  HomeworkCheckStatus,
  HOMEWORK_CHECK_VI,
  SessionType,
} from '../types';

export interface SynthesizeReviewRequest {
  className: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  sessionType: SessionType;
  lessonContent: string;
  homeworkSummary: string;
  studentName: string;
  parentName: string;
  attendanceStatus: AttendanceStatus;
  attendanceReason: string;
  homeworkStatus: HomeworkCheckStatus;
  homeworkNote: string;
  attitudeRating: AttitudeRating;
  attitudeComment: string;
  hasTestScore: boolean;
  testScore: number | null;
  testMaxScore: number | null;
  weakTopics: string;
  parentPrivateMessage: string;
  teacherName: string;
}

export interface SynthesizeReviewResponse {
  message: string;
  generatedBy: string;
  generatedAt: string;
}

const HOMEWORK_SENTENCE: Record<HomeworkCheckStatus, string> = {
  done_well: 'Em hoàn thành tốt bài tập về nhà, trình bày cẩn thận.',
  done: 'Em đã hoàn thành đầy đủ bài tập về nhà.',
  incomplete: 'Em làm được một phần bài tập về nhà, còn thiếu một số câu.',
  not_done: 'Em chưa hoàn thành bài tập về nhà buổi trước.',
  not_applicable: 'Chưa kiểm tra bài tập về nhà trong buổi này.',
};

const ATTITUDE_SENTENCE: Record<AttitudeRating, string> = {
  excellent: 'Em tập trung tốt, chủ động phát biểu và tiếp thu bài nhanh.',
  good: 'Em học nghiêm túc, hợp tác tốt trong giờ học.',
  needs_focus: 'Em cần giữ sự tập trung hơn và luyện tập thêm để nắm chắc bài.',
  not_applicable: '',
};

/**
 * Tạo ngay mẫu tin nhắn chuẩn 8 mục lịch sự, tự nhiên (hiển thị tức thì để GV xem/sửa/gửi PH
 * mà không phải chờ gọi AI từng em, tuyệt đối không bịa điểm hay nhận xét khi HS nghỉ học).
 */
export function buildStructuredParentMessage(input: SynthesizeReviewRequest): string {
  const isAbsent =
    input.attendanceStatus === 'absent_excused' || input.attendanceStatus === 'absent_unexcused';
  const greetingTarget =
    input.parentName && /^phụ huynh/i.test(input.parentName.trim())
      ? input.parentName.trim()
      : `Phụ huynh em ${input.studentName}`;

  const lines: string[] = [`Kính gửi ${greetingTarget},`, ''];
  let idx = 1;

  lines.push(`${idx++}. Lớp học: ${input.className}`);
  lines.push(
    `${idx++}. Thời gian học: ${input.sessionDate} (${input.startTime} - ${input.endTime}${
      input.sessionType === 'makeup' ? ' · Buổi học bù' : ''
    })`
  );
  lines.push(
    `${idx++}. Nội dung bài học: ${
      input.lessonContent.trim() || 'Học và luyện tập theo tiến độ chương trình của lớp.'
    }`
  );

  // 4. Nhận xét bài tập về nhà (có chi tiết cụ thể nếu GV nhập)
  if (isAbsent) {
    lines.push(`${idx++}. Nhận xét bài tập về nhà: Chưa kiểm tra do em nghỉ buổi học hôm nay.`);
  } else {
    const hwParts: string[] = [HOMEWORK_SENTENCE[input.homeworkStatus]];
    if (input.homeworkNote.trim()) {
      hwParts.push(`Cụ thể: ${input.homeworkNote.trim()}`);
    }
    lines.push(`${idx++}. Nhận xét bài tập về nhà: ${hwParts.join(' ')}`);
  }

  // 5. Tình hình học trên lớp (nếu nghỉ học thì chỉ báo điểm danh, tuyệt đối không nhận xét ý thức)
  if (isAbsent) {
    const absLabel =
      input.attendanceStatus === 'absent_excused' ? 'nghỉ học có phép' : 'nghỉ học không phép';
    const reasonText = input.attendanceReason.trim() ? ` (${input.attendanceReason.trim()})` : '';
    lines.push(
      `${idx++}. Điểm danh: Em ${absLabel}${reasonText}. Gia đình hỗ trợ em xem lại nội dung bài học trên để kịp tiến độ lớp.`
    );
  } else {
    const classParts: string[] = [];
    if (input.attendanceStatus === 'late') {
      classParts.push(
        `Em đến lớp muộn${input.attendanceReason.trim() ? ` (${input.attendanceReason.trim()})` : ''}.`
      );
    } else if (input.attendanceStatus === 'makeup') {
      classParts.push('Em tham gia đầy đủ buổi học bù.');
    }
    if (ATTITUDE_SENTENCE[input.attitudeRating]) {
      classParts.push(ATTITUDE_SENTENCE[input.attitudeRating]);
    }
    if (input.attitudeComment.trim()) {
      classParts.push(input.attitudeComment.trim());
    }
    if (input.weakTopics.trim()) {
      classParts.push(`Kiến thức cần củng cố thêm: ${input.weakTopics.trim()}.`);
    }
    lines.push(
      `${idx++}. Tình hình học trên lớp: ${
        classParts.join(' ') || 'Em tham gia học tập đầy đủ trong buổi học.'
      }`
    );
  }

  // 6. Kết quả kiểm tra (CHỈ hiển thị khi thực sự có điểm)
  if (!isAbsent && input.hasTestScore && input.testScore !== null) {
    const maxScore = input.testMaxScore ?? 10;
    lines.push(`${idx++}. Kết quả kiểm tra: ${input.testScore}/${maxScore} điểm.`);
  }

  // 7. Bài tập về nhà buổi tới
  lines.push(
    `${idx++}. Bài tập về nhà: ${
      input.homeworkSummary.trim() || 'Em ôn lại bài học hôm nay và chuẩn bị cho buổi tới.'
    }`
  );

  // 8. Nhắn gửi riêng với bố mẹ (CHỈ hiển thị khi có nội dung)
  if (input.parentPrivateMessage.trim()) {
    lines.push(`${idx++}. Nhắn gửi riêng với bố mẹ: ${input.parentPrivateMessage.trim()}`);
  }

  lines.push('');
  lines.push(
    `Trân trọng cảm ơn gia đình đã đồng hành cùng em!\n— ${input.teacherName || 'Giáo viên phụ trách'}`
  );

  return lines.join('\n');
}

export interface ClassHomeworkReportRow {
  studentName: string;
  studentCode: string;
  attendanceStatus: AttendanceStatus;
  homeworkStatus: HomeworkCheckStatus;
  homeworkNote: string;
}

/**
 * Tạo bản báo cáo BTVN cụ thể của cả lớp để giáo viên sao chép gửi nhóm Zalo lớp.
 */
export function buildClassHomeworkReportText(params: {
  className: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  homeworkSummary: string;
  teacherName: string;
  rows: ClassHomeworkReportRow[];
}): string {
  const { className, sessionDate, startTime, endTime, homeworkSummary, teacherName, rows } = params;
  const isAbsentRow = (r: ClassHomeworkReportRow) =>
    r.attendanceStatus === 'absent_excused' || r.attendanceStatus === 'absent_unexcused';

  const presentRows = rows.filter((r) => !isAbsentRow(r));
  const absentRows = rows.filter(isAbsentRow);
  const doneWell = presentRows.filter((r) => r.homeworkStatus === 'done_well');
  const done = presentRows.filter((r) => r.homeworkStatus === 'done');
  const incomplete = presentRows.filter((r) => r.homeworkStatus === 'incomplete');
  const notDone = presentRows.filter((r) => r.homeworkStatus === 'not_done');

  const completedCount = doneWell.length + done.length;
  const rate = presentRows.length > 0 ? Math.round((completedCount / presentRows.length) * 100) : 0;

  const lines: string[] = [
    `BÁO CÁO BÀI TẬP VỀ NHÀ – ${className.toUpperCase()}`,
    `Buổi học: ${sessionDate} (${startTime} - ${endTime})`,
    `Tổng sĩ số: ${rows.length} HS | Có mặt: ${presentRows.length} | Nghỉ: ${absentRows.length}`,
    `Tỉ lệ hoàn thành BTVN: ${completedCount}/${presentRows.length} em (${rate}%)`,
    `- Làm tốt: ${doneWell.length} | Đầy đủ: ${done.length} | Làm thiếu: ${incomplete.length} | Chưa làm: ${notDone.length}`,
    '',
  ];

  if (doneWell.length > 0) {
    lines.push('1. Tuyên dương hoàn thành tốt BTVN:');
    for (const r of doneWell) {
      lines.push(`- ${r.studentName}${r.homeworkNote.trim() ? `: ${r.homeworkNote.trim()}` : ''}`);
    }
    lines.push('');
  }

  if (done.length > 0) {
    lines.push('2. Hoàn thành đầy đủ BTVN:');
    for (const r of done) {
      lines.push(`- ${r.studentName}${r.homeworkNote.trim() ? `: ${r.homeworkNote.trim()}` : ''}`);
    }
    lines.push('');
  }

  if (incomplete.length > 0) {
    lines.push('3. Hoàn thành còn thiếu (cần bổ sung):');
    for (const r of incomplete) {
      lines.push(
        `- ${r.studentName}: ${r.homeworkNote.trim() || 'Còn thiếu bài, cần hoàn thiện bổ sung'}`
      );
    }
    lines.push('');
  }

  if (notDone.length > 0) {
    lines.push('4. Chưa làm BTVN (nhờ gia đình nhắc em hoàn thành):');
    for (const r of notDone) {
      lines.push(
        `- ${r.studentName}: ${r.homeworkNote.trim() || 'Chưa nộp/chưa làm bài tập về nhà'}`
      );
    }
    lines.push('');
  }

  if (absentRows.length > 0) {
    lines.push('5. Học sinh nghỉ buổi này (chưa kiểm tra BTVN):');
    for (const r of absentRows) {
      lines.push(
        `- ${r.studentName} (${
          r.attendanceStatus === 'absent_excused' ? 'Nghỉ có phép' : 'Nghỉ không phép'
        })`
      );
    }
    lines.push('');
  }

  const otherRows = presentRows.filter((r) => r.homeworkStatus === 'not_applicable');
  if (otherRows.length > 0) {
    lines.push(`Chưa chấm / Không kiểm tra (${otherRows.length} em): ${otherRows.map((r) => r.studentName).join(', ')}`);
    lines.push('');
  }

  if (homeworkSummary.trim()) {
    lines.push(`Bài tập về nhà giao cho buổi tới:\n${homeworkSummary.trim()}`);
    lines.push('');
  }

  lines.push(`Cảm ơn quý phụ huynh đã phối hợp đôn đốc các con!\n— ${teacherName || 'Giáo viên phụ trách'}`);

  return lines.join('\n');
}

export function getHomeworkLabel(status: HomeworkCheckStatus): string {
  return HOMEWORK_CHECK_VI[status];
}

/**
 * Gọi backend an toàn (/api/ai/synthesize-review) kèm Firebase ID Token.
 * Tuyệt đối không gọi trực tiếp Gemini API từ trình duyệt hay để lộ khóa bí mật.
 */
export async function synthesizeParentReviewWithAI(
  payload: SynthesizeReviewRequest
): Promise<SynthesizeReviewResponse> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Vui lòng đăng nhập trước khi sử dụng tính năng AI.');
  }

  const idToken = await user.getIdToken();
  const response = await fetch('/api/ai/synthesize-review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as { error?: string } & Partial<SynthesizeReviewResponse>;
  if (!response.ok || !data.message) {
    throw new Error(data.error || 'Không thể tổng hợp nhận xét bằng AI. Vui lòng thử lại.');
  }

  return {
    message: data.message,
    generatedBy: data.generatedBy ?? 'gemini-4-hydrogen',
    generatedAt: data.generatedAt ?? new Date().toISOString(),
  };
}

/**
 * Kiến trúc sẵn sàng cho Giai đoạn 2: AI tạo bài tập cá nhân hóa theo lỗ hổng kiến thức của học sinh.
 */
export interface PersonalizedHomeworkPlanRequest {
  studentId: string;
  classId: string;
  subject: string;
  gradeLevel: string;
  weakTopics: string[];
  recentScores: number[];
  difficulty: 'foundation' | 'standard' | 'advanced';
}

export interface PersonalizedHomeworkPlanContract {
  endpoint: '/api/ai/generate-personalized-homework';
  schemaVersion: 'v2-ready';
  payload: PersonalizedHomeworkPlanRequest;
}
