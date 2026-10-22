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

## Detailed findings — second pass
- `site-settings.js:944-974`: Google login uses a separate LOCAL-persistence Firebase auth instance and copies the user into the SESSION-persistence instance. This is deliberate isolation between remembered teacher and student tabs; removing it without replacement would be unsafe.
- `site-settings.js:1048-1100`: each `onAuthStateChanged` subscription can invoke `readUserAccess(user)` and the admin callback can also run workspace mirroring/migration. Measure the frequency of these operations before deciding whether to deduplicate.
- `index.html:1565-1589`: the homepage already reuses the initial student login token when supplied; do not reintroduce an unnecessary second token request.
- `halacha/index.html:782-820`: Halacha checks the existing Firebase identity first, but requests a fresh `halachaToken` and signs in when missing/mismatched, with a fallback to `studentRewardsLogin` for older deployments. Test whether this fallback is still required before removing it.
- `game-gate.js:401-440`: the class lookup is two sequential groups of protected reads (profile/membership, then five class properties). The individual calls in each group are parallel; a single slow call can delay the whole group.
- Existing teacher preview and student impersonation are distinct identity flows and must remain separate.

## Acceptance criteria for first code repair
- Existing teacher Google session survives refresh, opens teacher tools without a new popup, and never becomes a student session.
- ET and WT students sign in once and can navigate all assigned tools; no additional passcode prompts.
- An unassigned student, disabled member, locked tool, and expired credential are denied; network timeouts never authorize.
- Student A cannot read/write Student B's records; teacher previews do not write student data.
- Repeated tool opens do not repeat unnecessary sign-in token exchanges.
- Measured p50/p95 sign-in and tool-open timings improve against a captured baseline; no fabricated speed target.
