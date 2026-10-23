# Sefer HaMitzvos artwork drafts, Oct 25–31 2026

**DRAFT ONLY — DO NOT MERGE OR DEPLOY**

Seven dated SVG files are included, with four distinct scenes (the official cycle repeats N250, N251 and N253 on successive days). Existing PNG cards and the live page remain untouched.

| Date | Mitzvah | Card | Meaning |
|---|---|---:|---|
| Oct 25 | N250 | 500 | Do not cheat someone in buying or selling |
| Oct 26 | N250 | 500 | Same mitzvah |
| Oct 27 | N251 | 501 | Do not hurt someone with words |
| Oct 28 | N251 | 501 | Same mitzvah |
| Oct 29 | N253 | 502 | Do not cheat a ger in buying or selling |
| Oct 30 | N253 | 502 | Same mitzvah |
| Oct 31 | N252 | 503 | Do not hurt a ger with words |

Source: existing `schedule.js`, `calendar.js`, and `descriptions.js` on main.

## Verification and limitations
- Seven separate 960×680 SVG drafts created and committed.
- No production assets, manifests, saved coloring, date restrictions or app files changed.
- **Not yet validated:** SVG rasterization into the required native PNG assets; visual/halachic review; closed-region/flood-fill tests; browser and performance testing; progress/save behavior.
- Illustrations are preliminary schematic vector drawings, not approved release artwork.
- Existing coloring engine is PNG/mask based. Do not wire up SVG directly without compatibility work and tests.
- Check other in-flight Sefer HaMitzvos PRs before merging; do not overwrite shared files.
