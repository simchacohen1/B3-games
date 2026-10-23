# Sefer HaMitzvos coloring artwork — October 25–31, 2026

**DRAFT ONLY — DO NOT MERGE OR DEPLOY.**

Seven separate dated SVG illustrations at 1427 × 950 pixels (viewBox 1200 × 800). There are four distinct mitzvos; repeated days reuse the same artwork to preserve the existing card semantics. These SVGs are source drafts, NOT drop-in assets for the current PNG/mask coloring engine.

| Civil date | Hebrew date | Ref | Card | Hebrew topic | Meaning |
|---|---|---|---:|---|---|
| 2026-10-25 | 14 Cheshvan 5787 | N250 | 500 | איסור אונאת ממון | Do not cheat someone in buying or selling |
| 2026-10-26 | 15 Cheshvan 5787 | N250 | 500 | איסור אונאת ממון | Same mitzvah |
| 2026-10-27 | 16 Cheshvan 5787 | N251 | 501 | איסור אונאת דברים | Do not hurt someone with words |
| 2026-10-28 | 17 Cheshvan 5787 | N251 | 501 | איסור אונאת דברים | Same mitzvah |
| 2026-10-29 | 18 Cheshvan 5787 | N253 | 502 | איסור אונאת הגר בממון | Do not cheat a convert in business |
| 2026-10-30 | 19 Cheshvan 5787 | N253 | 502 | איסור אונאת הגר בממון | Same mitzvah |
| 2026-10-31 | 20 Cheshvan 5787 | N252 | 503 | איסור אונאת הגר בדברים | Do not hurt a convert with words |

Hebrew topics are concise descriptive labels, not quotations from Rambam's Hebrew text. A ger is not identified by appearance: all people are drawn with dignity.

## Source verification
- Existing website: `sefer-hamitzvos/schedule.js`, `calendar.js`, `descriptions.js` and `SCHEDULE-SOURCES.md`.
- Independent schedule: https://www.hebcal.com/hebcal?dsm=on&end=2026-12-31&i=on&set=off&start=2025-10-01&v=1
- Chabad mitzvah meanings: https://www.chabad.org/library/article_cdo/aid/961882/jewish/Negative-Commandment-250.htm ; https://www.chabad.org/library/article_cdo/aid/961884/jewish/Negative-Commandment-252.htm ; https://www.chabad.org/library/article_cdo/aid/961885/jewish/Negative-Commandment-253.htm

## Verified draft checks
- Seven SVG files exist, four distinct scenes, correct date-to-ref mapping.
- All explicit path shapes close with Z. White fills only, black outlines only; no external images, shading, scripts or embedded text.
- Each scene has white-background closed vector objects and kippah/tzitzis on boy figures.
- Source dimensions 1427 × 950 and aspect ratio 1.502.

## NOT YET VERIFIED — release blockers
- Rasterize SVGs into the website's native PNG assets and verify full white/black raster pixels.
- Build native-resolution region masks, visually inspect each region and run actual click-to-fill, neighbor-leak, whole-object fill, save/reload, repeated fills, switching days, undo/redo, memory and distortion tests with synthetic student data.
- Review artistic quality against the approved coloring-v2 pictures; SVG closed geometry alone does not prove click-to-fill correctness.
- Existing `index.html` routes cards 500–503 to legacy `coloring/NNN.png` because `newArt` currently ends at 499. A later reviewed integration must add cards 500–503 to `coloring-v2` and isolate saved progress keys without altering old records.
- Respect the existing date floor, future lock and card reuse. No production files or student records were changed.

**Do not merge until PNG, mask, browser/performance and progress preservation checks are green and the owner separately approves publication.**
