# Chazara AI Practice (#688)

AI Practice lives **inside the existing Chazara tile**. A teacher marks a Chazara assignment as
**AI Practice**; students record themselves reading the pasuk and saying what it means, and get a
friendly result right away. **Regular Chazara is unchanged and stays the default.** No new homepage tile.

This is **casual practice, not grading**, and it is kept deliberately **simple and lenient**:
it only checks that the child actually said something. It does **not** check the meaning and does
**not** compare what was said with the pasuk. It leans heavily toward passing and only fails a
recording that is clearly silent or clearly gibberish. The child can always try again, with no penalty.

Status: **built and tested with fictional data. Not deployed. Not yet tried on real children's
recordings with the real transcription service.**

## The two-step check

| Step | Where | What it does | If it fails |
|---|---|---|---|
| **1. Instant silence check** | in the browser, right after each pasuk is recorded, **before anything is uploaded** | The recording must be at least **2 seconds** long, and the microphone must have picked up sound: a peak level of at least ~-36 dBFS and at least **0.4 s** of sound in total. | 🎧 **Couldn't Hear Clearly** — "I couldn't hear you — try again!" Shown instantly. Nothing is sent to the server or OpenAI, nothing is counted, and the child re-records just that pasuk. |
| **2. Transcription check** | server | Each pasuk clip is sent to OpenAI **`gpt-4o-mini-transcribe`** (no language forced: Hebrew, English, Yiddish or a mix). If the transcript contains real words, it passes. | 📖 **Let's Try Again!** — "I couldn't make that out — try again." |

"Real words" (server, `transcript-check.cjs`) means at least two different words of 2+ letters, or one
word of 3+ letters, in any language — after removing filler sounds (um, uh, hmm, la la, blah, boing,
אה…), one syllable repeated ("lalala", "bababa"), and whole transcripts that recognizers are known to
invent from silence or noise ("Thank you.", "Thanks for watching", "[Music]", "תודה רבה"…).
Anything else passes — including a wrong translation or unrelated talking, by design.

## The four results

| Result | Message | When |
|---|---|---|
| 🌟 **Excellent!** (+ confetti) | Excellent job! You read and explained the pasuk beautifully! | every pasuk's transcript has real words |
| 💪 **Almost There!** | Great effort! You're getting closer. Practice a little more and try again! | multi-pasuk only: some pesukim have real words, some don't (tip: "Some pesukim were hard to make out. Try them again!") |
| 📖 **Let's Try Again!** | I couldn't make that out — try again. | no pasuk has real words (empty or gibberish) |
| 🎧 **Couldn't Hear Clearly** | I couldn't hear you — try again! | step 1: too short or silent (instant, in the browser) |

If OpenAI is unreachable, the child sees "The checker needs a short break" with a **Check Again**
button; that attempt is not counted. No coins/points are requested, no audio is saved, and the
result cannot be changed by the browser. Teacher-preview and Guest mode show a sample with a
result picker — nothing is sent.

## What the student sees (chazara/index.html)

1. In the Chazara chart, a **🤖 AI Practice** panel lists AI assignments for the student's class
   (hidden when there are none). Regular teacher assignments are listed separately as
   **"📋 Chazara from your teacher — Teacher listens"**.
2. Tap a card → practice screen with the **Hebrew of every assigned pasuk** (nekudos, right-to-left).
3. **🎙️ Start Recording** → read the pasuk, then say what it means. Multi-pasuk: one pasuk at a time,
   **Next Pasuk ➜**, then **✅ Finish Recording**. Live recording dot, timer and volume bars; each pasuk
   stops at 60 s.
4. "Checking your Chazara…" animation → result (step 1 failures appear instantly instead).

## What the teacher sees (chazara/teacher.html)

