# Class Gallery emulator lab

Test-only infrastructure for issue #206. No production application or rules files are edited. Uses the same Auth/Database emulator approach as `scripts/pointer-lab`, extended with Storage and the real Gallery handlers.

## Run

Requires Node 22+, Java 17+, and the emulator binaries cached by Firebase CLI.

```sh
cd scripts/gallery-lab
npm ci
npx playwright install chromium-headless-shell
node prepare.cjs
cd ../..
node scripts/gallery-lab/start.cjs --verify
```

`node scripts/gallery-lab/start.cjs` leaves the local lab running; open `http://127.0.0.1:8887/_lab/login`. ET and WT student and teacher sign-in links are emulator-only. Do not use these accounts on the live site.

The CLI runs with a socket guard from process startup. Its optional public metadata request is blocked. If emulator binaries are not cached, download them as a separate dependency setup step before starting the guarded lab. The lab never logs into Firebase CLI or loads application-default production credentials.

## Isolation

- Project `demo-gallery-lab`, fresh ephemeral Auth/Database/Storage.
- All emulator and site listeners bind to loopback only.
- Backend socket guard rejects nonlocal connections; browser CSP plus HTTP/WebSocket interception reject nonlocal requests.
- Firebase SDKs and Three.js are served from installed packages. No browser CDN requests are required.
- Static serving rewrites only service addresses and Firebase project configuration; the Gallery source and backend handlers remain unchanged.
- The production handlers' explicitly named bucket is mapped to the synthetic Storage emulator bucket by a lab-only service adapter. Download links returned by the reader are translated to emulator addresses. Private media signing uses expiring local tickets after the unchanged authorization handler grants access; it does not use cloud signing credentials. `start.cjs --smoke` checks that adapter and denies cross-class access.
- The Add to Gallery button runs the actual `gallery-share.js` and `html2canvas` on a neutral synthetic artwork surface; no unrelated learning activity is exercised.
- Database and Storage use the repository's existing hardened rule files without edits. These tests do not establish which rules are deployed live.

## Evidence and limits

`.run/results.json`, logs, and PNGs contain only synthetic data. They are ignored by git. Tests verify both submission methods, teacher queues/approval, rendered personal-room and hallway meshes, image loads, reload/reopen, and student/teacher ET/WT authorization. Opening a personal room uses the Gallery's normal room-entry function; submission and approval use DOM controls.

The test browser is disposable and distinct from the user's browser. Reopening reauthenticates the same synthetic student in a fresh browser context and checks persistence in the emulator database. Live deployment correctness, historic real artwork, and real saved-session restoration remain outside this lab's claims. Keep issue #206 open until separate live verification succeeds.

Stopping the emulator discards all test records. No production cleanup is necessary.

The runner refuses occupied lab ports and aborts if its emulator or server exits unexpectedly. Keep runs serial; `GALLERY_LAB_RUN` can select a different evidence/log directory. The automated browser emulates a low-memory device and uses a saved avatar choice to avoid the first-visit chooser interrupting submission clicks.

## Known defect found by this lab

The initial mesh/overview checks passed, but console review found tainted 3D card canvases for Storage screenshot images. `verify.cjs` now asserts canvas origin cleanliness and is expected to fail the personal/hallway/persistence checks until the application is repaired separately. `node scripts/gallery-lab/start.cjs --render-probe` isolates this defect using a real screenshot submission and an inline-image control in each class; it records findings in `render-probe.json`. Its separate anonymous-CORS control changes only a diagnostic canvas, never the Gallery code. See `VERIFICATION.md` for the corrected final results.
