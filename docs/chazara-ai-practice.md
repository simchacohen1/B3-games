# Chazara AI Practice (#688)

AI Practice lives **inside the existing Chazara tile**. A teacher marks a Chazara assignment as
**AI Practice**; students record themselves reading the pasuk and then translating it, and get
one of four kid-friendly results right away. **Regular Chazara is unchanged and stays the default.**
No new homepage tile.

This is **casual practice, not grading**, and it is deliberately **lenient**. It checks only two
things: that the child read something like the assigned pasuk, and that he said something after
it. It does **not** judge whether the translation is correct, and it uses **no paid AI service**:
speech is recognised by a free, open-source Whisper model running inside the Cloud Function.

Status: **built and tested with fictional data. Not deployed. Not yet tried on real children's
recordings** (see "Real-audio check").

## What the student sees (chazara/index.html)

1. In the Chazara chart, a **🤖 AI Practice** panel lists AI assignments for the student's class
   (hidden when there are none). Regular teacher assignments are listed separately as
   **"📋 Chazara from your teacher — Teacher listens"**.
2. Tap a card → practice screen with the **Hebrew of every assigned pasuk** (nekudos, right-to-left).
3. **🎙️ Start Recording** → read the pasuk, then say what it means (English, Yiddish or mixed).
   Multi-pasuk: one pasuk at a time, **Next Pasuk ➜**, then **✅ Finish Recording**.
   Live recording dot, timer and volume bars; "Keep going!" if pressed too early (< 3 s);
   each pasuk stops at 60 s.
4. "Checking your Chazara…" animation → result:

| Outcome | Message | When |
|---|---|---|
| 🌟 **Excellent!** (+ confetti) | Excellent job! You read and explained the pasuk beautifully! | every pasuk: the Hebrew roughly matched **and** at least 3 more words were said after it |
| 💪 **Almost There!** | Great effort! You're getting closer. Practice a little more and try again! | only one part: read but said nothing after it, or (multi-pasuk) some pesukim done and some skipped |
| 📖 **Let's Try Again!** | Let's try again! Remember to read the pasuk and explain what it means. | silence, gibberish, unrelated talking, a different pasuk, far too short — i.e. no reading of this pasuk heard |
| 🎧 **Couldn't Hear Clearly** | I couldn't hear you clearly. Please try recording again! | bad audio: loud background noise or distortion, or a clear voice the recognizer could not turn into words |

Plus one short tip (e.g. "After you read the pasuk, say what it means."). It never claims a
specific word was wrong. Retry is unlimited (within the daily cap). No coins/points are requested,
no audio is saved, and the result cannot be changed by the browser. Teacher-preview and Guest
mode show a sample with a result picker — nothing is sent.

## What the teacher sees (chazara/teacher.html)

A **📋 Chazara Assignments & 🤖 AI Practice** panel (below the recordings panel):
- **+ New assignment**: title, sefer, perek, pesukim (≤ 6). Type: **👂 Regular Chazara (default)** or **🤖 AI Practice**.
- **📖 Load the pesukim text** fills the Hebrew from Sefaria (ה׳ abbreviated, same source as
  Posuk Practice). The teacher checks it and ticks "I checked the Hebrew text". There is **no
  meaning/translation field** — translations are not checked.
- Each assignment shows a **🤖 AI Practice** or **👂 Regular — you review** badge, Edit, Hide/Show.
- AI assignments show simple completion: "N of M students reached Excellent · K practiced", and
  per student: tries, latest result in words, reached Excellent ✓. "Practice information only —
  not a grade." No percentages.

## How a recording is checked

```
browser (chazara/ai-practice.js)                       Cloud Function chazaraAiPractice
  record 1 clip per pasuk  ── multipart + ID token ──▶  http.cjs     CORS, size limits, sign-in
                                                         service.cjs  auth + class scope, pasuk text from DB,
                                                                      one-at-a-time lock, replay, caps
                                                         pipeline.cjs
                                                          1 audio-signal.cjs  ffmpeg → PCM; silence/noise/short/clipping
                                                          2 providers.cjs     ONE local Whisper pass, language = Hebrew
                                                          3 hebrew-match.cjs  reading: Hebrew words heard in order vs the pasuk
                                                          4 hebrew-match.cjs  translation attempt: words heard AFTER the reading
                                                          5 decide.cjs        fixed rules → 4 outcomes + fixed messages
```

- **Reading check:** the existing accent-tolerant word matcher (nekudos ignored, Ashkenazi/Israeli
  sound-alikes accepted, split/merged words allowed). The reading "roughly matches" when at least
  **30%** of the pasuk's words are heard in order, in runs (`THRESHOLDS.reading` in `decide.cjs`).
  Another pasuk that shares a few common words does not reach this.
