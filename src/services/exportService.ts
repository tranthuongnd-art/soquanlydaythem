import { readSheet } from 'read-excel-file/browser';
import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/browser';
import {
  AttendanceRecord,
  Classroom,
  IssuedCredentialItem,
  STUDENT_STATUS_VI,
  Student,
  TuitionRule,
} from '../types';

export interface ImportedStudentRow {
  studentCode: string;
  fullName: string;
  dateOfBirth: string;
  schoolClass: string;
  parentName: string;
  studentPhone: string;
  fatherPhone: string;
  motherPhone: string;
  contactInfo: string;
}

function makeHeaderRow(labels: string[]): Row {
  return labels.map((value) => ({
    value,
    fontWeight: 'bold' as const,
    backgroundColor: '#FCE7F3',
    color: '#831843',
  }));
}

function formatCellValue(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const yyyy = cell.getFullYear();
    const mm = String(cell.getMonth() + 1).padStart(2, '0');
    const dd = String(cell.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return String(cell).trim();
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const cleanText = text.replace(/^\uFEFF/, '');

  for (let i = 0; i < cleanText.length; i += 1) {
    const ch = cleanText[i];
    const next = cleanText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',' || ch === ';') {
      row.push(field.trim());
      field = '';
    } else if (ch === '\r' && next === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.length > 0));
}

export async function downloadStudentImportTemplate(): Promise<void> {
  const headers = [
    'Mã HS',
    'Họ tên',
    'Ngày sinh',
    'Lớp chính khóa',
    'Họ tên phụ huynh',
    'SĐT mẹ (Đăng nhập PH)',
    'SĐT bố (Đăng nhập PH 2)',
    'SĐT học sinh (Đăng nhập HS)',
    'Thông tin liên hệ',
  ];

  const data: SheetData = [
    makeHeaderRow(headers),
    [
      'HS-2026-101',
      'Nguyễn Minh Quân',
      '2012-05-15',
      '9A1',
      'Phụ huynh Nguyễn Minh Quân',
      '0912345601',
      '0912345602',
      '0988111001',
      'Gửi nhận xét qua Zalo mẹ sau 19h',
    ],
    [
      'HS-2026-102',
      'Lê Hoàng Nam',
      '2012-08-20',
      '9A2',
      'Phụ huynh Lê Hoàng Nam',
      '0912345603',
      '',
      '0988111002',
      '',
    ],
  ];

  await writeXlsxFile(data, {
    sheet: 'MauNhapHocSinh',
    columns: [
      { width: 15 },
      { width: 24 },
      { width: 14 },
      { width: 16 },
      { width: 22 },
      { width: 22 },
      { width: 22 },
      { width: 24 },
      { width: 28 },
    ],
  }).toFile('mau-nhap-danh-sach-hoc-sinh.xlsx');
}

export async function parseStudentsFromExcel(file: File): Promise<ImportedStudentRow[]> {
  let matrix: string[][];

  if (file.name.toLowerCase().endsWith('.csv')) {
    const text = await file.text();
    matrix = parseCsvText(text);
  } else {
    const rows = await readSheet(file);
    matrix = rows.map((r) => r.map((cell) => formatCellValue(cell)));
  }

  if (matrix.length < 2) return [];

  const headers = matrix[0].map((h) => h.trim());
  const rawRows: Record<string, string>[] = matrix.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (header) {
        obj[header] = cells[idx] ?? '';
      }
    });
    return obj;
  });

  const pick = (row: Record<string, string>, keys: string[]): string => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k].trim() !== '') {
        return row[k].trim();
      }
    }
    return '';
  };

  return rawRows
    .map((row, idx): ImportedStudentRow => {
      const fullName = pick(row, ['Họ tên', 'Ho ten', 'Họ và tên', 'fullName', 'Ten']);
      return {
        studentCode:
          pick(row, ['Mã HS', 'Ma HS', 'Mã học sinh', 'studentCode']) || `HS-IMP-${idx + 1}`,
        fullName,
        dateOfBirth: pick(row, ['Ngày sinh', 'Ngay sinh', 'dateOfBirth']),
        schoolClass: pick(row, ['Lớp chính khóa', 'Lop chinh khoa', 'Lớp', 'schoolClass']),
        parentName:
          pick(row, ['Họ tên phụ huynh', 'Phụ huynh', 'Phu huynh', 'parentName']) ||
          (fullName ? `Phụ huynh ${fullName}` : 'Phụ huynh'),
        studentPhone: pick(row, [
          'SĐT học sinh (Đăng nhập HS)',
          'SĐT học sinh',
          'SDT hoc sinh',
          'studentPhone',
        ]),
        motherPhone: pick(row, [
          'SĐT mẹ (Đăng nhập PH)',
          'SĐT mẹ',
          'SDT me',
          'SĐT phụ huynh',
          'motherPhone',
        ]),
        fatherPhone: pick(row, [
          'SĐT bố (Đăng nhập PH 2)',
          'SĐT bố',
          'SDT bo',
          'fatherPhone',
        ]),
        contactInfo: pick(row, ['Thông tin liên hệ', 'Liên hệ', 'Ghi chú', 'contactInfo']),
      };
    })
    .filter((r) => r.fullName.length > 0);
}

