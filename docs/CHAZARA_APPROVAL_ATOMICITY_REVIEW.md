# Chazara approval safety: design review and release gates (draft only)

**Status:** Design / test plan only. No production implementation, Firebase rules, data migration, CI safeguard, deployment or release authorization. Coordinate with [#346](https://github.com/simchacohen1/B3-games/pull/346), deliberately failing [#472](https://github.com/simchacohen1/B3-games/pull/472) and [#476](https://github.com/simchacohen1/B3-games/pull/476), and generic-class [#344](https://github.com/simchacohen1/B3-games/issues/344).

## What the current draft tests prove

The Chazara review handler in `backend/functions/student-rewards-auto-award.js` checks a teacher's class scope, then claims a request at `studentRewards/pointRequests/<requestId>`, credits `studentRewards/students/<rewardStudentId>/rewardBalance`, finalizes the request and mirrors the status to `posukPractice/chazara/events/<studentId>/<eventId>/pointRequestStatus`. Those writes span independent RTDB paths.

- **#472:** four deliberately RED tests revoke the teacher account or class tool grant *after* a fresh preflight authorization read but *before* the request transaction. A second read narrows the window but cannot make a grant and a request transaction atomic.
- **#476:** two deliberately RED tests inject a crash after the balance commits but before request finalization, and a failed recording-status mirror after approval. A retry must repair the request/mirror **without a second credit**.
- A green pending-only/lazy-history UI test is not evidence that approval/revocation and recovery are safe. Preserve all six RED tests until a real implementation passes them without bypasses.

## Non-negotiable invariants

1. A revoked teacher, principal or class/tool grant cannot cause a new approval or rejection to commit after the revocation's effective boundary. Define that boundary precisely; a cached role, token, class list or client check is not sufficient.
2. Each logical point request changes the student's balance **at most once**, including concurrent workers, retries, process restarts, timeout-after-commit and duplicate submissions. If approval has been durably committed, an authorized recovery may complete remaining mirrors without adding points.
3. A successful API response means the durable request and any required mirror are consistent; otherwise return a retryable, truthful state. Do not return success for a stranded `processing` request.
4. No class-crossing reads, approvals or recovery writes. Shared students and classless legacy records must fail closed when class attribution is ambiguous.
5. Preserve old balances, earned points, class membership, student history, and Rashi/milestone semantics. Never overwrite or reset a live balance during a rollout.

## Candidate approach requiring architecture review (not a patch)

**Exactly-once credit:** evaluate an atomic, per-reward-student transaction that stores both `rewardBalance` and an immutable per-request application marker under **one transaction node**. A retry checks that marker before changing the balance. This is only a candidate: existing balances are numeric at a separate child path, other writers may update that child directly, and the parent node can be large/hot. Every balance writer and rules/permission boundary must be inventoried before selecting this approach. A separate marker and balance written sequentially is **not** sufficient. Do not add an unbounded ledger without retention/size analysis.

**Revocation vs. claim:** an authorization re-read followed by a transaction at another RTDB path is not atomic. Review either (a) a shared transactional authority/claim boundary covering the grant's effective state and the request, or (b) a rigorously specified serialized service protocol that all grant-revocation and review writers obey, with durable fencing and crash recovery. A timestamp or epoch checked *outside* the transaction is insufficient. A client-only fix or Firebase rules alone cannot protect Admin SDK writes.

**Recovery:** define explicit durable states (pending, claimed/processing, credited, finalized, mirrored) or an equivalent journal; idempotent replay must distinguish never-credited from already-credited requests. Recovery must validate the request's current student/class identity and the caller's current authority, and must not reverse an already-approved reward without a separate authorized reversal protocol. Consider what happens if revocation occurs while a previously authorized credit is in progress; document the precise policy before coding.

**Principal:** any design must also revalidate the principal's *own active owner invitation*, owner-selected supervised teachers and their current class grants, independently in each backend endpoint and applicable Firebase rules. Browser fixes [#493](https://github.com/simchacohen1/B3-games/pull/493) and Chazara API fixes [#490](https://github.com/simchacohen1/B3-games/pull/490) are draft, separate, and do not prove all endpoints safe.

## Synthetic acceptance matrix (keep original RED tests)

- Revoke teacher, tool grant, class membership, principal invitation, supervised-teacher assignment and supervised class: before handler, during read, immediately before claim, and during retry. Deny unauthorized new commits and check **all** request/balance/mirror paths.
- Inject failure before/after claim, before/after balance commit, before/after request finalization, before/after mirror; then retry once and concurrently. Verify exactly-once credit and eventual truthful completion.
- Duplicate review submissions and simultaneous approve/reject must have one deterministic durable outcome. Include Rashi, milestones and manual Chazara controls.
- Shared student in 2–3 classes, classless legacy event, moved/revoked class, inactive account, expired invitation, overlapping valid supervisors; ensure no cross-class disclosure or mutation.
- Model transient RTDB `transaction` noncommit, throw-after-commit and stale snapshot; inspect actual backend code in tests, not only a mock algorithm.
- Confirm pending-only startup has no full-history subscription; historical filters and audio remain class-scoped; measure actual signed-in staging startup latency, read count, bytes received and cost against the existing baseline.
- Run Firebase emulator rules tests and **authenticated fictional-account staging** before any readiness claim. Review indexed pending-query rules/index proposals [#462/#463](https://github.com/simchacohen1/B3-games/pull/462) separately.

## Integration and release order

1. Inventory **every** reward-balance writer, point-request mutator, approval/mirror reader and authorization entry point. Identify any client direct writes and incompatible schemas before a ledger or claim design is selected.
2. Agree on the single atomicity/serialization design and recovery semantics; implement in a separate **draft** branch, with the original six RED tests unchanged.
3. Pass focused fault-injection tests, complete exact-head CI, emulator class/rules tests, authenticated synthetic staging and measured latency/egress. Do not treat a workflow green if its syntax-validation command masked a failure.
4. Independently review backup, migration, rollback and Firebase rules/function deployment steps. Seek **specific new owner approval** before merge, auto-merge, changing safeguards, deploying Firebase, migrating or reading/writing live student data, or publishing.

This document does not itself choose a schema or authorize implementation. It records why a superficially green patch could still double-credit points or approve after revocation.