- **Translation check:** at least **3 words** (any language, any script) heard **after the last
  matched pasuk word** (`THRESHOLDS.extraWords`). What the words mean is not checked. Whisper is run
  in Hebrew mode, so an English or Yiddish translation usually comes out in Hebrew letters, Latin
  letters or a mix — all count.
- **Whisper model:** `Xenova/whisper-small` (multilingual, Hebrew/Yiddish capable), 8-bit quantised,
  via transformers.js + ONNX Runtime on the function's CPU. Downloaded from Hugging Face once per
  function instance (~250 MB) and kept in memory. Change it without a code edit with
  `CHAZARA_AI_WHISPER_MODEL` (e.g. `Xenova/whisper-base`: faster, weaker Hebrew) and
  `CHAZARA_AI_WHISPER_DTYPE`. Known Whisper "silence hallucinations" (e.g. "תודה רבה",
  "Thanks for watching") are stripped.
- **Reusable:** `pipeline.cjs` only needs `{id, label, hebrew}` items and one audio clip each, with
  injected providers. Nothing in it knows about Chazara or Firebase.

## Security, privacy and limits

- **No database or storage rule changes.** All data is under `b3Private/chazaraAiPractice/…`,
  which the existing rules already deny to every browser. Regular Chazara paths
  (`posukPractice/chazara/**`, events, recordings, Student Rewards) are never read or written.
- Students: Firebase ID token checked with the existing `authorizePracticeStudent` (active student,
  active membership, class active, Chazara allowed); only their own class's assignments.
  Teachers: verified Google sign-in, assigned to the class (or owner/admin), Chazara enabled.
- The pasuk text and the result are server-side only; extra fields from the browser are ignored.
- **Audio and transcripts are not stored, and audio never leaves Google Cloud** (no third-party
  speech or AI service). Stored per student: attempts, last outcome, first-Excellent time.
  Monthly totals (no student data): checks, outcomes, audio seconds, processing time.
- **No API keys or secrets** are needed by this function.
- Limits: 1.5 MB per pasuk clip, 6 MB total, ≤ 6 pesukim, ≤ 60 s per pasuk, audio types only. One
  check at a time per student (+4 s cooldown); a repeated request id replays the saved result; failed
  checks are not counted and can be retried.
- Caps (adjustable in `b3Private/chazaraAiPractice/config/limits`): 20/minute, 150/day,
  1500/month, 15 per student per day, 120 per class per day. They now protect server time, not an AI bill.
- **Off switch:** nothing is checked until the owner sets `b3Private/chazaraAiPractice/config/enabled = true`.

## Expected cost

There is **no per-attempt fee** (no Google Speech-to-Text, no Claude). The only cost is the Cloud
Function's own compute while Whisper runs (Cloud Functions 2nd gen tier-1 list prices:
$0.000024 per vCPU-second, $0.0000025 per GiB-second; the function uses 2 vCPU + 4 GiB, so
≈ **$0.000058 per second of checking**).

| | 1 pasuk (~30 s audio) | 3 pesukim (~90 s audio) |
|---|---|---|
| Whisper time (estimate, **not yet measured**) | ~15–25 s | ~40–70 s |
| Compute before free tier | **≈ $0.001–0.0015** | **≈ $0.0025–0.004** |
| AI/API fees | $0 | $0 |

- **Free tier:** each Google billing account gets 180,000 vCPU-seconds and 360,000 GiB-seconds per
  month, shared with the project's other functions. That is enough for roughly **4,000–6,000
  one-pasuk checks a month** if nothing else used it.
- **Example class:** 25 boys × 2 attempts/day × 1 pasuk ≈ 1,000 checks/month ≈ 20,000 s ≈
  **$0 inside the free tier, about $1–1.50/month if the free tier is already used up** by other functions.
- **Worst case at the default cap** (1,500 checks/month): ≈ $1.50–2.25 (single-pasuk) or
  ≈ $4–6 (all 3-pasuk), before the free tier.
- **Other small costs:** each new function instance downloads and loads the model (a "cold start",
  roughly 30–90 s, ≈ $0.005 each); the larger container image (~1 GB, mostly ONNX Runtime) costs
  about $0.10/month in Artifact Registry storage. Hugging Face downloads are free.
- Previous design for comparison: Google Speech-to-Text + Claude Opus/Haiku ≈ $0.025–0.07 per attempt.

The owner can read actual monthly totals with the `usageReport` action (checks, outcomes, audio
seconds, average time, estimated compute cost).

## Trade-offs of the lenient, free design

- **Speed:** Whisper on CPU is slower than a paid recognizer. Expect roughly 15–25 s of "Checking…"
  per pasuk, and up to a minute or two extra for the first student after the function has been idle
  (cold start). Up to 5 checks run at once (one per instance); more students wait their turn.
  `Xenova/whisper-base` is faster if this is too slow.
