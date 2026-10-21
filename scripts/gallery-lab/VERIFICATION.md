# Historical pre-repair Gallery verification — issue #206

For current repair validation, see [REPAIR_VERIFICATION.md](REPAIR_VERIFICATION.md). This document preserves the original failing baseline.

Tested application baseline: `87d1ae55bafa4d623c733fe58cd5447a62342bd7`. Date: October 21, 2026.

**Evidence review found a 3D rendering defect after the initial structural assertions passed.** The personal-room, hallway, and persistence rows below are corrected to FAIL for screenshot artwork. The separate private-media adapter smoke passed.

| Check | ET | WT |
|---|---|---|
| 1. Pin Work submission | PASS | PASS |
| 2. Add to Gallery screenshot submission | PASS | PASS |
| 3. Correct teacher approval queue | PASS | PASS |
| 4. Teacher approval and queue clears | PASS | PASS |
| 5. Personal gallery displays approved work | FAIL — screenshot texture | FAIL — screenshot texture |
| 6. Hallway displays approved work | FAIL — screenshot texture | FAIL — screenshot texture |
| 7. Refresh and reopen persistence | FAIL — screenshot texture | FAIL — screenshot texture |
| 8. ET/WT artwork and teacher access separation | PASS | PASS |

## Evidence

[Initial structural results and exact synthetic post IDs](evidence/verification.json). These preliminary PASS labels are superseded by the focused render probe and corrected table above. Screenshots are saved beside that JSON. [Focused texture probe](evidence/render-probe.json) and [final consolidated results](evidence/final-results.json) are authoritative for the corrected visibility results.

- [ET teacher pending queue](evidence/et-teacher-queue.png) → [cleared after approval](evidence/et-teacher-approved.png).
- [WT teacher pending queue](evidence/wt-teacher-queue.png) → [cleared after approval](evidence/wt-teacher-approved.png).
- [ET personal room](evidence/et-personal-gallery.png), [approved post overview](evidence/et-hallway-posts.png), [reopened Gallery](evidence/et-reopened.png).
- [WT personal room](evidence/wt-personal-gallery.png), [approved post overview](evidence/wt-hallway-posts.png), [reopened Gallery](evidence/wt-reopened.png).

## Findings and limits

An actual Class Gallery defect was found: `createProjectCard` loads cross-origin screenshot images without `img.crossOrigin = "anonymous"`. Drawing them into the card canvas taints it, and WebGL rejects the texture. The posts and image objects persist and All Posts displays the images, but that does not prove the actual pictures appear on 3D walls. The initial assertions checked mesh presence and overview images and were too weak; the runner now checks canvas origin cleanliness too. Submissions saved, reached the assigned teacher, and were approved. Cross-class reads returned HTTP 403 for both synthetic students and both class-specific teachers. The four resulting posts stayed in their own classes.

Approval visibility follows the existing polling cycle (up to about 20 seconds); the final test waited for the teacher queue to clear. Personal-room checks invoke the existing room-entry function and verify rendered meshes; submission and approval use actual UI controls. The Add to Gallery test uses the unchanged shared script and screenshot library on a neutral test artwork page, without testing an unrelated learning tool. Refresh was followed by a fresh context and fresh synthetic sign-in for the reopen check; this proves artwork persistence, not remembered-login behavior after a browser restart.

The lab uses the repository’s unchanged hardened rules. These results do not establish the rules deployed to production, deployed backend parity, or preservation/visibility of historic real student artwork. **Keep issue #206 OPEN until separate live verification succeeds.** Proposed repair: set `img.crossOrigin = "anonymous"` before assigning `img.src` in `createProjectCard`, verify Storage CORS for both branded origins, and add image-load error handling plus a canvas/GPU regression check. No application repair was made in this assignment.

## Harness fixes only

- Correct emulator config location and vendor SDK paths; allow emulator polling in the local-only CSP.
- Guard CLI/backend sockets, browser HTTP/WebSocket requests, and page connections against nonlocal access. The deliberate production-address probe was blocked by CSP; recorded browser network requests were all loopback. CLI metadata attempts were blocked by the server socket guard.
- Save a synthetic avatar preference and wait for app readiness after navigation, instead of racing first-visit UI or uninitialized scripts.
- Close browser contexts between classes; keep runs serial; refuse occupied ports and abort on service exit.
- Map the handlers’ named bucket to local Storage; private media uses expiring local tickets after the unchanged authorization checks. A 35-byte synthetic media download passed, while cross-class access returned 403.

All changes are test infrastructure/configuration/evidence. Production app files, Firebase rules, student records, points, artwork, and deployments were not changed. Emulators were stopped after testing; their synthetic records are disposable.

## Exact local reproduction

Run `node scripts/gallery-lab/start.cjs --render-probe`. The probe submits a synthetic screenshot through the actual `classGallerySubmit` handler, approves that fixture locally, and creates an approved inline-image control. Sign in as the synthetic student and open the personal room and hallway, then refresh and reopen. The remote image loads as an ordinary image, but its 3D card canvas throws `Tainted canvases may not be exported` and WebGL logs `Tainted canvases may not be loaded`. The inline-image control stays origin-clean. A separate `crossOrigin = "anonymous"` diagnostic image produces an origin-clean canvas. This reproduces why saved/approved screenshot work can look missing on 3D walls without records being deleted.
