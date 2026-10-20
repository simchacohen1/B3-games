# Yiddish Explorer unlock persistence repair — October 20, 2026

Status: prepared for review; production deployment requires owner approval.

## Findings

Read-only live Edge inspection loaded ET step 4 and WT step 2. No classroom settings or student records were changed. Source inspection confirms selecting a level previously changed only the local dropdown: persistence required a separate Save lesson settings click. Refresh/reopen restored the last saved value. Authentication callbacks could also reload the form without respecting unsaved changes. These are confirmed reset paths; the specific historical WT incident is not conclusively attributed to one of them. No evidence of a default-value write was found.

ET/WT use one legacy configuration record. Existing version checks reject stale full-form saves; they do not silently merge them. The new action updates only the requested class within that record and compares the prior saved level inside the transaction. A stale same-class session gets a conflict rather than overwriting newer access. No migration is needed, and progress paths are unchanged.

## Changes

- Immediate class-specific unlock saving, with saving/saved/failure messages.
- Preserve the other class, lesson sections and student progress.
- Reject stale same-class edits; keep existing whole-form version checks.
- Ignore superseded loads and avoid reloading unsaved edits on auth callbacks.
- Disable unlock controls while a save is pending; refresh teacher asset version.

## Automated verification

Run:

`node --test tests/yiddish-backend.test.cjs tests/yiddish-main-sign-in.test.cjs tests/yiddish-teacher-preview.test.cjs tests/yiddish-unlock-ui.test.cjs`

42 tests passed. New coverage includes WT 4 then 5 across reconstructed service sessions and repeated ET/WT loads; independent cross-class writes; stale same-class and whole-form rejection; exact student practice limits; invalid/unauthorized writes; progress preservation; immediate UI save; failed-save feedback; delayed-load protection.

These are synthetic in-memory backend and VM UI tests, not actual Firebase/browser refresh or Google sign-out/re-login tests.

## Release order after explicit approval

1. Deploy only `functions:yiddishApi` to project `b3-games` from the reviewed backend. No security-rule changes. Preserve existing function configuration.
2. Publish the reviewed frontend via the normal main/GitHub Pages process. Do not publish the new page before the API supports `teacherSetUnlock`.
3. Verify live asset versions and perform the acceptance checks below.

## Independent QA handoff

The dedicated QA agent is in another conversation and is not reachable through this session's agent roster. This checklist is the handoff; no direct coordination or independent QA completion is claimed.

Use an isolated Firebase environment seeded with synthetic ET/WT classes and temporary students, or an approved preview wired to that environment. Do not alter production ET/WT unlock settings during teaching, and do not reuse real student passcodes. A production test class alone does not exercise the legacy shared ET/WT settings record.

- Save WT 4, wait for saved confirmation, refresh, close/reopen, and sign out/in in an isolated browser profile; repeat with WT 5.
- Switch ET/WT repeatedly and confirm ET is unchanged.
- In two sessions, update different classes and confirm both survive. Attempt a stale same-class edit and confirm visible conflict.
- Confirm student access matches the exact step, including the first blocked step.
- Simulate a delayed response/failure and verify visible feedback and recovery after refresh.
- Compare synthetic student progress before/after.
- After release, inspect live code and verify persistence using an approved safe live workflow outside teaching. Do not report live ET/WT persistence verified solely from a generic test class.

Outstanding: actual Firebase transaction integration, browser refresh/reopen/sign-out/in acceptance, independent QA, approved deployment, and live persistence verification. The repair remains open until those checks pass.
