# Outstanding issue: Shorashim approval status in teacher-mode Student Rewards

Status: OPEN, not fixed. This is separate from the 2026-10-21 approval-system repair and was left alone because it is in a backend file that wasn't authorized for change.

## What happens

When a **non-owner teacher** approves or rejects a Shorashim recording point request (`shorashim-recording` / `shorashim-no-hints`) from **Student Rewards → Approvals**, the backend function `studentRewardsTeacher` (`backend/functions/rewards-teacher-core.cjs`, `decideRequest`) writes the result to:

```
posukPractice/chazara/events/<practiceStudentId>/<eventId>/pointRequestStatus
```

This is the Chazara path. Shorashim requests keep their status at:

```
posukPractice/shorashimLearning/recordingEvents/<practiceStudentId>/<eventId>/pointRequestStatus
```

## Effect

- The points themselves are correct: the request is approved and the balance is credited.
- The Shorashim recording event still says `pending`, so the **homepage Approval Center** ("Shorashim recordings") and the **Shorashim teacher page** keep counting it as waiting.
- A stray node holding only `pointRequestStatus` is created under `posukPractice/chazara/events/...`. It doesn't show up as a Chazara because it lacks `recorded`/`reviewApplied`, but it's junk data.

The owner's own approvals in Student Rewards were fixed in the frontend by the 2026-10-21 repair (`setChazaraPointStatus` in `student-rewards/teacher.js`). Approvals made on the Chazara page or the Shorashim page go through `studentRewardsAutoAward`, which already writes to the correct path.

## Suggested fix (needs separate authorization)

In `decideRequest`, use the Shorashim path when `live.source` is `shorashim-recording` or `shorashim-no-hints`, the same way `mirrorChazaraPointStatus` does in `student-rewards-auto-award.js`. Then deploy only `functions:studentRewardsTeacher`. A one-time cleanup could correct already-affected Shorashim events, using the request records as the source of truth. That cleanup would need its own backup and approval.

## Related observation (not verified live)

`backend/functions/rewards-teacher.js` sets `cors:['https://simchacohen1.github.io']` for `studentRewardsTeacher`. The site is now served from `https://funtorahtools.com`. If the deployed function matches the repo, non-owner teachers using Student Rewards on funtorahtools.com may have their requests blocked by the browser. To verify, sign in as a non-owner teacher on the live site, open Student Rewards and check the browser console for a CORS error.
