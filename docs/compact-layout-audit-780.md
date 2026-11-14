# Compact layout audit — Issue #780 / draft PR #781
Updated: 2026-11-11. **Development only. Not production-ready.**

## Implemented in this draft
| Page | Before | Draft change | Access/data impact |
| --- | --- | --- | --- |
| `teacher-home.html` — principal mode | Every supervised class draws full Learning Island and teacher tools in one vertical list | School summary from already loaded scoped classes; grade and class foldouts, teacher/class/grade search, Expand/Collapse All, remembered expansion, distinct student/teacher counts | Presentation-only; the existing class access check, live revocation watch, tool links and settings controls are retained. No extra Firebase reads |
| `owner-admin.html` — Students view | Every student in the selected school displays full school/class editing controls | Students grouped once under their first assigned class (or Unassigned), class counts, search and fold controls; existing school and per-student options retained | The existing school scope and `onStudentChange` handler remain; no extra reads/writes |
| `assignment-center/teacher.html` — Reports | All assignments listed flat | Published, Draft and Archived foldouts with counts and expand/collapse | Existing assignment card click handlers and data shape unchanged |
| `assignment-center/teacher.html` — Check Submissions | One very long list of individual pending-review cards | Group pending submissions under an assignment-level foldout with counts and expand/collapse | Original recording playback, grading/feedback, approve/return API calls retained |

## Reviewed but **not** completed
| Page | Current observation | Next phase |
| --- | --- | --- |
| `chazara/teacher.html` — recordings | Large `#recordingsList` of incremental live audio rows with student/perek/date filters; `renderRecordings` and `applyRecordingFilters` rely on direct children | Integrate a student grouping that maintains row/audio identity and avoids extra Storage/media reads. Coordinate draft #346 before editing |
| `student-report/index.html` | Class-wide student table and per-student all-quiz history; quiz attempts have a details toggle but long histories remain | Design compact per-student activity sections and accessible quiz-history grouping, preserving print/PDF and export |
| `record_pesukim/teacher.html`, Kriah, Gallery, Rewards, other tools | Not yet individually audited in this issue | Inventory each active page, count high-scroll elements, choose appropriate compact summaries, and make focused changes with regression tests |

## Verification completed
- GitHub branch was created from verified remote `main`; no old local worktrees changed.
- JavaScript syntax of modified inline scripts checked in a JavaScript evaluator.
- Six synthetic DOM behavior checks of the principal component passed (grouping, original card identity, expand/collapse, search/filter, remembered state, teacher search). The matching Node test file was committed.
- PR CI runs are in progress; consult current-head checks, not earlier commits.

## Verification **not yet** completed — mandatory before release
- Full Node suite (including principal access and revocation regression), exact head.
- Browser test against isolated staging with fictional principal/teacher/student sign-ins, ET/WT and other class grants; verify click-through tools, class controls, deny/revoke mid-session, browser back, keyboard, mobile.
- Owner-admin student search and class-toggle regression with synthetic records.
- Homework grouping plus audio-player/feedback/approval/return navigation and recording review using fictional accounts.
- Actual before/after screenshots and measured Firebase read/egress comparison.
- Security review of potential merge conflicts with principal #405/#492/#493 and audit #347; no permission or backend changes are authorized.
- No merge, production deploy, live data access, Firebase rules/functions change without explicit owner approval.

## Design safeguards
Keep alerts/actions visible, avoid extra reads for hidden sections, preserve existing DOM controls, do not show cross-school data, treat collapsed UI state as convenience only (not authorization). Grouping a student under one class is display-only; do not silently modify membership.
