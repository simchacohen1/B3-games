# Sign-in reliability audit — 2026-10-21

Status: initial code inspection; no production changes.

## Goal
One reliable homepage sign-in, reuse the authenticated identity across tools, no repeated credential prompts, and no relaxation of student/teacher authorization. Preserve real student records.

## Confirmed code observations
- `game-gate.js` waits for Firebase Auth initialization and then makes REST reads for a student profile, memberships, and five class fields (active, siteEnabled, access, toolGrants, member). These calls run in parallel within their groups, but the groups are sequential.
- `game-gate.js` currently uses a 15,000 ms fetch timeout, and the auth readiness process can add waiting time.
- `student-rewards/student.js` has its own custom-token sign-in and Firebase Auth listener.
- `halacha/index.html` also has its own custom-token sign-in path.
- `index.html` includes custom-token sign-in.

## Hypotheses to test, not established causes
1. Multiple tool-specific authentication paths cause redundant authentication or session conflicts.
2. Sequential Firebase reads and slow individual REST responses contribute to startup delays.
3. Repeated initialization or retries add latency and produce inconsistent sign-in state.

## Safe implementation sequence
1. Record baseline sign-in and tool-opening timings in ET and WT using authorized test accounts; capture failure cases and network waterfall.
2. Map Firebase app/auth instances and session persistence across homepage and each tool. Identify which re-authentication is genuinely required.
3. Introduce a shared authenticated-session resolver with bounded waits, deduplicated in-flight checks, and explicit states (loading, authorized, denied, temporary error). Never interpret a timeout as authorization.
4. Optimize access reads while retaining server-side Firebase rules and current permission checks. Prefer an authorized single class-scoped read only if rules allow it; otherwise keep protected reads.
5. Migrate one tool at a time, beginning with a test environment, and verify teacher, student, ET/WT, locked tools, expired sessions, refresh, and offline behavior.
6. Run automated regression tests and live browser tests before requesting production approval.

## Non-goals
- No production changes or Firebase rules changes during audit.
- No bypass of authorization checks.
- No automatic student impersonation for teacher preview.
- Teacher preview progress and all-level unlocks are separate work.

## Immediate next steps
Inspect the full login functions in `index.html`, `site-settings.js`, `game-gate.js`, `halacha/index.html`, and `student-rewards/student.js`; add synthetic test coverage and baseline timing measurements before modifying authentication.
