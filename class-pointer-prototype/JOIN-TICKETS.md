# Classroom Pointer join tickets (security fix, not deployed)

**Problem fixed:** the teacher's room id is published on a publicly readable database path, and the lesson page used to admit any connection that sent a `join` message, then stream the shared screen to it. Anyone who read the public database could watch a lesson or take over a student's name.

**Now (signed-in teacher lesson, `classroom.html?dashboard=teacher&class=<id>`):**
1. The student page asks `classPointerShareAuth` (`joinIssue`) for a ticket, sending the student's own passcode, class, the lesson room and its own PeerJS connection id. The server checks: active class with Class Pointer on (ET/WT exempt), the student is an active member with an active profile, the passcode is the student's own (the shared default passcode is never accepted), wrong-passcode limits (8 per student per 15 min, 40 per address per hour). It stores only a hash of a random 256-bit ticket (90 s lifetime) in `b3Private/classPointerJoinTickets`, bound to student, class, room and connection id. One outstanding ticket per student: a new one replaces the old.
2. The student sends `{type:'join', ticket}` to the teacher.
3. The teacher page calls `joinVerify` with the teacher's Firebase sign-in. The server accepts only if the teacher owns this session (or is an active admin/assigned teacher), the ticket is unexpired and unused, for this room, class and exact connection id, and the student is still an active member. Student id and name come only from that answer. Anything else: the connection is closed. A repeat check by the same teacher for the same connection is allowed for 30 s; after that the ticket is dead.
4. Every minute the teacher page sends the connected student ids to `joinRecheck`; students removed, blocked or switched off are disconnected.
5. Reconnecting (page reload, new connection id) simply asks for a new ticket.

**Unchanged:** the plain (not signed-in) teacher page keeps its old behaviour; it does not publish the room id to the database, so only people given the link can find it. Screen-share tickets (`issue`/`verify`) are untouched. No database rules change.

**Deploy order (needs owner approval, not done):** 1. backend `classPointerShareAuth` (new actions; the old page keeps working) 2. website. A new page against the old backend fails closed ("Unknown action") and nobody can join, so never publish the page first. Test first with a synthetic class: teacher signed in, one student, one student from another class, one removed student.

**Known limits:** a student who is not signed in to Fun Torah Tools can no longer join a signed-in lesson by typing a name (they must open Class Pointer from their home page). A modified student page that is already connected is only dropped at the next minute check or when removed from the class. The public room id still exposes that a lesson is live (moving session data off the public tree is step P1 in `security/POINTER-AND-RTDB-MIGRATION.md`, PR #141).

## Live two-browser test runbook (prepared 2026-10-16; NOT run; needs the owner's go-ahead for each cloud step)

**Preconditions:** (1) Codex has reviewed PR #142 together with #124/#134 and confirmed the combined branch is ready; (2) the owner has created, in Owner Admin, a throwaway class "Synthetic Pointer Test" (Class Pointer switched on) with two made-up students and made-up passcodes, a second throwaway class without those students, and one throwaway Google account invited as its teacher; (3) the owner signs in as that teacher himself (the assistant never enters passwords or creates accounts). Never use ET/WT students.

**Deploy (owner-approved scope only, Command Prompt, from a clean checkout of the combined branch after `npm --prefix backend/functions ci`):** `firebase deploy --only functions:classPointerShareAuth --project b3-games`. Nothing else: no website, no database rules, no other functions. Rollback: redeploy the previous commit of that one function.

**Test with the website served locally from the same branch** (so production pages are not changed): teacher page `classroom.html?dashboard=teacher&class=<test class>` in browser A (signed-in throwaway teacher), student pages in browsers B and C (separate profiles), an outsider in browser D (no sign-in).
1. Legitimate join: student 1 opens Class Pointer from the home page and appears on the teacher roster with the server's name.
2. Unauthorized: browser D reads the room id from the page/database and connects with a hand-made `join`; student 2 with a wrong passcode; a student of the other class; a reused or expired ticket; a ticket replayed from another connection. All must be refused and receive nothing.
3. ET/WT/third-class isolation: a student of another class cannot get a ticket for this room; an ET or WT lesson room (if any exist) does not accept the test students.
4. Screen sharing: teacher shares a tab; student 1 receives it; student 1 shares an activity screen and the teacher sees it (existing flow).
5. Reconnection: reload student 1's page; it gets a fresh ticket and rejoins; the old connection is gone.
6. Revocation: teacher denies student 1 screen sharing and removes student 1 from the test class; within one minute the teacher page disconnects the student, and a new ticket request is refused.
7. Clean up: end the lesson, delete the test class in Owner Admin.
Record results (pass/fail with screenshots) on Issue #51.

## Local real-browser test (run 2026-10-16, no deployment, no Firebase, no internet)
`e2e/pointer-join-ticket-two-browser.spec.cjs` drives real Chromium contexts (teacher, students, an outsider) through the real `classroom.html`, `classroom.js`, `join-auth.js` and PeerJS/WebRTC, with a local PeerJS signaling server, the real `classPointerShareAuth` handler on an in-memory database, a stub Firebase object and made-up people. Run: install the `peer` package somewhere (not a repo dependency), then `PEER_MODULE=<path to node_modules/peer> npx playwright test e2e/pointer-join-ticket-two-browser.spec.cjs --project=chromium` (skipped when `PEER_MODULE` is not set). Result: **5 of 5 pass** (about 1.6 min):
1. a legitimate student joins and the roster shows the server's name, not what the page claimed;
2. outsiders who know the public room id (no ticket, invented ticket, a real ticket stolen and replayed from another connection, malformed ticket) receive nothing, are disconnected and never reach the roster;
3. wrong passcode, a WT student pointing at the ET room, and a student who is not signed in cannot join;
4. teacher screen sharing still reaches an admitted student;
5. reloading a student gets a fresh ticket and replaces (not duplicates) the old connection; after the student is removed from the class the teacher page drops them within a minute.
**Negative control:** the same outsider test against the page as it was before the fix fails (the outsider with no ticket receives the lesson messages). Not covered: real Firebase, real Google sign-in, real networks/NAT, real student devices, the website as served from GitHub Pages.
