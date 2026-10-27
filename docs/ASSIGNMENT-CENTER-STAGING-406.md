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

The callable `homeworkPortal` must be deployed to the staging project before
the signed-in flow can run. Deploy the function only with the explicit project
selector `--project fun-torah-tools-staging`; do not deploy backend changes to
`b3-games`. The staging static deployment must keep the existing staging
Firebase configuration and staging guard. A deployment that would replace
`firebase-config.js` with the production config is unsafe and must not run.
