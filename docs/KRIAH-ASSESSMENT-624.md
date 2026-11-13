# Kriah Assessment Center — Issue #624

This is a staging-only implementation. The owner subsequently approved isolated
staging setup and deployment; the dedicated service and preview were deployed.
No production data access/deployment, rules change or migration is included.
The draft PR does not authorize a production merge or deployment. The UI lives at
`kriah-assessment/index.html`; no live homepage links are added.

## Implemented behavior

- Teacher-defined library with editable type, level, Hebrew text, acceptable
  pronunciation, scoring unit and self-correction policy. Optional original
  starter exercises cover all 22 letters, five finals, common confusions,
  standard vowels/dots, syllables and words. These are not a standardized scale.
  Types also include phrases, sentences, pesukim/Tehillim and fluency. Teachers
  supply their own passage; no external corpus or copyrighted platform is copied.
- Assign immutable exercise snapshots to selected active fictional class members.
  Later library edits do not alter earlier attempts.
- Permission checkbox, timer, microphone denial/retry, original playback,
  retry before upload, upload progress and explicit submission. A 5-minute /
  2-MiB limit is enforced. Safari MP4, Chromium WebM and Ogg are supported by
  format selection; real Safari/iPad compatibility remains unverified.
- IndexedDB recovery of unsent original Blobs and teacher draft marks. When an
  upload may have started, the UI keeps those same bytes for idempotent retry.
  It does not silently replace the first original. A new attempt gets its own
  record and object. Clear local drafts on explicit sign-out. This is device
  storage: do not use real pupil recordings in this draft.
- RTL Hebrew grapheme rendering, separate selectable letter/vowel/dot/word
  targets, Shift-click span selection, error/correct marks, correction/note,
  optional teacher-tapped playback time, edit/remove/undo, save and finalize.
  No ASR, automatic alignment, trimming, voice processing or third-party audio.
- Accuracy counts only explicitly marked scoring units. Unmarked units remain
  not assessed. Self-correction can count as an error or correct observation.
  WPM is optional and requires a teacher-confirmed full-passage duration.
- Per-student attempt history, date/level/status, accuracy bars, category counts,
  letter and vowel frequencies, skill filter, explicit teacher mastery decisions,
  optional sharing of final feedback/mastery decisions, bounded class summary,
  and browser Print / Save PDF. Private marking notes are never in student views.

## Architecture and isolation

The only changes are new files. Existing Homework, Chazara, Pasuk Practice,
sign-in, rewards, multiplayer and Firebase rules are untouched. Existing
Homework recorder code is coupled to short messaging; Chazara's upload helper
assumes client Firebase Storage writes/download links. The new service requires
server-authorized private audio without permanent URLs, so those upload flows
were inspected but are not modified or reused unsafely.

Pure model: `kriah-assessment/core.js`. Its byte-identical backend copy is covered
by a parity test. Browser: `app.js`, `client.js`, `recorder.js`, `style.css`.
Backend: `backend/kriah-staging/` is a separate, undeployed Functions codebase.
`firebase.kriah-staging.json` names only that codebase and has no rules targets.

The staging server refuses any project other than `fun-torah-tools-staging`.
The UI rejects production hosts/config and never imports `firebase-config.js`.
The local demo requires localhost plus `?fixture=1`; the fixture-identity header
is accepted only by the loopback development server, never by Firebase.

Every service action rechecks current class access, membership/profile and tool
grant. Teacher ID tokens must be verified Google identities; active teacher
records grant only their current `classIds`. A staging fixture can also use a
verified `@funtorahtools-staging.test` password identity, but only when its current
server-side teacher record explicitly has `kriahSynthetic: true`. Ordinary
password accounts, unverified identities and other domains are denied. Current principal records use the
same owner-maintained, derived class IDs; they get no administrator shortcut.
The staging owner / active admins can enumerate enabled fictional classes only.
Students use existing Firebase custom-token claims `b3StudentRole`,
`b3StudentId`, `b3ClassId`, with current active central memberships required.
The HTTP wrapper calls `verifyIdToken(token, true)` to check token revocation.

