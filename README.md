# B3 Games

Live site: https://simchacohen1.github.io/B3-games/

Student-facing games, linked from the homepage (`index.html`):

- **Kahoot Word Quiz Engine** — `kahoot_word_quiz_engine_paste_only_any_perek.html`
- **Dikduk Arcade** — `kodesh-construct.html`
- **Chumash Quiz** — `chumash-quiz.html`
- **Posuk Practice Scroll** — `record_pesukim/student.html`
- **Rashi Letters** — `rashi-letters/student.html`
- **Shorashim** — `shorashim/teacher.html`
- **Class Gallery** — `class-gallery.html`
- **Game Show** — `player.html`

Games are toggled on/off from the "Admin" button on the homepage (backed by Firebase; see `site-settings.js`).

Teacher dashboards, prototypes, and other utilities (Work Timer, class slides, teacher consoles, etc.) aren't linked from the homepage but are all listed automatically at `all-pages.html`, which regenerates itself on every push via `generate_page_list.py` / `.github/workflows/update-page-list.yml`.
