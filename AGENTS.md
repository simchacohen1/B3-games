# Fun Torah Tools — shared AI coordination contract

Applies to ChatGPT, Claude, Claude Desktop, Codex, and any other AI or human
making changes to this repository. These are operating instructions, **not**
technical enforcement; repository protections and credential restrictions are
still required.

## Before editing anything
1. Fetch latest `main`, inspect working-tree changes, the relevant open GitHub
   Issues and PRs, and recent commits. Never assume your local copy is current.
2. Open or find one GitHub Issue for the requested task. State the acting agent,
   target files/directories, any backend or Firebase impact, current base SHA,
   expected tests, and whether this is a production-impacting change.
3. Read active work claims on other open Issues/PRs. If any affected files or
   behavior overlap, **stop and coordinate on the Issue before editing**.
4. Post an explicit work claim on the Issue. Other agents are expected to read
   it. A GitHub Issue comment is *not* an atomic lock; two simultaneous claims
   can still race. If you cannot check the shared Issues, do not modify files.
5. Make a dedicated branch/worktree from the newest `main` for each task.
   Keep each agent's uncommitted local changes isolated. Do not reuse a shared
   checkout for concurrent work.

## While working
- Preserve unrelated behavior and changes. Modify only the claimed scope.
- Never replace a whole file from an older downloaded copy. Compare against the
  newest branch file and apply narrowly scoped edits.
- Do not run destructive cleanup, `git reset --hard`, forced pushes, branch
  deletion, or bulk file replacement on shared work without explicit approval.
- No direct pushes or force pushes to `main`; submit a PR from your task branch.
- Do not infer compatibility from conflict-free merges: run regression tests.
- For student sign-in, student privacy/data, permissions, teacher access,
  Firebase functions, or database/storage rules, flag as **high risk** and
  require targeted review and testing.
- Do not commit secrets, private student records, or credentials.

## Before merging or deploying
- Rebase or update from current `main`, review complete diff for lost changes,
  review active work claims again, and run relevant automated tests.
- Link the PR to the Issue and state: files touched, intended changes,
  test results, risks, and whether deployment is included.
- A green test run is necessary but is not proof of behavioral compatibility.
- **Production approval:** The project owner requires explicit approval before
  any production website or Firebase deployment. An AI may perform all GitHub
  and deployment steps *after* that approval. A request to develop code is not
  automatically approval to publish it.
- Do not merge a production-triggering PR until approval is recorded and the
  repository's protections permit it. Never deploy Firebase directly from a
  local folder or unreviewed branch.
- After deployment, verify the live result and report the commit, affected
  services, tests, and outstanding issues. Update/close the task Issue.

## Handoff
Keep the Issue current with `CLAIMED`, `WORKING`, `PR OPEN`, `BLOCKED`, or
`COMPLETED`. When blocked, explain who or what has the conflicting claim.
Do not make up another agent's approval. AI conversations have no automatic
shared memory; GitHub Issues and PRs are the handoff record.

## Technical enforcement still to configure
Repository administrator must protect `main` from direct pushes, force pushes,
deletion and unreviewed merges; require suitable always-running PR checks; and
restrict who can bypass protections. Deploy credentials, especially Firebase,
must not be shared with unrestricted AI sessions. Automatic merges must not
bypass the separate owner-approval gate for production. Configure and verify
these settings before treating this policy as enforced.
