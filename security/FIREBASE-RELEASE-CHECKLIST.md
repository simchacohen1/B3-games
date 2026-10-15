# Fun Torah Tools — Firebase release and recovery checklist

**Release status: HOLD for live student data.** Prepared on 2026-10-15. This document is a runbook, **not** evidence that Firebase backups, live-rule audits, or deployments have happened.

## Before owner authorizes any production change

- [ ] Obtain authorized access to the correct Firebase project and Realtime Database instance; independently verify the project ID and instance URL. Never paste service-account keys or real student passcodes into tickets, public GitHub, AI chat, CI logs, or screenshots.
- [ ] Record the exact deployed Realtime Database rules, Storage rules, and Cloud Functions revisions in a **private** change record. Do not assume GitHub files match production.
- [ ] Create a full independent **encrypted** Realtime Database export and a separate backup of relevant Firebase Storage objects, preserving the original access controls. Record timestamp, size, custodian, encryption, and retention in the private change record. Protect access to both.
- [ ] Verify backup integrity and perform a sample restore **into an isolated test project**. Confirm key collections and reference counts; never test restore over the production database.
- [ ] Create a rollback plan: known-good backend revisions, rule snapshots, recovery owner and abort criteria. A GitHub commit alone does not restore a Firebase database.

## Preview and migrate student credentials (after trusted backend deployment)

1. Deploy and verify the updated owner-only `funTorahManageStudents` backend. **Deploy backend before frontend**. Verify the new `previewPasscodeMigration` action exists and has a read-only implementation. Old backends reject this action; never use `migratePasscodes` to simulate a preview.
2. Confirm `previewPasscodeMigration` returns `dryRun: true` and `protocol: "passcodes-v2-preview-20261015"` with count-only results and **no writes**. Reject any response missing the exact marker. Do not print or export individual PINs.
3. Reject cleanup if `conflicts` or `unmatched` are nonempty. Reconcile affected records in a private administrator workflow first. Retest a fresh preview; ensure all intended students are accounted for.
4. Reconfirm the **tested, encrypted backup** and obtain explicit owner approval for destructive cleanup. Only then allow `migratePasscodes` with `deletePublic: true`, the exact migration protocol, and explicit backup confirmation.
5. The backend re-evaluates conflicts at execution time and uses one atomic multi-path update. Verify expected copy/clear counts afterward; do not rerun blindly if any result is ambiguous.
6. Test old and newly chosen student PIN sign-in on ET, WT, and an additional isolated class; test a teacher PIN reset, student reopening tools, Posuk Practice, Chazara, Shorashim, Rashi Letters, and save/restore of recordings and progress.

## Teacher/class privacy release gate

- [ ] Build Firebase Emulator regression tests for the **actual proposed rules** covering owner, assigned teacher, unrelated teacher, revoked teacher, own student, cross-class student, blocked student, and anonymous client. Check both reads and writes and direct API requests.
- [ ] Confirm public parent rules (especially `/b3Games/.read`) have been eliminated **after** browsers are migrated. Parent `.read` grants override narrower child denies.
- [ ] Confirm every supported tool has an authenticated data path and that old ET/WT functionality is preserved.
- [ ] Confirm no passcodes or private student records remain readable anonymously; verify this with a controlled request that discards response bodies.
- [ ] Confirm teacher invitations, class assignment/revocation, and claimed sessions are enforced by backend rules; frontend gates alone are insufficient.
- [ ] Deploy and smoke-test the teacher-claim Cloud Function from both GitHub Pages and the custom domain. CORS is not authorization.
- [ ] Stage rule changes with a signed-off rollback and compare deployed rules to reviewed source afterward.

## Abort and recovery

Stop immediately and preserve logs (without PII) if any student cannot sign in, can see another student's/class's data, can lose recordings/progress, or if an unassigned teacher retains access.

Rollback **functions and rules** to recorded known-good versions under owner authorization. A data restore is a separate, potentially destructive step: validate the source export and restore plan with the owner before touching production. Post-release, compare record counts, spot-check sign-in with consenting test identities, and monitor errors.

## Current state

Static permission-drift checks protect review of repository rules, but public grants are still present in the repository. The owner-added teacher frontend hardening is published. This passcode migration code is staged for testing; no claim is made that Firebase production functions/rules or student credentials were changed.
