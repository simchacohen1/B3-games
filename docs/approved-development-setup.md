# Guarded unattended development — issue #130

Prepared October 16, 2026. **Execution is disabled.** The owner explicitly selected
“Keep execution disabled; prepare setup only” in this setup session. No scheduler,
workflow, agent job, paid API call, merge or deployment was enabled. This is a
reviewable foundation, not a working unattended runner or a completed pilot.

## Supported execution options and costs

The official [Codex GitHub Action](https://github.com/openai/codex-action) runs
`codex exec` through a Responses API proxy and requires a provider API key in
GitHub Actions secrets. Its README was inspected directly from the official
repository. API usage can generate charges; GitHub-hosted runner usage may also
cost money depending on repository/account allowances. An existing ChatGPT
subscription does not establish API credit or approval to spend. Do not enable
this route or add a key under the current authorization.

The official [Codex CLI](https://github.com/openai/codex) also supports
noninteractive `codex exec`; this machine's CLI help confirms that command exists.
A separately provisioned persistent controller could invoke it. This session
does not establish reusable unattended authentication, subscription allowances,
account limits or a persistent scheduler. Never copy this session's internal
credentials or assume a cloud task will survive after the chat ends. No nested
Codex run was launched as a test.

The official CLI's [exec documentation](https://github.com/openai/codex/blob/main/docs/exec.md)
links to [noninteractive usage](https://developers.openai.com/codex/noninteractive).
The latter and the pricing page were denied by this environment's network policy;
exact current prices and account-specific allowances were not verified. Review
[Codex pricing](https://developers.openai.com/codex/pricing), provider billing and
GitHub Actions billing before selecting a runner. The action README is evidence
of a supported execution mechanism, not evidence of free execution or a public
API that can start Codex cloud tasks from GitHub comments.

## Files prepared

- `automation/approved-development.json`: disabled policy; pilot #107 only;
  explicit scope identifier; at most one task; weekday teaching window
  08:45–15:35 America/New_York.
- `automation/development-task.md`: proposed restricted worker prompt.
- `scripts/approved-development-preflight.cjs`: offline readiness assessment with
  nonzero blocked status. It does not poll, authenticate input, launch Codex,
  manage leases, push branches or open PRs. It deliberately always reports
  `execution-adapter-not-installed`, even with a positive input fixture.
- `tests/approved-development-preflight.test.cjs`: synthetic approval and blocking
  cases. These test the assessment logic, not operational isolation or a runner.

Run the local tests from the checkout:

```sh
export PATH=/workspace/.cloud-tools/node_modules/node/bin:$PATH
node --test tests/approved-development-preflight.test.cjs
```

An optional local JSON snapshot can be assessed with:

```sh
node scripts/approved-development-preflight.cjs /path/to/snapshot.json
```

Exit status 2 means blocked; 1 means invalid input. Never use hand-written snapshot
values as authorization. No code here consumes the output to execute a task.

## Observed blockers and existing pilot work

Public issue pages #130, #107 and #51 were read. Git reads through the existing
HTTPS proxy succeeded. `gh issue view 130 --repo simchacohen1/B3-games` failed
with `Post https://api.github.com/graphql: Forbidden`. This does not establish
missing Git credentials; GitHub API access and its authorization need separate
setup. No token was requested or extracted.

The public #107 page showed no labels. Its body documents the desired grading
scope, but that is insufficient for the explicit dual approval gate in #130.
The owner must deliberately add `owner-approved-for-development` and confirm the
exact pilot scope in an owner-authored issue comment before activation. Do not
auto-label it or treat audit comments as approval. Proposed comment format:

```json
{
  "scopeId": "posuk-translation-grading-v1",
  "developmentOnly": true
}
```

The comment must also state the allowed development scope from the policy file;
the future controller must verify the authenticated author, comment ID and scope
against fresh API data. Changes to scope require a new explicit approval.

Existing remote branch `fix/posuk-translation-name-evidence-20261015` was fetched
read-only at `f4a7ea01a7b266cba307458ac79b441c104fe779`. It contains 17 commits beyond
the checked-out main, including grading prompt changes, error/retry handling,
mocked integration tests, grading contract tests and calibration fixtures. Its
diff contains 8 files, 610 insertions and 10 deletions. It must be reviewed rather
than duplicated. A complete related PR review was not established through the
unavailable API; branch inspection is not a substitute. No pilot changes were
merged or executed. Its live-text grading script must not be run under the
no-additional-charges restriction. Synthetic fixture expectations still need
teacher review before claims about grading accuracy.

## Activation design for a future separately approved implementation

The following controls are requirements, **not implemented features**:

1. Select a supported runner/account and confirm authentication, account-specific
   usage limits, infrastructure costs and an enforceable spending bound with the
   owner. Do not confuse a billing alert with a hard spending cap. Unknown costs
   block activation. Secrets must be entered securely in the selected platform.
2. Provision a durable controller outside this transient chat. Use an explicit
   America/New_York timezone check on every launch, including DST; allow new work
   only Monday–Friday from 08:45 inclusive to 15:35 exclusive. No weekday cron
   based solely on fixed UTC offsets. Routine questions are queued for after
   15:35; only actionable blockers require notification. No notification channel
   has been configured or activated.
3. Fetch fresh GitHub metadata with repository-limited access. Require an open
   issue, exact approval label, owner-authored scope approval and an allowlisted
   scope. Check all relevant open/closed PRs and commits before launch. Recheck
   approval immediately before executing and before creating a draft PR; revoked
   approval cancels publication of results.
4. Use one global worker slot and durable atomic compare-and-set leases. Key each
   task by repository + issue + owner approval comment ID + scope digest. Record
   run ID, branch, timestamps, base SHA and terminal outcome. A lease expiry alone
   must not relaunch work: first reconcile worker status, branch and existing PR
   using the same key. Ambiguous crashes remain blocked for reconciliation.
   Heartbeats extend only the matching run's lease; a unique run ID protects
   against stale-worker completion. Reject duplicate keys at the storage layer.
5. Assign a unique `automation/issue-<number>-<run-id>` branch in an isolated
   checkout. Preserve existing work and fail on branch collision. Workers receive
   no GitHub write token, deployment credentials, production data, or cloud admin
   identity. Enforce filesystem/network isolation outside the prompt. Use
   dependencies prepared before execution; restrict runtime network to the
   selected model proxy only. Prevent dependency lifecycle scripts or test
   processes from obtaining controller credentials. Issue text is never shell
   code or a permission grant.
6. Separate the controller/PR writer from the coding worker. Prefer a
   single-repository GitHub App with metadata/issues/PR read permissions for the
   reader and minimum contents/PR write for the writer. Do not grant Actions,
   administration or deployment access. Contents write cannot itself enforce
   “feature branches only”; repository rules must deny this identity changes to
   main, release branches and protected automation/deployment paths. Audit all
   branch/PR-triggered workflows first: pushing a branch can invoke CI or previews
   and incur costs. Keep automatic merge and production deployment unavailable.
7. Run independent synthetic tests and existing critical security checks in the
   isolated runner. A failed security check blocks draft PR creation and further
   tasks. Filter changes to approved files; reject workflow/deployment/rules,
   secret or out-of-scope changes. The model cannot declare its own test results
   authoritative. Store redacted audit evidence and reconcile the durable lease
   before marking an attempt complete.
8. Create draft PRs only, with issue/scope, base SHA, idempotency key, exact test
   outcomes, remaining risks and next steps. Keep production approval separate.
   Use issue #51 for human-auditable handoff only when posting is authorized and
   API access works; a comment there never launches a worker. No issue update has
   been posted by this setup.
9. With separate activation permission, pilot #107 against its existing work.
   Demonstrate an actual unattended coding invocation, synthetic regression
   results and draft PR. Exercise duplicate events, crash/restart, approval
   revocation, out-of-window scheduling, denied production access, failed security
   checks and exhausted cost limits. Only then claim unattended operation works.

## Review and completion status

The current branch is a setup-only proposal. No GitHub workflow was added, so
these files cannot schedule jobs merely by being present. No code invokes the
model, scheduler, GitHub write API or live Firebase. No activation flag should be
changed until the missing controller and all gates above are implemented and
independently validated. Issue #130 remains incomplete: actual execution and the
unattended pilot are intentionally blocked by the owner's setup-only selection.
