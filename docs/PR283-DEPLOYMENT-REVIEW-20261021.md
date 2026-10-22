# PR #283 — final code review and backend staging

Starting head: `65fa1cf8796509d19ad0d97623fe9068fba36114` on `audit/signin-reliability-20261021`.

## Deployment verdict

**Source review and isolated staging: PASS. Unconditional production deployment: HOLD.**

The reviewed changes pass the tested authentication and backend paths. A production go-ahead still requires read-only confirmation that the deployed authenticated endpoints and database rules match the tested release. No tools/credentials available in this session established those production versions. In particular, the student Quiz now deliberately requires the authenticated `weeklyQuizStudent` endpoint; it must not be released assuming that endpoint exists and is correctly configured.

No merge, deployment, production rules modification, or real student data access occurred. No database rules file was edited. Production authorization remains a separate explicit user decision.

## Repairs made during final review

- Halacha's secondary auth now uses SESSION persistence, so ET/WT browser tabs cannot replace each other's tool identity. Reuse validates both student and class; newly exchanged tokens are checked against both as well.
- Rewards secondary auth also uses SESSION persistence. A matching, authenticated student/class/rewards token is reused after refresh instead of making another passcode/token exchange. Mismatched class claims trigger a new verified exchange.
- Bootstrap owner authorization now requires `emailVerified === true`, matching the database rules; unverified owner-email text does not grant administrator UI access.
- Google sign-in tracks both sign-in attempts and sign-out generation. A late popup or authorization read cannot copy an older teacher back into the default app or restore cached authorization after sign-out. Cancelled old attempts cannot sign a newer login out. Cancellation also prevents an obsolete popup request from switching to redirect sign-in.
- Quiz token-verification failures return 401 rather than an accidental 500.
- Quiz students no longer fall back to raw database reads/writes after missing credentials, 401, unavailable backend, or network failure. The fallback conflicted with the existing hardened rules, which already deny raw student launch/response/completion access. Verified teacher preview retains read-only direct access; student grading remains server-side. Requests are bounded and authentication failures are shown promptly.
- Quiz reuses the configured Firebase app rather than initializing an unconditional second configuration.
- Updated the already stale Halacha stylesheet cache-version assertion to the newer version already present in the starting HTML. No stylesheet was changed for this assertion.

## Validation on the final files

- **159 unit/static/regression tests passed, zero failed or skipped.** Includes PIN handling, student claims, teacher roles, late Google results, observer unsubscription, secondary-app class matching, rewards reuse, Quiz token errors, grading, preview protections, and related Halacha/rewards regressions.
- **18/18 database security emulator tests passed.** Rules were installed only into local demo namespaces. Anonymous/peer access and client grading writes remain denied.
- **9/9 original browser regression scenarios passed again**, including lock/error recovery, teacher/student tab isolation, SDK fallback, and actual Halacha/Rewards previews. Performance remeasurement was skipped because the shared gate was unchanged in this continuation.
- **6/6 extended browser/HTTP staging scenarios passed.** Raw results: `docs/PR283-STAGING-RESULTS-20261021.json`.
- Syntax checks and `git diff --check` passed. The earlier stale stylesheet assertion is now resolved; the selected suite has no known failing assertions.

Extended staging covers:
1. Actual homepage form: wrong PIN rejected, private ET/WT PINs accepted, server-issued custom tokens exchanged with Auth emulator, expected student/class/role claims, and refresh restoration.
2. Actual Halacha and Rewards student pages: token requests go through the checked-in handlers, tool identity is isolated between simultaneous ET/WT tabs, and Rewards refresh reuses its valid token without another login request.
3. Real Firebase SDK Google popup against the Auth emulator: synthetic invited Google account, verified email, actual teacher-claim HTTP handler, only the assigned ET class, and refresh persistence.
4. Actual Quiz page: synthetic assigned launch loads through the authenticated API and a clicked answer is saved by the backend.
5. Uninvited Google account and student token cannot claim teacher access; no teacher record is created for the uninvited account.
6. Real HTTP handlers for homepage/Halacha/Rewards/Quiz: wrong passcode and wrong class refusal, custom-token exchange/claim checks, answer-key withholding, server scoring, duplicate answer refusal (409), completion, disabled Auth-account refusal (401), inactive profile refusal (403), and missing/invalid bearer-token refusal (401).

The staging server invokes the checked-in `onRequest` wrappers through Express and uses Firebase Admin SDK against local Auth/RTDB. No token-issuing handler was mocked. Google identities and credentials are synthetic emulator identities, not real Google accounts. Public GAPI loader/iframe scripts were cached before testing and fulfilled locally; optional font/Material assets were stubbed. Unexpected outbound browser requests: zero. Synthetic data writes and backend status codes are recorded without PINs, tokens, or response bodies.

## Reproduce

See `scripts/signin-lab/README.md` for exact dependencies, public-asset hashes, and commands. Use `SIGNIN_LAB_STAGE=1` for the new backend staging and `SIGNIN_LAB_SKIP_PERFORMANCE=1` for the original regression matrix without repeating the benchmark.

Selected unit/regression command:

```sh
node --test tests/signin-reliability-behavior.test.cjs tests/signin-architecture.test.cjs tests/game-gate-authenticated-reads.test.cjs tests/hardened-rules-static.test.cjs tests/teacher-signin-entry.test.cjs tests/student-auth.test.cjs tests/student-practice-auth.test.cjs tests/teacher-preview.test.cjs tests/yiddish-teacher-preview.test.cjs tests/signin-stale-auth.test.cjs tests/teacher-roles.test.cjs tests/direct-teacher-onboarding.test.cjs tests/signin-preview-connections.test.cjs tests/signin-final-review.test.cjs tests/weekly-quiz-token-errors.test.cjs tests/weekly-quiz-student.test.cjs tests/halacha-saving.test.cjs tests/halacha-illustrated-sticker-library.test.cjs tests/rewards-login.test.cjs tests/rewards-teacher.test.cjs tests/rewards-cancel.test.cjs tests/rewards-contribution-balance.test.cjs
```

## Remaining production release checks

These are not established application failures; they are limits of isolated validation:
- Confirm deployed rules match the reviewed hardened rules; never apply the permissive legacy rules file by mistake.
- Confirm production `funTorahStudentAuth`, `funTorahTeacherClaim`, `studentRewardsLogin`, and `weeklyQuizStudent` versions/CORS/IAM match the expected API contracts. The PR also changes `weeklyQuizStudent`, so that function needs an explicitly approved release alongside the frontend as appropriate.
- Production Google OAuth/authorized domains, CDN availability, actual internet cold starts, and real-world sign-in latency were not tested.
- AI grading, recording uploads, storage/media, guest UI, all custom-class previews, and every complete exercise flow are outside this sign-in staging matrix.

For an authorized release, verify configuration metadata first, release the required backend before relying on the updated Quiz client, publish the frontend, and run approved synthetic-account smoke tests. Keep rollback artifacts for both frontend and function. Do not use real student records to fill remaining gaps without approval.
