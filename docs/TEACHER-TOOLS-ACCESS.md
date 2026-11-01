# Teacher Tools access control (issue #439)

## What is enforced where

| Layer | What it does | Strength |
|---|---|---|
| `teacher-tool-gate.js` (first script in every Teacher Tools page) | Hides the whole page until a verified, active teacher/admin is confirmed by the existing `site-settings.js` access check. Denies signed-out visitors, students, signed-in people who are not teachers, revoked teachers, invited-but-unclaimed teachers, teachers with no classes, "Sign in as a student" mode, and `?class=` for a class that is not the teacher's own. Fails closed. Re-checks after back/forward cache and sign-out. | **Screen-level.** Stops anyone opening the tool by typing its address. |
| Firebase database rules / Cloud Functions | The only place data can really be protected. | **Real protection**, but see "Still open" below. |

GitHub Pages serves every `.html`/`.js` file publicly, so a browser gate can never make the page *source* secret. It keeps the tool closed; the data must be protected by rules and functions.

## Inventory

`security/teacher-tools-inventory.json` lists every Teacher Tools page (36 pages) and the gate scope:

* `teacher` (default): any active teacher of at least one class, or an admin.
* `b3`: admin, or a teacher of the B3 classes (`et` / `wt`) — Class Dashboard, Comment Log, Sync to Nigri, Chossid Lamdan marks, Hebrew Reading lab. (admin.html is the Teacher Center shell used by every teacher, so it is `teacher`.)
* `admin`: owner/admin only — `owner-admin.html`.
* `teacher-home.html` has its own sign-in screen (checked by test, not given the gate).
* `class-pointer-prototype/dashboard.html` and `classroom.html` are also the *student* Class Pointer screens, so they are gated only in teacher mode (`?teacher=1`, `?dashboard=teacher`).

A test fails if a new `*teacher*.html` file is added without being listed.

## Tests (fictional people only, no network)

`node --test tests/teacher-tools-direct-url.test.cjs`

For every gated page it opens the direct URL as: anonymous, student, random Google account, invited-but-unclaimed teacher, revoked teacher, teacher with no classes (all must be denied with no visible tool and no database writes); ET teacher and WT teacher (allowed, except owner-admin); admin and owner (allowed); ET teacher with `?class=wt` and `?class=../../x` (denied); admin with `?class=wt` (allowed). It also checks Teacher Center shows no classes to those same people and that the student Class Pointer screen still opens.

## Found while testing

* `game-show/teacher.html` wrote `buzzSound` to the database as soon as it loaded, even for a stranger. It now waits for `window.B3TeacherGateReady`, which resolves only for a confirmed teacher.
* Before the gate, about ten pages showed their working teacher screen to a signed-out visitor (Story Timing Tool, Work Timer, Sync to Nigri and its Classtime / School Marks / Chossid Lamdan pages, the root Chossid Lamdan page, Class Pointer teacher screen, Comment Log). The rest showed a sign-in message but still had their screens in the page.

## Database security candidate in this draft PR

This draft now includes a local Firebase rules candidate alongside the page gate:

* The broad `b3Games` parent read and wildcard grant are removed, so direct parent requests cannot inherit access to every class.
* Teacher reads of class records, student profiles, memberships, student attempts, and Weekly Quiz data are restricted to the assigned class; owner/admin access is preserved.
* Weekly Quiz launch, response, completion, and assignment paths are class-scoped. Direct collection reads and cross-class requests are covered by emulator tests.
* The candidate keeps student writes bound to their own student ID. Class and student creation remain restricted at the database layer; principal creation/management still depends on the separate trusted management-function work in #344.

Focused fictional-account checks passed locally: rules/additive static checks (19/19), hardened rules emulator tests (18/18), and transitional class-scope/Weekly Quiz emulator tests (2/2). The emulator was local; no staging or production database was changed.

Existing public leaf grants for public settings/content and legacy Class Gallery data remain outside this Teacher Sign-in rules change. The rules candidate must not be described as deployed.


## Not verified yet

* Staging: not deployed. The staging copy is built by a local, untracked tool; this branch has only been tested locally.
* Production: unchanged.
* Real teacher / real student sign-in on the gated pages.

## Review follow-ups (PR 441 review, 2026-10-28)

* **Revocation while a tool is open:** the gate now also watches the signed-in teacher's own `admins/<uid>` and `teachers/<uid>` records and re-decides when they change (inactive, class removed, record deleted), without sign-out or reload. Tested with fictional data (`revoking a teacher or removing their class...`). This is the screen. Server-side denial of later writes still depends on the database rules (see "Still open").
* **Hidden is not execution-blocked:** unchanged and stated plainly. Other scripts on a gated page still load and can issue reads (and, apart from Game Show's startup write which now waits for `B3TeacherGateReady`, the tests show no writes for denied users). The tests assert zero visible tool controls and zero writes for denied users; they do **not** claim zero reads. Data isolation must come from rules/functions; RTDB/Functions emulator checks per route belong with the rules work (#20/#94/#145/#344).
* **`data-scope="b3"` and the hardcoded `et`/`wt` IDs:** intentional for now. Class Dashboard, Comment Log, Sync to Nigri, Chossid Lamdan marks and the Hebrew Reading lab are B3-only tools (not grantable per class), so they are limited to admins and ET/WT teachers. If they become class-generic, remove that special case together with #344 and keep existing lock/grant history. Not changed here.
