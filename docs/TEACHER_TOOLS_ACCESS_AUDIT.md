# Teacher Tools access audit — initial route inventory (2026-10-28)

**Status: INVENTORY ONLY — NOT AN AUTHORIZATION FIX OR SECURITY PASS.** This is an isolated, synthetic/static audit for [issue #439](https://github.com/simchacohen1/B3-games/issues/439). No live user data, Firebase rules, functions, or production pages were changed.

## Scope captured

- `index.html#teacherToolsSection`: 21 direct-link cards plus the "Sign in as a Student" action.
- `teacher-home.html#TOOLS`: 18 configured tool entries (some aliases share a route).
- Union: **24 distinct canonical HTML destinations**, listed in `docs/teacher-tools-route-inventory.json`. Query parameters are stripped only for route de-duplication; direct URL and parameter substitution tests are still required.
- Related deep-link/preview surfaces to audit separately: `teacher-home.html`, `teacher-preview-tool.html`, `teacher-student-split.html`, `owner-admin.html`, and `class-pointer-prototype/classroom.html`. This list is not exhaustive.

## Required next security checks (not yet performed)

1. On **isolated staging**, open each route as anonymous, signed-in student, unclaimed invited teacher, revoked teacher, authorized teacher, and owner. Test direct URL, reload, bookmark, private session, stale token and changed class query parameters. Ensure denied users cannot load privileged data or perform actions.
2. Inventory the Firebase RTDB paths, Storage rules, and Cloud Functions/API calls used by each route. Test server-side denials with emulator and fictional multi-class students, including secondary-class membership and independent revocation. Browser hiding alone is insufficient.
3. Identify dual-use pages (e.g. `halacha/index.html`, `class-gallery/index.html`, `sefer-hamitzvos/index.html`, `davening_student_app/index.html`) and preserve legitimate student learning while blocking **teacher-only capabilities**.
4. Verify current production vs staging behavior only with permission and without touching live student records. Static GitHub Pages HTML can remain publicly downloadable even when privileged data/actions are correctly denied.
5. Coordinate with #20, #94, #145, #344 and the failing multi-class security draft #424. Do not weaken its red security assertions to force green CI.

## What the regression actually checks

`node --test tests/teacher-tools-route-inventory.test.cjs` ensures the two menus' routes are represented in the explicit audit inventory and remain local links. Any new/removed route must be reviewed. **It cannot prove that anonymous visitors or students are denied**; that requires the staging and backend checks above.

**Publication:** This branch is draft-only. No merge, auto-merge, Firebase deployment or production publication is authorized by this document.
