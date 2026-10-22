# Fun Torah Tools stabilization checkpoint — 2026-10-22

## Branch and scope

- Repository: `simchacohen1/B3-games`.
- Candidate branch: `audit/signin-reliability-20261021`, rebased onto the latest `main` during the PR #283 CI repair continuation.
- Keep PR #283 draft; do not merge or deploy.
- PR #281 student-authentication changes were incorporated into this candidate. Where its gate changes conflicted, the candidate retained PR #283's fail-closed role/membership checks and merged only the compatible session and tool fixes.
- No production config, functions, rules, student accounts, or student data were changed or accessed.

## Repairs in this checkpoint

- Returning student sign-in reuses a saved student ID only as a server-validated lookup hint. An incorrect/stale hint falls back to a full name lookup; the server still checks the individual passcode, active profile, and class membership.
- Avoided a duplicate verify/login round trip when restoring a valid student session; auth restore and server login overlap where safe.
- Fixed Switch Student's undefined reset handler and a Posuk Practice page-load request to a POST-only endpoint.
- Kept Firebase SDK/session initialization intact on first visits by aborting an IndexedDB open that would otherwise create an empty auth store.
- Gate optimizations overlap public site settings and the teacher helper download with Firebase restoration, suppress repeated empty teacher checks, and stop background polling while hidden. Protected profile, membership, class, and tool checks stay authenticated and fail closed.
- Removed a remembered-class prefetch experiment after regression tests showed that it could read class data before confirming an active student profile. Class reads remain after profile and membership verification.
- Fixed the Halacha mini-control container creation path and invalidated cached gate script URLs on active tool pages.
- Preserved Rashi Letters automatic advance after correct answers and current Gallery improvements from `main`.

## Verification

- Earlier focused synthetic regression suite after integration: **184 passed, 0 failed, 0 skipped**. New PR #283 merge-base CI failures are being repaired and tests rerun on the rebased head.
- `node --check` passed for `game-gate.js`, `backend/functions/student-auth-core.cjs`, and `backend/functions/student-auth.js`; whitespace checks passed when recognizing the repository's CRLF files.
- Existing PR #283 evidence remains separate: its synthetic browser staging reported 15 scenarios passed, its RTDB emulator run reported 18 rule tests passed, and its synthetic gate benchmark reported student p50 449→332 ms and teacher p50 449→200 ms under an injected 120 ms REST delay. These older results were not rerun against this combined checkpoint and are not production measurements.
- Current live site was opened in Chrome in signed-out mode. Homepage and Halacha route loaded; Halacha presented its access gate and displayed its local-only save notice. A teacher-demo direct URL presented a membership/sign-in gate. No production credentials were used.
- Live homepage response measured once with `curl`: 200, 162,412 bytes, DNS 0.000029 s, TLS 2.7995 s, TTFB 2.9313 s, total 2.9779 s. One sample is not a reliable before/after benchmark. Python requests to routes returned 403 with that client and are not treated as confirmed site failures.
- Three additional homepage requests all returned 200 with 162,412 bytes; total times were 6.58 s, 3.85 s, and 2.60 s. TLS setup took 6.32 s, 3.71 s, and 2.47 s; TTFB was 6.53 s, 3.81 s, and 2.55 s. These are signed-out, single-route measurements; they point to variable connection setup and are not a before/after comparison.
- Local Chromium/Firefox/WebKit Playwright execution is blocked: Playwright browser download returned a truncated/invalid archive; no local browser binaries are installed. Cloud browser verification used Chrome only and did not log in.
- GitHub CI on the prior PR head reported failures in Class Pointer unit/browser regressions, Follow Teacher and broad browser coverage. Those checks must pass on the rebased head before a release-ready verdict.

## Confirmed release blockers from the existing read-only production review

- Production RTDB rules differ materially from the hardened candidate and include broad public grants for application data. This is a production security defect that requires a coordinated rules release. Do not deploy legacy `firebase-rules.json`.
- The production inventory recorded in the existing PR #283 review lacks the `weeklyQuizStudent` endpoint; publishing the updated Quiz client without that function will break Quiz requests.
- Production `funTorahTeacherClaim` is older than the candidate and lacks the candidate's `www` CORS behavior and zero-class invitation refusal. Existing student-auth and rewards code matched the reviewed candidate source, but live positive auth flows were not verified.
- The current evidence comes from a read-only production inspection performed 2026-10-21/22 and must be refreshed before any release.
- No production rule change, function deployment, frontend publication, merge, or real-account test was performed.

## Next steps / release gate

1. Review this combined branch and let GitHub Actions run against it; run the full Chromium/Firefox/WebKit suite in CI or a browser-capable staging environment. Re-run emulator rules and synthetic ET, WT, and teacher flows against the combined head.
2. Refresh read-only production function/rule/config metadata immediately before release and verify OAuth domains and token exchange with synthetic accounts in isolated staging.
3. With explicit owner approval only: deploy the required candidate backend functions, publish the frontend, and activate the hardened RTDB rules in a planned maintenance window. Verify each stage before proceeding.
4. Preserve frontend artifact, function revisions/config, and the pre-release rules snapshot. Roll back frontend or functions to the recorded compatible versions if checks fail; after hardened rules are active, keep affected tools unavailable and fix forward rather than restoring permissive rules.

## Resume note

Do not stage unrelated untracked `node_modules` or the scratch audio file under `preview-pr234/davening_student_app_wt/audio/`. Production release requires explicit approval, and these changes are not ready for production until browser/emulator checks against this combined head and a fresh production preflight pass.
