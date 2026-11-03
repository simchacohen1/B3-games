# Class Gallery version check: deployment and rollback plan

Status: **prepared, NOT deployed.** Nothing below may be run against production without the owner's explicit approval.

## What changes
| Piece | File | Where it runs |
| --- | --- | --- |
| Two database triggers that add 1 to `classGalleryMeta/<class>/version` whenever any gallery post is written | `backend/functions/class-gallery-version.js` (+ `class-gallery-meta.js`), exported in `backend/functions/index.js` | Cloud Functions (new) |
| `classGalleryRead` returns `{unchanged:true}` without reading the posts when the browser's `v` equals the counter; falls back to the full read if the counter is unreadable | `backend/functions/class-gallery-read.js` | Cloud Functions (existing function, new version) |
| Page sends `v`, resets it per signed-in user, does a full reload every 5 minutes as a safety net | `class-gallery/index.html` | GitHub Pages |

Not changed: sign-in/permission checks (all still run before the counter is looked at), hidden-tab skipping, Follow Teacher, `game-gate.js`, database rules, pictures.

## Compatibility (any order is safe; the recommended order below still avoids a gap)
- Old page + new function: page sends no `v`, function does the full read as today.
- New page + old function: old function ignores `v` and sends no `version`; the page then never sends `v` (same as today).
- New function with the triggers missing or failing: the counter stops moving, so the page falls back to a full reload at most every 5 minutes. Posts are never hidden permanently.

## Evidence before release (all done on branch `fix/gallery-version-check-20261022`)
1. `node --test tests/gallery-version-check.test.cjs` : 29 unit tests (simulated database firing the real trigger wiring).
2. `node docs/gallery-version-check/emulator-check.cjs` : the real triggers and the real `classGalleryRead` running in the local Firebase emulators (database + functions + auth, demo project; cannot reach production). Needs Java and the firebase CLI. If this checkout has no `backend/functions/node_modules`, set `FUNCTIONS_NODE_MODULES` to one that does.
3. Mutation checks: 8 deliberate breakages of the trigger/read logic are each caught by the unit tests.
4. The emulator run found one real defect the unit tests could not (`admin.database.ServerValue` was undefined inside a trigger), fixed by using a transaction.
5. Existing test suite: same 55 failures on this branch as on `main` (unrelated areas); 29 new tests pass.

## Deployment (owner approves each step)
Use **Command Prompt (cmd), not PowerShell**.

**Step 0. Baseline (read only, no approval needed).**
```
cd C:\Users\simch\GitHub\B3-games
node docs\gallery-version-check\measure-db-downloads.cjs 168 > before.txt
```
Keep `before.txt` outside the repo. It contains only counts and gigabytes.

**Step 1. Merge PR #310 into main (owner decision).** The page change goes live with the normal GitHub Desktop push; this is safe before or after the functions (see Compatibility).

**Step 2. Deploy the two triggers first (approval).**
```
cd C:\Users\simch\GitHub\B3-games\backend
firebase deploy --only functions:classGalleryVersionLegacy,functions:classGalleryVersionWorkspace --project b3-games
```
Look for `Deploy complete!`. These are the project's first database triggers, in `us-central1` next to the database; the Eventarc API is already enabled. If the deploy asks to enable an API or grant a role, stop and ask the owner.

**Step 3. Verify real trigger behavior (approval, because it writes one tiny test record).**
Write and then delete one throwaway post in a test class that no student uses (for example class `test_class`, path `b3Games/workspaces/b3-2026/classes/test_class/resources/gallery/posts/versioncheck`). Then:
```
firebase database:get /classGalleryMeta --project b3-games
```
Expect `test_class` to show `version: 2` (one bump for the write, one for the delete) and no other class changed. Alternatively wait for a natural post (a real approval or submission) and confirm that class's number moved.

**Step 4. Deploy the read function (approval).**
```
firebase deploy --only functions:classGalleryRead --project b3-games
```
The first poll of each class creates its counter if missing.

**Step 5. Functional check (no live data changed).** Open the Class Gallery as a test student and as a test teacher: posts appear; approving a pending post shows within one poll (about 20 seconds); a second tab keeps working. Check that the browser requests show small `unchanged` replies between changes.

**Step 6. Measure after.** Run the same script for the same weekday and class hours as `before.txt`:
```
node docs\gallery-version-check\measure-db-downloads.cjs 168 > after.txt
```
Compare database GB per class hour and `classGalleryRead` calls. Do not claim a saving until this comparison supports it.

## Rollback
- **Page:** revert the PR commit (GitHub: Revert button on the merged PR) and push. Old pages are fully compatible with the new function.
- **Read function:** redeploy the previous source (revert the commit, then `firebase deploy --only functions:classGalleryRead --project b3-games`), or in the Google Cloud console open Cloud Run > `classgalleryread` > Revisions and send 100% of traffic to the previous revision.
- **Triggers:** they only write the counter. To remove them: `firebase functions:delete classGalleryVersionLegacy classGalleryVersionWorkspace --region us-central1 --project b3-games` (needs approval). The leftover `classGalleryMeta` data is tiny and harmless; it can stay.
- **Fastest "something looks stale" fix with no deploy:** students and teachers press Ctrl+Shift+R; the page also does a full reload every 5 minutes on its own.

## Known limits
- Reducing gallery polling does not touch other large readers (see the traffic report in the PR). Expect a partial, not total, reduction.
- The counter bumps once per changed post. A bulk action on N posts bumps N times; harmless.
