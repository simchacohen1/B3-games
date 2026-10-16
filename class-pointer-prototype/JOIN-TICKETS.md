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
