# Homework & Assignment Center staging slice (#406)

This prototype is isolated to `https://fun-torah-tools-staging.web.app` and the
Firebase project `fun-torah-tools-staging`. It fails closed on other hosts or
Firebase projects. Do not point it at production or use real student accounts.

## Teacher workflow

- Choose an assigned class and create an assignment draft for Shorashim,
  Weekly Quiz, Rashi Letters, Chazara, or Posuk Practice.
- Set assigned and due dates, an optional target amount, and either the whole
  class or selected active students.
- Review the draft and per-student status table before publishing. Edit,
  unpublish, or archive assignments. Archive preserves student work.
- Review submitted answers and approve them or return them with feedback.

## Student workflow

- The staging student home links to My Homework only when the class grant is on.
- Students see only published assignments targeted to their class membership,
  and only on or after the assigned date.
- Activity links open the existing activity in another tab. Opening a link
  does not update the activity record or mark the assignment complete. Student
  work is submitted explicitly from the assignment card.

## Verification

Local synthetic authorization and lifecycle suite:

```powershell
node --test tests/homework-portal.test.cjs tests/homework-synthetic-privacy.test.cjs tests/homework-assignment-center.test.cjs assignment-center/assignment-policy.test.js
```

Staging browser checks are in `e2e-staging/staging-common.ts` and
`e2e-staging/public-smoke.spec.ts`. Run them only against the staging host:

```powershell
npx playwright test -c playwright.staging.config.ts --grep @smoke
```

For a preview channel, set `FTT_STAGING_SITE` to the returned preview URL before
running smoke or authenticated checks. The issue #406 channel is named
`homework-406-preview` and expires after seven days. Its Firebase config is
loaded from the existing staging site's generated public config and fail-closed
network guard. The deploy script verifies the generated config targets only
`fun-torah-tools-staging`, stores the public bootstrap files as ignored local
assets, and uploads them with the preview. The bootstrap runs only on this exact
channel hostname; the function CORS allowlist matches it.

Deploy with `scripts/deploy-homework-staging-preview.ps1`. The script first
verifies that the signed-in Firebase account can see project
`fun-torah-tools-staging` and Hosting site `fun-torah-tools-staging`. It then
deploys the Homework-only `homework-staging` functions codebase from
`firebase.staging-preview.json` and creates an expiring Hosting preview channel.
The isolated codebase prevents the staging deployment from inspecting unrelated
functions or requiring their secrets. The script never runs a live Hosting
deploy, publishes on the production project, or deploys database rules.

Authenticated tests require existing fictional TEST-ALEF accounts. Point
`FTT_STAGING_CREDENTIALS_FILE` at a local-only credentials JSON containing an
`adultAccounts` teacher for `TEST-ALEF` and a `studentAccounts` student for
`TEST-ALEF`. Keep that file out of Git; `staging/test-credentials.local.json`
is ignored. The new acceptance test creates, publishes, opens, submits,
approves, and archives an assignment, then checks that opening the activity
alone leaves the assignment incomplete.

The HTTP function `homeworkPortal` must be deployed to the staging project before
the signed-in flow can run. Deploy the function only with the explicit project
selector `--project fun-torah-tools-staging`; do not deploy backend changes to
`b3-games`. The staging static deployment must keep the existing staging
Firebase configuration and staging guard. A deployment that would replace
`firebase-config.js` with the production config is unsafe and must not run.
