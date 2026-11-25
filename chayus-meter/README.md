# Chayus Meter (#802) — pages-only version

**Status: on the ET and WT Davening pages on branch `feat/chayus-meter-pages-only`. Not merged, not deployed.**

A boy may turn on his microphone during davening and see that he is davening **steadily**. It never rewards loudness. This version runs entirely in the page: no server, no database, no network requests.

## What the boy sees (`panel.js`)

- The microphone is **off** until he clicks "Turn on My Chayus Meter". The browser asks permission every time.
- A flame inside a ring. It is driven only by "is a voice heard" and "how steadily over about the last quarter minute" (`meter.live()` in `core.js`). Loudness is not an input, so a quiet voice and a shout draw the same picture. Very loud input only shows "A comfortable voice is perfect. No need to be loud."
- No score or percentage is ever shown to the boy.
- A short word of encouragement about every 2.5 minutes of measured davening.
- **Pause**, **Resume** and **Turn microphone off** at any time. Hiding the tab or a disconnected microphone pauses the meter. Turning it off starts completely fresh next time.
- Denied or missing microphone: the meter stays off, davening works as normal.

## Privacy

Sound goes only into a local analyser. There is no recorder, no peer connection, no socket and no `fetch` in `panel.js` (a test enforces this). Nothing is saved to the browser either. Raw audio and transcripts do not exist beyond the current instant.

## Independent of Chazzan

The panel shares no state, audio or microphone with the player or with any Chazzan feature. It is added after `<main>` and does not touch the page's own scripts. Chazzan (#799) is not on main yet; when it lands, Chayus needs no change.

## Not built yet (second step, needs the owner's OK)

**Teacher summary per boy.** Each boy's numbers stay on his own computer, so nothing reaches the teacher yet. `teacher-preview.html` shows the intended layout with fictional names only. Delivering real summaries needs a server piece (signed-in student identity, class isolation, bounded aggregate storage, retention), as in closed draft PR #800. That is high risk and is deliberately not part of this change. No points are ever automatic; the teacher decides in Student Rewards.

## Files

- `core.js` — the meter engine: room-noise calibration, yes/no voice activity, steadiness, pauses, summary numbers, and `teacherRows` for the future teacher view.
- `panel.js` — the student panel mounted on both Davening pages.
- `teacher-preview.html` — fictional layout preview of the future teacher summary.

## Tests

- `node --test tests/chayus-meter.test.cjs` — meter logic, plus a check that `panel.js` makes no network or recording calls and both pages load it.
- `e2e/chayus-panel.spec.cjs` (Playwright, Chromium) — runs the real ET and WT pages with a generated speech-like tone as the microphone: click-to-start, quiet vs. loud look the same, pause/resume/off release the microphone with no network calls, denied or missing microphone, and encouragement at about 2.5 minutes.

**Not verified:** a real microphone on real school computers. In particular, davening audio playing from the speakers may be picked up as voice; the browser's echo cancellation is on, but this needs a real-room check.
