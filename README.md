# B3 Games

Live site: https://simchacohen1.github.io/B3-games/

Student-facing games, linked from the homepage (`index.html`):

- **Kahoot Word Quiz Engine** — `kahoot-word-quiz/index.html`
- **Dikduk Arcade** — `kodesh-construct/index.html`
- **Chumash Quiz** — `chumash-quiz/index.html`
- **Posuk Practice Scroll** — `record_pesukim/student.html`
- **Rashi Letters** — `rashi-letters/student.html`
- **Shorashim** — `shorashim/teacher.html`
- **Class Gallery** — `class-gallery/index.html`
- **Game Show** — `game-show/player.html`

Games are toggled on/off from the "Admin" button on the homepage (backed by Firebase; see `site-settings.js`).

Every game/tool now lives in its own folder (mirroring `rashi-letters/`, `record_pesukim/`, `shorashim/`, `game-show/`, `work-timer/`, `class-slides/`, etc.). Only files genuinely shared across pages stay at the repo root: `index.html`, `all-pages.html`, `firebase-config.js`, `firebase-rules.json`, `site-settings.js`, `generate_page_list.py`.

Teacher dashboards, prototypes, and other utilities (Work Timer, class slides, teacher consoles, etc.) aren't linked from the homepage but are all listed automatically at `all-pages.html`, which regenerates itself on every push via `generate_page_list.py` / `.github/workflows/update-page-list.yml`.
