# Assignment Center — integration contract (phase 1)

The current `index.html` is deliberately an **isolated design prototype**. Its drafts are browser-local, not assignments, and it writes **nothing** to Firebase. Never publish the prototype as if its student/teacher authorization were real.

## Approved product behavior

- Existing Fun Torah Tools student login; no additional registration/sign-in.
- Keep optional, free-choice practice available.
- Assign a whole class or specified individual students, with different targets.
- Required tasks may refer to Posuk Practice, Chazara, Shorashim minutes, other existing tools, or submitted audio, workbook pictures, and videos.
- A nonblocking persistent student assignment badge should remain visible until required work is handled.
- Teacher sees assignments, timestamps, submitted/awaiting review/approved/missing, with easy class and student filtering.
- A tool activity can satisfy an assignment automatically **only** when a trusted matching completion event exists.

## Integration checklist (before enabling real records)

1. Authenticate with the site's existing student or teacher session. Reuse `student-class.js` and existing server-side teacher/class authorization; never trust arbitrary client-provided student ID/class ID.
2. Define assignment records scoped by workspace, class, student, due time, activity type, target, creation and edit audit fields. Keep assignment definitions distinct from per-student state.
3. Build **server-authorized** create/edit/delete and read endpoints or equally restrictive Firebase rules. Teachers must access only their own classes; student reads limited to their own assignments/submissions. Disable anonymous writes.
4. Use stable assignment IDs and submission IDs; idempotent updates. Keep submission assets in protected storage with type, size, duration and retention limits; scan/validate as appropriate. Never store recordings/photos/videos in localStorage.
5. Existing tool integrations must emit trusted, student-bound, time-stamped progress events. Define time-on-task as verified active work, not merely an open tab. Define activity-specific grading rules and due-date behavior.
6. Status lifecycle: assigned -> in progress -> submitted -> approved, or returned for revision; late/missing derived from due date; teacher override audited. For auto-graded activities define the auto-approval rule explicitly.
7. Add reminder to the shared student shell only after authenticated assignment APIs are working; badge must not leak another student's assignments.
8. Test same student across multiple classes, two teachers, class removal, inactive membership, expired/invalid sessions, stale tabs, repeat submissions, offline/retry/duplicate uploads, video upload failure, and direct URL access.
9. Run regression tests for existing Fun Torah Tools, particularly student sign-in, class membership, teacher authorization, Posuk Practice/Chazara submissions, and Shorashim progress.
10. Publish behind a disabled feature flag or limited test class; verify on production with test users before broad release.

**Out of scope for this initial prototype:** live assignments, student file uploads, teacher approvals, automatic completion tracking, and persistent live reminders.

## Homework Portal (phase 2, built 2026-10-16, NOT deployed)

- `prototype.html`: the original design prototype, kept unchanged.
- `student.html`: signed-in students (existing sessionStorage sign-in) see their own homework, save progress/drafts (also kept locally so a dropped connection loses nothing), and hand in.
- `teacher.html`: verified Google teacher picks an assigned class, gives homework to the whole class or chosen students, edits/deletes, sees handed-in/approved/late counts, approves (optional 1-5 stars + note) or sends back with a note.
- Backend: `backend/functions/homework-core.cjs` (all authorization; uses `homework-policy.cjs`, a tested copy of `assignment-policy.js`) and `homework.js` (function `homeworkPortal`, registered in `index.js`). The `assignmentCenter` database tree has no client rules, so browsers cannot read or write it directly.
- Tests: `node --test tests/homework-portal.test.cjs assignment-center/assignment-policy.test.js`.
- Still needed before going live: owner approval to deploy `homeworkPortal`; a test class; entry links from the student home and Teacher Home (not added, to avoid overlapping other work); file/audio/photo/video uploads (hand-ins are text notes for now); automatic completion from other tools.
