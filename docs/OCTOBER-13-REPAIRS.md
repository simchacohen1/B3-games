# October 13 repair batch

This branch continues the audit at main revision `cc5589c`; it does not replace the newer Shorashim picture picker or unfinished PRs #47/#48. No student records, pictures, rewards, recordings, approvals or progress were migrated or deleted.

## Repairs

- Restore Shorashim duration display, including the saved `durationMs` fallback for WebM files without a finite metadata duration. Restore the points-request reconnect control. Reuse the existing owner session and hide redundant sign-in controls. Validate action identifiers before putting them in inline handlers.
- Keep the current movable/resizable Classroom Pointer panels, fullscreen controls and Student Screens layout. Remove tab-preferred capture hints from both capture paths. Bind a capture to the selected lesson while connection setup is pending.
- Reject sharing sessions with invalid timestamps and explicit disabled ET/WT tool grants. A teacher must still be active and assigned to the class when a ticket is accepted; active administrators and the verified owner retain their own lesson access.
- Load Game Show's generator once and correct the Bereishis 18:15 question about Sarah denying laughter.
- Refresh modified asset versions on the 16 existing sharing pages so cached scripts do not hide the fixes.

PR #45's duration repair, source guard and workflow have been incorporated without reverting the uploaded picture-pool code. PR #46's capture-selection change has been incorporated and extended to the independent activity-sharing widget. Neither PR was merged or closed by this work.

## Tests

Use Node 22 and the committed lockfile:

```bash
npm ci
npm test
npx playwright install --with-deps
npm run test:browser
npm run test:halacha
npm run test:preview
```

For an existing system Chromium instead of downloaded Chromium:

```bash
FTT_TEST_CHROMIUM=/usr/bin/chromium npm run test:browser -- --project=chromium
HALACHA_TEST_CHROMIUM=/usr/bin/chromium npm run test:halacha
FTT_TEST_CHROMIUM=/usr/bin/chromium npm run test:preview
```

The former 55 Node failures were investigated. Browser tests now use the Playwright runner in `live-tests/`; their assertions remain available through `npm run test:live`. The isolated tests now model the actual dashboard entry, shared tool permissions, server-verified passcodes, browser initialization, teacher-access checking and authenticated calendar browsing. Question wording/source fixtures reflect the active generator. No assertions were silently skipped or disabled.

The unrelated Classtime test expected its write script to be attached. The current page explicitly says saving is paused for safety, and the Nigri service also blocks that write path. The test now requires the save panel/button to stay hidden/disabled and the save script to stay disconnected. This batch does not activate Nigri saving.

Reward repair tests run the real backend handler against an in-memory database. They verify one pending request, no points merely for reconnecting, exactly-once approval, the existing three-point no-hints award, rejection of insufficient evidence, and preservation of recording/catalog/progress fields. Existing owner-only reward-approval policy is unchanged.

The local preview uses real Chromium DOM, canvas and generated non-sensitive audio; cloud access and screen capture are simulated. It checks Shorashim duration/reconnect/approval/session reuse, permissions-panel movement/resize, fullscreen entry/exit, combined screens, Sefer picture navigation/export, Yiddish vocabulary, Rashi video removal, one Game Show generator and capture cleanup. Its screenshots and results are generated under ignored `test-results/oct13-preview/`.

## Live observations and remaining acceptance work

Public live browser checks passed for guest entry, Sefer previous-picture navigation and downloading a picture titled **לא תחמד**, the first four Yiddish vocabulary cards with nekudos, and Rashi's removal of video embeds. These checks used no teacher/student account and made no paid AI calls.

Production still serves the Shorashim script without the restored duration/reconnect functions. A POST with an empty body to `https://us-central1-b3-games.cloudfunctions.net/classPointerShareAuth` returned **404**, not the function's expected invalid-session response. The authorization function must be deployed or its deployment URL verified; do not assume publishing HTML deploys Firebase functions.

Authenticated staging acceptance is **NOT VERIFIED**: no dedicated teacher or ET/WT student browser sessions were supplied. Before production approval, use non-sensitive test accounts to check:

1. Record a short Shorashim sample, confirm duration and playback, reconnect a missing points request twice, approve twice, and confirm exactly one award. Navigate with an already signed-in owner and confirm no redundant Google popup. Preserve the current ordinary-teacher approval restrictions unless a separate policy change is approved.
2. Have ET and WT teachers/students join their own lessons. Verify wrong-class and wrong-teacher attempts, removed memberships, disabled grants and teacher reassignment. Test real Chrome/Edge tab, window and screen choices, and confirm the teacher actually receives video. Revoking an already established peer stream also needs a live acceptance check.
3. Save sample scrapbook work, reload and retrieve it in a second authorized session. Confirm teacher inspection remains read only.
4. Generate a small Game Show set only when necessary, review accuracy, save and play it, and verify correct choices move while grading stays correct.
5. Check Sefer titles and account saves with a test student. Guest PNG download does not prove Firebase account persistence.

See `live-tests/README.md` for secure session-state handling. Do not commit authentication state or credentials. No local transcription/OpenAI key is required for this repair batch. The deployed Posuk API configuration is untouched.

## Deployment — requires explicit approval

The repository's Pages configuration publishes **main**. Merging the repair PR will automatically publish the frontend; merge approval therefore also needs to cover that automatic publication.

One modified Firebase function requires a separate targeted deployment:

```bash
# From the repository root; after reviewing and approving the target checkout.
npm --prefix backend/functions ci
firebase deploy --only functions:classPointerShareAuth --project b3-games
```

The existing `deploy-class-pointer.ps1` does syntax/regression checks and deploys only that function. It must be run only after approval. Confirm the deployed function uses the reviewed commit and returns the expected rejection for an invalid session, then run the authenticated sharing matrix.

No security-rule changes are included. No new changes to `studentRewardsAutoAward` are included, but the restored reconnect UI relies on that function's existing `repair-shorashim-recording` action from PR #44. Confirm its deployed version with an authorized test session. If the live version lacks that action, a separate targeted deployment of `functions:studentRewardsAutoAward` needs explicit approval and its own acceptance test.

PR #47 (persistent sharing) and PR #48 (Posuk question banks) remain separate unfinished work. This branch does not implement them or the next layout/animation/appearance changes.
