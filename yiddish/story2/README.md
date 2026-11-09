# Yiddish Story 2

The second Yiddish story. It uses the same reader layout as the Wine Merchant
(`../story.html`): audio player with speed and "Back 10 sec", large right-to-left
text, the paragraph and word being read light up, and a picture panel.

Students see a **Story 2** button in the Story Corner on the Yiddish page
(`../index.html`) only after `story.js` has text in it.

This is read-along only. Story 2 has no practice words, progress or teacher
unlock steps yet. Those are run by the Yiddish backend, which only knows the
Wine Merchant story (see issue #611).

## Current story: Living Dream (the Sultan story)

Text, word timings and picture placement come from the Living Dream read-along
(`living-dream.html`, Oct 30 2026). Audio is the Nov 8 2026 `living-dream.mp3`,
re-encoded to 64 kbps mono like the Wine Merchant audio. Pictures are the newest
set (including the Oct 31 redo of scenes 8 and 13–16).

Clean-up of the source text: a stray backslash before 39 quote marks was removed
(`תשמ\"ח` → `תשמ"ח`), and 12 words that had run together in paragraph 2 were split
(for example `צוריקאיז` → `צוריק איז`, `געגאַנגעןאון` → `געגאַנגען און`), each word's
time divided between the two halves by letter count.

About two thirds of the word timings were estimated in the original read-along, so
word highlighting is close but not exact. Paragraph and picture changes use each
paragraph's first word and are more reliable.

## Adding the story

| What | Where |
| --- | --- |
| Audio | Save it here as `audio.mp3`. After replacing it later, change `audio: 'audio.mp3'` in `story.js` to `'audio.mp3?v=2'` so browsers load the new file. |
| Title, credit | `title`, `titleYi`, `credit`, `blurb` in `story.js` |
| Yiddish text | `paras` in `story.js`, one string per paragraph, original wording |
| English intro (optional) | `intro` in `story.js` |
| Paragraph timings (optional) | `times` in `story.js`: `{"0": 1.2, "1": 20.8, ...}`, seconds where each paragraph starts in the audio. Turns on "follow the audio" and click-to-play. |
| Word timings (optional) | `word-times.js`, same format as `../word-times.js` but counting paragraphs from 0 in `paras` |
| Pictures | Image files go in the `pictures/` folder here and are listed in `pictures` in `story.js`: `{src: 'pictures/01.jpg', at: 75.8, para: 1, caption: '...'}`. `at` is the second in the audio when the picture appears (it can change in the middle of a paragraph); `para` is the paragraph it belongs to. If no picture has `at`, pictures change by paragraph instead. With no pictures the panel says "Pictures coming soon". |

After changing `story.js`, bump `story.js?v=1` in both `index.html` (this folder)
and `../index.html` so students get the new version.
