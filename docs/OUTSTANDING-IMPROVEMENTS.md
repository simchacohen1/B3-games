# Outstanding improvements — October 14, 2026

This branch is based on draft PR #49 at `1226630`. PR #49 remains intact and unmerged. The new PR must be reviewed after #49; neither GitHub Pages nor Firebase was deployed. No live student data was read through a teacher/student account, migrated, deleted or overwritten. No paid AI/transcription requests were made in testing.

## Request coverage

| Area | Implemented in this branch | Test / remaining limitation |
| --- | --- | --- |
| Shorashim compact layout | Smaller header, path, gaps and tools at normal browser zoom; responsive card; one visible top Save button | Real browser layout at 1280×800 and 540×740. No browser zoom or saved design coordinates changed. |
| First-card text and transitions | Text rescales immediately after final card fitting and font/layout changes; first card starts at full size; later cards randomly bounce, slide left/right, pop or spring up; reduced-motion preference respected | Browser checks readable first text before mouse movement, both faces, one Save control and viewport width. Picture selection, drawing and original save handler remain. |
| Missing pictures | Existing meaning-aware picker and selected/suggestion pools retained; original local art preserved | Existing source guards and catalog-preservation tests. Actual saved teacher/student pictures require account access to verify. |
| Shorashim recording and points | #49 duration/reconnect repairs retained; selected-class recording list checked on server; assigned teachers can reconnect/approve their own class, active owner/admin retained; new recordings carry their class ID | Real handler tests: ET/WT denial, revocation, exactly-once repair/approval, preserved pictures/recordings/progress. Real microphone and production approval NOT VERIFIED. |
| Teacher sign-in and roster | Reuse current Google user/token; ordinary teachers must choose an assigned class; scoped student reads and recording listing; revoked access closes dashboard; shared duplicate merges require admin and use a transaction over current student data | Backend and source/browser tests. Real Google authorization/session reuse NOT VERIFIED. |
| PeerJS warnings | Separate signaling interruption from an existing drawing/video channel; bounded automatic retry; clear only stale peer warnings after recovery; do not republish/rejoin a working class on every reconnect | Executed PeerJS event fixture. The intermittent production warning itself has not been reproduced with real accounts. |
| Pointer controls | Students/Share menus clamp to their actual containing block and viewport; drag coordinates corrected; Stop Sharing moved out of hidden menu and remains visible with collapsed fullscreen toolbar | Real browser menu/drag/fullscreen checks at 780×640. |
| Pointer cursor | Default native arrow locally, small arrow remotely; special shapes hide native cursor only during an active lesson; Roar/lion added alongside Sparkle/Paw/Heart | Browser checks normal, Sparkle, Heart, Paw, Roar and Pen cursor modes. |
| Activity sharing / PR #47 | Companion owns capture; activity page launches/focuses it, student/class context checked when reusing a window; tab/window/screen chooser remains user-initiated; all 16 existing activity entry points refreshed | Mock-capture companion checks plus native sample-video test prepared. Production screen video/native permission chooser NOT VERIFIED. Keep the companion window open. |
| Ongoing sharing permissions | Student listens for class/member/grant changes; teacher rechecks server authorization every 15 seconds and closes a revoked/uncheckable stream; no live-video label until frames arrive | Actual authorization-handler fixtures cover ET/WT, reassignment, disabled grants and membership/lesson revocation. Established production-stream revocation NOT VERIFIED. |
| Missing sharing endpoint | Correct `classPointerShareAuth` source/export and targeted deployment path prepared | Production endpoint previously returned HTTP 404. It remains unrepaired on live until approved Firebase deployment. |
| Movable preview / overlap | Brown Viewing as banner has a bounded drag handle; default banner/gallery/sharing controls occupy separate vertical positions; Home remains available | Browser drag, Exit button, and Home/Gallery non-overlap checks. |
| Posuk / PR #48 | Retain original generation/cache/voice recorder; exactly three voice questions + two reviewed uploaded Hebrew-word tap questions per pasuk; full arrangement required across ranges | Executed bank loader and browser voice/tap control tests; no paid requests. Some verses may not yield three reliable generated questions; UI blocks completion and invites retry rather than inventing questions. |
| Teacher question upload | Three-column CSV from #48; exactly two rows, size/length limits; verify answer phrases against selected pasuk; show review before explicit approval/save; transaction detects concurrent teacher edits | CSV/phrase fixtures and new Firebase emulator test. Upload approval does not alter previous student attempts. Live upload/save NOT VERIFIED. |
| Posuk progress / review | Preserve existing reading, translation, bonus, Chazara and attempt storage; restore by question/pasuk/mode/bank version instead of blindly crediting an old index; honor teacher's final verdict; escape displayed question/transcript/feedback | Node/UI tests; production voice grading and restored progress NOT VERIFIED. API secrets/configuration unchanged. |
| Book-specific comprehension references | Send selected Sefer to generation/grading and avoid Bereishis-only reference fallbacks for other books | Executed reference-selection fixture. Requires separate targeted function deployment; no secret changes. |
| Sefer Hebrew titles | All 613 Hebrew descriptions bundled from Rambam/Sefaria; N265/card 476 = לא תחמד; N266/card 477 = לא תתאוה; downloaded descriptions wrap above picture | Mapping/source checks and coloring/export preview. No images or saved paintings moved. |
| Sefer navigation / coloring / saves | Existing previous-day and future-day restrictions, color-first enclosed fill, local/account save logic retained | Existing fill/calendar/gate tests and PNG browser export. Real signed-in Firebase persistence NOT VERIFIED. |
| Scrapbook | Existing Firebase identity/save/restore/read-only teacher behavior retained | Seven isolated browser tests. Refresh/second-device production persistence NOT VERIFIED without safe accounts. |
| Yiddish | All 32 vocabulary entries already have nekudos; Back/Again/Next resume continuous story instead of stopping at each selected sentence; individual word pronunciation remains a short clip | All-word check and executed sentence-playback path; live authenticated story playback NOT VERIFIED. |
| Rashi Letters | Embedded videos remain removed | Existing public live and isolated browser check. |
| Game Show | #49 single generator, corrected Sarah-denial question, simple source-grounded questions and randomized correct positions retained; existing library copies only question-set data between accessible classes | Existing question/shuffle/library tests. Real ET↔WT library copy NOT VERIFIED. No private student progress is included in the import payload. |

