# Yiddish Story 2

The second Yiddish story. It uses the same reader layout as the Wine Merchant
(`../story.html`): audio player with speed and "Back 10 sec", large right-to-left
text, the paragraph and word being read light up, and a picture panel.

Students see a **Story 2** button in the Story Corner on the Yiddish page
(`../index.html`) only after `story.js` has text in it.

This is read-along only. Story 2 has no practice words, progress or teacher
unlock steps yet. Those are run by the Yiddish backend, which only knows the
Wine Merchant story (see issue #611).

## Adding the story

| What | Where |
| --- | --- |
| Audio | Save it here as `audio.mp3`. After replacing it later, change `audio: 'audio.mp3'` in `story.js` to `'audio.mp3?v=2'` so browsers load the new file. |
| Title, credit | `title`, `titleYi`, `credit`, `blurb` in `story.js` |
| Yiddish text | `paras` in `story.js`, one string per paragraph, original wording |
| English intro (optional) | `intro` in `story.js` |
| Paragraph timings (optional) | `times` in `story.js`: `{"0": 1.2, "1": 20.8, ...}`, seconds where each paragraph starts in the audio. Turns on "follow the audio" and click-to-play. |
| Word timings (optional) | `word-times.js`, same format as `../word-times.js` but counting paragraphs from 0 in `paras` |
| Pictures (later) | Put image files in a `pictures/` folder here and list them in `pictures` in `story.js`: `{src: 'pictures/01.jpg', para: 0, caption: '...'}`. Until then the panel says "Pictures coming soon". |

After changing `story.js`, bump `story.js?v=1` in both `index.html` (this folder)
and `../index.html` so students get the new version.
