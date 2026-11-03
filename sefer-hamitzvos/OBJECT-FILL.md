# Object-aware coloring (objectVersion 2)

## What was wrong
Every ink line, even a thin fold line inside a pair of pants, started a new fillable section, so one tap colored only a strip. The old fix repaired gaps but never joined sections that belong to one object, and the closing step also left unpainted white slivers beside thin lines.

## What happens now
`fill.js` → `createObjectMask` (runs in `mask-worker.js`, once per picture, cached with the picture):

1. **Same sections as before** (`segmentRegions`; its output hash is unchanged, so saved pictures replay identically).
2. **Slivers filled.** Each section grows over the thin-line slivers around it, but only inside the same thick-outline area, never over a thick outline, never into the open background. Tiny enclosed white pockets (a belt band) become sections of their own. Specks smaller than a finger join their longest-bordering neighbour.
3. **Explicit grouping.** Sections are joined **only** where `region-groups.js` names them (pants, sleeves, hands, faces, shoes...). Nothing is guessed. A first attempt that joined everything inside one thick outline leaked into the ground, shoes and bucket, so it was removed. A group that would exceed 30% of the picture, or has a seed that is not on a section, is ignored whole (fails closed).
4. **Fast lookup.** `buildRegionIndex` (counting sort) makes any object's pixel list one slice, so a tap, undo, redo or full replay never rescans the picture.

The line art stays a separate layer above the paint (`#outline`, multiply blend, z-index above the paint canvases), so every black outline and interior line is always visible.

## Saved pictures
New fills are stored as `{type:'fill', seed, color, maskVersion:1, objectVersion:2}`. Old records (no `objectVersion`) replay through the unchanged section or legacy tracer, pixel for pixel. A browser still running the previous page treats the new record as an ordinary section fill (safe, smaller), never as a leak. No storage keys or account paths changed (`versionedSaveArt` / `-v2` untouched). Redo is page-only (not saved).

## Adding groups for another picture (one picture at a time)
```
FTT_CANVAS_MODULE=<path to @napi-rs/canvas> node sefer-hamitzvos/tools/section-sheet.cjs 478 sheet.png 0 150 1427 950 1
```
Open `sheet.png`: every section is colored and numbered. Add `{"name":"...","sections":[numbers]}` entries for the card in `tools/region-groups-source.json`, then:
```
FTT_CANVAS_MODULE=... node sefer-hamitzvos/tools/build-region-groups.cjs
FTT_CANVAS_MODULE=... node sefer-hamitzvos/tools/section-sheet.cjs 478 check.png 0 150 1427 950 1 --groups
```
Look at `check.png` for leaks (the build warns when one group covers more than 6% of the picture). Do not pick a number just because it is printed near the object: a background section can sit next to a shoe.

Curated so far: cards 475, 478, 479, 480 (men/boys: pants, shirts/jackets, sleeves, hands, faces, hair, kippahs, belts, shoes). Other pictures get the sliver fix and speck cleanup but each section is still its own object until grouped.
