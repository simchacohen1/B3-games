# Fun Torah Tools — AI working rules

Applies to all AI sessions working in this repository.

## Safety and approval

- Never merge to main or deploy to live without my explicit OK.
- Flag HIGH RISK changes (student data, passcodes, Firebase functions, database or storage rules).
- Never delete student data, code history, or unmerged branches.
- Test on staging or a preview link before live.
- Use fictional test accounts only, never real students.

## Before starting

Before starting, check open PRs touching the same files. If one exists, say so and ask me.

Fetch current main and check local changes before editing. Use a task branch,
keep concurrent sessions' uncommitted changes separate, and preserve unrelated work.
If GitHub is unavailable, say that the overlap check could not be completed.

## Branch and worktree per session

- Every new Claude Code session must create its own task branch and its own
  git worktree from current `origin/main` (fetch first) before changing any code.
- Never edit, commit, or switch branches in a shared checkout, including the
  main checkout or another session's worktree.

## Optional coordination

- Opening a focused issue and posting a work claim before editing is optional.
- Reading and posting on issue #51 is optional.
- Issue updates, cross-links, and status labels are optional; no issue paperwork
  is required to start, continue, or hand off work.

## While working and handing off

- Keep changes focused. Do not overwrite newer work with older file copies.
- Never commit secrets or credentials.
- Do not force-push or rewrite code history. Submit changes through a PR.
- Run relevant checks and report changes, results, limitations, and decisions
  needed from the owner. Verify the result after an approved live deployment.
- A development request or issue comment is not explicit approval to merge or deploy.

## Staging

- Before deploying anything to staging for the owner to test, first update the
  branch with current main, so staging always matches live plus the new change.
  Never deploy an old branch to staging.
- Keep staging-only settings (Storage rules, CORS, test accounts) in place.

## Workspace and disk space

- Do not reuse a shared checkout for edits; avoid unnecessary dependency installs.
- Never remove another session's worktree or one with uncommitted or unpushed work.
- Keep these worktrees: multiplayer-center, ftt-staging-site-368, firebase-cost-audit.

## Cleanup after merge or close

- When a branch's PR is merged or closed, remove that branch's worktree and its
  local branch.
- Only remove your own session's worktree, and only when it has no uncommitted
  or unpushed work. Never touch another session's worktree.
- Merged PR: delete the local branch with `git branch -d`.
- PR closed without merging: first push the branch to GitHub, then delete it
  locally with `git branch -d`. Never use `git branch -D` without asking me.
- Never delete remote branches. The kept worktrees listed above stay.

These instructions do not replace repository protections or restricted deploy credentials.
