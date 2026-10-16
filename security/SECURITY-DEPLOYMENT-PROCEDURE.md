# Firebase security change procedure

This is a deployment checklist for the local security work. It has not been run against production. The candidate rules live in `firebase-rules.hardened.json`; the normal Firebase config still points to `firebase-rules.json`.

## Before any production change

1. Select a maintenance window and pause student activity so ET/WT attempts, Chazara events, recordings, rewards, and quiz answers are not changing during the backup and cutover.
2. Capture the current Realtime Database rules and deployment inventory for project `b3-games`. Record the Realtime Database instance ID, all active function names, regions, generations, runtimes, and trigger URLs. Save the exports to an encrypted, access controlled backup location. Never commit them or paste student exports into tickets or logs.
3. Export a complete Realtime Database backup with an authorized Admin SDK account into the encrypted backup location. Verify the export can be parsed and its checksum matches. Limit access to the owner and the specifically assigned recovery operator. Do not use a local, unencrypted student-data export.
4. Record the source commit and build artifact for every function that will be replaced. The deployed function source was not proven to match this repository during the earlier inspection, so confirm the deployed revision and secrets/runtime configuration before replacing a function.
5. Confirm the existing ET and WT membership records and tool grants using aggregate counts and synthetic fixtures only. Do not copy or use student names, records, or passcodes in test fixtures.

## Local and emulator validation

1. Use Java 21 or newer with the Firebase CLI. Temurin Java 21 is installed locally and the database emulator has been run against the isolated demo project.
2. Run `node --test tests/weekly-quiz-student.test.cjs tests/hardened-rules-static.test.cjs tests/teacher-class-rosters.test.cjs` and the feature regression suites covering Posuk Practice, Chazara, Rewards, Shorashim, teacher class access, and ET/WT.
3. Run `firebase emulators:exec --config firebase.security-test.json --project demo-b3-security --only database "node --test tests/security-rules-emulator.test.cjs"`. This uses an isolated `demo-` project ID and synthetic class/student records only.
4. Verify the emulator proves: anonymous reads/writes fail for student paths; students cannot directly read Weekly Quiz answer keys, response correctness, or completions; a student can use only their own ID; teachers read only assigned classes; a teacher assigned to one class cannot read another; and ET/WT paths preserve legitimate student and teacher access.
5. Review the function unit tests for server-scored answers, score release, assignment checks, and membership revalidation before promoting the candidate rules.

## Safe deployment order after explicit approval

1. Freeze writes and confirm a fresh encrypted backup, rules export, rollback commit, and maintenance contact.
2. Deploy the compatible student-authentication, Weekly Quiz student API, and point-award functions first. Verify function health and synthetic requests before changing the website.
3. Publish the website code that signs students in with the returned class scoped token and sends authenticated requests for Posuk Practice, Chazara, Rewards, and Weekly Quiz. Verify the published artifact and a synthetic test account before opening student access.
4. Apply the restrictive Realtime Database rules only after the website is confirmed to use those authenticated flows and the full direct-path emulator suite passes. The candidate rules must be reviewed against every feature before this step; changing rules too early will interrupt legacy direct database flows.
5. Verify anonymous access is denied on student profile, roster, Posuk attempts, Chazara, Shorashim, Gallery, and quiz-result paths. Verify ET and WT students, teachers, and two teachers assigned to separate classes can use only their own class.
6. Reopen student activity and monitor permission-denied counts, failed sign-ins, failed point requests, and function errors. Do not log request bodies, passcodes, recordings, or student records.

## Rollback

1. If function behavior fails before the rules change, restore the previously recorded function source/build and keep student activity paused until smoke checks pass.
2. If the website fails after function deployment, restore the previous website artifact. The old website can still authenticate, but new point requests may fail closed until a compatible site is restored.
3. If a rules issue blocks legitimate ET/WT work, pause student activity, fix the candidate and rerun emulator tests. Restore previous rules only with explicit owner authorization and a time limited exposure plan; the previous rules reopen public access. Prefer a corrected restrictive ruleset over reverting to permissive rules.
4. Restore database contents only if the data is actually corrupted or lost, and only from the verified encrypted backup with explicit approval. Rules rollback does not require restoring database contents.

## Multi-teacher and ET/WT data safeguards

- Keep existing student IDs and ET/WT records in place; do not bulk move or rewrite records as part of a rules cutover.
- Issue student tokens for the selected active class. Recheck profile, class membership, class state, and tool grant in backend operations.
- Resolve teacher access from the authenticated teacher UID and assigned class list. Never accept a class assignment or student ID from a browser as authority.
- Test two synthetic teachers with disjoint class assignments and a synthetic student with two memberships. Revoke one class assignment and prove only that class becomes inaccessible.
- If the membership layout cannot support a class scoped rules check without exposing peers, migrate that feature to a backend endpoint or class keyed data path before deployment; do not widen rules to make the feature work.