Only `kriah-test-*` classes with `active: true`, `kriahSynthetic: true` and
`toolGrants.kriah-assessment: true` are accepted. Student profiles must also have
`active: true`, `kriahSynthetic: true`; their matching central membership and
class member row must explicitly be active. Legacy memberships are not guessed.
These requirements intentionally prevent this draft from accepting real classes.

### Data schema

All metadata is server-only under the existing private, client-denied tree:

```
b3Private/kriahAssessmentCenter/classes/{classId}/
  library/{exerciseId}
    title, text(NFD), type, level, pronunciation, unitType,
    countSelfCorrection
  students/{studentId}/records/{timestamp-uuid}
    exercise(snapshot), studentId, assignedBy, createdAt,
    status(assigned|submitted|in_progress|reviewed|deleting), revision,
    audio(path,sha256,size,type,duration), submittedAt,
    marks[{unitId,category,correction,note,time}], timing,
    feedback, recommendation, shareFeedback, summary,
    gradedBy, reviewedAt, parentId?, retryId?
  students/{studentId}/mastery/{letter_or_nekudah_codepoint}
    kind, label, state(mastered|needs-practice|not-assessed),
    shared, updatedAt, teacherId
```

Audio is **not** in RTDB or the existing Firebase Storage bucket. The adapter
requires the separate GCS bucket
`fun-torah-tools-staging-kriah-private`, with uniform bucket access and enforced
public-access prevention. It checks both bucket properties for every audio
operation. The server service account needs object create/read/delete plus
bucket metadata read; pupils/teachers need no GCS IAM roles. Objects are
`kriah/{classId}/{studentId}/{attemptId}`. Conditional generation-zero creation
and SHA-256 checks preserve the original through concurrent requests. No
download tokens, public object links or signed URL cache are created.

Current staging rules/IAM have not been remotely verified. Before deployment,
verify the existing private RTDB tree remains client-denied and provision the
dedicated private bucket in the staging project. Do not deploy broad new rules.

### Reads, costs and retention

There are no RTDB listeners, background polls, automatic audio downloads, or AI
calls. Lists use key pagination (25 records plus one lookahead). Class reports
explicitly load at most 25 records per selected class member. Library/member
views cap at 100; this draft is for small test classes. The UI labels partial
history and mixed scoring units. It does not claim to have read all history when
more pages exist. Metadata includes original exercise/marks within a bounded
record; audio bytes are stored separately. Original bytes download only after
an explicit Play/Load action. Upload base64 adds approximately 33% HTTP overhead
and is limited to one small original per attempt; this can later be replaced by
a private resumable transport if measurements justify it.

Synthetic decoded response sizes and read paths are measured in the service
tests; these are **not Firebase billing or authenticated staging measurements**.
Max 2 function instances limits concurrency, not total spend. No billing setup
was activated. Small fictional fixtures are the only permitted data.

Retention in this draft is explicit teacher deletion, not an unimplemented
automatic expiry promise. Delete removes the record and the deterministic audio
object, including interrupted-upload orphans. Deletion has a resumable tombstone
if storage fails. Local recovery drafts are removed after confirmed save/submit
or explicit sign-out; clearing browser site data also removes them. Before any
real-pupil release, the owner must choose retention/backup policy and validate
full student removal. Staging test records should be deleted after review.

## Verification and review

Local commands:

```
node --test tests/kriah-assessment.test.cjs
node scripts/kriah-fixture.cjs
python tests/kriah-browser.py
```

Open the printed loopback URL. Use the fictional identity selector (two teachers
and isolated ET/WT test classes). The local service stores data/audio in memory;
restarting it clears server fixtures. IndexedDB recovery stays in that browser.
The demo never talks to Firebase. The Playwright script uses a browser fake
microphone, simulates an upload outage and page reload, checks manual marking,
reports, phone width, PDF, microphone denial and direct unauthorized calls.

