# Reward-balance writer inventory for Chazara exactly-once review (DRAFT)

**Status:** Source inventory / architecture input only, checked 2026-10-30 against the repository default branch. No data was read from Firebase, no runtime code or security rules were changed, and no migration or release is authorized. This is a follow-up to [Chazara atomicity review #494](https://github.com/simchacohen1/B3-games/pull/494), not a proposed implementation. Source line numbers refer to the default branch as inspected; recheck after rebases.

## Existing shared numeric schema

The live-code paths below operate on a **numeric child** at `studentRewards/students/<rewardStudentId>/rewardBalance`, generally with `transaction(cur => number)`. The reward student ID is distinct from a B3 student ID in some flows. Request status is stored separately at `studentRewards/pointRequests/<requestId>`; Chazara event status is at `posukPractice/chazara/events/<studentId>/<eventId>/pointRequestStatus`. These are not one atomic RTDB transaction.

| Source / code region | Balance operation | Separate state / recovery concern |
| --- | --- | --- |
| [student-rewards-auto-award.js, approval](../backend/functions/student-rewards-auto-award.js) (about L889–935) | Credits pending Chazara/Rashi/milestone requests after a request-status claim | Claim, credit, finalization and recording mirror are separate. A crash after credit strands `processing`; a mirror failure is not repaired by an already-handled retry. See RED #476. |
| [student-rewards-auto-award.js, immediate awards](../backend/functions/student-rewards-auto-award.js) (about L950–962) | Credits verified automatic milestones after creating a `processing` request | Same separate claim/credit/finalization pattern. Include automatic awards in idempotency design. |
| [student-rewards-auto-award.js, Chazara reversals](../backend/functions/student-rewards-auto-award.js) (about L1190–1264, L1350–1398) | Debits points after rejecting or deleting a previously approved Chazara recording | A separate reversal request is claimed before balance debit; finalization and event mirror follow. A partial failure must not double-debit on replay. |
| [student-rewards-auto-award.js, class reward contribution](../backend/functions/student-rewards-auto-award.js) (about L574–590) | Debits the numeric balance for a class reward/Gimkit contribution | The round/contribution records are updated afterward, on different paths; compensation/recovery needs separate review. |
| [rewards-teacher-core.cjs](../backend/functions/rewards-teacher-core.cjs) (about L100–155 and related handlers) | `addToBalance` changes the numeric child for teacher daily scoring, adjustments and request approval | `decideRequest` separately claims and finalizes a point request; check its error/retry path before unifying approval protocols. |
| [student-rewards-functions.js](../backend/functions/student-rewards-functions.js) (about L197–230) | Debits the numeric child when a student redeems a store prize | Prize availability/redemption state is outside the balance transaction. |
| [rewards-cancel-core.cjs](../backend/functions/rewards-cancel-core.cjs) (about L15–40) | Refunds the numeric child after a student cancels a pending prize request | The cancellation claim, refund, stock and cooldown restoration are separate operations. |
| [class-gallery-powers.js](../backend/functions/class-gallery-powers.js) (about L255–289) | Debits points for a Tag power, with a compensating refund if effect application fails | Power-spend reservation, balance debit, effect and purchase history are separate. A crash or repeated compensation requires review. |
| [student-rewards/teacher.js](../student-rewards/teacher.js) (about L195–235, L605–627, L640–648, L707–737, L868–885) | **Owner browser** directly changes the numeric child for refunds, daily awards, adjustments, activity approvals and redemption declines | Teacher mode often uses an API, but owner mode retains direct RTDB writes. Do not assume all balance writers are server functions; Firebase rules and browser paths must be considered. |

### Creation and mirrored deployment code

- [student-rewards-functions.js](../backend/functions/student-rewards-functions.js) around L125–129 and [rewards-teacher-core.cjs](../backend/functions/rewards-teacher-core.cjs) around L48–54 initialize a **new** reward-student record with `rewardBalance:0`. These must not reset an existing student's balance during migration.
- [functions-staging/student-rewards-auto-award.js](../backend/functions-staging/student-rewards-auto-award.js) duplicates relevant production logic. The staging Functions bundle is a separate codebase; changing only one copy would invalidate staging parity. Audit other staging entry points and deployment packaging before relying on a test.
- The repository also contains `preview-*` copies and test fixtures. These were not counted as distinct production writers. The list above is a **first-pass source inventory**, not proof that every dynamic/indirect write, client, rule or deployed version has been located.

## Architecture consequences and mandatory next checks

1. **Do not replace the numeric child with an object** or introduce a parent-level balance+ledger transaction as a drop-in patch. Existing server and owner-browser numeric-child transactions and refund/debit flows must be updated or proven compatible first. An independent request marker followed by a numeric balance transaction does **not** provide exactly-once credit.
2. Enumerate the effective deployed Firebase Functions, browser write permissions, RTDB rules and every `store.tx`/dynamic `ref` target. Check other point-earning tools (Rashi, Posuk, Shorashim, daily awards), owner direct writes, staging packaging and any legacy writers. A repository search is not proof of what is deployed.
3. Specify whether all point changes must use a single service/ledger or only review awards; either way, account for concurrent prize purchases, teacher adjustments, contributions, refunds, reversals and other credits while an approval retries.
4. Preserve current numeric balances, request history, class membership, lock rules, earned points and teacher/owner workflows. Define an idempotent migration/rollback with backup and no live-data operations before explicit owner approval.
5. Keep [#472](https://github.com/simchacohen1/B3-games/pull/472)'s four RED grant-revocation boundary tests and [#476](https://github.com/simchacohen1/B3-games/pull/476)'s two RED approval-recovery tests unchanged. Add fictional failure injection for concurrent **balance debit + approval**, direct-owner adjustment, teacher daily save, automatic milestone and reversal; assert exact net balance and truthful request/mirror state.
6. Independently verify class-scoped authorization (including shared students and principal revocation), Firebase emulator rules, signed-in fictional staging, and performance/egress. A client check or Admin SDK preflight read cannot atomically fence a separate grant revocation.
7. Review a concrete schema/serialization proposal against this inventory **before implementation**. No CI pass, document or coordination comment is merge, Firebase, safeguard, live-record or publication authorization.

## Review questions for Codex / Claude

- Which actual deployed paths can write `rewardBalance` directly, including owner browser and legacy clients, and what do RTDB rules permit?
- Can a proposed per-student atomic record coexist with every current debit/refund writer, or must all writers migrate together?
- What durable marker distinguishes **credited but not finalized** from **claimed but not credited**, including process crashes and concurrent retries?
- What exact transactional or serialized boundary makes a revoked teacher/principal/class grant effective before a review commit?
- What is the safe rollback plan if some existing numeric balances or requests have partial historical states?

**Do not implement a schema migration from this document alone.** This is a concrete inventory to constrain the design and avoid an unsafe one-function fix.
