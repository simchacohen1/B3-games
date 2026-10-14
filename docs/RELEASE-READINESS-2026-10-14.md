# Release readiness — October 14, 2026

Review scope: #49 at `1226630c85b5ab8fa90304f2d6df837d70c62652`, #50 at `44c0ad2f50564b92946e33a2fc5ce8792932d844`, Issue #51 and the standing guide in #53. No AGENTS.md was found in the checkout, PR tree, or checked ancestor directories. The original checkout is on `main` at `1329577` with substantial uncommitted staging/Posuk/navigation work; it and the previous Game Show candidate worktree were preserved. PR #50 targets #49's branch, not main.

## Incremental recommendation

| Status | Slice | Dependencies and verification |
| --- | --- | --- |
| Ready for review | #49 Game Show Sarah-denial wording and duplicate generator removal | Pure static changes; existing earlier candidate remains in worktree `66b9`. Do not duplicate or overwrite it. Check a simulated question and a single generator load on the current main baseline before an owner-approved Pages merge. |
| Needs short verification | #49 Teacher Tools ResizeObserver fix; #50 Yiddish continuous sentence playback and Home/Gallery spacing | Frontend-only hunks can be isolated without new Firebase services. Retain current main's navigation changes and cache versions. Check browser errors, sentence/word playback behavior, and small-screen positioning. Do not copy whole pages that also introduce sharing or auth changes. |
| Needs short verification | #50 compact Shorashim and Hebrew Sefer titles | Frontend assets, but the Shorashim index/teacher files mix layout with access/reward work, and Sefer includes new sharing/cache hooks. Extract only layout/title hunks. Verify saved card fields, image choices, font fitting and mobile use; check the 613-title mapping separately. Cloud saves are not established by browser mocks. |
| Must wait for authorized acceptance | #49 recording reconnect/approvals and #50 scoped recording lists | Existing RTDB/Storage data and `studentRewardsAutoAward`. #49 assumes the already-deployed repair action exists; #50 adds a new list action and class authorization. Verify backend version and synthetic owner/admin/ET/WT permission boundaries before publishing associated UI. |
| Must wait for authorized acceptance | #49 sharing hardening and #50 persistent sharing | `classPointerShareAuth`, Auth/RTDB permissions, PeerJS, browser capture consent. #50 adds ongoing `check` requests; an older endpoint cannot support them. Deploy approved backend first, then test revoked teacher/member/grant/lesson cases and actual capture/video with synthetic sessions, then approve frontend publication separately. |
| Must wait for authorized acceptance | #50 mixed Posuk questions | Approved-bank RTDB rules plus `generateComprehensionQuestions` and `gradeQuestionAnswer`; audio flows also need Storage and existing speech/AI services. Deploy approved backend/rules before the frontend. Preserve secret bindings; mock generation/grading until paid use is explicitly approved. |

Neither full PR is a frontend-only release. #49 can be reviewed independently of #50, but its complete authenticated/sharing behavior is not established by passing CI. Do not merge either whole PR merely to publish its static subset.

For the earliest release, finish the existing Game Show candidate against current main, preserve the outstanding work, and prepare one small draft. Allow approximately 30–60 minutes of hands-on review and synthetic smoke testing for that slice, subject to baseline conflicts; this is an estimate, not a release promise. Other visual slices can follow separately. Full service acceptance has no reliable ETA until staging permissions/resources are explicitly authorized.

Every main merge automatically publishes Pages and requires separate explicit owner approval. If proceeding with backend-dependent work, obtain authorization for synthetic authenticated staging and precisely named resources/deployments first; staging Storage/Functions availability reported in STAGING-SETUP.md was not re-queried in this run. No current cloud price or free-tier guarantee was assessed. Local tests here made no paid AI/cloud calls. Keep paid handlers disabled unless separately approved.

Rollback: retain the release commit and previous frontend revision; propose an owner-approved revert of the isolated frontend commit if smoke checks fail. Backend/rules rollback requires its own authorization and saved prior versions. Do not reset another branch or assume a frontend revert reverses Functions/rules changes. After eventual #49 approval/merge, retarget/rebase #50 in a separate authorized step and rerun checks against current main.

## Evidence and bounded fix

- #49's four head workflows are successful. Browser run [38502239982](https://github.com/simchacohen1/B3-games/actions/runs/38502239982) has successful browser, Scrapbook and preview steps.
- #50's four PR-triggered head workflows are successful, including approved-bank rules. Its separate browser run [38512285647](https://github.com/simchacohen1/B3-games/actions/runs/38512285647) checked out the exact `44c0ad2` head: logs confirm 407 Node tests, 40 browser tests, and three native sample-video passes. These are historical CI results, not new staging acceptance.
- A clean local #50 branch reproduced 407/407 Node passes. The first Windows repair preview had 2 passes and 5 failures: the fixture path guard compared a Windows path with `root + '/'`, so valid local scripts/pages returned 404. This was a harness defect, not evidence of five product regressions.
- Replaced that guard with a platform-aware relative-path check; parent/sibling/root/different-drive escapes remain rejected. Added three regression tests exercising Windows and POSIX semantics. No product files, Firebase rules, credentials or application permissions changed.

Exact final local checks on the new branch:

| Command | Result |
| --- | --- |
| `npm ci --ignore-scripts --no-audit --no-fund` | Installed locked dependencies |
| `node --test tests/local-fixture-path.test.cjs` | 3 passed |
| `npm test` | 410 passed, 0 failed/skipped |
| `npm run test:preview` | 7 LOCAL PASS, 0 failures |
| `node node_modules/playwright/cli.js test --project=chromium --workers=2 --reporter=line` | 8 passed |
| `node --test tests/halacha-studio.browser.cjs` | 7 passed |
| `node --check tests/oct13-preview.browser.cjs` | Passed |
| `node --check tests/helpers/local-fixture-path.cjs` | Passed |
| `git diff --check` | Passed |

The equivalent npm browser launcher stalled before reporting tests and was interrupted; direct invocation of the locked Playwright CLI completed. No test assertions were weakened. Logs and screenshots remain local ignored artifacts; the initial Node log outside test-results was inspected and deliberately excluded from staging.

## Remaining gaps

Browser tests use synthetic data, intercepted requests and simulated authorization; preview audio is generated WAV. Scrapbook persistence is local/simulated, not an actual second-device Firebase save. Class-sharing backend tests use VM/database doubles. The approved-bank rules emulator result is from existing CI; this run did not rerun emulators. Native-video CI uses actual encoding/decoding with simulated capture/identity/Firebase/signaling; it does not verify browser/OS capture consent or production delivery. Real Google session reuse, microphone/transcription, authenticated ET/WT revocation, cross-device saves, and live library copying remain unverified. A full independent Claude review is still absent from the Issue #51 comments inspected; no Claude review was fabricated or requested by this automation.

Next owner focus: review the static Game Show release candidate and, independently, this test-only draft. Publication and any authenticated cloud/service slice remain approval-gated; no merge, deployment, paid-service activation or production/student-data access occurred.
