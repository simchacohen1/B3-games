# Class locks (retired panel) → Class Access is the one place

The separate **Class Locks** panel (`class-locks/`) is retired. The 🔒 in the teacher bar (any tool) now opens the same
**Class Access** panel as the main room (`admin.html?tab=access&embed=1`). Both write the same data, so there is one
source of truth: `b3Games/siteSettings` → `classAccess/<et|wt>` (`mode`, `lockWindows`, `openUntil`), plus the per-game
switches and stars next to it.

## Why the old panel did nothing
It wrote to `classes/<id>/locks` through the `studentLocks` function. Class Access and `game-gate.js` (the gate on every
student page) read `siteSettings`, so a lock made in the Locks panel never reached the gate that students actually obey.

## Timed unlocks
Class Access has **15 / 30 / 45 min** unlock buttons (and *End now*). They set `classAccess/<class>/openUntil` (ms). While
`openUntil` is in the future the class is OPEN even if it is locked or in a scheduled lock; when it passes, the class goes
back to its mode/schedule by itself. Choosing Automatic / Open / Lock now clears it. The owner's emergency lock still wins.
Read by: `site-settings.js`, `game-gate.js`, `backend/functions*/multiplayer-lock-policy.cjs`,
`backend/functions/yiddish-service/site-policy.js`. Teachers write it through the `funTorahClassAccess` function
(`timedOpen` action in `class-access-core.cjs`).

## How fast a student is locked
`game-gate.js` re-reads the settings on a 30 s poll, **and** now holds a live Firebase stream of `siteSettings`, so a lock
reaches a student already inside a tool within a few seconds.

## Left in place (dormant)
`student-lock.js` / `student-lock-core.js` / the `studentLocks` function and the `classes/<id>/locks` data are no longer
written by any panel. An empty `locks` node means "open". They can be removed in a follow-up once nothing live depends on them.
