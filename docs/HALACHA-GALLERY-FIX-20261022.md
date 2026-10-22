# Halacha → Class Gallery submission fix (October 22, 2026)

Branch: `fix/halacha-gallery-secure-submit`. Not merged and not deployed.

## What was wrong

The suspected cause, Firebase rules blocking the submission, was **not** the cause.

1. **Rules were not blocking it.** The production rules snapshot taken for PR #283 (`docs/PR283-PRODUCTION-RULES-20261021.json`, on the PR branch)
   sets `classGallery` to public `.read: true, .write: true`. The workspace `resources` path is also publicly writable.
   The direct write from `halacha/gallery.js` was therefore accepted.
2. **The real failure was on the Halacha page.** The new guided Halacha lessons (`sefer-style.css`, `siman-a-classroom.css`) hide the old
   scrapbook (`.work`) for students. `halacha/gallery.js` still:
   - put its "Post to Class Gallery" button inside the hidden scrapbook sidebar, so students had **no visible Halacha button**;
   - photographed the hidden 0×0 `.spread`, which produced the empty picture `data:,`. The submission still said "✓ Sent";
   - called `persist()` / `saveDrawing()` on hidden canvases before the capture. This **replaced the student's saved scrapbook drawings with blank images**.
   Reproduced on an unfixed checkout with the lab: `visibleButtons: 0`, posted `image: "data:,"` (6 characters), `savedDrawingsChanged: true`.
3. Students only saw the site-wide "📌 Add to Gallery" button, which sends a screenshot of the visible window rather than both pages.
   It is also partly covered by the "← Fun Torah Tools" pill.
4. Identity: the direct write trusted the browser-supplied `studentName`, `classId` and `status`. Under today's public production rules,
   anyone could write any post, including one marked `approved`.

## What changed

- `halacha/gallery.js` was rewritten. It no longer writes to the database and never saves or modifies student work.
  - A visible **🖼️ Send to Class Gallery** button is added to each lesson's toolbar: the Siman Alef classroom, the picture study for the other Simanim,
    and the legacy sidebar if it is ever shown again. Teacher preview and guest mode get no button.
  - It builds one picture containing the colored lesson picture and, when the student has scrapbook work, **both scrapbook pages**.
    The scrapbook pages include stickers and artwork, uploaded photos, text boxes and saved drawings. To capture them, the hidden scrapbook is shown off-screen only for the capture.
  - It sends the picture to the authenticated **`classGallerySubmit`** function with the session's name, individual passcode, student ID and class.
    The server verifies these and sets the student name and class, chooses the ET/WT gallery or the class gallery, stores the image in Storage, and writes `status: 'pending'`.
  - It shows clear messages for success, sign-in or passcode problems (401/403), sending too often (429), images that are too large, and offline or unreachable states.
    Each error message tells the student that their work is still saved.
  - It sets `window.FTTGalleryCaptureImage`, so the site-wide Add to Gallery button sends the same complete lesson picture on Halacha pages.
- `halacha/index.html` is **not** changed. PR #283 edits that file, so leaving it alone avoids merge conflicts.
  The script URL keeps its old `?v=` value, and GitHub Pages caches it for at most 10 minutes (`max-age=600`), so the new file takes effect shortly after publishing.
- No Firebase rules, Cloud Functions, `gallery-share.js`, or sign-in code changed. **No backend deployment is needed.** The live
  `classGallerySubmit` (GET reports `{"ok":true,"ready":true,"version":1}`) matches `backend/functions/class-gallery-submit.js`.

## Tests

- `tests/halacha-gallery-submit.test.cjs` (6/6). This runs the real `classGallerySubmit` handler against an in-memory fake Admin SDK and checks the following:
  - ET/WT routing and custom-class routing;
  - pending status;
  - the student name comes from the verified profile;
  - a classmate's identity, a wrong passcode, or a made-up name is refused;
  - a spoofed class is ignored;
  - the rate limit works;
  - existing posts are unchanged;
  - static checks that the client never writes to the database or re-saves student work.
- `scripts/halacha-gallery-lab/run.cjs`, a real-browser end-to-end test with synthetic students. **11/11** pass with the production rules snapshot and **11/11** with `firebase-rules.hardened.json`.
- The full `tests/*.test.cjs` suite (138 files) was run on `main` and on this branch. Results are identical: the same 58 assertions fail on both
  (for example `gallery-api-security`, `migration-access`, and browser tests without a local Chromium). The only difference is the 6 new passing tests. No regressions.
- Baseline on unfixed `main` (`--baseline`): 0 visible Halacha buttons, the picture posted as `data:,`, and the saved drawings were overwritten.

## Access-control findings outside this change (not fixed here, need owner decision)

1. **Production `classGallery` is publicly writable** (`.write: true`). Anyone can create posts already marked `approved`,
   edit or delete existing posts, or inject HTML into the teacher review list. The review list renders `p.image` unescaped.
   This branch stops Halacha from using that path, but only deploying the hardened rules closes the hole. That deployment is planned as part of the PR #283 release.
2. **`firebase-rules.hardened.json` has no rule for `b3Games/students/$studentId/halacha`** (on `main` and on PR #283).
   Production allows `auth.token.b3StudentId == $studentId` writes there. When the hardened rules go live, Halacha account save and load
   will be denied. Work would stay only on the device. This does not affect Gallery submission, which no longer touches the database, but it
   must be added to the hardened file before it is deployed. Suggested narrow rule (not applied):
   `"halacha": {".read": "auth != null && (auth.token.b3StudentId == $studentId || <owner/admin/assigned-teacher checks as in profile>)", ".write": "auth != null && auth.token.b3StudentId == $studentId"}`.
3. With the hardened rules, `loadSimanAccess()` can read before the Halacha student token is ready. Higher Simanim then stay locked for that load.
   This is sign-in timing that belongs to PR #283's scope, so it was left untouched.
