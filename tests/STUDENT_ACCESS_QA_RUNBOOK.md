# ET/WT Playwright test identities and runbook

Status: PROPOSED ONLY. No accounts, Firebase records, credentials, or staging environments are created by this document.

## Isolation
- Prefer a dedicated Firebase test project with a separate RTDB, Authentication, and any Cloud Functions required for authentication, configured with the same security rules and representative synthetic classes/tool grants.
- Name synthetic classes `QA-ET` and `QA-WT`, and synthetic students `Playwright ET` and `Playwright WT`. These are labels for test fixtures, not existing class/student IDs.
- Never populate the QA environment with actual student names, passcodes, recordings, homework, or progress. No copying production Firebase databases.
- If staging is unavailable, do not write test student records or grant access in production without explicit owner approval and a review of backend side effects.

## Identity and access
- Provision separate low-privilege student logins for QA-ET and QA-WT with only the access their classes require. Use an authorized provisioning method and test-only randomly generated passcodes; no teacher/admin claims.
- Ensure one test student cannot read the other test student's or class's records (negative test).
- Supply Playwright authenticated browser state via `FTT_STORAGE_STATE` on the runner or a secure secrets store. Never commit that state, tokens, or passcodes. Rotate and revoke after testing.
- Keep the test project and account access limited to maintainers. Never reuse a real student's account.

## What to test
1. Cold sign-in: new browser context, navigate home, start stopwatch, authenticate as QA-ET; record elapsed time to visible dashboard and last completed network requests.
2. Warm sign-in: new tab/context with authorized session state, verify dashboard visibility and no phantom login overlay.
3. Repeat for QA-WT.
4. For each class, open Halacha, Sefer Hamitzvos, Posuk Practice, Shorashim, Chazara, Weekly Quiz, Yiddish, Rashi Letters and other assigned tiles; distinguish valid class/tool locks from crashes.
5. Test refresh, back navigation, logout, student-switch flow, inaccessible direct links, wrong-class access, expired session, and a slow-network profile.
6. Capture request latency by sanitized endpoint (strip query strings, Firebase auth tokens, student IDs, request/response bodies), HTTP failures, uncaught exceptions, visible error/loader text, and sanitized Playwright trace/screenshot evidence.
7. Limit any write-path exercises (answers, submissions, recordings) to synthetic fixtures and verify cleanup; diagnostic sweep should stay read-only.

## Current automated coverage
`tests/student-access-diagnostics.spec.cjs` is a read-only baseline that visits pages, waits, and saves screenshots and JSON logs. It does NOT perform a sign-in, verify access grants, or assert successful tool content. It cannot diagnose authenticated student flow without separately provisioned authorized state. Avoid reporting a login screen as a failure for signed-out users.

## Next engineering tasks
- Prepare isolated QA Firebase project and synthetic class data, with deployment/config parity confirmed.
- Build actual login journey automation and state generation for QA-ET/QA-WT; report session timings from click-to-dashboard, not only DOMContentLoaded.
- Add assertions for content/authorization after each tool navigation, plus fixtures for network throttle, token expiry and class switching.
- Integrate opt-in CI workflow; do not run authenticated tests on untrusted pull-request code with secrets.
- After reproducible evidence, address root cause in separate PR, compare before/after timings, and obtain owner approval before production merge/deploy.

## Run existing baseline
```bash
npm ci
npx playwright install --with-deps chromium
npx playwright test tests/student-access-diagnostics.spec.cjs --workers=1
```
For authenticated test state (not yet created): `FTT_STORAGE_STATE=/secure/path/qa-et-state.json npx playwright test tests/student-access-diagnostics.spec.cjs --workers=1`.
