# Classroom Pointer security review and `/b3Games` read migration plan

Written 2026-10-16 by an independent reviewer (Claude). **Documentation only: no rules, functions or pages are changed by this file.** Findings are from reading code on `origin/main` and on the Pointer PR branches (#124 `fix/pointer-student-share-flow-oct16`, #134 `fix/class-pointer-student-permission-privacy`). Nothing was run against Firebase or real student data. "CONFIRMED" means traced in code, not reproduced live.

## A. Classroom Pointer findings (ranked)

### 1. HIGH, CONFIRMED (also true on `main` today): anyone who can read the public database can join a teacher's live lesson
- `dashboard-session.js` publishes `roomId` (the teacher's PeerJS id) under `b3Games/workspaces/<ws>/classes/<class>/classPointerSessions/<room>`. `/b3Games` has `.read: true`, so the room id is readable by anyone on the internet while a lesson is live.
- `classroom.js` `receiveStudent()` accepts any connection that sends `{type:'join', name, studentId}`, creates the member with `admitted:true`, and (when a screen is being shared) calls `callStudent(member)`, which streams the teacher's shared screen to that connection. The `studentId` is only format-checked; no passcode, ticket or class check happens.
- Exploit A (watch): read the public database, open PeerJS to the room id, send `join` with any name; receive the lesson screen and the roster.
- Exploit B (impersonate/evict): join with the exact name of a real student; the duplicate-name logic removes and disconnects the real student, and the attacker inherits that student's permissions and can send board, pointer and highlight messages as them.
- Fix (needs the Pointer owners): the student fetches a short-lived join ticket from `classPointerShareAuth` after the passcode and class-membership check; the teacher page verifies it with a new `verifyJoin` action and takes the student's id and name only from that verified result; unverified joins are refused. Also stop publishing room ids on a public path (see section C, step P1).

### 2. MEDIUM, CONFIRMED: one student can switch off screen sharing for the whole class
- In `class-pointer-share-auth.js` action `issue`, the per-IP limiter (25 per 10 min, key = IP only) is consumed before the passcode and member checks. A school shares one address; 25 junk requests make every classmate get "Too many sharing attempts" for 10 minutes.
- Fix: count only failures against the IP; add a per-student failure counter; count successes per student, not per IP.

### 3. MEDIUM, SUSPECTED (depends on live data): guessing and the shared default passcode
- `readPasscode(..., {allowLegacyDefault:true})` accepts the old shared PIN for students whose legacy record has no passcode. Pass `allowLegacyDefault:false` in this endpoint. The `permissions` action reveals whether a passcode is right (200 vs 401) and has no per-student lock across addresses. The shared student-sign-in limiter in PR #137 shows the pattern (`backend/functions/auth-attempts.cjs`).
- Whether `req.ip` can be spoofed behind Cloud Functions was not verified.

### 4. MEDIUM, CONFIRMED: removing a student's permission does not close an already-connected share
- The check happens at ticket issue and once at verify. `activity-screen-teacher.js` never re-checks or closes the call when the teacher later denies that student; a modified student page keeps sending video until the teacher clicks "Close view". Fix: on a permission change the teacher side closes the call mapped to the verified student id.

### 5. LOW
- A teacher of the class can overwrite another teacher's session record (both are in the class trust boundary); no `.validate` on the new session/permission rules.
- An unauthenticated peer who knows the room can spam bogus activity-screen calls, causing repeated teacher-side verify requests; add a per-peer cap.
- `b3Private/classPointerShareLimits` and orphaned sessions/permission rows have no time-based sweep if a browser dies before `onDisconnect` fires.

### Checked and fine
Names are rendered with `textContent`; tickets are 256-bit random, stored only as a hash, 90 s expiry, bound to room and class, atomic verification, removed teachers and students refused at verify; room ids are random UUIDs; per-student permissions in #134 are in `b3Private` (not client-readable); #134's rule changes only grant writes to the assigned teacher, admins and owner and make nothing newly readable.

### Release gates for Pointer (children share screens)
Findings 1-3 should be fixed or knowingly accepted by the owner before classes use screen sharing; finding 4 should be fixed in the same release. Deploy order: backend (`classPointerShareAuth`, ticket clean-up) first, then database rules (diff against the live rules first; the file is replaced as a whole), then the website. Run `tests/class-pointer-session-rules-emulator.cjs` (needs Java 21) and then a live test with a real teacher and two students (one denied, one from another class) on a throwaway class.

## B. What reads `/b3Games` from the browser (static inventory)

Students have **no Firebase Auth identity** (they sign in by name and passcode through `funTorahStudentAuth`; custom tokens exist only for Halacha, Class Gallery and Student Rewards), so almost every student-side read is anonymous. Because a parent `.read: true` overrides child rules, no child can be locked until the parent grant is split.

| Path | Readers | Sensitivity | Notes |
|---|---|---|---|
| `b3Games/siteSettings` | every student page (anonymous), signed-in users | low-medium | must stay public |
| `b3Games/students` (whole) | owner pages; **`chazara/index.html` student sign-in (anonymous)** | high | chazara read is the only student whole-list read |
| `.../students/$id/profile`, `/memberships` | students before sign-in and on load (live `.on` watch in `index.html`), teachers | high-medium | `student-class.js` is one choke point |
| `.../workspaces/$ws/classes` (whole) | owner/admin/teacher pages (Google-signed-in) | high (all rosters, grants, legacy `classPin` copy, room ids) | `auth != null` / teacher rule is enough |
| `.../classes/$id` (one record, includes `members`) | teacher pages **and students (anonymous)**, including a live watch | high | needs a "my class" endpoint |
| `.../classes/$id/classPointerSessions` | students listen (anonymous); teacher writes | medium-high | room ids; see A1 |
| `.../classes/$id/resources/*`, `classGalleryPresence/Tag` | students (anonymous) | medium | **world-writable today** |
| `.../teachers`, `teacherInvites`, `admins` | owner; teacher reads own record; teacher sign-in reads the whole invite list | high (emails) | easy to restrict; invite check better via backend |
| `posukPractice/allowedStudents`, `posukPractice/settings/classPin` | legacy student sign-in fallbacks (anonymous); one teacher page | high | remove after step R3 |

(Full file:line list is in the review notes on Issue #51; paths built by helper code may be missing from this static list.)

## C. Least-privilege migration order (no step flips the public parent to deny-all)

**P1 (Pointer first, smallest):** move live session/room data off the public tree: the teacher writes the session to a non-public path (e.g. `b3Private/classPointerSessions/$ws/$class`, write rule = assigned teacher/admin as in #134), and students get the room id from `classPointerShareAuth` after passcode and membership verification. Combine with the join ticket from A1. This removes the room id from public view without touching other tools. Needs backend first, then rules, then pages, and a rollback flag to read the old path for one release.

**R0 (no behaviour change):** replace `b3Games: {".read": true}` with explicit child grants that reproduce today's reads exactly (every path in section B that anonymous pages need), run the emulator suite and a full student walk-through on a throwaway project first. Deploy only after a database backup and with the previous rules file ready.
**R1:** lock paths nobody reads (`admins` except own uid, workspace meta/siteSettings, other teachers' records).
**R2:** owner/teacher-only nodes already behind Google sign-in (`teachers`, `teacherInvites`, whole `classes`, whole `students` for non-owners), guarded by an `auth != null` plus owner/teacher test; verify each teacher page reads after `onAuthStateChanged`.
**R3:** remove the Chazara whole-list read (use `funTorahStudentAuth`), stop reading the legacy class PIN, then lock `b3Games/students` for non-owners.
**R4:** add one endpoint that returns only the student's own profile, class name, active flag, grants and limits after a passcode check (PR #137's limiter and cheap lookup apply); move `student-class.js` and the ~10 student-page reads onto it; replace the live `.on` watches in `index.html` (a permission error there currently signs every student out) with polling; then lock class records, `members`, `profile` and `memberships` to teachers/owner.
**R5 (needs student authentication):** custom tokens for all students so rules can use the student id; then close gallery presence/resources writes and any remaining anonymous reads.
**R6:** delete the legacy `allowedStudents` and shared class PIN after no reader remains.

### Before any rules deploy (from the existing hardening plan)
Verified restorable backup; emulator tests for owner, assigned teacher, unrelated teacher, student, blocked student and anonymous; ET, WT and a third class exercised; live rules diffed against the repo file; rollback = redeploy the previous rules file; separate owner approval for each deploy.

### Rollback
Rules: redeploy the previous `firebase-rules.json` (`firebase deploy --only database --project b3-games` from the repository root). Functions: redeploy the previous commit of the changed function only. Pages: revert the merge commit.

### Costs
No new service. Backend endpoints are small Cloud Function calls; moving reads from whole-node downloads to single-student reads lowers database download (PR #137 measured 157 KB to 0.3 KB per sign-in).
