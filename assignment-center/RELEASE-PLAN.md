# Homework Portal — release plan (for owner approval; nothing here has been done)

## What goes live
- Website files (a normal GitHub push after merge): `assignment-center/*`, the "Homework" tool in Teacher Home and Owner Admin, and the "My Homework" button on the student home bar.
- ONE backend function: `homeworkPortal` (nothing else is redeployed).
- No database-rule changes. The `assignmentCenter` data has no browser rules, so browsers cannot read or write it; only the function can.

## Safety switch
Homework is OFF for every class until the owner turns on **Homework** under Owner Admin > Class Tools for that class. The function also refuses teachers and students of classes where it is off. Turn it on for a test class first.

## Steps (each needs the owner's separate OK)
1. Merge PR #133 into the Assignment Center branch, then that branch into main (website only; Homework still hidden because no class has it on).
2. Deploy only the function (Command Prompt, not PowerShell):
   `cd C:\Users\simch\GitHub\B3-games\backend` then `firebase deploy --only functions:homeworkPortal --project b3-games`. Look for "Deploy complete!".
3. Create/choose a test class with test students only. Turn Homework on for it.
4. Check on the live site: teacher gives homework; test student sees it, saves, hands in; teacher approves; a teacher of another class cannot open it; a class with Homework off cannot use it.
5. Only then turn it on for ET/WT.

## Rollback
Turn Homework off for the class (instant). Or delete the function: `firebase functions:delete homeworkPortal --project b3-games`. Stored homework data stays unseen under `assignmentCenter/`.

## Cost
No AI or speech calls and no file storage are used. It is one small function that reads/writes small text records. The project already runs on Firebase's pay-as-you-go plan with 19 functions; adding a function has no monthly fee. Normal classroom use should be a tiny fraction of the free monthly allowance, so the expected extra cost is $0 (at most pennies if usage were very large). Confirm in the Firebase console > Usage and billing, which I cannot see. Messaging with voice (not built) would add file storage and should be costed separately before it is built.

## Not built yet (kept as plans)
- Private teacher–student text and voice messaging: see `MESSAGING.md`, `message-policy.js`, `message-service.js`, `messages.html` (unchanged; policy + service tests still pass).
- Audio/photo/video hand-ins, automatic completion from other tools, due-date reminders.

## Known limits
- Hand-ins are a typed note.
- Teacher Google sign-in was tested with a stand-in login on a local fake database, not a real Google account.
- Repo-wide CI checks "Migration access checks", "Playwright Tests" and the Classroom Pointer tests were already failing on main and the base branch; this PR does not change them.

---
## Update 2026-10-16 (c): authentication, permissions, rollback, staging

### What was verified (local, isolated, no real accounts or data)
`scripts/homework-auth-emulator-test.cjs` runs the real `homework.js` function with real Firebase Admin token checking against the **Firebase Auth emulator** (fake Google accounts). Results, all passing:
- Teacher of class 1 can use class 1; is refused (403) for class 2. Teacher of class 2 is refused for class 1.
- Google account with an unverified email: refused. Email/password account: refused. No token: 401. Garbage token: 401 (this was a bug, it returned 500; fixed). Token revoked ("sign out everywhere"): 401.
- Student: wrong passcode 401; a student in another class sees none of this class's homework; asking for another class only returns the student's own.
- Homework off for a class: teacher and students refused (unit tests).
Not covered: the real Google pop-up and a real Google token. The emulator needs the Java 21 database emulator for a full end-to-end run (this computer has Java 17), so the database was an in-memory stand-in.

### Real Google sign-in in staging: what is blocking
Staging project `fun-torah-tools-staging` exists, but (per STAGING-SETUP.md) its Cloud Functions API is off and the project is not on the paid Blaze plan, so the function cannot be deployed there yet. I cannot sign in to Google or create accounts myself. To finish: owner decides whether to upgrade staging to Blaze (see cost), then signs in once with a throwaway Google account he owns on the staging site.

### Rollback (written, not yet rehearsed against a live deploy)
1. Instant, no deploy: Owner Admin > Class Tools > untick Homework for the class. Teacher Home and student buttons disappear after refresh, and the function refuses that class.
2. Remove the website part: revert the merge commit on main and push with GitHub Desktop (Branch > Revert changes in commit).
3. Remove the function: Command Prompt, `firebase functions:delete homeworkPortal --project b3-games` (type Y). Other functions are untouched.
4. Optional data clean-up (only if asked): delete `assignmentCenter/workspaces/b3-2026/classes/<classId>` in the Firebase console. It holds only homework.
Rehearsal to do on the test class right after the first deploy: switch Homework off, confirm the teacher page shows "Homework is not turned on", switch on again.

### Conflicts with other open work (checked by trial merges, nothing merged)
- Clean against `main` and PRs 129, 125, 121, 96, 76, 75, 74, 73, 71, 55.
- One-line clashes with my change, easy to keep both sides: `backend/functions/index.js` (PRs 134, 124, 84: everyone adds an export at the end) and `owner-admin.html` (PR 84, the Teacher Center onboarding: the tool list line).
- PRs 79, 68, 64, 50 conflict with the base branch in files I did not touch (Class Pointer, Sefer HaMitzvos, Shorashim teacher, many tools); not caused by Homework.
Recommendation: merge Homework after PR 84 (or resolve the two lines then); I will not do it without approval.

### Extra Firebase charges
- Production (b3-games) is already on pay-as-you-go with 19 functions. One more function: no monthly fee; usage beyond the free allowance is billed per call, and class homework use is tiny. Expected extra: $0, at most pennies. Only the Firebase console can confirm the current plan and free usage, which I cannot see.
- Staging: upgrading `fun-torah-tools-staging` to Blaze is needed to deploy a function or Storage there. Blaze has no fixed fee but needs a card and bills usage; an unused staging project should cost about $0. That upgrade is the owner's decision. Free alternative already done: local emulator checks.
- Nothing in Homework uses AI, speech or file storage.
