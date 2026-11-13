# Teacher Class Access Cloud Function deployment

## Verified production target

- The production application's version-controlled `firebase-config.js` uses Firebase project ID `b3-games`.
- Google Cloud project `b3-games` is ACTIVE (project number `568530046190`).
- The active Google Cloud principal has `roles/owner`; it can configure deployment IAM.
- The existing deployed teacher function uses runtime service account `568530046190-compute@developer.gserviceaccount.com`.
- `funTorahClassAccess` is not deployed yet.
- The local gcloud default is `fun-torah-tools-staging`. Do not rely on it. Every deployment must contain explicit `--project=b3-games`.
- The local Firebase CLI shim is broken, so deployment runs from GitHub Actions after `npm ci`; it does not deploy from this checkout.
- This procedure deploys one Gen 2 HTTP function. It does not deploy Hosting, Realtime Database rules, or other functions.

## Guarded deployment workflow

`.github/workflows/deploy-class-access.yml` is manual only. The workflow:
1. Runs only when `simchacohen1` dispatches it from `main`.
2. Accepts only the current, open, non-draft head SHA of PR #779.
3. Requires all expected PR check contexts and the latest result for every check run to be green. The expected list is the four branch-protection checks plus the teacher, principal, Follow Teacher browser and synthetic access checks. `navigation-policy` is not listed because its workflow is path-filtered and does not run on #779; its test files run inside `access-tests`.
4. Runs the focused class authorization and sign-in tests from that exact commit.
5. Authenticates through GitHub OIDC / Google Workload Identity Federation. It stores no service-account key or Firebase token.
6. Deploys only `functions:funTorahClassAccess` to `b3-games`.
7. Smokes the public HTTP handler: unauthenticated POST must return 401 and GET must return 405.

The WIF provider is restricted to this repository, `main`, `workflow_dispatch`, actor `simchacohen1`, and this exact workflow path. A branch or pull-request workflow cannot obtain production credentials.

## One-time Google Cloud setup

Use a Google Cloud account with project Owner rights. All commands specify the verified project.

```sh
PROJECT_ID=b3-games
PROJECT_NUMBER=568530046190
POOL_ID=github-actions-prod
PROVIDER_ID=teacher-class-access
DEPLOYER=github-functions-deployer
RUNTIME_SA=568530046190-compute@developer.gserviceaccount.com

gcloud services enable sts.googleapis.com --project="$PROJECT_ID"

gcloud iam workload-identity-pools create "$POOL_ID" \
  --project="$PROJECT_ID" --location=global \
  --display-name="GitHub Actions production deployment"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project="$PROJECT_ID" --location=global --workload-identity-pool="$POOL_ID" \
  --display-name="Teacher class-access deployment" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name,attribute.actor=assertion.actor,attribute.workflow_ref=assertion.workflow_ref" \
  --attribute-condition="assertion.repository == 'simchacohen1/B3-games' && assertion.ref == 'refs/heads/main' && assertion.event_name == 'workflow_dispatch' && assertion.actor == 'simchacohen1' && assertion.workflow_ref == 'simchacohen1/B3-games/.github/workflows/deploy-class-access.yml@refs/heads/main'"

gcloud iam service-accounts create "$DEPLOYER" \
  --project="$PROJECT_ID" --display-name="GitHub Functions deployer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudfunctions.developer"

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER@$PROJECT_ID.iam.gserviceaccount.com" \
  --project="$PROJECT_ID" \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/attribute.repository/simchacohen1/B3-games" \
  --role="roles/iam.workloadIdentityUser"
```

The deploy identity gets Cloud Functions Developer and Service Account User on the existing runtime identity. It does not receive Owner, Firebase Admin, database access, or a JSON key. Known gap found before first use: Cloud Functions Developer lacks `run.services.setIamPolicy`, which the Firebase CLI needs to make a newly created HTTP function publicly invocable. The owner must grant that single permission (custom role) or `roles/run.admin` to the deployer before the first deployment. If CI reports a missing permission, stop and review the exact permission before adding anything; do not broaden the role to Owner.

The deploy identity has no Secret Manager access and must not get any. Firebase CLI resolves every secret param (`defineSecret`) declared anywhere in the loaded functions codebase, even with `--only functions:funTorahClassAccess`, so deploying from `index.js` failed on `secretmanager.secrets.get` for `PARENT_DASHBOARD_SYNC_SECRET` (run 43372745863, attempts 4 and 5). The workflow therefore writes `backend/functions/class-access-deploy-entry.js`, which exports only `funTorahClassAccess`, points `package.json` `main` at it for that run, and fails if any other module of the codebase is loaded. Do not fix a secret error here by granting the deployer a Secret Manager role.

Wait for WIF/IAM propagation before dispatch. The workflow uses these exact identifiers:

- Provider: `projects/568530046190/locations/global/workloadIdentityPools/github-actions-prod/providers/teacher-class-access`
- Service account: `github-functions-deployer@b3-games.iam.gserviceaccount.com`

## Release order

1. Merge this workflow-only PR after its required checks pass; this does not publish the teacher UI or deploy a function.
2. Apply and verify the one-time WIF setup above.
3. Dispatch **Deploy teacher class-access function** from `main`, passing the exact green #779 head SHA. The workflow verifies PR state and check results before authenticating or deploying.
4. Verify deployment output and live unauthenticated HTTP smoke responses.
5. Run emulator tests for assigned-class allowed writes, unassigned/cross-class denial, owner Teacher View limits, and revocation. Use only fictional identities and test-only fixtures; never read or copy student data.
6. Only after the backend is live and access tests pass, update #779/#782 from current `main`, rerun exact-head required checks on the combined changes, then publish their UI changes. Verify the live Teacher Login pages and function again after each publication.

## Rollback

If the endpoint smoke or permission tests fail, keep the frontend PRs unmerged. Roll back only this function by deploying the last known-good function revision through the same owner-only workflow after adding a reviewed rollback path; do not change database rules or other functions.
