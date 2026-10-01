# Firebase backend migration — deployment required

These files were recovered from the September 29–30 project attachments and updated for Fun Torah Tools. They are source code, **not evidence of a deployed fix**. No Firebase credentials are present in this repository/session.

The recovered installation instructions identify the existing Windows project as `C:\B3-Games-Backend`. Preserve that project's other functions and package dependencies.

Copy the contents of `backend/functions/` into that project's `functions/` directory, retaining all other files. The existing `index.js` already exports `yiddishApi` from `./yiddish`; add:

```js
exports.funTorahTeacherClaim = require('./teacher-claim').funTorahTeacherClaim;
exports.funTorahManageStudents = require('./student-management').funTorahManageStudents;
```

From `C:\B3-Games-Backend`, deploy only these functions:

```powershell
firebase deploy --only functions:yiddishApi,functions:funTorahTeacherClaim,functions:funTorahManageStudents --project b3-games
```

Verify all three endpoints after deployment with a real invited Google teacher and real central student passcode. Do not change database rules as a shortcut. The Yiddish service uses the Admin SDK and never returns raw passcodes.

Yiddish preserves B3's existing configuration/progress paths. New classes use separate private configuration and progress paths under `yiddishPrivate/classes/b3-2026/{classId}` and require an active central profile, active membership, active class member, and the Yiddish tool grant. Sessions remember the active class and become invalid when the passcode changes. Lesson-round retry handling from the recovered v3 service is retained.

`funTorahTeacherClaim` verifies a Google ID token, matches an active email invitation, creates the UID teacher record with assigned class IDs and claim metadata, and links the UID to those classes. It rejects disabled teachers and never copies an invitation's role or wildcard class assignment as administrator access.

Full database security remains unfinished: public profile passcodes and broad workspace writes in the transitional rules must be replaced after all student frontends use trusted authentication. `firebase-rules.json` has not been deployed or relaxed by this change.

`funTorahManageStudents` checks the signed-in teacher UID against the selected class before creating students or changing passcodes/memberships. Teacher blocking is limited to that class membership; it does not disable the student profile across other teachers. Every change records a class audit entry without passcodes. Regular-teacher frontend writes use this endpoint; the owner keeps the existing direct-write compatibility flow until the remaining trusted-auth migration is complete.