Local Node results: **21 passed, 0 failed**. Local browser launch is blocked by
the workspace's Chromium `socket(): Operation not permitted`; no local screenshot
or real-browser success is claimed. A dedicated GitHub PR workflow runs the same
tests plus the browser journey and uploads fictional screenshots/PDF as artifacts.
See PR checks for the actual result; a configured test is not a passing test.

The one-attempt synthetic cost case returned 2,181 bytes of list metadata from
six scoped store reads (3,239 decoded JSON bytes), with zero audio downloads
before explicit playback and one afterward. These are adapter-fixture sizes,
not on-wire Firebase measurements or an estimate of a production bill.

### Separate staging approval gate (subsequently granted)

The owner granted the following isolated staging setup/deployment scope after
the initial draft. Production remains excluded:

1. Provision the dedicated private staging bucket and least-privilege service
   account access; enable only already-approved Firebase/Cloud services.
2. Deploy only `functions:kriah-staging` to `fun-torah-tools-staging` from the
   reviewed draft commit, and publish the new page on an isolated staging preview.
   Do not deploy rules or other functions. Set the staging GCLOUD_PROJECT during
   local source analysis as needed; the service rejects all other projects.
3. Provision two fictional verified test-domain teachers and two fictional
   students with `kriah-test-*` classes/profile flags and student claims as specified above.
   Never put passwords, ID tokens or passcodes into GitHub or this document.
4. Verify authenticated assign → record → mark → report, direct class/student
   denial, revoked teacher/member/token access, storage/RTDB direct denial,
   real Safari/iPad, and measured read/audio traffic, then delete the fixtures.

Production enablement requires separate work and approval: this draft deliberately
rejects production. No live Firebase permissions should be loosened to make it run.

## Approved staging setup continuation

The owner approved isolated staging setup and deployment in the development
session after the initial draft. This does not authorize production or a merge.
`scripts/kriah-stage-preview.cjs` creates a minimal preview package with only the
new center and validated public staging config. `scripts/kriah-stage-fixtures.cjs`
creates the dedicated verified test-domain accounts and marked class records;
passwords are random and retained only in a mode-0600 temporary file, never logs.
Existing unrelated account/class records are not overwritten. All commands must
explicitly target `fun-torah-tools-staging`. Hosting uses a `kriah-624` preview
channel; the staging site's current live channel remains untouched.

The deployed preview is
`https://fun-torah-tools-staging--kriah-624-h422du6m.web.app/kriah-assessment/index.html`.
Real Firebase testing found an adapter issue hidden by the in-memory store:
RTDB can invoke a transaction with provisional uncached `null`. The adapter now
returns that unchanged value for the server hash comparison, clears superseded
callback errors on retries, and reports a missing/conflicting record only after
confirmation. The two adapter regressions cover this behavior without adding a
listener or weakening the expected-revision conflict check.

### Authenticated staging results

After the adapter fix, `scripts/kriah-stage-api-verify.cjs` passed against the
deployed Firebase service with four real fictional Firebase sign-ins. It checked
assignment, a valid one-second synthetic silent Ogg/Opus submission, duplicate
retry, grading, shared feedback and reports, byte-identical original retrieval,
teacher/student class denial, student grading denial, teacher/member revocation,
revoked-token denial, private RTDB denial and anonymous audio denial.
The original was 318 bytes; 19 API calls returned 7,124 JSON bytes. These are test
response sizes, not billed RTDB measurements. Three `audioRead` attempts include
two denied cross-class calls; only the authorized call downloaded the original.

The owner's connected Edge browser was also signed in as a fictional teacher.
Original playback decoded with duration=1 second, readyState=4 and no media error.
A second nekudah was marked correct, draft saved, then finalized on the actual
staging server. The real report showed 1/2 assessed units correct (50%), 20 not
assessed, kamatz needing practice and patach correct. The preview is left open
with that fictional account for review.

The complete automated **remote** fake-microphone browser script remains
unverified because its browser-runtime download repeatedly timed out/was slow.
The local-fictional CI microphone/recovery/markup/report journey passes. Real
Safari/iPad remains a separate check. These limitations do not prevent reviewing
the isolated staging deployment, and do not grant production release approval.

