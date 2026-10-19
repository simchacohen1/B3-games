# Follow the Teacher — phase 1 foundation

Tracking issue: [#150](https://github.com/simchacohen1/B3-games/issues/150).

**Status:** Isolated navigation decision engine and safety tests only. No teacher
control has been exposed in production, no student has been redirected, and no
Firebase rules/functions or student data has been changed.

## Intended UI

A compact control in Teacher Tools for each *assigned* class:

- **Independent** (default): students navigate their own enabled activities.
- **Follow — Free afterward**: teacher chooses Shorashim and presses **Send**
  (whole class or selected students). It navigates eligible students once,
  after which they may leave.
- **Follow — Locked**: teacher chooses Shorashim and presses **Follow & Lock**.
  Students remain on Shorashim until **Unlock** or expiry; when new permitted
  destinations are implemented, a teacher can switch pages in the same session.
- Clear **Following teacher · Shorashim** status on students' pages. A student
  trying another FTT link sees a short explanation. Do not silently discard
  student work; integrate with the activity's save/leave lifecycle.
- **Unlock all** is always visible to the teacher and returns to Independent.

The navigation modes are not screen sharing, remote control, browser tab focus,
or permission to see a student's computer.

## State contract

The proposed state contains `version, workspaceId, classId, teacherUid,
mode, destination, revision, targets, issuedAt, heartbeatAt, expiresAt`.
`targets` is `all` or explicit student IDs in the selected class.
The client must never authoritatively decide teacher class access:
an authenticated service/rule must validate the user's assigned class,
selected student memberships, allowed destination and revocation.

The only enabled destination in this foundation is `shorashim`. No arbitrary
URL, cross-site redirect, or teacher-supplied JavaScript is allowed.

The pure engine in `core.js` refuses requests without verified student context,
class match, per-student tool authorization, current heartbeat and valid expiry.
Teacher sessions must renew their heartbeat while active; a missing heartbeat
fails open to Independent after **90 seconds**. The maximum lease is 10 minutes.
A revision key lets Free send once per tab without repeated redirection.
Locked checks must run both during live updates and on direct activity loads.
A mode change to Independent immediately clears the lock.

## Required integration before merging

1. Implement verified, class-scoped navigation writes and student reads in
   Firebase, with emulator tests for teacher assigned/unassigned/revoked,
   admin, student own/other class, anonymous and multi-tab access. Reconcile
   with the existing RTDB privacy/security migration (#20); do not bypass it.
2. Add teacher control to Teacher Tools, bound to the **selected class**,
   not all classes. Avoid altering working Classroom Pointer permission code.
3. Load a student navigation listener through the common access gate plus
   homepage, *after* verified student sign-in and activity authorization.
   Track the last applied Free revision in sessionStorage. Never redirect
   during unsaved work without a safe save/leave strategy.
4. Test two classes (ET and WT), a third teacher class, selected students,
   direct URLs, disconnected/rejoining students, multiple tabs, switching
   teacher accounts, expiry, lock removal, and an ongoing student activity.
5. Run `node --test tests/follow-teacher.test.cjs`, browser tests and Firebase
   Emulator rules tests. Compare against current `main`. Obtain explicit
   production approval before merging/deploying. Real teacher/student checks
   are required before marking issue #150 complete.

No production writes/changes occur from this branch automatically.