A **📋 Chazara Assignments & 🤖 AI Practice** panel (below the recordings panel):
- **+ New assignment**: title, sefer, perek, pesukim (≤ 6). Type: **👂 Regular Chazara (default)** or **🤖 AI Practice**.
- **📖 Load the pesukim text** fills the Hebrew from Sefaria (shown to students only; not used for checking).
- Badges, Edit, Hide/Show, and simple completion for AI assignments ("N of M reached Excellent ·
  K practiced", per-student tries and latest result). "Practice information only — not a grade."

## Code

```
chazara/ai-practice-check.js   step 1 — instant silence check (browser; also used by tests/scripts)
chazara/ai-practice.js         student panel, recorder, level meter, results
chazara/ai-practice-teacher.js teacher panel
backend/functions/chazara-ai/
  http.cjs              CORS, size limits, sign-in, multipart
  service.cjs           auth + class scope, one-at-a-time lock, duplicate replay, caps, usage totals
  pipeline.cjs          step 2 orchestration (one transcription per pasuk clip)
  providers.cjs         OpenAI gpt-4o-mini-transcribe (plain HTTPS, no SDK)
  transcript-check.cjs  "real words?" rule
  decide.cjs            the four results and their messages
backend/functions/chazara-ai-practice.js   production function (secret OPENAI_API_KEY)
backend/chazara-ai-staging/                staging-only copy (project-guarded)
```

The model can be changed without a code edit with `CHAZARA_AI_TRANSCRIBE_MODEL`.

## Security, privacy and limits

- **No database or storage rule changes.** All data is under `b3Private/chazaraAiPractice/…`,
  which the existing rules already deny to every browser. Regular Chazara paths
  (`posukPractice/chazara/**`, events, recordings, Student Rewards) are never read or written.
- Students: Firebase ID token checked with the existing `authorizePracticeStudent`; only their own
  class's assignments. Teachers: verified Google sign-in, assigned to the class (or owner/admin).
- **Privacy change to note:** recordings that pass step 1 are **sent to OpenAI** for transcription.
  Under OpenAI's API terms, API audio is not used to train models by default, but OpenAI may keep
  it for up to 30 days for abuse monitoring (unless the account has Zero Data Retention). Please
  confirm this fits the school's privacy/parent-consent expectations before turning it on for
  students. Silent clips stopped in step 1 never leave the device.
- Nothing is stored except attempt summaries: attempts, last result, first-Excellent time. No audio
  and no transcript is saved. Monthly totals (no student data): checks, results, audio seconds, time.
- Limits: 1.5 MB per pasuk clip, 6 MB total, ≤ 6 pesukim, ≤ 60 s per pasuk, audio types only. One
  check at a time per student (+4 s cooldown); a repeated request id replays the saved result
  (no second charge); failed checks are not counted and can be retried.
- Caps (adjustable in `b3Private/chazaraAiPractice/config/limits`): 20/minute, 150/day,
  1500/month, 15 per student per day, 120 per class per day.
- **Off switch:** nothing is checked until the owner sets `b3Private/chazaraAiPractice/config/enabled = true`.

## Expected cost

OpenAI `gpt-4o-mini-transcribe` is about **$0.003 per minute of audio** (OpenAI's published
estimate; it is billed by audio tokens, so check the actual usage page). Step 1 is free and runs
on the child's device, so silent or too-short recordings cost **nothing**. The Cloud Function is tiny
(256 MiB, a few seconds per check) and stays inside the Firebase free tier for this volume.

| | Audio sent | Cost per check |
|---|---|---|
| Silent / too short (stopped in the browser) | none | **$0** |
| 1 pasuk (~30 s) | 0.5 min | **≈ $0.0015** |
| 3 pesukim (~90 s) | 1.5 min | **≈ $0.0045** |
| Largest possible (6 pesukim × 60 s) | 6 min | ≈ $0.018 |

- **Example class:** 25 boys × 2 attempts/day × 1 pasuk ≈ 1,000 checks per school month
  ≈ **$1.50/month** (about $3/month if every boy also retries once).
- **Default cap** (1,500 checks/month): ≈ $2.25 for one-pasuk checks, ≈ $7 for three-pasuk checks;
  ≈ $27 is the absolute ceiling (every check at the 6-pasuk × 60 s maximum).
- Set a **monthly budget limit on the OpenAI project** as a hard stop in addition to these caps.
- The owner can read actual monthly totals with the `usageReport` action (checks, results, audio
  seconds, estimated cost per check, average time).

Earlier designs for comparison: Google Speech-to-Text + Claude ≈ $0.025–0.07 per attempt; local
Whisper ≈ $0.001 of compute but slow (15–25 s per pasuk) and large to deploy.

## Tests

- `node --test tests/chazara-ai-practice.test.cjs` — 33 tests, fictional data, **fake transcriber**
  (no paid calls): silence-check thresholds (speech passes; silence, quiet room, clicks and short
  clips stop; noise, soft voices and unmeasured recordings pass on); real-words rule (real words in
  any language pass; empty, filler, repeated syllables and known inventions fail); all four results
  incl. multi-pasuk Almost There; gentle, non-technical messages; one transcription per clip; cost
  figures; the OpenAI request (model, multipart file, key from the secret, no language forced,
  error handling); service failure → "short break", not counted; cut-off/oversized/wrong-type
  uploads; retries and duplicate replay; unauthorized and cross-class access; caps and off switch;
  privacy (nothing stored, regular Chazara untouched); no Anthropic/Google/Whisper dependency;
  no rules change.
- Existing Chazara tests (`chazara-recording-save`, `chazara-teacher-scope`, `chazara-owner-self-heal`) pass.
- `node tests/chazara-ai-browser.cjs` — 13 checks in Chromium with a fake microphone and a mocked
  server, including an early "Finish" (instant Couldn't Hear Clearly, **no request sent**, retry the
  same pasuk) and a **silent fake microphone** run (stopped instantly in the browser, nothing sent).
- `bash scripts/chazara-ai-make-signal-set.sh DIR && node scripts/chazara-ai-audio-eval.cjs DIR/manifest.json --silence-only`
  — the browser's silence check applied to **real decoded audio files** (synthetic voice + noise):
  **11/11 as expected** (all clips with sound sent on, incl. a very quiet voice and loud noise;
  silence, a quiet room, a 1-second clip and a multi-pasuk set with one silent pasuk stopped).
- CI: `.github/workflows/chazara-ai-practice.yml`.

**Not tested yet:** real transcription by OpenAI (no API key in the development environment) and
real children's voices.

## Real-audio check (recommended before students use it)

```
OPENAI_API_KEY=... node scripts/chazara-ai-audio-eval.cjs manifest.json --full --out report.json
```

Costs about $0.003 per audio minute (a 40-clip set is well under $0.25). Reports each case's result
against the expected one, clips wrongly stopped by the silence check, unexpected Excellents, average
time and cost, with the transcripts. Use authorised recordings only (adults or older children
imitating children, or children with parental consent): quiet readers, Ashkenazi reading, English
and Yiddish explanations, silly sounds, silence and a noisy room. Keep recordings and the manifest
out of git. Tune `LIMITS` in `chazara/ai-practice-check.js` or the word rule in
`transcript-check.cjs` from the results.

## Known limitations

- A very soft-spoken child far from the microphone could be stopped by step 1; the thresholds are
  set low, and the child just tries again.
- Transcription services sometimes "hear" words in noise; with this lenient rule a noisy room may
  get Excellent.
- Unrelated talking, a wrong translation, or reading a different pasuk all count as real words and
  get Excellent — the check only confirms the child said something.
- Whether `gpt-4o-mini-transcribe` turns children's Hebrew/Yiddish into words reliably is unmeasured
  (it only needs *some* words to pass, which makes this less critical).

## Owner steps to try it on staging (nothing here is done automatically)

1. Create an OpenAI API key in a project with a monthly budget limit.
2. Store it for staging: `firebase functions:secrets:set OPENAI_API_KEY --project fun-torah-tools-staging`.
3. From a reviewed checkout of this PR branch:
   `cd backend/chazara-ai-staging && npm install && cd ../..`
   `firebase deploy --only functions --config firebase.chazara-ai-staging.json --project fun-torah-tools-staging`
4. Build and publish a preview channel of the staging site (the staging packager rewrites the
   function URL to staging):
   `node staging/package-site.cjs . staging-build`
   `firebase hosting:channel:deploy chazara-ai --config firebase.staging.json --project fun-torah-tools-staging`
5. Turn it on (staging DB only): set `b3Private/chazaraAiPractice/config/enabled` to `true`.
6. With the fictional staging teacher, create an AI Practice assignment; with a fictional student, practice.

Production later needs: owner approval, the same secret in `b3-games`
(`firebase functions:secrets:set OPENAI_API_KEY --project b3-games`),
`firebase deploy --only functions:chazaraAiPractice`, merging the frontend, and setting the
production `enabled` flag. Rollback: set `enabled` to `false` (instant, no deploy).
