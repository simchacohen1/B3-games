# Claude instructions for Fun Torah Tools

Before any changes, **read and comply with [AGENTS.md](AGENTS.md)** at the root
of this repository. It is the single source of truth for AI coordination.

In particular: check GitHub Issues and PRs for active agent claims; claim scope
before editing; use a separate branch/worktree; do not replace current files
with old copies; never push to `main` or deploy Firebase directly; obtain
explicit owner approval for production deployments.

If GitHub issues are unavailable or another agent has overlapping work, stop
rather than guessing. These instructions also apply to Claude Desktop.

## Worktrees: one per session, cleaned up after merge (disk space rule)
Each copy of B3-games is about 0.5 GB and his C: drive is nearly full. Every coding assistant (Claude, Codex, anyone else) must:
- Every new session must create its own task branch and its own git worktree from current `origin/main` (fetch first) before changing any code. Never edit, commit, or switch branches in the main folder or any other shared checkout.
- When your branch's PR is merged or closed, remove your worktree (`git worktree remove <path>`) and delete the local branch. Check first that nothing is uncommitted or unpushed. Merged: `git branch -d`. Closed without merging: push the branch to GitHub first, then `git branch -d`. Never use `git branch -D` without asking him. Never delete remote branches.
- Never run `npm install` or `npm ci` in a worktree that does not need it (for example when only editing HTML, docs or notes).
- Never delete a worktree you did not create, and never delete one with uncommitted work, without asking him first.
- Worktrees he still needs (never remove): multiplayer-center, ftt-staging-site-368, firebase-cost-audit.
