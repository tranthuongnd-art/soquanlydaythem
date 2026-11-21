import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseClientConfig {
  apiKey?: string;
  projectId?: string;
}

function loadFirebaseWebApiKey(): string {
  try {
    const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as FirebaseClientConfig;
      return parsed.apiKey ?? '';
    }
  } catch (err) {
    console.error('Không thể đọc cấu hình Firebase:', err);
  }
  return '';
}

const FIREBASE_WEB_API_KEY = loadFirebaseWebApiKey();

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
}

async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseUser | null> {
  if (!FIREBASE_WEB_API_KEY || !idToken || idToken.length > 4096) {
    return null;
  }
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as {
      users?: Array<{ localId?: string; email?: string; disabled?: boolean }>;
    };
    const user = data.users?.[0];
    if (!user?.localId || user.disabled === true) {
      return null;
    }
    return {
      uid: user.localId,
      email: user.email ?? '',
    };
  } catch {
    return null;
  }
}

function cleanText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

interface SynthesizeReviewPayload {
  className: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  sessionType: 'regular' | 'makeup';
  lessonContent: string;
  homeworkSummary: string;
  studentName: string;
  parentName: string;
  attendanceStatus: 'present' | 'late' | 'absent_excused' | 'absent_unexcused' | 'makeup';
  attendanceReason: string;
  homeworkStatus: 'done_well' | 'done' | 'incomplete' | 'not_done' | 'not_applicable';
  homeworkNote: string;
  attitudeRating: 'excellent' | 'good' | 'needs_focus' | 'not_applicable';
  attitudeComment: string;
  hasTestScore: boolean;
  testScore: number | null;
  testMaxScore: number | null;
  weakTopics: string;
  parentPrivateMessage: string;
  teacherName: string;
}

const ATTENDANCE_LABELS: Record<SynthesizeReviewPayload['attendanceStatus'], string> = {
  present: 'Có mặt đúng giờ',
  late: 'Đi muộn',
  absent_excused: 'Nghỉ học có phép',
  absent_unexcused: 'Nghỉ học không phép',
  makeup: 'Tham gia buổi học bù',
};

const HOMEWORK_LABELS: Record<SynthesizeReviewPayload['homeworkStatus'], string> = {
  done_well: 'Hoàn thành tốt, trình bày cẩn thận',
  done: 'Đã hoàn thành đầy đủ',
  incomplete: 'Hoàn thành một phần, còn thiếu bài',
  not_done: 'Chưa hoàn thành bài tập về nhà',
  not_applicable: 'Không áp dụng / Chưa kiểm tra',
};

const ATTITUDE_LABELS: Record<SynthesizeReviewPayload['attitudeRating'], string> = {
  excellent: 'Tập trung tốt, chủ động phát biểu và tiếp thu nhanh',
  good: 'Nghiêm túc, hợp tác tốt trong giờ học',
  needs_focus: 'Cần tăng cường sự tập trung và luyện tập thêm',
  not_applicable: 'Không áp dụng',
};

