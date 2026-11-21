import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Printer } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportStatisticsToExcel, isBillableAttendance, StudentStatRow } from '../services/exportService';
import { saveTeacherProfile, todayISO } from '../services/firestoreService';
import { TUITION_RULE_VI, TuitionRule } from '../types';

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const StatisticsPage: React.FC = () => {
  const {
    firebaseUser,
    teacherProfile,
    isMainTeacher,
    classes,
    students,
    enrollments,
    sessions,
    attendance,
    assessments,
    reviews,
  } = useApp();

  const [startDate, setStartDate] = useState(daysAgo(30));
  const [endDate, setEndDate] = useState(todayISO());
  const [classFilter, setClassFilter] = useState('all');
  const [tuitionRule, setTuitionRule] = useState<TuitionRule>(
    teacherProfile?.tuitionRule ?? 'present_and_makeup'
  );

  const classMap = useMemo(() => new Map(classes.map((c) => [c.id, c])), [classes]);

  const filteredSessions = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.sessionDate >= startDate &&
          s.sessionDate <= endDate &&
          (classFilter === 'all' || s.classId === classFilter)
      ),
    [sessions, startDate, endDate, classFilter]
  );

  const filteredAttendance = useMemo(
    () =>
      attendance.filter(
        (a) =>
          a.sessionDate >= startDate &&
          a.sessionDate <= endDate &&
          (classFilter === 'all' || a.classId === classFilter)
      ),
    [attendance, startDate, endDate, classFilter]
  );

  const filteredReviews = useMemo(
    () =>
      reviews.filter(
        (r) =>
          r.sessionDate >= startDate &&
          r.sessionDate <= endDate &&
          (classFilter === 'all' || r.classId === classFilter)
      ),
    [reviews, startDate, endDate, classFilter]
  );

  const filteredAssessments = useMemo(
    () =>
      assessments.filter(
        (a) =>
          a.assessedDate >= startDate &&
          a.assessedDate <= endDate &&
          (classFilter === 'all' || a.classId === classFilter)
      ),
    [assessments, startDate, endDate, classFilter]
  );

  const scopedStudents = useMemo(() => {
    if (classFilter === 'all') return students;
    const ids = new Set(
      enrollments
        .filter((e) => e.classId === classFilter && e.status === 'active')
        .map((e) => e.studentId)
    );
    return students.filter((s) => ids.has(s.id));
  }, [students, enrollments, classFilter]);

  const studentStats: StudentStatRow[] = useMemo(() => {
    return scopedStudents.map((st) => {
      const stAtt = filteredAttendance.filter((a) => a.studentId === st.id);
      const presentCount = stAtt.filter((a) => a.status === 'present').length;
      const lateCount = stAtt.filter((a) => a.status === 'late').length;
      const absentExcusedCount = stAtt.filter((a) => a.status === 'absent_excused').length;
      const absentUnexcusedCount = stAtt.filter((a) => a.status === 'absent_unexcused').length;
      const makeupCount = stAtt.filter((a) => a.status === 'makeup').length;

      let billableSessions = 0;
      let estimatedTuition = 0;
      for (const a of stAtt) {
        if (isBillableAttendance(a.status, tuitionRule)) {
          billableSessions++;
          const fee = classMap.get(a.classId)?.feePerSession ?? teacherProfile?.defaultFeePerSession ?? 150000;
          estimatedTuition += fee;
        }
      }

      const stRevs = filteredReviews.filter(
        (r) => r.studentId === st.id && r.homeworkStatus !== 'not_applicable'
      );
      const completedHw = stRevs.filter(
        (r) => r.homeworkStatus === 'done_well' || r.homeworkStatus === 'done'
      ).length;
      const homeworkRate = stRevs.length > 0 ? Math.round((completedHw / stRevs.length) * 100) : 0;

      const stScores = filteredAssessments
        .filter((a) => a.studentId === st.id)
        .sort((a, b) => a.assessedDate.localeCompare(b.assessedDate));
      const averageScore =
        stScores.length > 0
          ? Number(
              (
                stScores.reduce((acc, item) => acc + (item.score / item.maxScore) * 10, 0) /
                stScores.length
              ).toFixed(2)
            )
          : null;

      let progressLabel = 'Chưa đủ dữ liệu';
      if (stScores.length >= 2) {
        const first = (stScores[0].score / stScores[0].maxScore) * 10;
        const last = (stScores[stScores.length - 1].score / stScores[stScores.length - 1].maxScore) * 10;
        const delta = Number((last - first).toFixed(2));
        if (delta > 0.3) progressLabel = `Tiến bộ (+${delta}đ)`;
        else if (delta < -0.3) progressLabel = `Cần củng cố (${delta}đ)`;
        else progressLabel = 'Ổn định';
      } else if (stScores.length === 1) {
        progressLabel = 'Đã có 1 bài kiểm tra';
      }

      return {
        studentId: st.id,
        studentCode: st.studentCode,
        studentName: st.fullName,
        presentCount,
        lateCount,
        absentExcusedCount,
        absentUnexcusedCount,
        makeupCount,
        billableSessions,
        estimatedTuition,
        homeworkRate,
        averageScore,
        progressLabel,
      };
    });
  }, [scopedStudents, filteredAttendance, filteredReviews, filteredAssessments, tuitionRule, classMap, teacherProfile]);

  const totals = useMemo(() => {
    const totalPresent = studentStats.reduce((s, r) => s + r.presentCount + r.lateCount, 0);
    const totalAbsent = studentStats.reduce((s, r) => s + r.absentExcusedCount + r.absentUnexcusedCount, 0);
    const totalMakeup = studentStats.reduce((s, r) => s + r.makeupCount, 0);
    const totalTuition = studentStats.reduce((s, r) => s + r.estimatedTuition, 0);
    const scored = studentStats.filter((r) => r.averageScore !== null);
    const avgScore =
      scored.length > 0
        ? (scored.reduce((s, r) => s + (r.averageScore ?? 0), 0) / scored.length).toFixed(2)
        : '—';
    return {
      sessionsCount: filteredSessions.length,
      makeupSessionsCount: filteredSessions.filter((s) => s.sessionType === 'makeup').length,
      totalPresent,
      totalAbsent,
      totalMakeup,
      totalTuition,
      avgScore,
    };
  }, [studentStats, filteredSessions]);

  const chartData = useMemo(
    () =>
      studentStats.slice(0, 12).map((s) => ({
        name: s.studentName.split(' ').slice(-2).join(' '),
        'Có mặt': s.presentCount + s.lateCount,
        'Học bù': s.makeupCount,
        'Nghỉ': s.absentExcusedCount + s.absentUnexcusedCount,
      })),
    [studentStats]
  );

  const handleRuleChange = async (nextRule: TuitionRule) => {
    setTuitionRule(nextRule);
    if (isMainTeacher && firebaseUser && firebaseUser.email) {
      await saveTeacherProfile(firebaseUser.uid, firebaseUser.email, {
        fullName: teacherProfile?.fullName || firebaseUser.displayName || 'Giáo viên',
        phone: teacherProfile?.phone,
        subjectSpecialty: teacherProfile?.subjectSpecialty,
        tuitionRule: nextRule,
        defaultFeePerSession: teacherProfile?.defaultFeePerSession ?? 150000,
      });
    }
  };

  const classLabel = classFilter === 'all' ? 'Tất cả các lớp' : classMap.get(classFilter)?.name || 'Lớp học';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Thống kê &amp; Báo cáo học phí</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Tổng hợp chuyên cần, học bù, học phí theo quy tắc tùy chỉnh và xuất Excel / PDF
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => exportStatisticsToExcel(studentStats, startDate, endDate, classLabel)}
            className="min-h-[44px] px-4 rounded-xl bg-[#ECFDF5] border border-emerald-200 text-[#15803D] text-xs font-semibold hover:bg-emerald-100 inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Xuất Excel</span>
          </button>
          <button
            onClick={() => window.print()}
            className="min-h-[44px] px-4 rounded-xl bg-[#DB2777] text-white text-xs font-semibold hover:bg-[#BE185D] inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Printer className="w-4 h-4" />
            <span>Xuất PDF / In báo cáo</span>
          </button>
        </div>
      </div>

      {/* Print-only Header */}
      <div className="hidden print-only border-b border-slate-300 pb-4 mb-4">
        <h1 className="text-xl font-bold text-slate-900">
          BÁO CÁO THỐNG KÊ HỌC TẬP &amp; HỌC PHÍ – SỔ DẠY HỌC THÔNG MINH
        </h1>
        <p className="text-xs text-slate-600 mt-1">
          Phạm vi: {classLabel} · Từ ngày {startDate} đến ngày {endDate} · Quy tắc học phí: {TUITION_RULE_VI[tuitionRule]}
        </p>
      </div>

      {/* Filter Bar */}
      <section className="rounded-2xl bg-white border border-pink-100 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 no-print">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Từ ngày</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full min-h-[42px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Đến ngày</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full min-h-[42px] rounded-xl border border-pink-200 px-3 text-sm font-mono-num"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Lọc theo lớp</label>
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="w-full min-h-[42px] rounded-xl border border-pink-200 bg-white px-3 text-sm"
          >
            <option value="all">Tất cả các lớp</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Quy tắc tính học phí</label>
          <select
            value={tuitionRule}
            onChange={(e) => void handleRuleChange(e.target.value as TuitionRule)}
            className="w-full min-h-[42px] rounded-xl border border-pink-200 bg-white px-3 text-xs"
          >
            <option value="present_and_makeup">Có mặt + Đi muộn + Học bù</option>
            <option value="present_only">Chỉ Có mặt + Đi muộn</option>
            <option value="present_makeup_unexcused">Có mặt + Học bù + Nghỉ KP</option>
          </select>
        </div>
      </section>

      {/* Summary KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="rounded-2xl bg-white border border-pink-100 p-4">
          <p className="text-xs text-slate-500">Tổng buổi đã tổ chức</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-num text-slate-900">{totals.sessionsCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">{totals.makeupSessionsCount} buổi học bù</p>
        </div>
        <div className="rounded-2xl bg-white border border-emerald-100 p-4">
          <p className="text-xs text-slate-500">Lượt học sinh có mặt</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-num text-[#15803D]">{totals.totalPresent}</p>
          <p className="text-xs text-slate-500 mt-0.5">+ {totals.totalMakeup} lượt học bù</p>
        </div>
        <div className="rounded-2xl bg-white border border-pink-100 p-4">
          <p className="text-xs text-slate-500">Lượt nghỉ học</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-num text-rose-700">{totals.totalAbsent}</p>
        </div>
        <div className="rounded-2xl bg-white border border-pink-100 p-4">
          <p className="text-xs text-slate-500">Điểm TB hệ 10</p>
          <p className="mt-1.5 text-2xl font-bold font-mono-num text-slate-900">{totals.avgScore}</p>
        </div>
        <div className="col-span-2 lg:col-span-1 rounded-2xl bg-[#FFF1F5] border border-pink-200 p-4">
          <p className="text-xs text-[#BE185D] font-medium">Tổng học phí dự kiến</p>
          <p className="mt-1.5 text-xl font-bold font-mono-num text-[#BE185D]">
            {totals.totalTuition.toLocaleString('vi-VN')}đ
          </p>
        </div>
      </section>

      {/* Attendance Chart */}
      {chartData.length > 0 && (
        <section className="rounded-2xl bg-white border border-pink-100 p-5 no-print">
          <h2 className="text-base font-semibold text-slate-900 mb-4">Biểu đồ chuyên cần theo học sinh</h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#FCE7F3" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="Có mặt" fill="#16A34A" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Học bù" fill="#86EFAC" radius={[6, 6, 0, 0]} />
                <Bar dataKey="Nghỉ" fill="#DB2777" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Detailed Student Statistics Table */}
      <section className="rounded-2xl bg-white border border-pink-100 overflow-hidden print-break-inside-avoid">
        <div className="p-5 border-b border-pink-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Chi tiết theo từng học sinh</h2>
          <span className="text-xs text-slate-500">{studentStats.length} học sinh</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-pink-100 bg-[#FDFBFC] text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Học sinh</th>
                <th className="py-3 px-3 text-right">Có mặt</th>
                <th className="py-3 px-3 text-right">Học bù</th>
                <th className="py-3 px-3 text-right">Nghỉ</th>
                <th className="py-3 px-3 text-right">Tính HP</th>
                <th className="py-3 px-3 text-right">Học phí dự kiến</th>
                <th className="py-3 px-3 text-right">% BTVN</th>
                <th className="py-3 px-3 text-right">Điểm TB</th>
                <th className="py-3 px-4">Tiến bộ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pink-50">
              {studentStats.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-slate-500">
                    Chưa có dữ liệu thống kê trong khoảng thời gian đã chọn.
                  </td>
                </tr>
              ) : (
                studentStats.map((row) => (
                  <tr key={row.studentId} className="hover:bg-pink-50/30">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900">{row.studentName}</p>
                      <p className="text-xs font-mono-num text-slate-500">{row.studentCode}</p>
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num text-[#15803D] font-medium">
                      {row.presentCount + row.lateCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num text-emerald-700">{row.makeupCount}</td>
                    <td className="py-3 px-3 text-right font-mono-num text-rose-700">
                      {row.absentExcusedCount + row.absentUnexcusedCount}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900">
                      {row.billableSessions}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num font-semibold text-[#BE185D]">
                      {row.estimatedTuition.toLocaleString('vi-VN')}đ
                    </td>
                    <td className="py-3 px-3 text-right font-mono-num text-slate-700">{row.homeworkRate}%</td>
                    <td className="py-3 px-3 text-right font-mono-num font-semibold text-slate-900">
                      {row.averageScore !== null ? row.averageScore : '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 whitespace-nowrap">{row.progressLabel}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
