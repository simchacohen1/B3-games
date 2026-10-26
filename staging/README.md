# Fun Torah Tools staging site

This directory contains staging-only build safeguards. It is not the production configuration and it does not provision or deploy Firebase resources.

## Current boundary

The Firebase project `fun-torah-tools-staging` is confirmed accessible and has an active Web app, Realtime Database instance and Firebase Hosting site. Cloud Functions and Storage are not yet verified. The staging site must not be published or used for account testing until the requested services and their rules are verified. Missing configuration makes the build fail.

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
- `B3_STAGING_POSUK_SCORER_URL` — a distinct HTTPS staging/test service, if this dependency is included
- `B3_STAGING_SYNC_URL` — a distinct HTTPS staging/test service, if this dependency is included

The project ID, Auth domain, RTDB URL and Storage bucket are checked against `fun-torah-tools-staging`. External scoring/sync services must use a host labeled for staging, test or development. The generator refuses missing or production values.

## Testing

Run `node --test tests/staging-isolation.test.cjs` and `npx playwright test e2e/staging-isolation.spec.ts --project=chromium`. These are guard and packaging regressions with synthetic credentials. They do not prove deployed Firebase rules, Functions, Storage, external service isolation, authenticated tool coverage, or live staging readiness.

Do not change the production Pages settings, Firebase project, domains, rules, Functions, data or service billing as part of staging setup. A separate Pages destination and the staging-only backend remain required before publishing an owner-openable test URL.
