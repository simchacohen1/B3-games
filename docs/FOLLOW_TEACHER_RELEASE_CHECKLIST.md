# Follow the Teacher + Class Pointer release checklist

This change is a frontend candidate. Do not call it live until the authenticated
checks and production asset verification below pass.

## Behavior

- Follow Once and Follow Teacher — Locked are the two visible choices.
  Unlock Everyone still publishes the independent state.
- Class Pointer opens the existing teacher workspace in an iframe on the
  Follow the Teacher page, scoped to the selected authorized class. This keeps
  the navigation heartbeat alive without another window. Its existing shared
  whiteboard opens after both the classroom and document controls are ready.
- Students navigate to `class-pointer-prototype/student-view.html`, which uses
  the shared access gate and existing `activity-share.js` presence/media path.
  The retired student classroom/dashboard workflow is not used.
- Teacher changes of presentation keep the student on the same viewing page.
  Only explicitly granted pointer, highlighter and pen tools are shown.
- The ordinary access gate remains closed. Server-admitted presentation and
  assigned whiteboard controls, and teacher-permitted screen-sharing controls,
  can receive interaction above it. This does not open the underlying activity.
- Shorashim supports Review, Learn New, Games, My Card Gallery and Prefixes /
  Suffixes. Locked mode guards actual in-app screen navigation, including
  learning tracks, rather than trusting the query string alone. Once mode lets
  students leave afterward. Dirty edits, recording and pending/failed account
  saves veto teacher navigation.
- Class/session changes reject old media. Existing ticket validation, browser
  consent, share transport, student whiteboard storage, and lease expiry remain.

## Extending subsection destinations

Add only reviewed activity-owned keys to `SUBDESTINATIONS` in
`follow-teacher/core.js`. Register an adapter at `window.FTTFollowActivities[tool]`
with `currentSection()` and `applySection(section)`. Guard that activity's own
navigation with the validated `FTTFollowStudent.activityPolicy(tool)`, and retain
its existing `ftt:before-follow-navigation` save veto. Reuse the parent tool grant;
never accept arbitrary URLs or invent a new permission grant for each section.
Test both classes, once, locked, unlock, direct reloads, in-app exits and saving
before registering another tool. Shorashim is the first opted-in activity.

## Local checks

Run:

```sh
node --test tests/follow-teacher*.test.cjs tests/class-pointer*.test.cjs tests/session-isolation.test.cjs tests/student-auth.test.cjs tests/game-gate-authenticated-reads.test.cjs
npx playwright test e2e/follow-teacher.spec.ts e2e/follow-teacher-subsections.spec.cjs e2e/class-pointer-my-screen.spec.cjs e2e/class-pointer-activities.spec.ts e2e/class-pointer-auth-startup.spec.ts e2e/class-pointer-activity-screen.spec.cjs e2e/class-pointer-teacher-workspace.spec.ts --project=chromium --workers=1 --reporter=line
```

Browser fixtures use in-memory Firebase/authentication/PeerJS and synthetic
canvas video. They do not establish real Google sign-in, real server grants,
real network traversal, or successful use of the browser capture picker.
`tests/auth-check.test.cjs` is a Playwright test for a live signed-in owner page;
it must not be run with Node's unit-test runner or treated as an offline test.

## Required before merging and deployment

1. Restore environment connectivity and fetch main and PRs #232/#233. The local
   starting commit was main `8eeb1d99bd286cad50b9ac04dc5881616f4e223b`; the PR files
   were retrieved through the connected GitHub API. Reconcile this candidate
   with the integration branch and preserve any intervening developer work.
2. Use an authenticated teacher and a separate authenticated student test
   session. Verify teacher identity survives a second tab, student login and
   Switch Student, and ET/WT isolation. Use test accounts; do not overwrite
   production student records or run destructive test setup against production.
3. Verify Once, Locked, Unlock Everyone and all five Shorashim subsections,
   including direct URLs, reloads, unsaved work and in-app navigation.
