# Fun Torah Tools staging site

This directory contains the isolated staging build and provisioning workflow for Firebase project `fun-torah-tools-staging`. It does not change production configuration.

## Deployed staging scope

- Hosting site: `https://fun-torah-tools-staging.web.app`
- Firebase project: `fun-torah-tools-staging`
- Realtime Database rules: `database.rules.json` (private by default; authenticated, role/class scoped access)
- Cloud Functions codebase: `backend/functions-staging` (only the student auth, teacher claim, student management, Weekly Quiz, and reward functions required for the fictional test fixtures)
- Audio/Storage uploads, Posuk scorer, and Nigri sync are disabled. No Firebase Storage bucket is provisioned.
- Do not run production deployment commands or merge PR #373 as part of staging work.

The `firebase.staging.json` config names the staging Hosting site, staging database rules, and the minimal staging Functions codebase. Deploy only with `firebase --config firebase.staging.json deploy --project fun-torah-tools-staging` after confirming the active CLI project and reviewing the config.

## Fictional data and accounts

`fictional-accounts.json` describes the fictional owner, principal, two teachers, three students, and three separate classes. Run `provision-fictional-accounts.ps1` only against the staging project. It refuses to overwrite a non-empty database. Passwords and passcodes are written to ignored local file `test-credentials.local.json`; never commit or post that file or its values. The accounts are test-only and must not be reused for real people.

## Build and checks

Build the static package with:

```
node staging/package-site.cjs <source-checkout> <empty-output-directory>
```

This copies app files, excludes backend/server code and repository-only documents, replaces Firebase settings with staging config, strips known production rosters/ledgers and production integrations, disables scorer/sync, and runs a fail-closed audit. `student-tool-policy.js` is copied as the one browser helper needed by the app.

Run local checks:

```
node --test tests/staging-isolation.test.cjs tests/staging-auth-claims.test.cjs tests/student-auth.test.cjs tests/weekly-quiz-student.test.cjs
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\simch\AppData\Local\ms-playwright'
node ..\..\node_modules\@playwright\test\cli.js test e2e/staging-isolation.spec.ts --project=chromium
```

Live coverage is in `e2e/staging-live.spec.ts`. It reads the ignored local credentials file and exercises student sign-in/tools, adult roles, class isolation, disabled integrations, and login timings. It requires public network/DNS access and a functioning staging project. A successful static load alone does not prove authenticated Firebase flows work.

## Cost and safety notes

Blaze billing is enabled on staging with an owner-configured $5 monthly budget alert. An alert is not a spending cap. The Functions source/artifact buckets are used by deployment; no Firebase Storage service/bucket is enabled. Keep functions limited to the staging codebase and avoid adding paid services without owner approval. The student custom-token function requires the staging runtime service account to have the narrow `iam.serviceAccountTokenCreator` permission needed for `signBlob`; verify runtime sign-in after IAM propagation. Scorer and Nigri integrations remain off until separately reviewed.
