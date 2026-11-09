# Chazara AI Practice (#688)

AI Practice lives **inside the existing Chazara tile**. A teacher marks a Chazara assignment as
**AI Practice**; students record the reading + translation and get one of four kid-friendly results
right away. **Regular Chazara is unchanged and stays the default.** No new homepage tile.

Status: **built and tested with fictional data. Not deployed. Not yet validated on real children's
recordings — do not treat it as reliable until that is done (see "Real-audio validation").**

## What the student sees (chazara/index.html)

1. In the Chazara chart, a new **🤖 AI Practice** panel lists AI assignments for the student's class
   (the panel is hidden when the class has none, so nothing changes for other classes).
   Regular teacher assignments are listed separately as **"📋 Chazara from your teacher — Teacher listens"**.
2. Tap a card → practice screen with the **Hebrew of every assigned pasuk** (nekudos, right-to-left).
3. **🎙️ Start Recording** → read the pasuk, then say what it means (English, Yiddish or mixed).
   Multi-pasuk: one pasuk at a time, **Next Pasuk ➜**, then **✅ Finish Recording** on the last.
   Live recording dot, timer and volume bars; "Keep going!" if they press too early (< 3 s);
   each pasuk stops at 60 s.
4. "Checking your Chazara…" animation → result:

| Outcome | Message | When |
|---|---|---|
| 🌟 **Excellent!** (+ confetti) | Excellent job! You read and explained the pasuk beautifully! | every pasuk: clear audio, strong Hebrew reading (confirmed by a 2nd recognition pass) **and** strong meaning |
| 💪 **Almost There!** | Great effort! You're getting closer. Practice a little more and try again! | a real attempt with significant mistakes or missing content (e.g. read but no translation, translation but no reading, a pasuk skipped) |
| 📖 **Let's Try Again!** | Let's try again! Remember to read the pasuk and explain what it means. | mostly wrong, wrong pasuk, unrelated talk, gibberish, far too short |
| 🎧 **Couldn't Hear Clearly** | I couldn't hear you clearly. Please try recording again! | silence/mic problem, loud background, distorted audio, or recognition too unsure to judge |

Plus at most one or two safe tips ("Next time, explain what the pasuk means too.").
It never claims a specific word was mispronounced. Retry is unlimited (within the daily cap).
No coins/points are requested, no audio is saved, and the result cannot be changed by the browser.
Teacher-preview and Guest mode show a sample with a result picker — nothing is sent.

## What the teacher sees (chazara/teacher.html)

A new **📋 Chazara Assignments & 🤖 AI Practice** panel (below the recordings panel; the rest of
the page is untouched):
- **+ New assignment**: title, sefer, perek, pesukim (≤ 6). Type: **👂 Regular Chazara (default)** or **🤖 AI Practice**.
- **📖 Load the pesukim text** fills the Hebrew (Sefaria, ה׳ abbreviated, same source as Posuk Practice)
  and, for AI Practice, a *suggested* English meaning (Kehot). The teacher edits/approves the
  **Approved meaning (English or Yiddish)** — this is the answer key. AI mode requires ticking
  "I checked the Hebrew text and the meanings".
- Each assignment shows a **🤖 AI Practice** or **👂 Regular — you review** badge, Edit, Hide/Show.
- AI assignments show simple completion: "N of M students reached Excellent · K practiced", and
  per student: tries, latest result in words, reached Excellent ✓. Labelled "Practice information
  only — not a grade". No percentages.

## Architecture

```
browser (chazara/ai-practice.js)                       Cloud Function chazaraAiPractice
  record 1 clip per pasuk  ── multipart + ID token ──▶  http.cjs   CORS, size limits, sign-in
                                                         service.cjs auth + class scope, answer key from DB,
                                                                     one-at-a-time lock, replay, rate caps
                                                         pipeline.cjs
                                                          1 audio-signal.cjs  ffmpeg → PCM; silence/noise/short/clipping
                                                          2 providers.cjs     Google STT: Hebrew (boosted) + English;
                                                                              Hebrew again UNBOOSTED only if step 3 says "strong"
                                                          3 hebrew-match.cjs  deterministic, accent-tolerant, in-order runs
                                                          4 meaning-judge.cjs Claude vs TEACHER-APPROVED meaning (JSON schema)
                                                          5 decide.cjs        fixed rules → 4 outcomes + fixed messages
```

- **Reusable**: `pipeline.cjs` only needs `{id, label, hebrew, meaning}` items and one audio clip
  each, with injected providers. Nothing in it knows about Chazara or Firebase.
