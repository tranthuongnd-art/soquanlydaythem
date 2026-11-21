# Security Specification — Sổ Dạy Học Thông Minh (Smart Teaching)

## 1. Data Invariants & Access Boundaries
1. **Strict Tenant & Student Isolation**: Every educational record belongs to an authenticated teacher (`teacherId == request.auth.uid`). Cross-teacher reads and writes are strictly denied.
2. **Parent Multi-Child Isolation**: A parent (`request.auth.token.email_verified == true`) may ONLY read records where their verified email is explicitly listed in `resource.data.parentEmails` (bounded `<= 2`) or `resource.data.memberEmails` / `resource.data.recipientEmails`. Parents can NEVER read other students' profiles, attendance, scores, or messages.
3. **Student Self-Only Access**: A student (`request.auth.token.email_verified == true`) may ONLY read their own profile, enrollments, attendance, assessments, public reviews (`visibleToStudent == true`), and assigned homework, and may ONLY create/update their own `homework_submissions` (`answerText`, `attachmentUrl`, `status: 'submitted'`).
4. **Teacher Internal Notes Isolation (PII & Sensitive Notes)**: Internal teacher notes are stored exclusively in `/sessions/{sessionId}/teacher_notes/{noteId}` and `/student_session_reviews/{reviewId}/private_notes/{noteId}` where ONLY `teacherId == request.auth.uid` can read or write. Neither STUDENT nor PARENT can ever read them.
5. **No Self-Escalation**: Users cannot arbitrarily assign `role: 'TEACHER'` onto another teacher's workspace or mutate `teacherId` / `createdAt` after creation.
6. **Strict Temporal & Schema Validation**: All `createdAt` on create and `updatedAt` on update must equal `request.time`. All document IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and every string/array field enforces explicit size caps.

## 2. The "Dirty Dozen" Payloads (Must All Return PERMISSION_DENIED)
1. **Unverified Email Spoof**: Request with `email_verified: false` attempting to create/read any collection.
2. **Cross-Teacher Read**: Teacher B attempting to `get` or `list` Teacher A's `/students/{id}` or `/classes/{id}`.
3. **Cross-Student Parent Leak**: Parent of Student 1 attempting to read Student 2's `/students/{student2}` or `/parent_messages/{msg2}`.
4. **Private Teacher Note Exfiltration**: Parent or Student attempting to `get` `/sessions/{s}/teacher_notes/private` or `/student_session_reviews/{r}/private_notes/private`.
5. **Hidden Student Review Leak**: Student attempting to read `/student_session_reviews/{r}` when `visibleToStudent == false`.
6. **Shadow Field Injection**: Teacher attempting to create a `/classes/{id}` document with an undocumented ghost key `isSuperAdmin: true`.
7. **ID Poisoning Attack**: Attempting to write `/students/<200-char-invalid-id-with-spaces>` violating `isValidId`.
8. **Student Score Tampering**: Student attempting to update `score` or `teacherFeedback` on `/homework_submissions/{id}`.
9. **Immutable Ownership Hijack**: Updating `teacherId` or `createdAt` on an existing `/students/{id}` document.
10. **Client Timestamp Forgery**: Creating a `/sessions/{id}` document with a forged past `createdAt` instead of `serverTimestamp()` (`request.time`).
11. **Value Poisoning on Allowed Key**: Updating `/parent_messages/{id}` `content` with a non-string boolean or a >4000 char string.
12. **Blanket List Scraping**: Any authenticated user attempting an unfiltered `list` query on `/students` without matching `teacherId`, `studentEmail`, or `parentEmails`.
