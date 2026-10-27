# Firebase security change procedure

This is a deployment checklist for the local security work. It has not been run against production. The default `firebase.json` selects `firebase-rules.json`, the rules currently live in production, so an ordinary deploy cannot switch every rule at once. Only `firebase.security-deploy.json` selects the hardened Realtime Database and Storage rules; use it deliberately, one tested step at a time. Before any deployment, verify the selected project, database instance, bucket, source revision, and target rules files; no production deployment has been performed.

## Before any production change

1. Select a maintenance window and pause student activity so ET/WT attempts, Chazara events, recordings, rewards, and quiz answers are not changing during the backup and cutover.
2. Export the currently deployed Realtime Database rules and Storage rules. Record project ID, RTDB instance ID, bucket name, rules revisions, and the complete Cloud Functions inventory (name, region, generation, runtime, trigger, URL, and relevant non-secret configuration). Store these beside the backup in encrypted, access controlled storage; do not commit or paste data exports into tickets or logs.
3. Export a complete Realtime Database backup using an authorized Admin SDK account to the encrypted backup location. Include any external or secondary RTDB instances used by ET/WT. Verify the backup parses, record byte size and SHA-256 checksum, and restrict access to the owner and named recovery operator.
4. Back up Firebase Storage objects and metadata, including names, generations, content types, sizes, checksums, and custom metadata. Use a versioned, encrypted destination with object versioning or an equivalent immutable copy. Verify the object inventory and checksums without opening recordings or media.
5. Restore the RTDB backup into a separate emulator or isolated non-production project, then compare record counts by path and verify the restored rules remain the captured rules. Restore a sample of Storage objects into an isolated bucket and confirm generation, metadata, and checksums. Keep student media contents out of routine inspection.
6. Record the source commit and build artifact for every function that will be replaced. The deployed function source was not proven to match this repository during the earlier inspection, so confirm the deployed revision, runtime, secrets, environment variables, service accounts, and trigger configuration before replacing a function. Export function configuration without exporting secret values.
7. Confirm ET and WT membership counts and tool-grant counts using aggregate counts and synthetic fixtures only. Do not copy or use student names, records, recordings, or passcodes in test fixtures.

## Local and emulator validation

1. Use Java 21 or newer with the Firebase CLI. Temurin Java 21 is installed locally and the database emulator has been run against the isolated demo project.
2. Run the local Node regression suite while excluding browser tests that navigate to the live website. Run targeted security tests for Game Show answer stripping and active membership, private media URL authorization, Shorashim concurrent merges, Rewards, Posuk Practice, Chazara, Gallery, and ET/WT teacher scoping.
3. Run the Realtime Database emulator with `firebase emulators:exec --config firebase.security-test.json --project demo-b3-security --only database "node --test tests/security-rules-emulator.test.cjs"` and Storage emulator with the same config and `--only storage`. The `demo-` project uses synthetic records and files only.
4. Verify the emulator proves: anonymous reads/writes fail on student data; students cannot read Weekly Quiz correctness or Game Show answer keys; students can write only their own progress and submissions; Gallery students see approved posts and their own submissions; teachers read only actively assigned classes; and ET/WT access works independently for assigned teachers.
5. Review function tests for verified ID tokens, server side answer filtering/scoring, class membership and active assignment checks, safe media URL issuance, and request body validation. Verify function URLs and the frontend configuration point to the intended `b3-games` project before any deployment.

## Safe deployment order after explicit approval