- **Easy Excellent, by design:** any rough reading followed by a few words earns Excellent — even a
  wrong translation, or silly words after a correct reading.
- **Translation-only, or translating before reading → Let's Try Again,** because the translation
  check only counts words said *after* a recognised reading.
- **Phrase-by-phrase style** (read a few words, translate, read more…) counts only the words after
  the last pasuk word that was recognised; usually the last phrase's translation is enough.

## Tests

- `node --test tests/chazara-ai-practice.test.cjs` — 44 tests, fictional data, **fake Whisper**.
  Covers: reading + English/Yiddish/mixed/any-wording translation → Excellent; minor and many
  reading mistakes; reading only → Almost; translation only, wrong pasuk, unrelated talk, gibberish,
  silence, very short → Try Again; noise and empty recognition → Couldn't Hear; multi-pasuk
  complete/skipped; one Hebrew Whisper pass per pasuk; Whisper provider (loaded once, audio
  conversion, hallucination removal, failed load retried); Whisper failure → "short break" and not
  counted; interrupted/oversized/wrong-type uploads; retries and duplicate replay; unauthorized and
  cross-class access; rate limits and off switch; usage report; privacy (nothing stored, regular
  Chazara untouched); no Anthropic/Google Speech dependency; no rules change.
- Existing Chazara tests (`chazara-recording-save`, `chazara-teacher-scope`, `chazara-owner-self-heal`) pass.
- `node tests/chazara-ai-browser.cjs` — 11 checks in Chromium with a fake microphone and a mocked
  checker: panel, RTL Hebrew, keyboard start, recording indicator, multi-pasuk steps, checking
  animation, results, retry, phone layout, teacher panel and editor (Hebrew only, no meaning field).
- `bash scripts/chazara-ai-make-signal-set.sh DIR && node scripts/chazara-ai-audio-eval.cjs DIR/manifest.json --signal-only`
  — audio check on real decoded audio files (synthetic voice + noise): **10/10 as expected**.
- transformers.js 4.3.2 was installed and imported in Node 22 and exposes the API the provider uses.
  **Whisper itself could not be run in the development sandbox** (Hugging Face downloads are blocked
  there), so recognition speed and accuracy are not measured yet.
- CI: `.github/workflows/chazara-ai-practice.yml`.

## Real-audio check (recommended before students use it)

```
cd backend/functions && npm install && cd ../..
node scripts/chazara-ai-audio-eval.cjs manifest.json --full --out report.json
```

Free: it runs the same local Whisper model on any computer with internet access (first run
downloads the model). It reports outcomes against expectations, false "Excellent"s, false
rejections, "couldn't hear" results, time per check and estimated compute cost, plus per-pasuk
coverage, words-after-reading and transcript. Use 20–40 authorised recordings (adults or older
children imitating children, or children with parental consent), including Ashkenazi reading,
English and Yiddish translations, reading only, silly talk and silence. Keep recordings and the
manifest out of git. Tune `THRESHOLDS` in `decide.cjs` from the results.

## Known limitations

- How well Whisper recognises **children's Ashkenazi Hebrew** is unmeasured. The likely failure is
  a correct reader getting "Almost There", "Let's Try Again" or "Couldn't Hear Clearly", not false praise.
- Whisper can occasionally invent text on noisy audio; noisy clips are filtered out first and known
  phrases are stripped, but not every hallucination can be caught.
- Audio checks use simple level/SNR measures; a child who speaks with no pauses at all may look "noisy".
- The Hebrew text comes from Sefaria and must be checked by the teacher.

## Owner steps to try it on staging (nothing here is done automatically)

1. In project `fun-torah-tools-staging` (already on Blaze for Functions) nothing extra needs to be
   enabled: no Speech-to-Text API and no secrets.
2. From a reviewed checkout of this PR branch:
   `cd backend/chazara-ai-staging && npm install && cd ../..`
   `firebase deploy --only functions --config firebase.chazara-ai-staging.json --project fun-torah-tools-staging`
3. Build and publish a preview channel of the staging site (the staging packager rewrites the
   function URL to staging):
   `node staging/package-site.cjs . staging-build`
   `firebase hosting:channel:deploy chazara-ai --config firebase.staging.json --project fun-torah-tools-staging`
4. Turn it on (staging DB only): set `b3Private/chazaraAiPractice/config/enabled` to `true`.
5. With the fictional staging teacher, create an AI Practice assignment; with a fictional student,
   practice. The first check after deploy is slow (model download).

Production later needs: owner approval, `firebase deploy --only functions:chazaraAiPractice`,
merging the frontend, and setting the production `enabled` flag. Rollback: set `enabled` to
`false` (instant, no deploy).
