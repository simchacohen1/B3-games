# Fun Torah Tools — security hardening plan (October 15, 2026)

## Status and scope

**NOT SECURITY-CLEARED.** The code repository has open Firebase Realtime Database rules, a currently unprotected `main` branch, and failing existing GitHub Actions tests. This document is a remediation plan; it is not evidence that the deployed Firebase project uses the repository's current rules.

The `scripts/security-rule-audit.cjs` check detects newly introduced unconditional public read/write rules and exposure of selected private backend namespaces. `public-permissions-baseline.json` lists **32 existing public grants** as security debt. It does **not** bless those grants or block privilege increases inside complex expressions. Do not claim that a passing guard means data is safe.

## Passcode migration safety — staged code changes

The owner-only "Make all passcodes private" action is being changed to **preview before cleanup**, with explicit owner confirmation. The backend now inventories class-only student records as well as central and legacy records, preserves already-private credentials as authoritative, and blocks public-PIN deletion when credentials conflict or an unlinked class-only record has no usable identity. Preview reports counts and affected IDs, never passcode values. Focused tests cover fail-closed behavior, read-only preview, and existing student login compatibility.

**This is a preparation step, not a completed security repair.** The public Realtime Database parent read rule still exposes child data, and browsers with old copies may continue to display existing credentials until migration completes. Do not execute the destructive cleanup without verifying the active server endpoint, testing student sign-in on ET/WT and a new class, and ensuring safe recovery if the function fails. Confirm actual deployed RTDB rules separately; this PR does not deploy rules or Functions.

## Priority 0: protect existing student information without breaking the classroom

1. **Check actual deployed Firebase Realtime Database and Cloud Storage rules** using authorized Firebase project access. GitHub Pages only publishes frontend assets. Comparing files in GitHub cannot establish the active server-side rules or Cloud Functions deployment.
2. **Verify an independent, encrypted export of the current database and Storage** before any rule, authentication or data migration; record its location, ownership and retention. Test restoring a sample in an isolated project. Never copy live student data into this public repository, CI logs, or public artifacts.
3. **Remove legacy plaintext student PINs from every publicly readable location** only after the owner-side `migratePasscodes` backend operation is deployed, validated, and run successfully; confirm that sign-in and PIN reset continue to work. Existing server login code can move individual PINs to `b3Private/passcodes`, but that does not automatically close every public data path.
4. **Migrate students to trusted Firebase authentication or server-validated, short-lived sessions** for all tools (Posuk Practice, Chazara, Shorashim, Rashi, Gallery, Game Show, Quiz, etc.). A browser-stored student ID, PIN, teacher flag, or frontend access gate is not server-side authorization. Require student identity, active class membership, class grant and record ownership on every protected data read/write.
5. **Replace open Realtime Database and Storage permissions incrementally** with least-privilege rules, testing each legacy tool's reads/writes in the Firebase emulator before deployment. A `.read` or `.write` on a parent path overrides narrower child restrictions in Firebase Realtime Database rules. Do not deploy blanket deny rules until all required operations have a verified authenticated path.
6. **Ensure teacher and admin separation server-side**: teachers manage only assigned classes; only owner/admin can grant cross-class or administrator powers. Do not permit a teacher account to write an entire workspace or its role assignments. Check direct API calls, not just the visible teacher portal.
7. **Audit exposed APIs and secrets**. Browser Firebase config values are normally public identifiers, not service-account secrets. Keep actual service credentials in server-side Secret Manager, verify CORS *and* authentication, rate-limit sensitive endpoints, and check logs for unusual access.

## Priority 1: publication and recovery

1. **Protect `main` in GitHub Settings:** require pull requests and passing reliable tests before merging. The branch was unprotected during this audit. The existing full test suites were failing, so first distinguish pre-existing failures from new failures and establish reliable required checks.
2. **Fast publishing:** run syntax, authentication/access regression, changed-tool smoke, and rules security checks before release. Run broader end-to-end tests separately (e.g. nightly). Keep failed tests visible; never relabel them as passes or silently waive critical permission checks.
3. **Keep a known-good release point** after verification. Git commits preserve code history, not live Firebase data. Maintain independent source and database backups, document a recovery operator procedure, and rehearse rollback/restore on a test instance.

## Before a live database rule change

- A verified backup exists and the restore drill works.
- The new rules pass emulator tests with owner, assigned teacher, unrelated teacher, student, blocked student and unauthenticated clients.
- B3 ET and WT and one generic new-teacher class are exercised; read, write, recording, quiz, rewards and reviews still save as intended.
- The deployed backend endpoints are confirmed available; security assertions use actual authenticated tokens.
- Owner retains an audited emergency recovery route.
- Rollout has a rollback procedure, and the current `firebase-rules.json` is compared with the *deployed* rules before applying any changes.

## Immediate scope of this first pull request

Only a static guard, focused tests, and this plan. **It does not change or deploy the live database, Firebase rules, Storage, Cloud Functions, or website.** Its current value is preventing obvious new unrestricted grants and making the existing problems explicit; the substantive security migration remains necessary.
