# Vayeira Rashi source-extraction draft (Issue #789)

This folder contains a **non-production, unverified** extract of the 36 separate Rashi passages appearing on 35 commentary pages in the *Children's Chumash Vayeira Teacher Viewable File.pdf* (source: https://drive.google.com/file/d/1ntTpodCgjmwJm_GdPxOIQQiAIlJxX4Uv/view).

The original file has 466 pages. The catalog preserves the printed book's abridged excerpts, **not necessarily the full Rashi from a standard Chumash**. For example, literal ellipses in the printed text are included.

## Critical limitations
- **Do not show the draft text to students yet.** The source PDF's Hebrew text layer sometimes inserts spaces inside words, disrupts nekudos, and occasionally displaces pasuk numbering. Every entry has `needs_visual_proofreading=True`.
- Each entry includes a stable ID, perek, pasuk and original PDF page to support side-by-side verification. There are two entries on original page 403 (22:3 and 22:4).
- This draft does **not** change the live Rashi Letters UI, recording/teacher grading, Firebase functions, database rules, or student records.
- The existing recording backend only permits a fixed list of letter and word practice section IDs and limits teacher-visible words to twelve short strings. A reviewed backend extension is needed to accept individual passages and preserve the full Rashi in teacher review.
- The three-reading daily cap is tracked by separate draft PR #402. Coordinate it before merging a real student submission flow.
- Current staging recording UI explicitly disables uploads; do not use production credentials to bypass this.

## Acceptance checklist before release
1. Visually proofread all 36 entries against the original PDF, especially nikud, space boundaries, dibbur hamaschil, and printed ellipses.
2. Add versioned passage IDs and full-text metadata to the shared frontend/backend contract, without changing existing letter/word sections.
3. Add the perek/pasuk Rashi browser; each Rashi gets its own record/replay/re-record/submit status.
4. Wire authenticated, class-scoped teacher review with individual grades and feedback, including 3/day server-side enforcement.
5. Run Node and emulator tests plus fictional student/teacher signed-in staging journey, then obtain explicit approval before any production merge or deploy.