4. With ordinary classroom activities locked, assign Class Pointer. Confirm
   the teacher whiteboard opens automatically and students receive it. Switch
   whiteboard, screen, PDF and webpage without student navigation.
5. Grant/revoke drawing tools and screen sharing. On a real Chromium/Edge
   browser, confirm the student must click and personally approve the normal
   screen picker; cancel it once, share once, stop, and retry. Confirm no
   additional window or redundant prompt and verify assigned whiteboards and
   their return control remain usable while other activities stay locked.
6. Interrupt the student network temporarily, reconnect, disconnect/end the
   teacher session and verify safe media clearing and lock lease expiry.
7. Run current checks on the final branch. Compare any regression to current
   main. No Firebase Functions, database rules or storage rules deployment is
   part of this change. The optional `subdestination` property uses the existing
   class-access state; verify deployed rules accept the authorized write.
8. Only after these pass, merge and use the repository's GitHub Pages publishing
   process. `CNAME` is `funtorahtools.com`. The automatic page-list workflow can
   add a generated commit after the merge: follow its actual Pages deployment,
   not only the initial merge SHA.
9. Check the deployed commit/Pages result and fetch the production teacher page,
   viewer, navigation scripts and Shorashim script. Confirm the new asset versions
   and real behavior in fresh authenticated browser sessions. Previously open
   student tabs need the updated assets loaded for new destinations/subsections.

## Environment access needed

The observed failure was a connection refusal to the injected HTTP proxy at
`proxy:8080`, not an HTTP destination-policy denial. Restart/recreate the managed
B3-games environment to restore that proxy; if it persists, the environment
service needs repair. Do not remove proxy settings or disable TLS validation.
Changing an allowed-host list alone does not repair an unreachable proxy.

In the cloud environment configuration, expand the restricted network policy
from its current package-manager hosts to allow the test/deployment services:

- `funtorahtools.com`, `github.com`, `api.github.com`, `raw.githubusercontent.com`
  and the existing GitHub download/CDN hosts.
- `www.gstatic.com`, `accounts.google.com`, `apis.google.com`,
  `identitytoolkit.googleapis.com`, `securetoken.googleapis.com`,
  `b3-games.firebaseapp.com`, `b3-games-default-rtdb.firebaseio.com`,
  `us-central1-b3-games.cloudfunctions.net`, `firebasestorage.googleapis.com`.
- Secure WebSocket signaling to `0.peerjs.com:443` and Firebase's realtime
  endpoint/redirect hosts. Permit additional actual provider endpoints only as
  required by observed browser requests.

Real media tests also need WebRTC connectivity, which an HTTP allowlist alone
cannot guarantee. The installed PeerJS client references
`stun.l.google.com:19302`, `us-0.turn.peerjs.com:3478` and
`eu-0.turn.peerjs.com:3478`. Use a test browser/network that supports the
configured ICE transports; do not substitute a mocked video source for this
verification.

The connected local Browser control tool was not exposed in this thread, so
there is no access to the owner's existing Edge tabs or cookies. Reconnect the
Browser plugin/extension in Work mode to a supported Edge session, or provide a
separate network-enabled Chromium test environment with teacher and student
profiles. Sign in interactively; do not paste credentials or session cookies
into chat. Frontend deployment authorization has already been granted.

## Recorded offline verification

- 304 Node regression checks passed with no failures.
- 70 Chromium browser cases passed with no failures in the final combined run.
- JavaScript syntax checks and `git diff --check` passed.
- Teacher/student service fixtures and canvas video were simulated. No real
  Google/Firebase sign-in, real browser capture consent picker, production media
  traversal, or live production deployment was verified.
- No production student data, Firebase Functions, database rules or storage
  rules were changed. PRs #232 and #233 were inspected through the GitHub
  connector and remain unmerged; this candidate has not been pushed/published.
