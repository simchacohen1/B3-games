# PR #283 — isolated validation and final-review checkpoint

Resume base: `365e2650c35bee6a66c014845ac8166e06a53774`. All work stays on `audit/signin-reliability-20261021`. No merge, deployment, production rules change, or real student data access.

## Repairs discovered during validation

- **Duplicate startup access passes:** the 365e2650 candidate began a student pass before teacher-role resolution, then discarded it and repeated the reads. The gate now waits for the initial role decision. Authorization has a bounded deadline, and failed initialization can retry without accumulating successful watchers.
- **Late authorization after sign-out:** `site-settings.js` now checks observer generation, current Firebase user, and subscription state before delivering an asynchronous authorization result. Unsubscription invalidates pending results. This also protects the gate's authorization timeout/retry path.
- **Rewards teacher preview used the wrong Firebase app:** preview reads now use the authenticated teacher app, while the isolated student app remains signed out. No teacher credentials are copied into that student app. Preview activation occurs after successful data reads.
- **Halacha preview attempted teacher-copy writes:** `?teacher=1&demo=1` now suppresses save calls and teacher access controls. It retains teacher identity and does not save a teacher copy or student progress.
- **Halacha preview threw a DOM exception:** the sticker organizer moved its target into a nested tray. Insertion now finds the target's direct ancestor under the intended parent. Actual-page tests verify that loading/reloading the preview no longer throws.

## Completed verification

### Unit/static and related regressions
- 104 focused tests passed, zero failed/skipped (including stale auth, preview database selection, and Halacha save suppression).
- Additional Halacha/rewards suites: 37 passed, one pre-existing cache-version assertion failed. The same assertion fails with the starting `365e2650:halacha/index.html`: it expects `scrapbook-editor.css?v=20261019-all-stickers1`, but that base already uses `20261019-page-grid-fix1`. No production stylesheet or cache version was changed to satisfy the obsolete assertion. This is an existing test-maintenance issue, not a new application regression.
- JavaScript syntax and `git diff --check` passed.

Focused command:

```sh
node --test tests/signin-reliability-behavior.test.cjs tests/signin-architecture.test.cjs tests/game-gate-authenticated-reads.test.cjs tests/hardened-rules-static.test.cjs tests/teacher-signin-entry.test.cjs tests/student-auth.test.cjs tests/student-practice-auth.test.cjs tests/teacher-preview.test.cjs tests/yiddish-teacher-preview.test.cjs tests/signin-stale-auth.test.cjs tests/teacher-roles.test.cjs tests/direct-teacher-onboarding.test.cjs tests/signin-preview-connections.test.cjs
```

### Real local Firebase security emulator
18/18 existing database security tests passed, with no skips. Coverage includes anonymous/peer data denial, own student writes, ET/WT isolation, teacher assignments, private invitations, Pointer metadata permissions, quiz results, Gallery, Rashi, Game Show answer keys/scores, and rewards balance protection. Permission-denied warnings in logs are expected negative assertions.

The earlier emulator blocker was resolved by running the Java database emulator and Node test process under one local process tree and removing proxy variables for localhost traffic. No database rules were edited. The tests install `firebase-rules.hardened.json` into the emulator only. They do not establish which rules are currently deployed.

### Browser scenarios
9/9 scenarios passed using Chromium 134 headless, actual bundled Firebase compat SDK, Auth emulator, database emulator, checked-in site-settings, shared gate, and tool policy:

1. Synthetic ET custom-token sign-in; six activity IDs retain identity through navigation and refresh.
2. Same for WT.
3. Signed-out direct entry denied.
4. Disabled profile, membership, and tool denied.
5. Class lock, access-check failure closure, and recovery.
6. Synthetic Google teacher persists through tools/new tab; student session in another tab does not replace it; unassigned class denied.
7. Blocked Firebase auth/database CDN requests fall back to local SDK files and restore a student session.
8. Teacher sign-out while access reads are pending remains denied after those reads settle.
9. Actual Halacha and Rewards student-preview HTML/JS pages open and refresh with teacher identity. A Halacha preview save attempt and a sample Rewards request leave student progress, reward requests, balances, and teacher cloud-copy data unchanged. Neither page throws an uncaught error.

Tool-shell activity IDs: Halacha, Posuk Practice, Chazara, Weekly Quiz, Shorashim, Rewards. Only Halacha and Rewards received the additional actual-page preview test; the other tools' complete interfaces/exercises were not exercised here.

Unexpected outbound browser requests: zero. Two deliberate CDN failures were intercepted before network access. Font CSS was stubbed. Every browser SDK app was connected to local emulators, and non-demo project initialization was rejected.

## Measured gate performance

Raw samples and request counts: `docs/PR283-LAB-RESULTS-20261021.json`.

The baseline is the pre-repair gate at `3aafc7c`; the candidate includes both 365e2650 and this checkpoint. The lab injects 120 ms delay per REST response, reuses an authenticated browser session, and measures navigation to first verified gate access. Each row has 10 samples. Request counts below are after settling, so they include the baseline's duplicate startup pass.

| Identity | Baseline median / p95 | Candidate median / p95 | Startup REST reads |
|---|---:|---:|---:|
| Student | 449 / 483 ms | 332 / 368 ms | 16 → 8 |
| Teacher | 449 / 491 ms | 200 / 233 ms | 6 → 3 |

Median gate-open improvement: about 26% for students and 55% for teachers under this controlled delay. Student steady-refresh authorization still requires eight narrow REST reads; the student request reduction is removal of duplicate startup work, not removal of permission checks. Teacher steady-refresh reads remain reduced from five to three by the previous checkpoint. No broad class/student parent read was introduced into the shared gate.

These are local gate measurements, not production homepage passcode/Google login timings, internet latency guarantees, a CDN cache benchmark, or a statistically strong real-world p95. They include first-document and subsequent-document opens with persisted emulator auth; they are not separate cache-cold/cache-warm production trials.

## Reproduce / resume

Read `scripts/signin-lab/README.md`. `scripts/signin-lab/run.cjs` starts local Auth/RTDB, seeds synthetic accounts, runs the 18 security tests, runs browser cases, and prints the timings. `SIGNIN_LAB_RESULTS=/tmp/pr283-results.json` optionally saves raw local results. No Firebase CLI deployment or production credentials are used.

## Remaining limitations and review disposition

The changes are ready for code review. Keep the PR draft and do not merge/deploy without explicit approval.

Still unverified:
- Production dependency availability, actual deployed Firebase rules, and real-world login timings.
- Full homepage credential submission and all tool-specific student token-exchange/backend paths. This lab directly signs synthetic users into the Auth emulator; it does not emulate every deployed Cloud Function.
- Complete exercise/save flows for Posuk Practice, Chazara, Quiz, Shorashim, and all other tools. Their shared gate is tested; that is not proof of each entire application.
- Expired/revoked credentials through a real identity provider. Unit tests verify failed/hung token acquisition closes access; browser tests verify real emulator sign-out, not actual Google token revocation.
- Guest preview's complete application behavior. Anonymous database isolation is tested, but the guest UI is a separate existing mode.
- Repeated `site-settings.js` authorization subscribers can still duplicate their own SDK reads/admin mirroring. This checkpoint removes duplicate shared-gate startup work and stale callbacks, without refactoring that larger subsystem.

Before any production release, run a separately authorized staging exercise matrix with the relevant backend functions, resolve the existing stale stylesheet assertion, review the diff, and obtain explicit merge/deployment/rules authorization as applicable. Do not read real student records to fill these gaps without approval.
