# Fun Torah Tools staging site

This directory contains staging-only build safeguards. It is not the production configuration and it does not provision or deploy Firebase resources.

## Current boundary

The Firebase project `fun-torah-tools-staging` is confirmed accessible and has an active Web app, Realtime Database instance and Firebase Hosting site. Read-only checks on October 26, 2026 confirmed billing is not linked, the Cloud Functions API is disabled, and no Cloud Storage bucket exists. The staging site must not be published or used for account testing until the requested services and their rules are verified. Missing configuration makes the build fail.

`prepare-site.cjs` operates on a generated site directory. It replaces the production Firebase Web configuration and known production Functions/scoring/sync endpoints, injects the guard before page scripts, and scans the output for production endpoint markers. The guard rejects Firebase initialization unless all Firebase options match the staging project and blocks requests to the known production endpoints.

## Build inputs

Provide these values through a protected, staging-only CI environment. Firebase Web API keys are client configuration, not server credentials; never place service-account keys, OAuth client secrets or other server credentials in the static site.

- `B3_STAGING_FIREBASE_API_KEY`
- `B3_STAGING_FIREBASE_AUTH_DOMAIN`
- `B3_STAGING_FIREBASE_DATABASE_URL`
- `B3_STAGING_FIREBASE_PROJECT_ID`
- `B3_STAGING_FIREBASE_STORAGE_BUCKET`
- `B3_STAGING_FIREBASE_MESSAGING_SENDER_ID`
- `B3_STAGING_FIREBASE_APP_ID`
- `B3_STAGING_POSUK_SCORER_URL` — optional distinct HTTPS staging/test service. If omitted, scorer calls are rewritten to the reserved inert host `staging-disabled.invalid`.

The project ID, Auth domain, RTDB URL and Storage bucket are checked against `fun-torah-tools-staging`. If a scorer URL is supplied, it must use a host labeled for staging, test or development. If omitted, scorer calls go to the reserved inert host `staging-disabled.invalid`. Nigri sync always stays disabled because its current browser protocol includes a shared key; the package removes that key and production origin. This allows safe packaging, while Posuk Practice scoring and Nigri sync must be reported as unavailable.

The Firebase project currently has billing disabled. A static preview is possible without billing, but it is not a working teacher/student test site: student PIN sign-in and other privileged workflows depend on Cloud Functions, and the existing staging RTDB rules/data have not been deployed and verified. Cloud Functions and Cloud Storage for Firebase require the Blaze plan. The production RTDB rules are not suitable for reuse.

Blaze includes no-cost monthly Functions allowances (2M invocations, 400K GB-seconds, 200K CPU-seconds and 5GB outbound networking), but deploying Functions also uses Cloud Build and Artifact Registry, which can incur separate charges. Eligible US-region Cloud Storage Always Free allowances include 5GB-month storage, 5,000 Class A operations, 50,000 Class B operations and 100GB outbound transfer. These are quotas, not a guarantee of zero cost: usage over them is billable. Budget alerts notify but do not stop spend; the Cloud Run Functions spend cap is a preview safeguard and not a hard cap. See [Functions pricing](https://firebase.google.com/docs/functions/faq-and-troubleshooting), [Storage billing changes](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024), [Cloud Storage pricing](https://cloud.google.com/storage/pricing), and [Firebase spend caps](https://firebase.google.com/docs/projects/billing/spend-caps).

The complete static site package is prepared with `node staging/package-site.cjs <source-checkout> <empty-output-directory>`. It copies the app files from the same checkout, excludes backend/server/config files and common credentials, rewrites Firebase and function endpoints, removes embedded production roster/ledger/sync data, disables unsupported scorer/sync endpoints, and runs the fail-closed source audit. Use an output directory outside the checkout; do not commit or deploy generated output.

## Testing

Run `node --test tests/staging-isolation.test.cjs` and `npx playwright test e2e/staging-isolation.spec.ts --project=chromium`. These are guard and packaging regressions with synthetic credentials. They do not prove deployed Firebase rules, Functions, Storage, external service isolation, authenticated tool coverage, or live staging readiness.

Do not change the production Pages settings, Firebase project, domains, rules, Functions, data or service billing as part of staging setup. A separate Pages destination and the staging-only backend remain required before publishing an owner-openable test URL.
