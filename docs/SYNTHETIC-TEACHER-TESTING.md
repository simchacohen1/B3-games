# Synthetic teacher and class testing

Use Node 24.12+ and Java 21+. Install `npm ci` and
`npm ci --prefix backend/functions --ignore-scripts`, then install Chromium with
`npx playwright install --with-deps chromium`. The pinned Firebase CLI requires
Java 21; the Firebase test SDK requires Node 24.12 or later.

All emulator commands use `demo-*` projects. Emulator listeners are pinned to
loopback in `firebase.security-test.json`. Never change the project to a live
project or supply real teacher/student credentials to this suite.

## Auth startup regression (no database emulator needed)

```sh
npx firebase emulators:exec --project demo-ftt-readiness --config firebase.security-test.json --only auth "npx playwright test e2e/firebase-auth-emulator.spec.ts --project=chromium"
```

A fresh Chromium context loads the actual Teacher Center. It must reach Google
sign-in, configure both default and remembered-teacher Auth instances on port
19099, and still reach sign-in after refresh. No Auth observer is stubbed.

The old page-header script opened `firebaseLocalStorageDb` at version 1 before
Firebase did, created it without Firebase's object store, and kept its handle
open. Firebase's repair/delete then waited indefinitely. This PR removes that
session-scanning/modal-hiding script from the pages used in the journey. Auth
initialization and authorization remain owned by the Firebase SDK and app.
The follow-up removed it from the remaining 38 site pages (old backup and
preview copies are left alone). tests/no-early-firebase-idb-scanner.test.cjs
fails if any page opens that database again, and firebase-auth-emulator.spec.ts
checks in a fresh browser that Auth creates a healthy database on eight of them.

## Full browser journey

```sh
npx firebase emulators:exec --project demo-ftt-readiness --config firebase.security-test.json --only auth,database,storage,functions "npx playwright test e2e/firebase-auth-emulator.spec.ts e2e/synthetic-multiteacher-classroom.spec.ts --project=chromium --workers=1"
```

The dedicated Migration access checks workflow runs this command. The ordinary
cross-browser workflow skips these two specs when the Auth emulator is absent;
it does not try to contact Firebase production. If using system Chromium locally,
set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable.

The full test uses actual owner, teacher, student and learning pages:

- A fictional owner creates a class, invites a fictional teacher, assigns the
  class and enables tools through Owner Admin.
- A second browser profile signs in as the teacher using the Auth emulator,
  claims the invitation through the Functions emulator, sees only that class,
  and enrolls three fictional students through Manage Class.
- A third profile uses the actual student name/passcode form. Weekly Quiz saves
  an answer, refreshes with that answer locked, completes the quiz, refreshes
  the result/history, and returns home.
- Rashi Letters completes a letter step, checks its database save, refreshes
  into the saved word phase, and returns home with the student token intact.
- Synthetic ET/WT memberships must remain unchanged. Unexpected external
  requests, JavaScript errors and failed Firebase requests fail the test.

The helper serves local copies of the SDK and redirects configured function
URLs to the local Functions emulator, preserving real token verification and
backend writes. Every Firebase app, including `FTTRememberedTeacher`, receives
only the demo config and Auth emulator. The Google popup interaction is replaced
with a fictional emulator credential, not a real Google login or fake auth callback.

### Fictional owner and rule boundary

The browser journey loads a test-only copy of the exact rule file selected by
production `firebase.json` (`firebase-rules.json`). It substitutes the bootstrap
owner email literal with `owner@example.test` in that in-memory copy and in the
locally served Owner Admin/site-settings source. The verified-email and owner
comparisons themselves remain unchanged. No production file/settings/rules are
rewritten or deployed, and the real bootstrap identity is never signed in.

The hardened candidate rules are tested separately below. A successful browser
journey under the current configured rules does not establish that every UI
read is compatible with the stricter candidate rules, or approve production use.

## Candidate security-rule checks

```sh
B3_RUN_RTDB_EMULATOR_TESTS=1 B3_RUN_STORAGE_EMULATOR_TESTS=1 FIREBASE_DATABASE_EMULATOR_PORT=19100 FIREBASE_STORAGE_EMULATOR_PORT=19199 npx firebase emulators:exec --project demo-ftt-security --config firebase.security-test.json --only database,storage "node --test tests/security-rules-emulator.test.cjs && node --test tests/storage-rules-emulator.test.cjs"
```

These checks continue to load the unchanged hardened RTDB and Storage candidate
rules, including negative authorization/isolation cases. The journey's owner
identity substitution is never applied to them.

## Pointer and PR #345 integration

```sh
npx playwright test e2e/class-pointer-teacher-workspace.spec.ts --project=chromium
```

Current main's test documents commit `58095c86` (Compact Students panel): the
intentional full-screen popover is 300px, not the older >=340px resizable drawer.
Keep the assertions for dragging, permission rows, inline widths and layout
restoration. No Pointer implementation change is needed for that stale failure.

PR #345 owns generic class-scope, roster and tool-control behavior. This branch
incorporates current main without duplicating that migration. A temporary merged
tree was used to run its class-scope/onboarding/tool-policy/roster/role tests;
neither PR is merged into main by these tests.

The hosted-site `auth-check.test.cjs` and `firebase-bandwidth.test.cjs` use the
Playwright runner and are excluded from the Node unit-test command. Do not run
hosted-site smoke checks as part of a synthetic-only local journey.
