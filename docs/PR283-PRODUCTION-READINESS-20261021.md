# PR #283 production readiness and release runbook

Reviewed application commit: `8537bb220f817a1d53120e9d2dd4fda7544ecdd3`.
Read-only production inspection: October 21, 2026, approximately 10:00–10:08 PM Eastern.

## Verdict

**HOLD: do not publish the frontend against the current production backend/rules.** The required Quiz endpoint is absent, teacher claim is older than the tested source, and deployed RTDB rules are substantially more permissive than the hardened candidate. Necessary application fixes already exist in the reviewed tree; this continuation changes evidence/documentation only.

No PR merge, deployment, production rules edit, account creation, real student record read, or production database mutation was performed. Console inspection used Rules, Functions, Cloud Run service metadata, YAML, and source views only. No Data tab, Auth user list, or request logs were opened. Endpoint requests were eight unauthenticated OPTIONS preflights, which do not enter the application data handlers. No production credentials or tokens are included in the evidence.

## Production findings

Both complete inventories contain 26 functions/services and omit `weeklyQuizStudent`. Its exact client URL returns 404 for both apex and www preflights. Publishing the updated client now would break student Quiz loading/submission: its authenticated API is mandatory and has no direct-database fallback. The function is exported correctly from the candidate `backend/functions/index.js`; no new implementation is needed.

| Function | Production revision | Runtime | Revision max / timeout | Result |
|---|---|---|---|---|
| funTorahStudentAuth | funtorahstudentauth-00008-zic | Node 22 | 10 / 60s | Handler and core match candidate after line-ending/outer-whitespace normalization; apex/www preflights pass. |
| funTorahTeacherClaim | funtorahteacherclaim-00006-moc | Node 20 | 5 / 60s | Needs candidate release: missing www CORS and zero-class invitation refusal. Apex preflight passes; www gets 204 without Allow-Origin and is blocked by browsers. |
| studentRewardsLogin | studentrewardslogin-00011-peg | Node 22 | 20 / 60s | Rewards handler module and student-login core match candidate after normalization; apex/www preflights pass. |
| weeklyQuizStudent | absent | — | — | Must be deployed before the updated Quiz client. Candidate uses us-central1, maxInstances 10, three allowed website origins and server-side grading. |

All three existing services show public invocation, ingress All, concurrency 80 and 100% traffic to the recorded revision. Public invocation permits the browser to reach the handler; authorization remains inside the handler. Full IAM policy bindings, all transitive dependencies, live custom-token signing, Google OAuth authorized domains, and positive production sign-in were not exhaustively tested. No source commit can be inferred solely from a Firebase deployment hash. Exact hashes and deployment timestamps are recorded separately.

The deployed teacher function uses Node 20; candidate package.json selects Node 22. Its targeted release therefore also upgrades that runtime. Do not redeploy every function to perform this update. Student Auth and Rewards need no redeployment based on the inspected matching handler/core files; leave their existing scaling configuration intact.

The production Rules editor contained no pending-publish controls. Its entire contents were selected/copied without edits. Compared with `firebase-rules.hardened.json`, 228 flattened leaves differ or are missing. Examples: `/b3Games/.read: true`, `/b3Quiz/.read: true` and `.write: true`, public Posuk Practice student writes, and public Gallery writes. Parent grants cannot be repaired by adding a restrictive child rule. This is a server-side security mismatch, independent of frontend sign-in.

The snapshot is forensic evidence, **not an approved rollback ruleset**. Applying the hardened rules changes access across multiple tools and must be treated as a coordinated release, with synthetic regression checks and a maintenance window. No migration of actual profiles/passcodes is authorized by this report.

## Isolated verification

- Re-ran the exact 22-file regression command in `PR283-DEPLOYMENT-REVIEW-20261021.md`: **159 passed, zero failed/skipped**.
- Replayed a synthetic verified-Google identity with an active invitation and zero assigned classes through the copied production teacher core and the candidate core, in memory only. Production source authorized it and attempted one store update; candidate refused it with zero writes. This demonstrates the actual deployed-code difference without using a real invitation/account.
- Compared six source files copied from each function's own Cloud Run Source view; four normalized matches and the two teacher differences are recorded with SHA-256 hashes.
- Production preflights independently confirm missing Quiz and teacher www CORS failure; no login body or bearer token was sent.
- Prior 18/18 local database security tests and 15/15 browser scenarios remain the evidence for the unchanged application/rules at this commit. They were not re-run in this continuation; this runtime lacks the earlier cached emulator setup. See the existing staging report for boundaries and reproduction. This continuation makes no new claim of emulator/browser execution.
- `git diff --check` passes. No application or rules file changed.

## Required approval and release sequence

Explicit owner approval is required for: (a) targeted production deployment of `funTorahTeacherClaim` and `weeklyQuizStudent` from the reviewed source, including Node 22 for teacher claim; (b) merge/publish PR #283 frontend; (c) replace production RTDB rules with the reviewed hardened file; (d) narrowly scoped synthetic production smoke fixtures/checks and cleanup, if used. Keep real student records excluded. Approval must cover a scheduled maintenance window and the rollback scope below. Do not execute commands in this document before that approval.

