# Follow the Teacher — class-scoped navigation

Tracking: [Issue #150](https://github.com/simchacohen1/B3-games/issues/150).
Integration PR: [#194](https://github.com/simchacohen1/B3-games/pull/194).

## Supported destinations

**Independent** lets students choose allowed tools. **Follow Once** sends the
whole class to the selected activity once and does not prevent leaving afterward.
**Follow Locked** sends the whole class to the selected activity and redirects them back
if they visit another gated FTT activity, until the teacher presses Unlock or
the live session expires. The explicit destination catalog covers Shorashim, Chazara, Posuk Practice, Rashi Letters, Halacha, Sefer HaMitzvos, Yiddish, Gematria, Weekly Quiz, Game Show and Student Rewards. Synchronized quiz question steps are future work. It does not share screens, request browser permissions
or perform remote control.

Teacher controls: `follow-teacher/teacher.html?class=et`, linked from the
owner's Teacher Tools and assigned class cards in Teacher Center.

Student listener: `follow-teacher/student.js`, started only after the
homepage's student custom-token sign-in or an authenticated student
session resolved by `game-gate.js`. It checks the Firebase token's student
ID and class claims and rechecks active class membership, profile and
the selected activity permissions before each navigation. It never navigates teacher
previews or embedded iframes.

The navigation state lives at
`b3Games/workspaces/<workspace>/classes/<class>/access/followTeacher`.
It uses the existing teacher-scoped access write rule, so this frontend
change requires **no Firebase rules or Cloud Functions deployment**.
Teacher identity in the class-visible state is a SHA-256 pseudonym, not
the actual Firebase user ID. Sessions renew from the teacher's control
page every 20 seconds and expire safely after 90 seconds without an
active heartbeat. Firebase server time offsets account for client clock skew.

Students see a brief warning before being moved. Automatic navigation
is postponed while a Chazara recording or upload is active; additional
activities can set `data-ftt-unsaved="true"` or cancel the
`ftt:before-follow-navigation` event while saving.

## Privacy gate

The existing RTDB ancestor `b3Games/.read=true` in
`firebase-rules.json` is a separate, unresolved privacy issue (#20).
**Student-specific targeting is deliberately disabled in this initial
integration** because listing selected students in the class-visible state
could reveal private teacher decisions. The policy engine supports it for a
future private, server-validated delivery path; do not turn the UI on until
the relevant private rules and server checks are deployed and verified.
No names, passcodes or targeted student IDs are written by this feature.

## Verification before considering the release complete

- `node --test tests/follow-teacher.test.cjs tests/follow-teacher-integration.test.cjs`
- Focused real-Chromium test:
  `npx playwright test e2e/follow-teacher.spec.ts --project=chromium`
- Check CI relative to the contemporary `main` branch rather than
  attributing old migration/Playwright failures to this feature.
- Test with one **real signed-in teacher** and a **dedicated test student**
  in ET, WT and a separately assigned teacher class.
- Confirm consent for screen sharing is entirely unchanged.
- Check a direct activity URL while Locked, an active Chazara recording
  while navigation is requested, class switch, teacher sign-out and
  disconnected teacher expiry.
- Verify successful Pages deployment and actual authenticated live behavior.
  This document and automated tests alone do not establish live success.

Do not mark issue #150 fully complete until more destinations, safe
individual targeting and end-to-end live verification are delivered.

## Locked classroom access

The shared gate asks the authenticated student listener for a destination-only capability. This bypasses the ordinary classroom/site lock only on the selected, permitted destination; tool switches and individual denials still win. Follow Once consumes its navigation revision before leaving; the currently selected activity remains accessible through reloads while the command is fresh. This does not repeat the one-time redirect. Unlock, revoked permissions and expired sessions remove this exception. No screen-sharing APIs are used.

Chazara recording panels and failed-save recovery remain protected. Posuk Practice vetoes navigation with live recorders, captured unsaved audio, grading and saves. Halacha and Sefer HaMitzvos veto while account saves are pending or failed. Weekly Quiz holds an unsubmitted selected answer; Student Rewards holds in-flight operations. Activities may also use data-ftt-unsaved or cancel ftt:before-follow-navigation.

Class Gallery is excluded pending its separate repair and verified submission protection. Teacher/admin pages, Classroom Pointer and screen-sharing windows are never teacher destinations. Their code and consent flow are unchanged. Live authenticated checks are required before calling this complete; see Issue #150.