- **Why these services**: Posuk Practice already uses Google Speech-to-Text and Claude with an
  existing `ANTHROPIC_API_KEY` secret, so no new vendor/account is needed. Claude cannot take
  audio, so recognition is done by Google. **Google STT v1 has no Yiddish model**; Yiddish is
  expected to come through the Hebrew-script pass (and partly the English pass) and is judged for
  meaning by Claude. That is a known accuracy risk to measure (below). Alternatives if real-audio
  results are poor: OpenAI `gpt-4o-transcribe`/Whisper (has Yiddish, children untested) or Google
  Chirp (v2). Both need owner approval and a new key/billing; the provider interface makes the swap
  a one-file change.
- **Conservative by design** (fewer false "Excellent"s):
  - the boosted Hebrew pass must be **confirmed by an unboosted pass** before reading counts as strong;
  - Hebrew coverage counts only words heard **in order, in runs** — another pasuk sharing a few
    words (וירא, פתח האהל) scores low;
  - "strong meaning" also needs enough spoken words beyond the Hebrew (blocks keyword-only answers);
  - transcripts are treated as data (prompt-injection text in a recording cannot instruct the judge);
  - any uncertainty → "Couldn't Hear Clearly", never "Let's Try Again".

## Security, privacy and cost controls

- **No database or storage rule changes.** All data is under `b3Private/chazaraAiPractice/…`,
  which the existing rules already deny to every browser. Regular Chazara paths
  (`posukPractice/chazara/**`, events, recordings, Student Rewards) are never read or written.
- Students: Firebase ID token with `b3StudentId`/`b3ClassId` claims, checked with the existing
  `authorizePracticeStudent` (active student, active membership, class active, Chazara allowed).
  Students only see their own class's assignments, and **never the approved meaning**.
- Teachers: verified Google sign-in; must be assigned to the class (or owner/admin); Chazara must be
  enabled for the class (ET/WT legacy classes exempt, as elsewhere).
- Answer key and results are server-side only; extra fields from the browser are ignored.
- **Audio and transcripts are not stored.** Audio exists only in memory during the check. Stored
  per student: attempts, last outcome, first-Excellent time. Monthly totals (no student data) for cost.
- Limits: 1.5 MB per pasuk clip, 6 MB total, ≤ 6 pesukim, ≤ 60 s per pasuk, audio types only.
  One check at a time per student (+4 s cooldown); a repeated request id replays the saved result
  without new charges; failed checks are not counted and can be retried.
- Caps (shared counter, adjustable in `b3Private/chazaraAiPractice/config/limits`):
  20/minute, **150/day, 1500/month**, 15 per student per day, 120 per class per day.
- **Off switch:** nothing is checked (and nothing billed) until the owner sets
  `b3Private/chazaraAiPractice/config/enabled = true`.

## Expected cost (list prices — verify in the Google Cloud and Anthropic consoles)

| Part | Price used | Typical 1-pasuk attempt (~30 s) |
|---|---|---|
| Google Speech-to-Text v1 | ~$0.024 / audio-minute per pass (≈$0.016 with data logging) | 2–3 passes × 30 s ≈ **$0.024–0.036** |
| Claude `claude-opus-5-5` (effort medium) | $4 / $20 per million tokens in/out | ~1.5k in + ~0.3–1.5k out ≈ **$0.01–0.035** |
| Cloud Function (1 GiB, ~5–10 s) | Firebase Blaze | < $0.001 |
| **Total** | | **≈ $0.04–0.07 per single-pasuk attempt** (3 pesukim ≈ $0.10–0.18) |

Example: 25 boys × 2 attempts/day × 1 pasuk ≈ $2–3.50/day ≈ $40–70 per school month.
The default monthly cap (1500 checks) bounds the worst case at roughly **$60–110/month**.
Silence/too-short recordings are rejected before any paid call. The owner can read actual
monthly totals with the `usageReport` action (evaluations, outcomes, speech seconds, tokens,
estimated cost per evaluation, average time).

## Tests

- `node --test tests/chazara-ai-practice.test.cjs` — 46 tests, fictional data, **fake providers**
  (no paid calls). Covers the 22 required scenarios: correct/minor errors/alt wording/English/
  Yiddish/mixed → Excellent; major mistakes, wrong pasuk, wrong translation, reading-only,
  translation-only, missing pasuk, unrelated talk, gibberish, silence, noise, very short, unclear
  transcription, API errors/timeouts/interrupted uploads, retries/replay, unauthorized and
  cross-class access, rate limits/duplicates/off switch — plus privacy (nothing stored, regular
  Chazara untouched) and the no-rules-change guarantee.