1. **Freeze and capture.** Reconfirm PR head and latest main; refresh these metadata-only snapshots immediately before release. If application changes or merge conflicts exist, resolve on development and repeat affected tests. Record the currently live Pages deployment SHA/artifact (not simply latest main). Export current function source archives, immutable image digests, configuration and IAM metadata for rollback; the recorded revision names are references, not a substitute for preserving artifacts. Preserve current rules securely as evidence. Do not export database contents.
2. **Isolated release rehearsal.** Use a separate staging Firebase project with synthetic fixtures only, the reviewed functions and hardened rules. Re-run the documented security/browser matrix, including teacher www CORS, actual token exchange, wrong-class refusal, answer-key withholding, server scoring and duplicate prevention. Positive signing/OAuth behavior must pass before the frontend is released. Do not use a synthetic student's name as a reason to download production rosters.
3. **Backend first.** From a clean checkout of the reviewed release, install the locked backend dependencies and deploy only the two required functions. Use an explicit project/config and selector:

   ```sh
   npx -y firebase-tools@latest deploy --project b3-games --config firebase.security-deploy.json --only functions:funTorahTeacherClaim,functions:weeklyQuizStudent
   ```

   This selector must not include database, storage, or all functions. If deployment proposes unrelated deletions, broad IAM changes, missing secrets, or unrelated services, stop. Preserve existing invocation semantics; authorize only the intended public browser endpoints, with authentication enforced in code. Check serving revisions, runtime, traffic, and preflight from apex/www/GitHub origin. Missing/invalid Quiz tokens must return 401 before any database read. Do not proceed if backend verification fails.
4. **Publish frontend.** Merge PR #283 only after required checks pass and backend availability is confirmed. Wait for the specific GitHub Pages deployment to succeed, then verify the live published files match that deployment. Do not cancel unrelated workflows or assume a merge equals publication. Exercise synthetic sign-in, refresh, teacher preview and Quiz; stop on any authentication error or preview write.
5. **Activate hardened rules in the approved window.** Rehearse every affected tool first. From the exact reviewed tree, deploy database rules only:

   ```sh
   npx -y firebase-tools@latest deploy --project b3-games --config firebase.security-deploy.json --only database
   ```

   Confirm the target instance is `b3-games-default-rtdb` before execution. Never use the legacy `firebase-rules.json`. Re-copy/compare deployed rules after success, and verify anonymous/peer writes and raw Quiz answer-key reads are denied using isolated fixtures/approved probes only. Do not probe actual students. Existing cached clients may need reloads; keep a controlled maintenance period rather than reopening public permissions to accommodate old clients.
6. **Finish.** Run the approved synthetic smoke matrix after the rules change, verify no preview writes or cross-class access, and retain the release SHA, hashes and serving revision IDs. Do not declare production ready from OPTIONS success alone. Report any remaining limitation explicitly.

## Rollback

- Stop rollout immediately on failed backend, CORS, sign-in, authorization or Quiz checks. Never continue into the next stage with a failed prerequisite.
- If only the new frontend fails, republish the captured last-known-good Pages artifact/SHA using the normal Pages deployment path. Keep compatible new backend and hardened rules in place. An old client that requires public Quiz reads is not a safe fallback under hardened rules; keep that tool unavailable while fixing forward.
- If a function release fails before rules/frontend changes, restore its preserved previous source/configuration through the Cloud Functions deployment path. Existing references: teacher `funtorahteacherclaim-00006-moc`, student auth `funtorahstudentauth-00008-zic`, rewards `studentrewardslogin-00011-peg`. Verify actual traffic/configuration after restoration. Restoring the old teacher revision reintroduces the documented invitation/CORS defects; prefer a corrective release. No previous Quiz revision exists: leave it unused and stop frontend rollout rather than deleting it automatically.
- After hardening, do **not** restore the captured permissive production rules as routine rollback. Keep the affected tool unavailable and fix forward, or apply a narrowly scoped, emulator-tested restrictive correction with explicit owner approval. Any proposal to restore public grants requires a separate decision that states the exposure; it is excluded from ordinary rollback authorization.
- Never restore database backups or mass-edit user records as authentication rollback. Cleanup, if approved, is limited to specifically created synthetic fixtures. No rollback action has been performed.

## Evidence

- `PR283-PRODUCTION-RULES-20261021.json`: complete configuration-only rules snapshot.
- `PR283-PRODUCTION-RULES-COMPARISON-20261021.json`: hashes, public grants and drift count.
- `PR283-PRODUCTION-FUNCTIONS-20261021.json`: serving revisions, deployment hashes, runtime/scaling metadata.
- `PR283-PRODUCTION-SOURCE-COMPARISON-20261021.json`: normalized source hashes and synthetic teacher regression replay.
- `PR283-PRODUCTION-PREFLIGHT-20261021.json`: eight read-only preflight results.

This report supersedes the earlier statement that production configuration could not be inspected. It does not supersede the requirement for explicit production approval.