## Follow-up 2026-11-13: playback length, staging accounts, Alef-Beis adventure

### "Recordings load as only about 1 second"

Checked against the fictional data on staging (read-only):

- The private bucket holds four originals. Two are **318-byte, 1-second synthetic
  clips** uploaded by `scripts/kriah-stage-api-verify.cjs`; one of them belongs to
  the only *Reviewed* assessment, so it is the first recording a teacher opens.
  It plays for one second because one second is all that was ever recorded.
- The two real browser recordings (124,878 B / 32.7 s and 134,376 B / 35.3 s)
  decode to 32.2 s and 34.8 s and play to the end in Edge and Chrome through the
  page's own player code. A local fake-microphone run of 8 s and 50 s also
  saved, uploaded and played back at full length. No stored recording is cut.
- Nothing was deleted. The synthetic clips are still there.

What changed so this cannot mislead or fail quietly again:

- `recorder.js` `resolveDuration()` replaces the old length helper. The old one
  accepted the **first** finite length the player reported and then cancelled
  its own end-seek; a browser that reports a part-way length first (the first
  one-second chunk) would have been frozen at about one second. The new helper
  waits for the end-seek to finish, has a time limit, and cleans up.
- `recorder.js` `inspect()` fully decodes the recording for its real length. If
  the player cannot show that full length, playback switches to a plain WAV
  copy (`wav()`), so the whole recording is heard and can be seeked. The stored
  original is never modified.
- The teacher sees "Recording length: m:ss · the student recorded for m:ss".
  A clip under 3 seconds is labelled as recorded that short, not cut off.
- A student whose take is under 2 seconds is told so before sending.

Not verified: Safari / iPad playback (no device available here).

### Staging accounts: what the center needs

The server (`backend/kriah-staging/service.cjs`) accepts an account only when
all of the following hold. Missing any one gives a 403.

| Who | Needs |
|---|---|
| Student sign-in token | custom claims `b3StudentRole: "student"`, `b3StudentId`, `b3ClassId` |
| Class row `…/classes/{classId}` | id starts `kriah-test-`, `active`, `kriahSynthetic`, `toolGrants["kriah-assessment"]`, `members[studentId].active` |
| Student record | `profile.active` **and** `profile.kriahSynthetic`; an active membership for that class in workspace `b3-2026` |
| Teacher | email/password account on `@funtorahtools-staging.test`, email verified; teacher row `active`, `kriahSynthetic`, `classIds[classId]`. No custom claims. |

Because of the `kriah-test-` rule, the ordinary staging students (TEST-ALEF,
TEST-BEIS…) cannot open the center even though their homepage sign-in carries
the three claims. Sign in on the Kriah page itself with a Kriah test account.

`scripts/kriah-stage-accounts.cjs` checks all of this (read-only by default)
and repairs it with `--apply`: it adds missing claims and Kriah rows, and
creates one demo teacher and one demo student whose generated passwords go to a
private file outside the repository. It never resets a password, never deletes,
and only writes Kriah fixture records.

State found on 2026-11-13 (check mode):

- `student.kriah.et` — complete.
- `student.kriah.wt` — has the claims, but its profile has lost
  `kriahSynthetic`, so the server rejects it.
- `student.kriah.et2` — created by hand with **no claims** and no class rows.
- The passwords of the original four fixture accounts were kept only in a
  temporary Cloud Shell file and are not available locally.

### Alef-Beis adventure design

`magic.css` / `magic.js` (presentation only) add the night-sky hero, the
Alef-Beis Trail of 22 letters plus the five final letters, student "reading
quest" cards, tappable letter tiles for the passage, a large microphone
button, step chips and a short star burst after sending. Every Hebrew container
is `dir="rtl"`: Alef is first on the right, Beis to its left. The old hero
tiles were laid out left-to-right (Alef on the left); that is fixed and covered
by a test. Teacher grading tools are unchanged apart from the theme.
