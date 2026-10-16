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
