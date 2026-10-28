# Firebase backend migration — deployment required

This repository is the main Fun Torah Tools project. Its Firebase Functions source, dependencies, and Firebase configuration are in `backend/functions` and `backend`. The standalone `C:\B3-Games-Backend` directory is a legacy copy; do not use it for new work or deployments. It has not been archived or deleted, and its backups must be reviewed before retirement.

These are source changes, **not evidence of a deployed fix**. GitHub Pages does not deploy Firebase functions.

The [install-migration.ps1](install-migration.ps1), [install-login-fixes.ps1](install-login-fixes.ps1), and [install-chazara-scope.ps1](install-chazara-scope.ps1) scripts default to this `backend` directory (the directory containing each script). They install source only and print targeted deployment commands. Review the affected source and command before any deployment.

To deploy from a checkout, open PowerShell in the repository's `backend` directory:

```powershell
npm --prefix functions ci
firebase login
firebase deploy --only functions:yiddishApi,functions:funTorahTeacherClaim,functions:funTorahManageStudents --project b3-games
```

Do not copy Functions source into the legacy directory. Existing deployed secrets remain in Firebase; no secret values belong in this repository.

Verify all three endpoints after deployment with a real invited Google teacher and real central student passcode. Do not change database rules as a shortcut. The Yiddish service uses the Admin SDK and never returns raw passcodes.

Yiddish preserves B3's existing configuration/progress paths. New classes use separate private configuration and progress paths under `yiddishPrivate/classes/b3-2026/{classId}` and require an active central profile, active membership, active class member, and the Yiddish tool grant. Sessions remember the active class and become invalid when the passcode changes. Lesson-round retry handling from the recovered v3 service is retained.

`funTorahTeacherClaim` verifies a Google ID token, matches an active email invitation, creates the UID teacher record with assigned class IDs and claim metadata, and links the UID to those classes. It rejects disabled teachers and never copies an invitation's role or wildcard class assignment as administrator access.

Full database security remains unfinished: public profile passcodes and broad workspace writes in the transitional rules must be replaced after all student frontends use trusted authentication. `firebase-rules.json` has not been deployed or relaxed by this change.

`funTorahManageStudents` checks the signed-in teacher UID against the selected class before creating students or changing passcodes/memberships. Teacher blocking is limited to that class membership; it does not disable the student profile across other teachers. Every change records a class audit entry without passcodes. Regular-teacher frontend writes use this endpoint; the owner keeps the existing direct-write compatibility flow until the remaining trusted-auth migration is complete.

Chazara teacher scope: run `install-chazara-scope.ps1` in the existing Windows project to back up and install the updated review backend and shared class policy. Then deploy only `functions:studentRewardsAutoAward`. No database rules are changed by this installer.