function buildPromptForParentReview(input: SynthesizeReviewPayload): { systemInstruction: string; userPrompt: string } {
  const isAbsent = input.attendanceStatus === 'absent_excused' || input.attendanceStatus === 'absent_unexcused';

  const systemInstruction = `Bạn là trợ lý sư phạm chuyên nghiệp của giáo viên dạy thêm tại Việt Nam.
Nhiệm vụ của bạn là soạn thảo tin nhắn nhận xét sau buổi học gửi phụ huynh bằng tiếng Việt tự nhiên, lịch sự, ngắn gọn, ấm áp, mang tính xây dựng và khích lệ.

NGUYÊN TẮC BẮT BUỘC (TUYỆT ĐỐI KHÔNG VI PHẠM):
1. CHỈ sử dụng đúng dữ liệu của học sinh được cung cấp. Tuyệt đối KHÔNG suy diễn, KHÔNG tự bịa thêm điểm số, bài tập hay chi tiết không có trong dữ liệu.
2. KHÔNG dùng từ ngữ tiêu cực hoặc gán nhãn học sinh (tránh các từ như "lười", "kém", "yếu đuối", "chậm chạp"). Thay bằng ngôn ngữ khích lệ, cụ thể và hướng giải pháp (ví dụ: "cần luyện thêm dạng bài...", "cần giữ tập trung hơn ở phần...").
3. NẾU KHÔNG CÓ ĐIỂM KIỂM TRA (hasTestScore = false hoặc không có điểm): Tuyệt đối KHÔNG tạo mục kết quả kiểm tra và KHÔNG tự bịa điểm.
4. NẾU HỌC SINH NGHỈ HỌC (nghỉ có phép hoặc nghỉ không phép): Tuyệt đối KHÔNG nhận xét ý thức hay tình hình học trên lớp của buổi hôm đó! Chỉ thông báo nhẹ nhàng rằng em nghỉ buổi học, cung cấp nội dung bài học của lớp để gia đình nắm bắt và phần bài tập về nhà cần xem lại/bổ sung, cùng lời nhắn riêng nếu có.
5. Nếu không có lời nhắn riêng cho bố mẹ, KHÔNG cần ghi mục số 8.
6. Trình bày gọn gàng, dễ đọc trên điện thoại (Zalo/SMS), dùng cấu trúc rõ ràng, đánh số các mục có dữ liệu theo thứ tự chuẩn:
   - Lời chào lịch sự tới phụ huynh (ví dụ: "Kính gửi phụ huynh em [Tên học sinh],")
   1. Lớp học: ...
   2. Thời gian học: ...
   3. Nội dung bài học: ...
   4. Nhận xét bài tập về nhà: ... (nếu học sinh nghỉ học thì bỏ qua hoặc ghi ngắn gọn rằng chưa kiểm tra do em nghỉ buổi học)
   5. Tình hình học trên lớp: ... (CHỈ viết khi học sinh CÓ MẶT / ĐI MUỘN / HỌC BÙ; nếu học sinh NGHỈ HỌC thì thay bằng thông báo điểm danh "Em nghỉ buổi học hôm nay..." và tuyệt đối không nhận xét ý thức học)
   6. Kết quả kiểm tra: ... (CHỈ hiển thị khi có điểm kiểm tra thực tế)
   7. Bài tập về nhà: ...
   8. Nhắn gửi riêng với bố mẹ: ... (CHỈ hiển thị khi giáo viên có nhập lời nhắn riêng)
   - Lời kết ngắn gọn, trân trọng của giáo viên.
7. Không dùng markdown phức tạp như ** hoặc ### để phụ huynh sao chép gửi qua Zalo/SMS đẹp ngay lập tức. Chỉ dùng văn bản thuần sạch đẹp và xuống dòng hợp lý.`;

  const dataLines: string[] = [
    `Giáo viên: ${input.teacherName || 'Giáo viên phụ trách'}`,
    `Học sinh: ${input.studentName}`,
    `Phụ huynh: ${input.parentName || 'Quý phụ huynh'}`,
    `Tên lớp học: ${input.className}`,
    `Ngày học: ${input.sessionDate}`,
    `Giờ học: ${input.startTime} - ${input.endTime} (${input.sessionType === 'makeup' ? 'Buổi học bù' : 'Buổi học chính khóa'})`,
    `Trạng thái điểm danh: ${ATTENDANCE_LABELS[input.attendanceStatus]}${input.attendanceReason ? ` (Ghi chú: ${input.attendanceReason})` : ''}`,
    `Nội dung bài học của lớp: ${input.lessonContent || 'Chưa cập nhật chi tiết'}`,
    `Bài tập về nhà giao cho buổi tới: ${input.homeworkSummary || 'Không có bài tập bổ sung'}`,
  ];

  if (!isAbsent) {
    dataLines.push(`Kết quả kiểm tra bài tập về nhà: ${HOMEWORK_LABELS[input.homeworkStatus]}`);
    if (input.homeworkNote) {
      dataLines.push(`Nhận xét cụ thể về bài tập về nhà: ${input.homeworkNote}`);
    }
    dataLines.push(`Đánh giá ý thức học tập: ${ATTITUDE_LABELS[input.attitudeRating]}`);
    if (input.attitudeComment) {
      dataLines.push(`Nhận xét chi tiết ý thức học trên lớp: ${input.attitudeComment}`);
    }
    if (input.weakTopics) {
      dataLines.push(`Phần kiến thức cần củng cố thêm: ${input.weakTopics}`);
    }
  } else {
    dataLines.push('LƯU Ý ĐẶC BIỆT: Học sinh NGHỈ HỌC buổi này. Tuyệt đối KHÔNG nhận xét ý thức học tập trên lớp.');
  }

  if (input.hasTestScore && input.testScore !== null && input.testMaxScore !== null) {
    dataLines.push(`Điểm kiểm tra thực tế: ${input.testScore}/${input.testMaxScore}`);
  } else {
    dataLines.push('Điểm kiểm tra: KHÔNG CÓ (không được viết mục kết quả kiểm tra).');
  }

  if (input.parentPrivateMessage) {
    dataLines.push(`Lời nhắn gửi riêng với bố mẹ: ${input.parentPrivateMessage}`);
  } else {
    dataLines.push('Lời nhắn gửi riêng với bố mẹ: KHÔNG CÓ.');
  }

  const userPrompt = `Dựa hoàn toàn vào dữ liệu thực tế dưới đây, hãy viết tin nhắn nhận xét gửi phụ huynh:\n\n${dataLines.join('\n')}`;

  return { systemInstruction, userPrompt };
}

