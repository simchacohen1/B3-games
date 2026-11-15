# Firebase cost reduction — 2026-11-13 (Issue #51)

Goal: cut Realtime Database download traffic by at least half without removing anything a teacher or student can do.

**Short answer:** the pages measured below download 29–95% less on a made-up class in the local emulator. Whether the monthly bill falls by 50% is **not proven**: no production usage figures were read, so there is no real before/after for the bill. See "What is still needed".

## What was already done before this branch

| Work | State | What it does |
| --- | --- | --- |
| PR #498 | Open draft, not merged | Per-student index for Rewards point history, so a student's history is not found by scanning every request and adjustment. Needs a data migration before production. |
| PR #560 | Open draft, not merged | Rewards teacher API reads only the teacher's own classes, students and rounds. Needs a Functions deploy. |
| #641, #667, #414 and others | Merged to `main` | Narrow class-record reads, adaptive quiz polling, live approval-center listeners, no whole student list on sign-in, Shorashim teacher listens per student (97225643), Weekly Quiz history loaded on demand, Class Gallery images in Storage with a version check. |

## Baseline and result

Measured with `scripts/firebase-cost/measure.cjs`: the real Firebase browser client talks to the local emulator through a small proxy that counts every byte the database sends. The class is made up (24 students, 300 Shorashim words, 48 cards with a drawing per student, 40 days of Rewards ratings, 60 quiz launches). "Before" is the read pattern on `main`; "after" is this branch.

| Workflow | Before | After | Less |
| --- | ---: | ---: | ---: |
| Shorashim: student opens the page | 217.9 KB | 153.9 KB | 29.4% |
| Shorashim: teacher opens the class page | 4,419.8 KB | 2,210.0 KB | 50.0% |
| Chazara: student opens the page | 250.4 KB | 128.7 KB | 48.6% |
| Student Rewards: student opens the page | 16.9 KB | 10.1 KB | 40.5% |
| Student Rewards: owner view open 10 minutes (1 load + 20 refreshes) | 30,272.6 KB | 1,443.4 KB | 95.2% |
| Parent Dashboard API: quiz data for one call | 3,303.9 KB | 2,043.9 KB | 38.1% |

For the Rewards owner view the page's real `loadRoot()` was also run directly, once from `origin/main` and once from this branch (`scripts/firebase-cost/real-owner-rewards.cjs`): 31,714.2 KB against 1,443.4 KB (95.4% less), and both versions ended with identical data, including a rating saved by another device between refreshes.

These are wire bytes on a made-up class. Real savings scale with how much real data each class has and how long pages stay open. They are not billing figures.

## What was wrong and what changed

**1. Pages downloaded the same data twice at startup.** They read a path once, then attached a live listener to the same path. The Firebase client throws away the first copy when the one-time read finishes, so the listener downloads it again. The fix opens a do-nothing listener on those paths just before the reads, so the read and the real listener share one download.