## Validation

- Full Node suite: 407 passing tests after the first review corrections (no failing or skipped tests).
- Four new Chromium layout/control tests passed locally; the original four Chromium tests also passed during this batch.
- Seven repair-preview checks and seven isolated Scrapbook checks passed locally with sample data and simulated cloud access.
- CI now covers Chromium, Google Chrome, Microsoft Edge, Firefox and WebKit. Final run results belong in the PR description.
- Native sample-video test uses actual RTCPeerConnections and canvas video between test windows. Firebase, screen permission and pupil identity are simulated; even a pass does not prove production video delivery. Locally, WebRTC emitted no ICE candidates, preventing connection. The first CI run received real sample frames and preserved navigation, but its final hidden-tray assertion failed because the connection stub replaced an existing close listener instead of supporting multiple listeners as PeerJS does. The stub now supports all listeners, and the production stylesheet is included. The repeat native-video run is required before reporting a pass.
- The new rule-emulator suite passed real authorization/shape checks locally after correcting unsupported rules syntax and the test tools’ localhost proxy handling. The local CLI-only proxy workaround is outside tracked application code; external requests retain the configured proxy. CI installs the unmodified locked tools and must also pass.

No existing failing assertion was disabled. Obsolete fixture entry points were updated for the companion window/current class constants. Logs are outside the repository or ignored. Private authentication exports remain ignored.

## Safe test commands

```bash
npm ci
npm test
npx playwright install --with-deps chromium firefox webkit chrome msedge
npm run test:browser
npm run test:halacha
npm run test:preview
npm run test:sharing
npm --prefix tests/rules ci
tests/rules/node_modules/.bin/firebase emulators:exec --config firebase.preview-tests.json --project demo-ftt-tests --only database 'node tests/rules/approved-banks.test.cjs'
```

Test-tool dependencies have a separate locked manifest under `tests/rules/`; production dependencies and the root lockfile are unchanged. The emulator uses only the demo project and ports 19000/14400. Do not change that command to the production project.

## Required acceptance before live rollout

Use a private, approved staging environment or specifically authorized test accounts. Do not test by writing to actual pupil records.

1. ET teacher/student and WT teacher/student: record a non-sensitive sample, confirm duration and playback, reconnect a missing request twice and approve twice. Confirm one award, other class denial, removed membership denial and no redundant Google popup.
2. In Chrome and Edge, share an actual activity tab/window/screen; verify visible moving video on teacher's screen. Navigate activities without closing the companion; confirm continuity. Stop, remove permission, revoke teacher assignment and end the lesson; verify streams stop. Check the pink warning during a real signaling interruption.
3. Posuk: upload/review two tap questions for two different pesukim/books, verify isolation and concurrent-edit protection; verify three actual voice answers plus two no-speech answers, a range, teacher review, reload/history and Chazara. Existing production transcription configuration is unchanged; account access is required before paid acceptance testing is appropriate.
4. Save non-sensitive Sefer/Scrapbook work, refresh and restore on a second test device. Check N265 vs N266 labels and downloads; future-date restriction and enclosed fills.
5. Test the full Yiddish story and all vocabulary steps; copy an allowed Game Show library ET↔WT and confirm no student records are copied.

## Deployment requires separate explicit approval

Merging #49 publishes its frontend via Pages from `main`. Merging the follow-on PR then publishes these new frontend changes. Neither merge is authorized.

After review and approval, deploy only these functions from the reviewed checkout:

```bash
firebase deploy --only functions:classPointerShareAuth,functions:studentRewardsAutoAward,functions:generateComprehensionQuestions,functions:gradeQuestionAnswer --project b3-games
```

`studentRewardsAutoAward` now includes scoped Shorashim list/repair/approval access; the two Posuk functions change only book-reference selection, preserving their existing secrets and API setup. Confirm the reviewed function versions before accepting the new frontend.

The new `posukPractice/approvedQuestionBanks` rules require another separately approved deployment:

```bash
firebase deploy --only database --project b3-games
```

Review the complete rules diff before that command. Only the new question-bank subtree is changed; existing pupil data rules are not rewritten. This batch does not migrate legacy public data paths to a new authentication model.

PR #47/#48 remain open while their necessary work is incorporated in the follow-on draft. Neither was blindly merged or closed. #45/#46 remain represented in #49. All real-account acceptance items above are NOT VERIFIED until evidence is recorded.