async function generateWithRetry(ai: GoogleGenAI, systemInstruction: string, userPrompt: string): Promise<string> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: userPrompt,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const text = response.text?.trim();
      if (!text) {
        throw new Error('Mô hình AI không trả về nội dung văn bản.');
      }
      return text;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes('429') || msg.includes('503') || msg.includes('500') || msg.includes('UNAVAILABLE');
      if (!isRetryable || attempt === 2) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/ai/synthesize-review', async (req, res) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Vui lòng đăng nhập bằng tài khoản giáo viên trước khi sử dụng AI.' });
      return;
    }

    const verifiedUser = await verifyFirebaseIdToken(token);
    if (!verifiedUser) {
      res.status(403).json({ error: 'Phiên đăng nhập không hợp lệ hoặc email chưa được xác thực.' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'Chưa cấu hình GEMINI_API_KEY trên máy chủ. Vui lòng thiết lập khóa Gemini trong mục Settings > Secrets.',
      });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const validAttendance = new Set(['present', 'late', 'absent_excused', 'absent_unexcused', 'makeup']);
    const validHomework = new Set(['done_well', 'done', 'incomplete', 'not_done', 'not_applicable']);
    const validAttitude = new Set(['excellent', 'good', 'needs_focus', 'not_applicable']);

    const attendanceStatus = validAttendance.has(String(body.attendanceStatus))
      ? (String(body.attendanceStatus) as SynthesizeReviewPayload['attendanceStatus'])
      : 'present';
    const homeworkStatus = validHomework.has(String(body.homeworkStatus))
      ? (String(body.homeworkStatus) as SynthesizeReviewPayload['homeworkStatus'])
      : 'not_applicable';
    const attitudeRating = validAttitude.has(String(body.attitudeRating))
      ? (String(body.attitudeRating) as SynthesizeReviewPayload['attitudeRating'])
      : 'not_applicable';

    const hasTestScore = body.hasTestScore === true;
    const rawScore = typeof body.testScore === 'number' && Number.isFinite(body.testScore) ? body.testScore : null;
    const rawMaxScore =
      typeof body.testMaxScore === 'number' && Number.isFinite(body.testMaxScore) && body.testMaxScore > 0
        ? body.testMaxScore
        : 10;

    const payload: SynthesizeReviewPayload = {
      className: cleanText(body.className, 120),
      sessionDate: cleanText(body.sessionDate, 30),
      startTime: cleanText(body.startTime, 10),
      endTime: cleanText(body.endTime, 10),
      sessionType: body.sessionType === 'makeup' ? 'makeup' : 'regular',
      lessonContent: cleanText(body.lessonContent, 2000),
      homeworkSummary: cleanText(body.homeworkSummary, 1500),
      studentName: cleanText(body.studentName, 120),
      parentName: cleanText(body.parentName, 120),
      attendanceStatus,
      attendanceReason: cleanText(body.attendanceReason, 300),
      homeworkStatus,
      homeworkNote: cleanText(body.homeworkNote, 500),
      attitudeRating,
      attitudeComment: cleanText(body.attitudeComment, 600),
      hasTestScore: hasTestScore && rawScore !== null,
      testScore: hasTestScore ? rawScore : null,
      testMaxScore: hasTestScore ? rawMaxScore : null,
      weakTopics: cleanText(body.weakTopics, 500),
      parentPrivateMessage: cleanText(body.parentPrivateMessage, 1000),
      teacherName: cleanText(body.teacherName, 120),
    };

    if (!payload.className || !payload.studentName || !payload.sessionDate) {
      res.status(400).json({ error: 'Thiếu thông tin bắt buộc (tên lớp, tên học sinh hoặc ngày học).' });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const { systemInstruction, userPrompt } = buildPromptForParentReview(payload);
      const message = await generateWithRetry(ai, systemInstruction, userPrompt);

      res.json({
        message,
        generatedBy: 'gemini-4-hydrogen',
        generatedAt: new Date().toISOString(),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Lỗi không xác định từ Gemini API.';
      console.error('Lỗi AI tổng hợp nhận xét:', errMsg);
      if (errMsg.includes('403') || errMsg.includes('API_KEY_INVALID') || errMsg.includes('PERMISSION_DENIED')) {
        res.status(403).json({
          error: 'Khóa GEMINI_API_KEY không hợp lệ hoặc thiếu quyền truy cập. Vui lòng kiểm tra lại trong Settings > Secrets.',
        });
        return;
      }
      if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
        res.status(429).json({
          error: 'Hệ thống AI tạm thời đạt giới hạn lượt gọi. Vui lòng thử lại sau ít phút.',
        });
        return;
      }
      res.status(502).json({
        error: `Không thể tạo nhận xét AI lúc này: ${errMsg}`,
      });
    }
  });

  const httpServer = http.createServer(app);
  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Sổ Dạy Học Thông Minh server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