1. Freeze writes. Reconfirm fresh encrypted RTDB and Storage backups, rules/config exports, object inventory and checksums, successful isolated restore drills, rollback commit, and maintenance contact.
2. Validate `firebase.security-deploy.json`, `.firebaserc`, functions source, runtime, regions, bucket and database IDs, and environment configuration against the approved project. Use explicit `--project b3-games --config firebase.security-deploy.json` on each later deployment command; do not run it now without separate approval.
3. Deploy compatible backend functions first: student authentication/token issuance, Rewards and Posuk/Chazara actions, Game Show student question/action endpoints, Gallery scoped reads, and private media URL issuance. Verify function health and synthetic requests without live student data.
4. Publish the website frontend after the endpoints are ready. Confirm student login, ET/WT class selection, teacher class selection, recordings, Gallery approval, Game Show question display/buzz, and Rewards workflows with synthetic test accounts. Keep student activity paused.
5. Deploy the Realtime Database rules from `firebase-rules.hardened.json` only after the updated frontend is serving and emulator tests pass. Confirm teacher and owner workflows immediately with synthetic accounts.
6. Deploy Storage rules from `storage-rules.hardened.rules`. Verify owner-only Posuk/Chazara reads, matching-class uploads, Gallery media visibility only after approval through the signed URL endpoint, size/type checks, and teacher media access after assignment verification.
7. Run the post-deployment smoke checklist with synthetic accounts: anonymous and cross-student data reads denied; rewards balances cannot be directly changed; Game Show answers remain filtered; ET and WT students function independently; two teachers cannot cross classes; active assignment revocation blocks the next backend request; new recordings play for the student and assigned teacher; approved Gallery media displays for classmates.
8. Reopen student activity only after all checks pass. Monitor permission-denied counts, failed sign-ins, failed submissions, function errors, and Storage errors. Do not log request bodies, passcodes, recording contents, or student records.

## Rollback

1. If function behavior fails before the rules change, restore the previously recorded function source/build and keep student activity paused until smoke checks pass.
2. If the website fails after function deployment, restore the previous website artifact. The old website can still authenticate, but new point requests may fail closed until a compatible site is restored.
3. If a rules issue blocks legitimate ET/WT work, pause student activity, fix the candidate and rerun emulator tests. Restore previous rules only with explicit owner authorization and a time limited exposure plan; the previous rules reopen public access. Prefer a corrected restrictive ruleset over reverting to permissive rules.
4. If Storage rules block legitimate uploads or playback, pause activity and restore only the captured Storage rules after explicit owner authorization; review the temporary exposure and immediately correct the restrictive candidate.
5. Restore database contents only if data is actually corrupted or lost, from the verified encrypted backup into the correct instance after explicit approval. Rules rollback does not require restoring database contents.
6. Restore Storage objects only if they are actually missing or corrupted. Restore object generations and metadata from the verified backup after explicit approval; do not overwrite newer valid recordings or Gallery media during recovery.

## Existing download URL migration blocker

Firebase Storage download URLs contain bearer tokens. Tightening Storage rules does not revoke a token URL already saved in Realtime Database or copied elsewhere. The updated student pages save new Posuk and Chazara audio by private Storage path, and new Gallery media uses the authorized short-lived URL endpoint, but historical `audioURL` and `videoUrl` values can remain usable until their object tokens are rotated. Before claiming that all historical recordings and Gallery files are private, inventory tokenized objects from metadata only, migrate database references to object paths, rotate the download tokens, and verify playback through authenticated endpoints. Keep the object bytes and generations unchanged. This production metadata and database migration requires separate explicit approval, a fresh backup, a restore check, and a tested rollback plan.

## Multi-teacher and ET/WT data safeguards

- Keep existing student IDs and ET/WT records in place; do not bulk move or rewrite records as part of a rules cutover.
- Issue student tokens for the selected active class. Recheck profile, class membership, class state, and tool grant in backend operations.
- Resolve teacher access from the authenticated teacher UID and assigned class list. Never accept a class assignment or student ID from a browser as authority.
- Test two synthetic teachers with disjoint class assignments and a synthetic student with two memberships. Revoke one class assignment and prove only that class becomes inaccessible.
- If the membership layout cannot support a class scoped rules check without exposing peers, migrate that feature to a backend endpoint or class keyed data path before deployment; do not widen rules to make the feature work.