export async function exportClassStudentsToExcel(
  classroom: Classroom,
  students: Student[]
): Promise<void> {
  const headers = [
    'STT',
    'Mã HS',
    'Họ tên',
    'Ngày sinh',
    'Lớp chính khóa',
    'Phụ huynh',
    'SĐT mẹ',
    'SĐT bố',
    'SĐT học sinh',
    'Tài khoản HS',
    'Tài khoản PH',
    'Ngày bắt đầu',
    'Trạng thái',
  ];

  const data: SheetData = [
    makeHeaderRow(headers),
    ...students.map((st, idx): Row => [
      idx + 1,
      st.studentCode,
      st.fullName,
      st.dateOfBirth || '',
      st.schoolClass || '',
      st.parentName,
      st.motherPhone || '',
      st.fatherPhone || '',
      st.studentPhone || '',
      st.studentUid ? 'Đã cấp' : 'Chưa cấp',
      (st.parentUids?.length ?? 0) > 0 ? `Đã cấp (${st.parentUids.length})` : 'Chưa cấp',
      st.startDate,
      STUDENT_STATUS_VI[st.status],
    ]),
  ];

  const safeName = classroom.name.replace(/[^a-zA-Z0-9\u00C0-\u1EF9_-]+/g, '_').slice(0, 40);
  await writeXlsxFile(data, {
    sheet: 'DanhSachLop',
    columns: [
      { width: 6 },
      { width: 14 },
      { width: 22 },
      { width: 13 },
      { width: 15 },
      { width: 22 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
      { width: 14 },
      { width: 14 },
      { width: 14 },
      { width: 16 },
    ],
  }).toFile(`danh-sach-${safeName}.xlsx`);
}

export async function exportIssuedCredentialsToExcel(items: IssuedCredentialItem[]): Promise<void> {
  const headers = [
    'STT',
    'Học sinh',
    'Vai trò',
    'Chủ tài khoản',
    'Số điện thoại đăng nhập',
    'Mật khẩu được cấp',
    'Trạng thái',
  ];

  const data: SheetData = [
    makeHeaderRow(headers),
    ...items.map((item, idx): Row => [
      idx + 1,
      item.studentName,
      item.role === 'PARENT' ? 'Phụ huynh' : 'Học sinh',
      item.ownerLabel,
      item.phone,
      item.password,
      item.status === 'created'
        ? 'Mới cấp'
        : item.status === 'already_exists'
        ? 'Đã có tài khoản'
        : item.note || 'Chưa cấp',
    ]),
  ];

  await writeXlsxFile(data, {
    sheet: 'TaiKhoanDangNhap',
    columns: [
      { width: 6 },
      { width: 22 },
      { width: 14 },
      { width: 22 },
      { width: 22 },
      { width: 26 },
      { width: 26 },
    ],
  }).toFile(`phieu-cap-tai-khoan-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export interface StudentStatRow {
  studentId: string;
  studentCode: string;
  studentName: string;
  presentCount: number;
  lateCount: number;
  absentExcusedCount: number;
  absentUnexcusedCount: number;
  makeupCount: number;
  billableSessions: number;
  estimatedTuition: number;
  homeworkRate: number;
  averageScore: number | null;
  progressLabel: string;
}

export function isBillableAttendance(
  status: AttendanceRecord['status'],
  rule: TuitionRule
): boolean {
  if (rule === 'present_only') {
    return status === 'present' || status === 'late';
  }
  if (rule === 'present_makeup_unexcused') {
    return (
      status === 'present' ||
      status === 'late' ||
      status === 'makeup' ||
      status === 'absent_unexcused'
    );
  }
  return status === 'present' || status === 'late' || status === 'makeup';
}

export async function exportStatisticsToExcel(
  stats: StudentStatRow[],
  startDate: string,
  endDate: string,
  classLabel: string
): Promise<void> {
  const headers = [
    'STT',
    'Mã HS',
    'Họ tên',
    'Có mặt',
    'Đi muộn',
    'Học bù',
    'Nghỉ có phép',
    'Nghỉ không phép',
    'Buổi tính học phí',
    'Học phí dự kiến (VNĐ)',
    'Hoàn thành BTVN (%)',
    'Điểm TB',
    'Tiến bộ',
  ];

  const data: SheetData = [
    makeHeaderRow(headers),
    ...stats.map((s, idx): Row => [
      idx + 1,
      s.studentCode,
      s.studentName,
      s.presentCount,
      s.lateCount,
      s.makeupCount,
      s.absentExcusedCount,
      s.absentUnexcusedCount,
      s.billableSessions,
      s.estimatedTuition,
      s.homeworkRate,
      s.averageScore !== null ? s.averageScore : 'Chưa có',
      s.progressLabel,
    ]),
  ];

  const safeClass = classLabel.replace(/[^a-zA-Z0-9\u00C0-\u1EF9_-]+/g, '_').slice(0, 30);
  await writeXlsxFile(data, {
    sheet: 'ThongKe',
    columns: [
      { width: 6 },
      { width: 14 },
      { width: 22 },
      { width: 10 },
      { width: 10 },
      { width: 10 },
      { width: 14 },
      { width: 16 },
      { width: 18 },
      { width: 22 },
      { width: 20 },
      { width: 12 },
      { width: 16 },
    ],
  }).toFile(`thong-ke-${safeClass}-${startDate}_${endDate}.xlsx`);
}
