# October 20 Sefer HaMitzvos repair

## Content

- Added reviewed classroom descriptions for **P1–P248 and N1–N365** (all 613), displayed above each picture. The original picture files are preserved.
- Replaced title-substring vocabulary selection with **613 explicit reference lists**. Each has one to three directly relevant terms. Existing useful vocalized terms remain. P182/P225/N296 include cities of refuge; P247 uses attacker/pursued; N31–38 distinguish the prohibited practices instead of labeling them all sorcery.
- Fixed the malformed P105 title containing literal HTML. Sources, edition differences and the numbering convention are recorded in CONTENT-SOURCES.md.

## Coloring cause and repair

The previous flood fill followed connected near-white source pixels after a two-pixel outline expansion. Larger breaks could join separate intended sections, including within a page frame where reaching the image edge did not detect the spill. Expanding every outline also removed tiny interiors.

Compile immutable native-resolution region masks once per picture from the untouched artwork. The algorithm is independently cross-checked against morphological closing and connected-component labeling for all 613 active files. Morphological closing repairs short outline breaks without expanding every line. The masks exclude original outline pixels and ambiguous components larger than 18% of the image. New fill operations use only one immutable mask label. Missing/mismatched masks fail closed. Screen coordinates map to native image pixels; CSS resizing never resamples the region labels.

Existing fill records continue through the **unchanged legacy tracer**, preserving saved coloring rather than rewriting pupils' history. New fill records carry a mask version. New eraser records also erase bucket color, with undo support. No storage keys, cloud paths, account policy or schedule data changed.

## Focused validation

- Existing Sefer calendar, navigation, access and legacy fill tests: 18 passed.
- New mask/content tests: 10 passed, including source hashes, dimensions, ink exclusion and size limits for all 613 pictures; actual complex pictures 1, 475, 476, 484, 487, 499, 613; small and separate regions; scaling; invalid mask rejection; full content/vocabulary coverage.
- Relevant word-bank checks: deduplication, ET/WT separation, all-613 vocabulary contract and matching feedback passed.
- Actual page handlers executed with native Canvas and synthetic in-memory account storage on pictures 1, 475, 484, 487, 499, 613: fill, neighboring-color preservation, mouse/touch coordinates at 50%/125% scale, eraser, undo, clear/reset, account save and reload passed.
- Legacy fill replay tested pixel-identical across save/reload; loading did not overwrite the synthetic remote record.

No real student work was used. The native Canvas harness tests actual pixel rendering and page handlers, but is not a physical touchscreen/browser-device test. Publication and live verification are recorded in the pull request and final report.

Reproduce:

```
node --test tests/sefer-hamitzvos-fill.test.cjs tests/sefer-hamitzvos-calendar.test.cjs tests/sefer-hamitzvos.test.cjs tests/sefer-hamitzvos-regions.test.cjs
npm install --prefix /tmp/sefer-canvas --no-audit --no-fund @napi-rs/canvas
FTT_CANVAS_MODULE=/tmp/sefer-canvas/node_modules/@napi-rs/canvas node sefer-hamitzvos/tools/verify-coloring.cjs
```

Regenerate the independent verification manifest with `python sefer-hamitzvos/tools/build-regions.py` (Pillow, NumPy, SciPy). The manifest records each exact source artwork SHA-256 and expected region count. No extra mask download is needed.
