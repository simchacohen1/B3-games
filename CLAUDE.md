# Claude instructions for Fun Torah Tools

Before any changes, **read and comply with [AGENTS.md](AGENTS.md)** at the root
of this repository. It is the single source of truth for AI coordination.

In particular: check GitHub Issues and PRs for active agent claims; claim scope
before editing; use a separate branch/worktree; do not replace current files
with old copies; never push to `main` or deploy Firebase directly; obtain
explicit owner approval for production deployments.

If GitHub issues are unavailable or another agent has overlapping work, stop
rather than guessing. These instructions also apply to Claude Desktop.

## Worktrees: do not pile up project copies (disk space rule)
Each copy of B3-games is about 0.5 GB and his C: drive is nearly full. Every coding assistant (Claude, Codex, anyone else) must:
- Reuse an existing worktree or the main folder where possible. Do NOT create a new project copy for a small task; just make a branch in the folder you are already in.
- Remove any worktree you create once its PR is merged or closed (`git worktree remove <path>`, then delete the local branch). Check first that nothing is uncommitted or unpushed.
- Never run `npm install` or `npm ci` in a worktree that does not need it (for example when only editing HTML, docs or notes).
- Never delete a worktree you did not create, and never delete one with uncommitted work, without asking him first.
- Worktrees he still needs (never remove): multiplayer-center, ftt-staging-site-368, firebase-cost-audit.
