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

## Completed preparation and verification
- Seven SVG files exist, four distinct scenes, correct date-to-ref mapping.
- All explicit path shapes close with Z. White fills only, black outlines only; no external images, shading, scripts or embedded text.
- Each scene has white-background closed vector objects and kippah/tzitzis on boy figures.
- Source dimensions 1427 × 950 and aspect ratio 1.502.

The four distinct SVG scenes were rasterized into `coloring-v2/500.png` through `503.png`. The images are 1427 × 950, binary black-and-white, and the preview sheet shows each scheduled date in order. Cards 500–503 now use the existing v2 path and have isolated `cartoon-v2` local keys and `-v2` account paths. Existing `coloring/500.png` through `503.png` and their saved records remain unchanged.

The region manifest now matches the four new raster sources and the production mask algorithm. The region builder recognizes v2 cards through 503. The actual `fill.js` mask algorithm successfully segmented 69, 48, 74 and 48 regions respectively; every region was filled and checked against its full label, neighboring labels and source ink.

### Tests run
- `node --test tests/sefer-hamitzvos*.test.cjs` — **45 passed, 0 failed**, including all 613 mask manifests, previous artwork, calendar rules, future locks and progress-key isolation.
- `FTT_CANVAS_MODULE=<temporary @napi-rs/canvas> node sefer-hamitzvos/tools/prepare-weekly-art-20261025.cjs` — **7 dated PNGs rasterized; source-region checks passed**.
- `FTT_CANVAS_MODULE=<temporary @napi-rs/canvas> node sefer-hamitzvos/tools/verify-coloring.cjs` — **passed** real app fill, repeat recoloring, adjacent isolation, mouse/touch scaling, undo, erase, save/reload, legacy-record preservation, rapid navigation, and all four card-specific saves/reopens.
- `npx playwright test e2e/sefer-week-20261025.spec.ts --project=chromium --reporter=list` — **1 passed**. Browser checks cover all seven dates, card routing, save/reopen, repeated-day reuse, exact image/canvas dimensions, zero ink coverage, complete selected-region coverage, and bounded mask caching. Final switch times were 131–283 ms (max 283 ms); observed JS heap was 76.6 MB with two masks cached, below the 200 MB ceiling.
- Manual visual inspection completed for each of the four unique scenes and the seven-day contact sheet: `preview-2026-10-25-to-31.png`.

No date floor, future lock, existing picture, saved student record or production deployment was changed. Keep PR #313 in draft and do not merge or deploy without the owner's separate approval.


## Offline raster-preparation harness
The repository now contains `sefer-hamitzvos/tools/prepare-weekly-art-20261025.cjs`. It can rasterize each dated SVG to a separate binary black-and-white 1427×950 PNG in a **temporary output directory**, count connected white regions, check dimensions/ink density, and exercise synthetic complete-region fills and recoloring. It refuses to write inside the live artwork directories.

Run in a checked-out development branch:
```bash
npm install --prefix /tmp/sefer-canvas --no-audit --no-fund @napi-rs/canvas
FTT_CANVAS_MODULE=/tmp/sefer-canvas/node_modules/@napi-rs/canvas node sefer-hamitzvos/tools/prepare-weekly-art-20261025.cjs
node --test tests/sefer-hamitzvos-week-20261025-art.test.cjs
```
Output PNGs are copied into the v2 card assets only by the separately reviewed PR changes; this harness writes exclusively to a temporary directory and never overwrites website artwork.
