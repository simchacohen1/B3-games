# Unattended staging testing (issue #390)

Automated checks that run on GitHub's computers, so they keep going when the
owner's computer is off. They use only the isolated staging site
(https://fun-torah-tools-staging.web.app) and fictional accounts.

## What runs, and how often

| When | Workflow | What it checks |
|---|---|---|
| Every 30 minutes | Unattended staging tests (smoke) | 13 staging pages load; staging guard and banner present; Firebase points only at `fun-torah-tools-staging`; audio upload, Posuk scoring and Nigri sync are off; no requests to production hosts; no page errors; sign-in form shows; anonymous visitors cannot read student, class or private data. |
| Every 2 hours | Unattended staging tests (auth) | Fictional student A1 signs in and opens Weekly Quiz, Chazara, Shorashim, Rashi Letters, Posuk Practice, Yiddish, Student Rewards, Game Show; cannot read another class. Owner, both teachers and principal can read only the classes they should. |
| Nightly 04:41 UTC | Unattended staging tests (nightly) | Smoke + auth, the whole node test suite (`tests/**/*.test.cjs`) and the Firebase rules audit. |
| Nightly 06:17 UTC | Overnight reliability (existing) | Emulator rules tests and synthetic multi-teacher classroom journeys. Its scheduled failures are now filed as issues too. |
| Sun–Fri 10:30 UTC | Live site smoke check (existing) | Anonymous production page check. Its scheduled failures are now filed as issues too. |

GitHub can start scheduled runs late (sometimes 10–30 minutes) when it is busy.

## Results: passed, failed, could not run

Each run's summary page shows a table of **Passed / Passed on retry / Failed /
Could not run**. "Could not run" is never counted as a pass. Reasons include:

- `NOT VERIFIED: FTT_STAGING_CREDENTIALS_JSON secret is not configured` — every signed-in check.
- `BLOCKED: Cloud Function <name> is not deployed on staging` — Yiddish (`yiddishApi`) and Student Rewards (`studentRewardsLogin`) today. These checks turn themselves on once the function exists on staging.

## Issues it files

- One issue per failing suite, labelled `automated-test-failure` + `bug`, with severity, the failing checks, sanitized error text, reproduction steps and the run link.
- The next failing run updates the same issue quietly. It comments only when the set of failing checks changes, or once a day while still failing.
- When the suite passes again, the issue is closed automatically with a comment.
- Checks that could not run go into one quiet `automated-coverage-gap` issue per suite.
- Frequent (30-minute and 2-hour) runs stay green and report through the issue, so an outage does not email every 30 minutes. Nightly, manual and PR runs turn red on any failure.

## Secrets and evidence

- Credentials come only from the Actions secret `FTT_STAGING_CREDENTIALS_JSON` (the same JSON as the ignored local file `staging/test-credentials.local.json`). They are never in the repository.
- Playwright traces and videos are off because they would record typed passcodes. Failure screenshots (passcode box shows dots) and JSON reports are kept 7 days.
- The reporter redacts every passcode and password from the secret before writing summaries or issues.

## AI agents

- **Codex**: the ChatGPT Codex connector is installed. The owner can comment `@codex investigate this failure and open a draft PR with a regression test` on any automated issue. Bot comments cannot start Codex.
- **Claude**: `.github/workflows/ai-investigate-failure.yml` starts when the owner adds the `ai-investigate` label. It needs the Claude GitHub app (https://github.com/apps/claude) and the secret `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. Without them it only comments with these steps. It may open draft PRs only; it never merges or deploys.

## Running locally

```
npx playwright test -c playwright.staging.config.ts --grep @smoke
```

For signed-in checks, set `FTT_STAGING_CREDENTIALS_FILE` to the full path of `staging/test-credentials.local.json` and use `--grep @auth`.