- `node tests/chazara-ai-browser.cjs` — Chromium with a fake microphone and a mocked checker:
  panel, RTL Hebrew for every pasuk, keyboard start, recording indicator, multi-pasuk steps,
  checking animation, Almost/Excellent, retry, close, phone layout, teacher panel and editor.
  Screenshots in `test-results/chazara-ai/`.
- `bash scripts/chazara-ai-make-signal-set.sh DIR && node scripts/chazara-ai-audio-eval.cjs DIR/manifest.json --signal-only`
  — step 1 (audio validity) on **real decoded audio files** made with a synthetic voice + noise:
  **10/10 classified as expected** (clean, soft and moderate background → ok; loud background,
  clipping, noise-only → noisy; silence and quiet room → silent; 1-second clip → too short).
- CI: `.github/workflows/chazara-ai-practice.yml` runs all of the above on PRs touching Chazara.

**What the fake-provider tests prove:** the decision rules, security and limits. **What they do not
prove:** that Google recognises children's Hebrew/Yiddish well enough. That needs real audio.

## Real-audio validation (required before calling it reliable)

Not done yet: this cloud session has no Google Cloud credentials, and no authorised children's
recordings exist in the repo. The harness is ready:

```
node scripts/chazara-ai-audio-eval.cjs manifest.json --paid --out report.json
```

It reports false approvals (incorrect → Excellent), false rejections (correct → Almost/Try again),
uncertain results, average time and cost per evaluation, with per-pasuk diagnostics.

Suggested set (≈ 60–80 clips, ~$5 total): recorded with parental consent or by adults/older
children imitating children, on school devices, in a classroom-like room. Per pasuk (e.g. Bereishis
18:1–3): correct reading + English; + Yiddish; + mixed; correct with 2–3 slips; Ashkenazi vs Israeli
pronunciation; reading only; translation only; many mistakes; wrong pasuk; unrelated chat; silly
sounds; whispering; background chatter; one pasuk skipped in a 3-pasuk set. Keep recordings and the
manifest out of git.

Suggested go-live bar: **false approvals ≤ 2%** and false rejections ≤ 15% on that set, with
"Couldn't hear" under ~15%. Tune thresholds in `decide.cjs` (`readingStrong`, `corroborate`) and
`audio-signal.cjs` only from measured results.

## Known limitations

- Recognition of children's Ashkenazi Hebrew and Yiddish by Google STT is **unmeasured**. Likely
  failure mode is false "Almost/Couldn't hear" for correct readers (safe direction), not false praise.
- Yiddish has no dedicated recognizer here; meaning judgement for Yiddish depends on how it comes
  through the Hebrew-script/English passes.
- Audio checks use simple level/SNR measures; a constant hum the child talks over loudly may pass,
  and a child who speaks with no pauses at all may look "noisy".
- Hebrew text comes from Sefaria (Kehot meaning as a suggestion) and must be checked by the teacher.
- Teacher completion info appears only for AI assignments; regular assignments created here are
  informational for students (they still do the Chazara in the chart as before).

## Owner steps to try it on staging (nothing here is done automatically)

1. Approve the paid services (Google Speech-to-Text + Claude) for **staging** and set a budget alert.
2. In project `fun-torah-tools-staging`: enable the **Cloud Speech-to-Text API**, and add the
   secret: `firebase functions:secrets:set ANTHROPIC_API_KEY --project fun-torah-tools-staging`.
3. From a reviewed checkout of this PR branch:
   `cd backend/chazara-ai-staging && npm install && cd ../..`
   `firebase deploy --only functions --config firebase.chazara-ai-staging.json --project fun-torah-tools-staging`
4. Build and publish a preview channel of the staging site (existing staging packaging rewrites the
   function URL to staging):
   `node staging/package-site.cjs . staging-build`
   `firebase hosting:channel:deploy chazara-ai --config firebase.staging.json --project fun-torah-tools-staging`
5. Turn it on (staging DB only): set `b3Private/chazaraAiPractice/config/enabled` to `true` in the
   staging Realtime Database console.
6. With the fictional staging teacher, create an AI Practice assignment; with a fictional student, practice.

Production later needs: owner approval, `firebase deploy --only functions:chazaraAiPractice`
(the secret and Speech API already exist in `b3-games`), merging the frontend, and setting the
production `enabled` flag. Rollback: set `enabled` to `false` (instant, no deploy).
