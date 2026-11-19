# Class locks

Teachers lock or unlock **every** student feature for their class from one panel (🔒 in the teacher bar, any page),
with weekly schedules and timed unlocks. HIGH RISK: it changes what students can open, adds a function and a rules node.

## What a student sees
- Locked feature, student already inside it: within about a second the page is covered by "Locked by your teacher 🔒".
- Student home page: locked tiles show a lock and do not open.
- Arcade (all 12 games), Class Pointer (lessons, whiteboards, screen sharing), Homework, Word Bank, Davening, Work Timer and the
  other pages are covered like the older activities. `tests/student-lock-pages.test.cjs` fails for any HTML page that is not
  classified, or any student page without `student-lock.js`.

## The rules (`student-lock-core.js`, the same file in the browser and on the server)
Per class and feature, first match wins:
1. **Timed override** that has not run out (most specific key wins: feature, then `@group`, then `*`). Unlock or lock.
2. **The teacher's switch** (stays until switched back).
3. **A weekly schedule of ANY teacher of the class** that covers right now (New York time; a window may pass midnight).
4. Otherwise open.
A student in several classes is locked if **any** of his classes locks it (so any of his teachers can lock it).
The owner's emergency lock and an activity switched off for the class still win over a timed unlock (older gate, unchanged).

## Who "has the class"
The teacher whose own schedule line covers right now. If several, the one who opened the class most recently. If none is
scheduled, the teacher who most recently opened it. Opening = opening the Locks panel, or choosing the class in the teacher bar
(at most once every 5 minutes). Only the holder (or an admin) can start or end timed overrides; every teacher of the class can
use the switches and edit his own schedule.

## Data (`b3Games/workspaces/<ws>/classes/<classId>/locks`)
`features/<id>` (switch), `schedules/<teacherUid>` (name, rules), `overrides/<key>` (state, until, by, byName, label),
`opened/<teacherUid>` (ms). Written **only** by the `studentLocks` function; the node has no client write rule.
Students/teachers read it (hardened/staging rules: class token, or the student's membership, or an assigned teacher/admin).

## Files
`student-lock-core.js` (+ identical copies in `backend/functions` and `backend/functions-staging`), `student-lock.js`
(student pages), `class-locks/` (teacher panel), `backend/functions/student-locks*.{js,cjs}` (+ staging copy),
server checks in `multiplayer-games.js` and `class-pointer-share-auth.js`, `game-gate.js` (honours a timed unlock).

## Deploying
Staging (this order): rules, functions, hosting.
`firebase --config firebase.staging.json deploy --project fun-torah-tools-staging --only database,functions:staging`
then `.\scripts\deploy-posuk-grading-staging.ps1 -SkipFunctions` (hosting).
Live needs the same three pieces (database rules from `firebase-rules.json`, function `studentLocks` and the two edited
functions, hosting) and the owner's approval. Deploy the **function and rules before the pages**.

## Rollback
Pages: revert the merge. Locks stop being enforced client-side at once. Server: the Arcade/Class Pointer checks only refuse when a
lock exists, so deleting a class's `locks` node (or the function change) restores the old behaviour.

## Known limits
- Schedules and timed unlocks use each computer's own clock (as the older class hours do).
- If a student's browser cannot read the lock data, it keeps the last known state; with none the page stays open (the server
  still refuses Arcade and Class Pointer actions).
- The Class Pointer ticket check and the Arcade check read the lock when an action is made; a student already connected is moved
  out by the page (the sharing code leaves the lesson and stops sharing).
