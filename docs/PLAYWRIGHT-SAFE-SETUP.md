# Playwright safe testing entry point (isolated QA branch)

This setup is intentionally separate from the repository's existing `playwright.config.ts`.
It **does not audit or approve** the existing test suite, and no production tests should
be run until each test has been inspected for writes and authentication side effects.

## Run the isolated offline smoke tests

From the repository root:

```sh
npm ci
npx playwright install chromium
npx playwright test --config=playwright.safe.config.ts --list
npx playwright test --config=playwright.safe.config.ts
```

Only files named `*.safe.spec.ts` are selected. The initial tests load three
repository HTML pages through an in-process request interceptor using a synthetic
localhost origin. All non-local network calls (including Firebase) are aborted.
No real student, teacher, ET/WT or production records are created or modified.
These are **render smoke tests**, not full authentication or data-persistence tests.

Failure artifacts appear under `test-results-safe/` and
`playwright-report-safe/` and should not be committed.

## Plan for comprehensive coverage

1. Inventory all existing `e2e/` Playwright tests and `tests/` Node suites.
2. Classify each as offline/mock-only, emulator-only, read-only, or write-risk.
3. Move/copy a suite into `*.safe.spec.ts` only after verifying every network
   route, credential, fixture, and storage write; never relax network blocking casually.
4. Add separate synthetic ET and WT identities and test permission isolation.
5. Add per-tool student/teacher navigation, reload, save/reopen, and failure handling
   with a Firebase emulator or complete network mocks.
6. Cover Yiddish Explorer unlock persistence (teacher sets level, reloads, switches
   ET/WT, simultaneous teacher sessions) with synthetic class data.
7. Capture console errors, page errors, failed requests, screenshots and traces;
   distinguish intentional mocked request blocks from genuine failures.
8. Run write-capable integration suites **only** against a disposable emulator
   database, never against production Firebase.
9. Coordinate merges with the other active agents; this branch does not deploy.

The default Playwright configuration is not assumed safe simply because it exists.
