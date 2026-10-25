# Synthetic teacher and class testing

All Firebase emulator runs use a `demo-*` project ID and the rules in
`firebase.security-test.json`. They cannot connect to a production Firebase
project. The test config pins the Hub, logging, database, and storage ports to
loopback; change ports with the matching `FIREBASE_*_EMULATOR_PORT` variables
when another local process owns them.

## Security emulators

```powershell
$env:B3_RUN_RTDB_EMULATOR_TESTS = '1'
$env:B3_RUN_STORAGE_EMULATOR_TESTS = '1'
$env:FIREBASE_DATABASE_EMULATOR_PORT = '19100'
$env:FIREBASE_STORAGE_EMULATOR_PORT = '19199'
npx firebase emulators:exec --project demo-ftt-security --config firebase.security-test.json --only database,storage "node --test tests/security-rules-emulator.test.cjs && node --test tests/storage-rules-emulator.test.cjs"
```

The root package pins Firebase CLI, Playwright, and the Firebase test SDK in
`package-lock.json`. Install with `npm ci` before running the command.

## Browser checks

Install the browser matching the checked-in Playwright version with
`npx playwright install chromium`. If Chromium is already installed in a
non-default cache, set `PLAYWRIGHT_BROWSERS_PATH` to that cache. Optionally set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to the exact Chromium executable. Then run:

```powershell
npx playwright test --project=chromium
```

The multi-teacher classroom test uses the real app pages and local Auth,
Realtime Database, and Functions emulators. Run it with:

```powershell
npx firebase emulators:exec --project demo-ftt-readiness --config firebase.security-test.json --only auth,database,functions "npx playwright test e2e/synthetic-multiteacher-classroom.spec.ts --project=chromium"
```

This journey is also part of the migration-checks GitHub workflow. It must pass
before using the synthetic onboarding path as evidence for a supervised pilot.

The hosted-site smoke tests `auth-check.test.cjs` and
`firebase-bandwidth.test.cjs` are not run by the Node unit-test workflow; they
use Playwright Test and target the public website. Do not run them as part of
synthetic-only local testing.

## Coverage boundary

`tests/synthetic-teacher-journey.test.cjs` exercises the invitation claim core,
student-management core, and teacher roster authorization using fictional
identities and an isolated in-memory store. It is not a substitute for a full
browser journey through Firebase Auth emulator, Functions emulator, all tool
screens, and student progress reload. Do not use its passing result alone to
approve a teacher pilot.
