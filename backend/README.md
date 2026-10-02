# Firebase backend migration — deployment required

The current project was supplied in `B3-Games-Backend.zip` on October 1, 2026. This directory now contains its active function entrypoint, dependencies, Firebase configuration, and supporting function modules, with the Fun Torah Tools changes integrated. Historical backups and `node_modules` are excluded. Existing grading, speech, rewards, Gallery powers, and parent-dashboard exports are preserved.

These are source changes, **not evidence of a deployed fix**. GitHub Pages does not deploy Firebase functions.

For the existing Windows project, [install-migration.ps1](install-migration.ps1) downloads the eight tested migration modules from a pinned commit, backs up replaced files, and adds missing exports without replacing the rest of `index.js`. Run it in PowerShell; it installs source only and prints the targeted deployment command.

To deploy from a checkout, open PowerShell in the repository's `backend` directory:

```powershell
npm --prefix functions ci
firebase login
firebase deploy --only functions:yiddishApi,functions:funTorahTeacherClaim,functions:funTorahManageStudents --project b3-games
```

Alternatively copy `backend/functions/` into `C:\B3-Games-Backend\functions`, retaining other project files, and run the same targeted deployment from `C:\B3-Games-Backend`. The new function exports are already wired into `functions/index.js`. Existing deployed secrets remain in Firebase; no secret values belong in this repository.

Verify all three endpoints after deployment with a real invited Google teacher and real central student passcode. Do not change database rules as a shortcut. The Yiddish service uses the Admin SDK and never returns raw passcodes.

Yiddish preserves B3's existing configuration/progress paths. New classes use separate private configuration and progress paths under `yiddishPrivate/classes/b3-2026/{classId}` and require an active central profile, active membership, active class member, and the Yiddish tool grant. Sessions remember the active class and become invalid when the passcode changes. Lesson-round retry handling from the recovered v3 service is retained.

`funTorahTeacherClaim` verifies a Google ID token, matches an active email invitation, creates the UID teacher record with assigned class IDs and claim metadata, and links the UID to those classes. It rejects disabled teachers and never copies an invitation's role or wildcard class assignment as administrator access.

Full database security remains unfinished: public profile passcodes and broad workspace writes in the transitional rules must be replaced after all student frontends use trusted authentication. `firebase-rules.json` has not been deployed or relaxed by this change.

`funTorahManageStudents` checks the signed-in teacher UID against the selected class before creating students or changing passcodes/memberships. Teacher blocking is limited to that class membership; it does not disable the student profile across other teachers. Every change records a class audit entry without passcodes. Regular-teacher frontend writes use this endpoint; the owner keeps the existing direct-write compatibility flow until the remaining trusted-auth migration is complete.

Chazara teacher scope: run `install-chazara-scope.ps1` in the existing Windows project to back up and install the updated review backend and shared class policy. Then deploy only `functions:studentRewardsAutoAward`. No database rules are changed by this installer.
