# Class Pointer polls (first version)

Polls use the existing admitted, class-scoped PeerJS connections. The teacher owns the current poll in memory. Student identity comes from the admitted connection, never the vote payload. A reconnect receives the current poll and that student's previous choice. Activity pages receive polls through their existing Class Pointer listener, as does the student classroom.

The teacher can leave the question blank, select thumbs / numbers / letters / 2–4 custom answers, send, inspect counts and named participation (including offline class members), show/hide aggregate results, and end the poll. Students can change their choice until it ends. Totals are omitted from student messages while sharing is off; other students' identities/votes are never sent. There are no points, correct-answer settings, database writes, or Reports integration.

One poll exists at a time. A new poll starts with empty votes and sharing off. Closing the teacher panel preserves the poll; the Poll button reopens it. Ending/leaving a classroom or changing student identity clears its poll UI. Teacher sign-out ends voting. Refreshing/closing the teacher tab loses poll results. Offline students see the current poll when they reconnect while the teacher's session remains open.

## Staging acceptance checklist — fictional accounts only

Use https://fun-torah-tools-staging.web.app **after the feature has been deployed**. Hard-refresh teacher and student pages to update the activity listener. Use the private staging credentials file; never put passwords/passcodes in a PR.

1. Sign in as **Test Teacher Alef** (`teacher.alef@funtorahtools-staging.test`), open Teacher Tools → Class Pointer for **TEST-ALEF**, and open a whiteboard. In separate browser profiles, sign in as **Test Student A1** and **Test Student A2**. Keep A1 on an activity page and A2 on the teacher presentation/whiteboard. Keep **Test Student B1** in **TEST-BEIS** as an isolation control.
2. Click **📊 Poll**, leave Question empty, choose **👍 / 👎**, and Send. A1 and A2 should get large answer buttons with no blank question heading. B1 should get no poll. Confirm Show results to class starts off and students see no chart.
3. A1 taps 👍. Teacher: 👍 count 1; A1 named under Answered; A2 under Hasn’t answered. A1 changes to 👎: total stays 1; the vote moves to 👎. A2 answers 👍: total becomes 2. No points/rewards should change.
4. Enable **Show results to class**. Both students should see matching bars/counts, without student names. Disable it: both charts disappear. Teacher chart remains visible.
5. Close the teacher panel, continue writing on the whiteboard, then reopen Poll. Votes should remain. Refresh A1's activity page: the current poll and A1's selection should return after reconnection. Temporarily disconnect A2: teacher should retain their vote. Reconnect A2 and change it: total must remain 2.
6. Click **End poll**. Both students should see Poll ended and disabled answer buttons. Teacher counts stop changing. Students can close the ended popup. End with results both hidden and shared in separate runs.
7. Click **New poll**. Repeat for **1 · 2 · 3** and **A · B · C**, with and without a question. Confirm each new poll starts empty with sharing off. Typed questions must appear for students.
8. Choose **Custom**. Try one answer, duplicate answers, then 2, 3, and 4 distinct answers. Invalid configurations must stay unsent with a clear message. Verify long text/Hebrew answer labels wrap on a narrow student screen. Typed markup must appear as text.
9. Start a poll while A2 is offline: teacher should list A2 under Hasn’t answered. Reconnect A2: the poll should appear. Check the popup and toolbar in lesson full screen, keyboard navigation, and a tablet-sized viewport.
10. End the classroom or sign out as teacher while a poll is active. Student voting should stop; ending the classroom should dismiss the poll. Switch classes and confirm no previous poll appears. Verify Reports has no poll entries and no new correct-answer/points controls exist.

## Verification and staging deployment

Focused checks:

```
node --test tests/class-pointer-poll.test.cjs
npx playwright test e2e/class-pointer-poll.spec.cjs --project=chromium
```

The browser test uses fictional teacher/student fixtures and the actual poll scripts with an in-process transport; it does not prove deployed Firebase authentication or cross-class admission. Complete the acceptance checklist on staging for those checks.

Build from this branch (based on current main), with approved `B3_STAGING_FIREBASE_*` config variables present, into an empty `staging-build` directory:

```
node staging/package-site.cjs . staging-build
npx firebase-tools deploy --config firebase.staging.json --only hosting --project fun-torah-tools-staging --non-interactive
```

Hosting only is sufficient for this feature. Do not deploy production, functions, or database/storage rules. No changes from PRs #853, #819, or #834 are included. If the current staging lesson cannot open because of its existing rules, report that blocker separately; do not silently incorporate #834.