- `shorashim/app.js` — catalog and settings at student sign-in.
- `shorashim/teacher.js` — catalog, settings, the class student list (the big one: every student's cards and drawings) and scores; both the class view and the ET/WT view.
- `chazara/index.html` — the student's Posuk attempts and Chazara events.
- `student-rewards/student.js` — the student's record, redemptions, contributions, refund requests, the rewards list and the store switch.

**2. The Rewards owner view re-downloaded 18 whole collections every 30 seconds.** That includes the full ratings, audit, point-request and adjustment history, 120 times an hour for as long as the tab is visible. `student-rewards/teacher.js` now keeps those 18 paths open, so the database sends only what changed and the 30-second refresh is answered from the copy already in the page. The refresh still runs and shows the same data.

**3. The Parent Dashboard API read the whole quiz tree.** `backend/functions/parent-dashboard-api.js` used only launches, responses and completions but downloaded every saved quiz, the audit log and settings too. It now reads just the three parts it uses. This one needs a Functions deploy to take effect; the others take effect when the site is published.

Script cache tags were bumped so browsers pick up the new files.

One trade-off to know about: the Rewards owner view used to stop all traffic while its tab was hidden. It now keeps receiving the small change messages while hidden. That is far less than one visible refresh used to cost, but it is not zero.

## Audit of each area

| Area | Finding | State |
| --- | --- | --- |
| Listeners on too much data | Shorashim teacher and the home approval center already listen narrowly. Weekly Quiz teacher still listens to all of `b3Quiz/launches` (each holds a copy of its quiz) and all of `posukPractice/allowedStudents`. | Weekly Quiz listeners left as they are: open candidate. |
| Repeated downloads | Double startup downloads on four pages. | Fixed here. |
| Rewards ledger | Owner view polling fixed here. Teacher API still reads all point requests and adjustments on every call; PR #560 narrows the rest, PR #498 indexes student history. | Partly fixed; rest waits on #498, #560 and an index in the database rules. |
| Shorashim | Student and teacher startup fixed here. The teacher's recordings panel still loads every recording event for the class, including old approved ones. | Recordings panel: open candidate. |
| Chazara | Student startup fixed here. Teacher listeners are already per student; approval polling already pauses when hidden. | No further change. |
| Weekly quizzes | History already loads on demand and only the live launch is listened to (guarded by `tests/weekly-quiz-bandwidth.test.cjs`). | Already done on `main`. |
| Class Gallery | Images are in Storage; the page polls a version number every 20 seconds and re-reads posts only when it changes. Whether the matching functions are deployed was not checked. No paging of the post list. | Not changed. |
| Parent Dashboard | Quiz read narrowed here. Each call still reads every student's Posuk attempts, Chazara, Shorashim and Rewards records. How often it is called is unknown. | Partly fixed. |

A correction to the October audit (`docs/FIREBASE-COST-AUDIT-20261023.md` on PR #560): it sized listener traffic by the decoded snapshot handed to the page. On the wire the database sends a listener only the part that changed. So an open listener is cheap and a repeated one-time read is what costs, which is why this branch targets double reads and polling.

## Tests

- New: `tests/firebase-cost-51.test.cjs` (7 checks that each fix stays in place, plus the emulator measurement when `B3_RUN_RTDB_EMULATOR_TESTS=1`).
- Shorashim, Chazara, Rewards and Weekly Quiz suites: 149 pass, 0 fail.
- Full `node --test tests/*.test.cjs`: 1,552 pass, 47 skipped, 1 fail. The failure is `tests/teacher-center-auth-browser.test.cjs` (Teacher Center page timing out in a headless browser). It loads `teacher-home.html` and `site-settings.js`, which this branch does not change; it was not re-run on `main` to confirm it fails there too.
- **Not done:** no signed-in run of the changed pages in a real browser or on staging. The checks above exercise the real Rewards owner load code and the read patterns, not a full classroom session.

To reproduce the measurement:

```
java -jar ~/.cache/firebase/emulators/firebase-database-emulator-v4.11.2.jar --host 127.0.0.1 --port 9123
node scripts/firebase-cost/measure.cjs
node scripts/firebase-cost/real-owner-rewards.cjs
```

## What is still needed for the 50% target

1. **A real baseline.** Firebase console → Realtime Database → Usage → Downloads, for the 30 days before and the weeks after release. Without it nobody can say what share of the bill these pages are.
2. **Merge and deploy PR #560 and PR #498** (Rewards teacher API and student history). The teacher view polls that API every 30 seconds, so until #560 is live each poll still reads whole collections on the server.
3. **Index point requests and adjustments by student** in the database rules, so the Rewards API stops reading both full histories. Rules change: needs owner approval.
4. **Weekly Quiz teacher:** stop listening to every past launch and the whole legacy student list; load past launches on demand.
5. **Shorashim recordings panel:** load pending recordings first and older ones on request.
6. **Parent Dashboard:** build its summary per student or from a stored summary instead of reading every student's full history per call.

Nothing here was deployed. No production or staging data was read or changed.
