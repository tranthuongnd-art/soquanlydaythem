import {
  doc,
  DocumentReference,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  db,
  makeDeterministicPairId,
  makeDeterministicSessionId,
  phoneToAuthEmail,
} from '../lib/firebase';
import { todayISO } from './firestoreService';

function daysAgoISO(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysAheadISO(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function seedDocIfAbsent(
  ref: DocumentReference,
  data: Record<string, unknown>
): Promise<void> {
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Tạo bộ dữ liệu mẫu giả lập 100% (không sử dụng dữ liệu cá nhân thực tế)
 * phục vụ kiểm thử đầy đủ cả 15 thực thể Firestore và cả 3 vai trò.
 * An toàn khi chạy nhiều lần (idempotent): không ghi đè trường bất biến createdAt
 * hoặc các tin nhắn đã ở trạng thái khóa 'sent'.
 */
export async function seedSyntheticDemoData(
  teacherId: string,
  teacherEmail: string,
  teacherName: string,
  teacherPhone = ''
): Promise<void> {
  const today = todayISO();
  const todayDow = new Date().getDay();
  const prevDow = (todayDow + 5) % 7;
  const prefix = teacherId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'tchr';

  // 1. Teacher profile (update safely if already provisioned on sign-in, never overwrite createdAt)
  const teacherRef = doc(db, 'teachers', teacherId);
  const teacherSnap = await getDoc(teacherRef);
  if (teacherSnap.exists()) {
    const existingData = teacherSnap.data();
    const existingName =
      typeof existingData.fullName === 'string' ? existingData.fullName.trim() : '';
    const existingPhone =
      typeof existingData.phone === 'string' ? existingData.phone.trim() : '';
    const existingSpecialty =
      typeof existingData.subjectSpecialty === 'string'
        ? existingData.subjectSpecialty.trim()
        : '';
    const existingFee =
      typeof existingData.defaultFeePerSession === 'number' &&
      existingData.defaultFeePerSession > 0
        ? existingData.defaultFeePerSession
        : 150000;

    await updateDoc(teacherRef, {
      fullName: (existingName || teacherName || 'Cô Minh Thư (Mẫu)').slice(0, 120),
      phone: (existingPhone || teacherPhone || '0900 100 000').slice(0, 30),
      subjectSpecialty: (existingSpecialty || 'Toán học & Tiếng Anh THCS').slice(0, 120),
      tuitionRule: existingData.tuitionRule || 'present_and_makeup',
      defaultFeePerSession: existingFee,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(teacherRef, {
      teacherId,
      fullName: (teacherName || 'Cô Minh Thư (Mẫu)').slice(0, 120),
      email: teacherEmail.toLowerCase().slice(0, 160),
      phone: (teacherPhone || '0900 100 000').slice(0, 30),
      subjectSpecialty: 'Toán học & Tiếng Anh THCS',
      tuitionRule: 'present_and_makeup',
      defaultFeePerSession: 150000,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 2. Classes (3 lớp học mẫu)
  const clsMath9 = `demo_${prefix}_toan9`;
  const clsEng7 = `demo_${prefix}_anh7`;
  const clsMath6 = `demo_${prefix}_toan6`;

  const studentsData = [
    {
      id: `demo_${prefix}_hs01`,
      studentCode: 'HS-2026-001',
      fullName: 'Nguyễn Minh Anh',
      dateOfBirth: '2012-03-14',
      schoolClass: '9A1 - THCS Chu Văn An (Mẫu)',
      parentName: 'Phụ huynh Nguyễn Minh Anh',
      studentPhone: '0988 000 101',
      fatherPhone: '0900 000 101',
      motherPhone: '0900 000 102',
      contactInfo: 'Zalo phụ huynh hoạt động buổi tối sau 19h',
      studentEmail: phoneToAuthEmail('0988000101'),
      studentUid: '',
      parentEmails: [phoneToAuthEmail('0900000102'), phoneToAuthEmail('0900000101')],
      parentUids: [] as string[],
      classes: [clsMath9, clsEng7], // Tham gia 2 lớp để kiểm thử đa lớp
    },
    {
      id: `demo_${prefix}_hs02`,
      studentCode: 'HS-2026-002',
      fullName: 'Nguyễn Bảo Châu',
      dateOfBirth: '2015-08-22',
      schoolClass: '6A2 - THCS Chu Văn An (Mẫu)',
      parentName: 'Phụ huynh Nguyễn Bảo Châu',
      studentPhone: '0988 000 102',
      fatherPhone: '0900 000 101',
      motherPhone: '0900 000 102',
      contactInfo: 'Em gái Minh Anh, cùng số điện thoại phụ huynh',
      studentEmail: phoneToAuthEmail('0988000102'),
      studentUid: '',
      parentEmails: [phoneToAuthEmail('0900000102'), phoneToAuthEmail('0900000101')],
      parentUids: [] as string[],
      classes: [clsMath6],
    },
    {
      id: `demo_${prefix}_hs03`,
      studentCode: 'HS-2026-003',
      fullName: 'Trần Gia Bảo',
      dateOfBirth: '2012-05-09',
      schoolClass: '9A3 - THCS Nguyễn Du (Mẫu)',
      parentName: 'Phụ huynh Trần Gia Bảo',
      studentPhone: '0988 000 201',
      fatherPhone: '0900 000 201',
      motherPhone: '0900 000 202',
      contactInfo: 'Bố đón lúc 19h30',
      studentEmail: phoneToAuthEmail('0988000201'),
      studentUid: '',
      parentEmails: [phoneToAuthEmail('0900000202'), phoneToAuthEmail('0900000201')],
      parentUids: [] as string[],
      classes: [clsMath9],
    },
    {
      id: `demo_${prefix}_hs04`,
      studentCode: 'HS-2026-004',
      fullName: 'Lê Thảo Vy',
      dateOfBirth: '2012-11-19',
      schoolClass: '9A1 - THCS Chu Văn An (Mẫu)',
      parentName: 'Phụ huynh Lê Thảo Vy',
      studentPhone: '0988 000 301',
      fatherPhone: '0900 000 301',
      motherPhone: '0900 000 302',
      contactInfo: 'Nhờ cô nhắc em luyện thêm hình học không gian',
      studentEmail: phoneToAuthEmail('0988000301'),
      studentUid: '',
      parentEmails: [phoneToAuthEmail('0900000302'), phoneToAuthEmail('0900000301')],
      parentUids: [] as string[],
      classes: [clsMath9],
    },
    {
      id: `demo_${prefix}_hs05`,
      studentCode: 'HS-2026-005',
      fullName: 'Phạm Đức Khang',
      dateOfBirth: '2014-01-25',
      schoolClass: '7B1 - THCS Lê Quý Đôn (Mẫu)',
      parentName: 'Phụ huynh Phạm Đức Khang',
      studentPhone: '0988 000 401',
      fatherPhone: '0900 000 401',
      motherPhone: '0900 000 402',
      contactInfo: 'Cần củng cố từ vựng và kỹ năng viết câu',
      studentEmail: phoneToAuthEmail('0988000401'),
      studentUid: '',
      parentEmails: [phoneToAuthEmail('0900000402'), phoneToAuthEmail('0900000401')],
      parentUids: [] as string[],
      classes: [clsEng7],
    },
    {
      id: `demo_${prefix}_hs06`,
      studentCode: 'HS-2026-006',
      fullName: 'Hoàng Khánh Linh',
      dateOfBirth: '2014-07-04',
      schoolClass: '7B2 - THCS Lê Quý Đôn (Mẫu)',
      parentName: 'Phụ huynh Hoàng Khánh Linh',
      studentPhone: '0988 000 501',
      fatherPhone: '0900 000 501',
      motherPhone: '0900 000 502',
      contactInfo: 'Học đều và rất hào hứng phát biểu',
      studentEmail: phoneToAuthEmail('0988000501'),
      studentUid: '',
      parentEmails: [phoneToAuthEmail('0900000502'), phoneToAuthEmail('0900000501')],
      parentUids: [] as string[],
      classes: [clsEng7],
    },
  ];

  const emailsForClass = (classId: string) =>
    Array.from(
      new Set(
        studentsData
          .filter((s) => s.classes.includes(classId))
          .flatMap((s) => [s.studentEmail, ...s.parentEmails])
      )
    );

  const classesData = [
    {
      id: clsMath9,
      name: 'Toán 9 – Ôn thi vào 10 (Nhóm A)',
      subject: 'Toán học',
      gradeLevel: 'Khối 9',
      room: 'Phòng 201',
      feePerSession: 180000,
    },
    {
      id: clsEng7,
      name: 'Tiếng Anh 7 – Tăng cường giao tiếp & ngữ pháp',
      subject: 'Tiếng Anh',
      gradeLevel: 'Khối 7',
      room: 'Phòng 102',
      feePerSession: 150000,
    },
    {
      id: clsMath6,
      name: 'Toán 6 – Nền tảng tư duy',
      subject: 'Toán học',
      gradeLevel: 'Khối 6',
      room: 'Phòng 101',
      feePerSession: 140000,
    },
  ];

  for (const c of classesData) {
    await seedDocIfAbsent(doc(db, 'classes', c.id), {
      ...c,
      teacherId,
      status: 'active',
      memberEmails: emailsForClass(c.id),
      memberUids: [],
    });
  }

  // 3. Students & Parents
  for (const st of studentsData) {
    await seedDocIfAbsent(doc(db, 'students', st.id), {
      id: st.id,
      teacherId,
      studentCode: st.studentCode,
      fullName: st.fullName,
      dateOfBirth: st.dateOfBirth,
      schoolClass: st.schoolClass,
      parentName: st.parentName,
      studentPhone: st.studentPhone,
      fatherPhone: st.fatherPhone,
      motherPhone: st.motherPhone,
      contactInfo: st.contactInfo,
      studentEmail: st.studentEmail,
      studentUid: st.studentUid,
      parentEmails: st.parentEmails,
      parentUids: st.parentUids,
      startDate: daysAgoISO(45),
      status: 'active',
    });
  }

  const parMultiId = `par_${teacherId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}_0900000102`;
  await seedDocIfAbsent(doc(db, 'parents', parMultiId), {
    id: parMultiId,
    teacherId,
    fullName: 'Phụ huynh Nguyễn Minh Anh',
    email: phoneToAuthEmail('0900000102'),
    authUid: '',
    phone: '0900000102',
    relationship: 'Mẹ',
    studentIds: [studentsData[0].id, studentsData[1].id],
  });

  // 4. Class enrollments
  for (const st of studentsData) {
    for (const cId of st.classes) {
      const enrId = makeDeterministicPairId(cId, st.id);
      await seedDocIfAbsent(doc(db, 'class_enrollments', enrId), {
        id: enrId,
        teacherId,
        classId: cId,
        studentId: st.id,
        studentEmail: st.studentEmail,
        studentUid: '',
        parentEmails: st.parentEmails,
        parentUids: [],
        status: 'active',
        enrolledAt: daysAgoISO(45),
      });
    }
  }

  // 5. Schedules
  const schedulesData = [
    { id: `demo_${prefix}_sch1`, classId: clsMath9, dayOfWeek: todayDow, startTime: '17:30', endTime: '19:00', room: 'Phòng 201' },
    { id: `demo_${prefix}_sch2`, classId: clsMath9, dayOfWeek: prevDow, startTime: '17:30', endTime: '19:00', room: 'Phòng 201' },
    { id: `demo_${prefix}_sch3`, classId: clsEng7, dayOfWeek: todayDow, startTime: '19:15', endTime: '20:45', room: 'Phòng 102' },
    { id: `demo_${prefix}_sch4`, classId: clsMath6, dayOfWeek: (todayDow + 1) % 7, startTime: '17:30', endTime: '19:00', room: 'Phòng 101' },
  ];

  for (const sch of schedulesData) {
    await seedDocIfAbsent(doc(db, 'schedules', sch.id), {
      ...sch,
      teacherId,
      active: true,
      memberEmails: emailsForClass(sch.classId),
      memberUids: [],
    });
  }

  // 6. Sessions
  const sesPastId = makeDeterministicSessionId(clsMath9, daysAgoISO(4), '17:30');
  const sesTodayId = makeDeterministicSessionId(clsMath9, today, '17:30');
  const sesMakeupId = makeDeterministicSessionId(clsEng7, daysAgoISO(2), '19:15');

  const sessionsData = [
    {
      id: sesPastId,
      classId: clsMath9,
      className: classesData[0].name,
      sessionDate: daysAgoISO(4),
      startTime: '17:30',
      endTime: '19:00',
      sessionType: 'regular',
      lessonContent: 'Hệ thức Vi-ét và ứng dụng tìm tham số m trong phương trình bậc hai.',
      homeworkSummary: 'Làm phiếu bài tập số 12 (câu 1 đến câu 6) và ôn lại công thức nghiệm.',
      status: 'completed',
      memberEmails: emailsForClass(clsMath9),
      memberUids: [],
    },
    {
      id: sesTodayId,
      classId: clsMath9,
      className: classesData[0].name,
      sessionDate: today,
      startTime: '17:30',
      endTime: '19:00',
      sessionType: 'regular',
      lessonContent: 'Giải bài toán bằng cách lập hệ phương trình — dạng chuyển động và năng suất.',
      homeworkSummary: 'Hoàn thành 5 bài tập trang 28 sách bổ trợ và chuẩn bị kiểm tra 15 phút buổi sau.',
      status: 'draft',
      memberEmails: emailsForClass(clsMath9),
      memberUids: [],
    },
    {
      id: sesMakeupId,
      classId: clsEng7,
      className: classesData[1].name,
      sessionDate: daysAgoISO(2),
      startTime: '19:15',
      endTime: '20:45',
      sessionType: 'makeup',
      lessonContent: 'Ôn tập thì hiện tại hoàn thành và luyện viết đoạn văn chủ đề Community Service.',
      homeworkSummary: 'Viết đoạn văn 80–100 từ về hoạt động tình nguyện yêu thích.',
      status: 'completed',
      memberEmails: emailsForClass(clsEng7),
      memberUids: [],
    },
  ];

  for (const s of sessionsData) {
    await seedDocIfAbsent(doc(db, 'sessions', s.id), {
      ...s,
      teacherId,
    });
  }

  const privateNoteRef = doc(db, 'sessions', sesTodayId, 'teacher_notes', 'private');
  const privateNoteSnap = await getDoc(privateNoteRef);
  if (!privateNoteSnap.exists()) {
    await setDoc(privateNoteRef, {
      teacherId,
      note: 'Lưu ý nội bộ: Cần cho Gia Bảo thêm 1 bài dẫn nhập dễ trước khi làm dạng năng suất chung riêng.',
      updatedAt: serverTimestamp(),
    });
  }

  // 7. Attendance + Reviews + Assessments + Parent Messages
  const math9Students = studentsData.filter((s) => s.classes.includes(clsMath9));
  const pastScores = [9.0, 7.5, 8.5];

  for (let i = 0; i < math9Students.length; i++) {
    const st = math9Students[i];

    const attPastId = makeDeterministicPairId(sesPastId, st.id);
    await seedDocIfAbsent(doc(db, 'attendance', attPastId), {
      id: attPastId,
      teacherId,
      sessionId: sesPastId,
      classId: clsMath9,
      studentId: st.id,
      sessionDate: daysAgoISO(4),
      sessionType: 'regular',
      status: 'present',
      reason: '',
      studentEmail: st.studentEmail,
      studentUid: '',
      parentEmails: st.parentEmails,
      parentUids: [],
    });

    const revPastId = makeDeterministicPairId(sesPastId, st.id);
    await seedDocIfAbsent(doc(db, 'student_session_reviews', revPastId), {
      id: revPastId,
      teacherId,
      sessionId: sesPastId,
      classId: clsMath9,
      studentId: st.id,
      sessionDate: daysAgoISO(4),
      homeworkStatus: i === 0 ? 'done_well' : 'done',
      homeworkNote:
        i === 0
          ? 'Làm đủ 6/6 câu, trình bày rõ ràng, tự làm thêm câu nâng cao.'
          : i === 1
          ? 'Làm đủ 6/6 câu, còn nhầm dấu ở câu 4b.'
          : 'Hoàn thành đủ bài, trình bày sạch đẹp.',
      attitudeRating: i === 1 ? 'good' : 'excellent',
      attitudeComment:
        i === 0
          ? 'Tiếp thu nhanh, chủ động xung phong chữa bài trên bảng.'
          : i === 1
          ? 'Nghiêm túc chép bài, cần kiểm tra kỹ dấu khi biến đổi Vi-ét.'
          : 'Tập trung tốt, trình bày lời giải sạch đẹp.',
      hasTestScore: true,
      testScore: pastScores[i],
      testMaxScore: 10,
      weakTopics: i === 1 ? 'Biến đổi biểu thức đối xứng với nghiệm x1, x2' : '',
      parentPrivateMessage:
        i === 1 ? 'Nhờ gia đình nhắc em dành 15 phút mỗi tối ôn lại hằng đẳng thức cơ bản ạ.' : '',
      visibleToStudent: true,
      studentEmail: st.studentEmail,
      studentUid: '',
      parentEmails: st.parentEmails,
      parentUids: [],
    });

    const assessId = makeDeterministicPairId(`as_${sesPastId}`, st.id);
    await seedDocIfAbsent(doc(db, 'assessments', assessId), {
      id: assessId,
      teacherId,
      classId: clsMath9,
      sessionId: sesPastId,
      studentId: st.id,
      title: 'Kiểm tra 15 phút – Hệ thức Vi-ét',
      score: pastScores[i],
      maxScore: 10,
      assessedDate: daysAgoISO(4),
      comment: i === 0 ? 'Bài làm xuất sắc' : 'Cần cẩn thận bước rút gọn',
      studentEmail: st.studentEmail,
      studentUid: '',
      parentEmails: st.parentEmails,
      parentUids: [],
    });

    const attTodayId = makeDeterministicPairId(sesTodayId, st.id);
    const todayStatus = i === 2 ? 'absent_excused' : i === 1 ? 'late' : 'present';
    await seedDocIfAbsent(doc(db, 'attendance', attTodayId), {
      id: attTodayId,
      teacherId,
      sessionId: sesTodayId,
      classId: clsMath9,
      studentId: st.id,
      sessionDate: today,
      sessionType: 'regular',
      status: todayStatus,
      reason: i === 2 ? 'Phụ huynh xin phép em bị cảm nhẹ' : i === 1 ? 'Đến muộn 10 phút' : '',
      studentEmail: st.studentEmail,
      studentUid: '',
      parentEmails: st.parentEmails,
      parentUids: [],
    });

    const revTodayId = makeDeterministicPairId(sesTodayId, st.id);
    await seedDocIfAbsent(doc(db, 'student_session_reviews', revTodayId), {
      id: revTodayId,
      teacherId,
      sessionId: sesTodayId,
      classId: clsMath9,
      studentId: st.id,
      sessionDate: today,
      homeworkStatus: i === 2 ? 'not_applicable' : i === 0 ? 'done_well' : 'incomplete',
      homeworkNote:
        i === 2
          ? ''
          : i === 0
          ? 'Hoàn thành xuất sắc 6/6 câu phiếu số 12, lời giải mạch lạc.'
          : 'Mới làm 4/6 câu phiếu số 12, còn thiếu câu 5 và câu 6.',
      attitudeRating: i === 2 ? 'not_applicable' : i === 0 ? 'excellent' : 'good',
      attitudeComment:
        i === 2
          ? ''
          : i === 0
          ? 'Em lập bảng tóm tắt bài toán chuyển động rất rõ ràng và tự giải được bài nâng cao.'
          : 'Em nắm được cách chọn ẩn, cần rèn thêm bước đổi đơn vị thời gian.',
      hasTestScore: i === 0,
      ...(i === 0 ? { testScore: 9.5, testMaxScore: 10 } : {}),
      weakTopics: i === 1 ? 'Đổi đơn vị phút sang giờ trong bài toán chuyển động' : '',
      parentPrivateMessage:
        i === 2 ? 'Chúc em Thảo Vy mau khỏe, cô đã gửi phần bài tập để em xem nhẹ nhàng khi khỏe lại ạ.' : '',
      visibleToStudent: true,
      studentEmail: st.studentEmail,
      studentUid: '',
      parentEmails: st.parentEmails,
      parentUids: [],
    });

    const pmPastId = makeDeterministicPairId(sesPastId, st.id);
    await seedDocIfAbsent(doc(db, 'parent_messages', pmPastId), {
      id: pmPastId,
      teacherId,
      sessionId: sesPastId,
      classId: clsMath9,
      studentId: st.id,
      sessionDate: daysAgoISO(4),
      className: classesData[0].name,
      studentName: st.fullName,
      content: `Kính gửi phụ huynh em ${st.fullName},\n1. Lớp học: ${classesData[0].name}\n2. Thời gian học: ${daysAgoISO(4)} (17:30 - 19:00)\n3. Nội dung bài học: Hệ thức Vi-ét và ứng dụng tìm tham số m.\n4. Nhận xét bài tập về nhà: Em đã hoàn thành bài đầy đủ.\n5. Tình hình học trên lớp: Em học nghiêm túc và tiếp thu tốt.\n6. Kết quả kiểm tra: ${pastScores[i]}/10 điểm.\n7. Bài tập về nhà: Làm phiếu bài tập số 12 (câu 1 đến câu 6).\nTrân trọng cảm ơn gia đình đã đồng hành!`,
      status: 'sent',
      sentChannel: 'Zalo (Đã xác nhận)',
      sentConfirmedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
      parentEmails: st.parentEmails,
      parentUids: [],
    });
  }

  const eng7Students = studentsData.filter((s) => s.classes.includes(clsEng7));
  for (const st of eng7Students) {
    const attMakeupId = makeDeterministicPairId(sesMakeupId, st.id);
    await seedDocIfAbsent(doc(db, 'attendance', attMakeupId), {
      id: attMakeupId,
      teacherId,
      sessionId: sesMakeupId,
      classId: clsEng7,
      studentId: st.id,
      sessionDate: daysAgoISO(2),
      sessionType: 'makeup',
      status: 'makeup',
      reason: 'Tham gia buổi học bù đầy đủ',
      studentEmail: st.studentEmail,
      studentUid: '',
      parentEmails: st.parentEmails,
      parentUids: [],
    });
  }

  // 8. Homework
  const hw1Id = `demo_${prefix}_hw01`;
  const hw2Id = `demo_${prefix}_hw02`;

  await seedDocIfAbsent(doc(db, 'homework', hw1Id), {
    id: hw1Id,
    teacherId,
    classId: clsMath9,
    sessionId: sesTodayId,
    title: 'Phiếu luyện tập: Lập hệ phương trình dạng chuyển động',
    description: 'Hoàn thành 5 bài tập trang 28 sách bổ trợ. Lưu ý kẻ bảng tóm tắt Quãng đường – Vận tốc – Thời gian trước khi lập phương trình.',
    scope: 'class',
    assignedStudentId: '',
    dueDate: daysAheadISO(3),
    attachmentUrl: '',
    attachmentName: '',
    targetSkills: ['Lập hệ phương trình', 'Bài toán chuyển động'],
    generationSource: 'teacher_manual',
    memberEmails: emailsForClass(clsMath9),
    memberUids: [],
  });

  await seedDocIfAbsent(doc(db, 'homework', hw2Id), {
    id: hw2Id,
    teacherId,
    classId: clsMath9,
    sessionId: sesPastId,
    title: 'Bài tập củng cố riêng: Biến đổi biểu thức Vi-ét',
    description: 'Làm 3 câu cơ bản về x1^2 + x2^2 và 1/x1 + 1/x2, trình bày từng bước biến đổi.',
    scope: 'individual',
    assignedStudentId: studentsData[2].id,
    dueDate: daysAheadISO(2),
    attachmentUrl: '',
    attachmentName: '',
    targetSkills: ['Hệ thức Vi-ét', 'Hằng đẳng thức'],
    generationSource: 'teacher_manual',
    memberEmails: [studentsData[2].studentEmail, ...studentsData[2].parentEmails],
    memberUids: [],
  });

  const sub1Id = makeDeterministicPairId(hw1Id, studentsData[0].id);
  await seedDocIfAbsent(doc(db, 'homework_submissions', sub1Id), {
    id: sub1Id,
    teacherId,
    homeworkId: hw1Id,
    classId: clsMath9,
    studentId: studentsData[0].id,
    status: 'reviewed',
    answerText: 'Em đã hoàn thành đủ 5 bài và lập bảng đầy đủ cho các bài toán chuyển động xuôi dòng, ngược dòng.',
    attachmentUrl: '',
    teacherFeedback: 'Bài làm trình bày rất khoa học, Minh Anh nắm chắc phương pháp!',
    score: 9.5,
    studentEmail: studentsData[0].studentEmail,
    studentUid: '',
    parentEmails: studentsData[0].parentEmails,
    parentUids: [],
  });

  // 9. Notification
  const notiId = `demo_${prefix}_noti01`;
  await seedDocIfAbsent(doc(db, 'notifications', notiId), {
    id: notiId,
    teacherId,
    classId: clsMath9,
    studentId: '',
    title: 'Thông báo lịch kiểm tra định kỳ cuối tháng – Lớp Toán 9',
    body: 'Kính gửi quý phụ huynh và các em học sinh, buổi học cuối tuần tới lớp sẽ có bài kiểm tra tổng hợp 30 phút về Hệ thức Vi-ét và Giải bài toán bằng cách lập hệ phương trình.',
    category: 'schedule',
    recipientEmails: emailsForClass(clsMath9),
    recipientUids: [],
    readByEmails: [],
    readByUids: [],
  });
}
