# Deploying the 2026-10-21 teacher approval repair

Branch: `fix/approval-system-verify-20261021` (based on main `87d1ae55`).
Changes only: `approval-queue.js`, `index.html`, `chazara/teacher.html`, `student-rewards/teacher.html`, `student-rewards/teacher.js`, `backend/functions/student-rewards-auto-award.js`, two test files, and these docs and the deploy script.
No Firebase rules changes, no other functions, no data migration, no force push.

The two parts can go live in either order and either one can be rolled back on its own:
- **Website**: teacher screens stop listing Posuk Practice milestones and quietly pay any that are still pending, using the approve action that already exists. This works with the current backend.
- **Function** (`studentRewardsAutoAward`): pays verified milestones the moment a student earns them. The current student page already handles that reply.

The recommended order is **website first, then function**, so the deployed function source matches GitHub main.

## 0. One-time setup on your computer (safe)

Open **PowerShell** (not as administrator) and go to the repo:

```powershell
cd $env:USERPROFILE\GitHub\B3-games
```

**GitHub sign-in.** Git for Windows includes Git Credential Manager. The first `git push` opens a GitHub sign-in page in your browser, and the token is stored in Windows Credential Manager.
- Do not paste a personal access token into a command, a URL or a file.
- Do not put a token in the remote URL.
- To check sign-in without pushing anything: `git ls-remote origin main`

**Firebase CLI.** `firebase-tools` appears to be installed already (global npm).
- `firebase --version`. If it isn't found, run `npm install -g firebase-tools`.
- `firebase login:list` should show the owner Google account. If it doesn't, run `firebase login`, which signs in through your browser.
- Don't use `firebase login:ci` tokens or service-account key files for this; a key file on disk is a standing credential.

## 1. Check (changes nothing)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-approval-fix.ps1 -Phase Check
```

This phase:
- fetches GitHub main;
- **stops if main has new commits** that the repair doesn't contain;
- stops if the repair touches any unexpected file;
- runs the focused tests in a throwaway copy;
- shows your GitHub and Firebase sign-in status.

## 2. Backup (read-only, plus one tag)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-approval-fix.ps1 -Phase Backup
```

**a.** Tags the exact live main commit as `backup/main-before-approval-fix-<time>` and pushes **only the tag**. You'll be asked to type `TAG` first.

**b.** Saves to `%USERPROFILE%\B3-backups\approval-fix-<time>\`:
- the Firebase functions list;
- read-only snapshots of `/studentRewards/pointRequests` and `/studentRewards/students` (point balances);
- SHA-256 checksums.

These snapshots contain student data. Keep them private and never commit or share them.

**c.** Manually, back up the deployed function's source. The deployed function may not exactly match the repo.
1. Open https://console.cloud.google.com/functions/details/us-central1/studentRewardsAutoAward?project=b3-games
2. Go to **Source** and choose **Download ZIP**.
3. Save the ZIP into the same backup folder.

## 3. Publish the website

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-approval-fix.ps1 -Phase Website
```

This re-runs the check and tests, then asks you to type `PUBLISH`. It runs a normal push, `git push origin fix/approval-system-verify-20261021:main`. Git itself refuses that push if main changed in the meantime, so nobody's work can be overwritten.

Live checks, 2–5 minutes later:
- **Homepage Approvals popup:** no "Posuk Practice points" line, and the Chazara line shows an ET/WT split.
- **Chazara Teacher:** the first screen shows "Recordings awaiting review" and the pending Chazara points list with **Approve All**. No Posuk Practice milestones and no Shorashim items appear in it.
- **Student Rewards → Approvals:** no Posuk Practice items, and **Approve all** is shown when Chazara or Shorashim items are pending.
- **Counts:** the Chazara count is the same on the homepage and on the Chazara page.

## 4. Deploy the function

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy-approval-fix.ps1 -Phase Function
```

This phase:
- refuses to run until the website is on main;
- builds from a clean copy of GitHub main;
- runs `npm ci`;
- asks you to type `DEPLOY`;
- deploys **only** `functions:studentRewardsAutoAward` to `b3-games`.

Live check: a student reaches 100% on a posuk and sees "+3 points" right away, with nothing appearing in any approval list. In the database, those requests show `reviewedBy: "Automatic: Posuk Practice milestone"` and `approvedAutomatically: true`.

## Rollback (each part on its own)

**Website.** Don't rewrite main. Add an undo commit:

```powershell
git fetch origin
git switch -c revert-approval-fix origin/main
git revert --no-edit 87d1ae55..fix/approval-system-verify-20261021
git push origin revert-approval-fix:main
```

**Function.**
- Preferred: redeploy the downloaded ZIP from step 2c, from an unzipped folder, with `firebase deploy --only functions:studentRewardsAutoAward --project b3-games`.
- Or: run `git worktree add ..\B3-rollback <backup tag>`, then in that folder run `npm --prefix backend/functions ci` and the same deploy command.

**Data.** Nothing needs restoring. No records are moved or deleted, and approvals are idempotent. Automatic approvals are identifiable by the `reviewedBy` and `approvedAutomatically` fields above.

## Separate outstanding issue

The teacher-mode Student Rewards Shorashim status mirror is a separate problem, not part of this deploy. See `docs/OUTSTANDING-shorashim-teacher-approval-mirror.md`.
