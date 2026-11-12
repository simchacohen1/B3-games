# School Classroom — Rabbi Mayer Kosofsky collaborator handoff

**Status (2026-11-12): preparation only.** The independent school repository, invitation, isolated Firebase project, protected branches, CI/CD, and staging URL are **not yet created or verified**. Do not interpret this guide as permission to access B3 production or publish student-facing features.

## People and existing projects

- Fun Torah Tools (owned by Simcha): https://github.com/simchacohen1/B3-games
- Rabbi Kosofsky's existing games repository: https://github.com/rabbimkosofsky-droid/school-games
- School Classroom tracking: https://github.com/simchacohen1/B3-games/issues/792
- School Classroom prototype (draft, fictional only): https://github.com/simchacohen1/B3-games/pull/793
- Existing shared coordination: https://github.com/simchacohen1/B3-games/issues/51

**Target architecture:** separate School Classroom repository AND separate Firebase Auth, database, storage, functions, hosting and deployment credentials; reuse vetted Fun Torah Tools code via reviewed changes rather than giving the new project production credentials.

## What Rabbi Kosofsky needs

1. Sign in to GitHub as `rabbimkosofsky-droid` (confirm this is the intended account).
2. Have his own ChatGPT Work or Claude coding-capable account, and connect **only the separate School Classroom repository** to it.
3. Accept the GitHub repository collaborator invitation when the owner sends it.
4. Give his agent the project documents and the scope document for Classroom Assignment Platform; describe desired behavior directly, approve designs as educational owner, and test on school staging with fictional accounts.
5. Never share passwords, tokens, service-account keys or real student records in issues or AI prompts.

## Owner-only one-time setup checklist

- [ ] Decide repository ownership/name (recommended: `simchacohen1/school-classroom`; alternate: school-owned GitHub organization).
- [ ] Create **separate private repository** with the school prototype and a copy of this guide; ensure no B3 production config, student data or secrets are carried across.
- [ ] Verify source-code/dataset licensing and written permission where needed for reuse from `school-games` or B3-games.
- [ ] Invite `rabbimkosofsky-droid` as collaborator on the NEW school repo; do not invite him as a write collaborator to the production B3-games repo.
- [ ] Configure protected `main` branch/ruleset: PRs required, required CI checks, stale-review dismissal where applicable, no force pushes/deletion, restricted bypasses, and appropriate review rules.
- [ ] Grant Rabbi Kosofsky freedom to create branches, PRs and publish to isolated **school staging** through a restricted deployment workflow. This may require a school-specific `develop` / staging branch. Do not grant B3 production deployment access.
- [ ] Provision/verify separate Firebase project and billing limits/alerts, Auth/database/storage/functions/hosting; least-privilege deploy identity and restricted CI environment. Use fictional accounts first.
- [ ] Add automated tests for privacy, role/class isolation, regression and build; ensure production deploys require separately approved environment permissions.
- [ ] Confirm that the school-specific release authority (Rabbi Kosofsky for routine school decisions) and the owner-only boundaries (B3 changes, secrets, first real-student launch) are documented.
- [ ] Send the invite and test: Rabbi Kosofsky accepts, agent creates a test branch, PR passes checks, a staging preview works with fictional identities.
- [ ] Review draft PR #793 and separately migrate or cherry-pick ONLY approved school-specific files into the new repo. Do NOT merge #793 into B3 production just to establish the school project.

### Recommended permissions
Rabbi Kosofsky: **write** to school repo for branch development; permission to publish to isolated staging once CI and deployment guards are configured. Only approved maintainers can alter protected main or production deployment rules. The exact GitHub settings and review eligibility depend on repo ownership and plan; verify enforcement, not just instructions.

## Agent coordination contract (both assistants)

Before any code changes:
1. Read the school repo's AGENTS.md, project Issue and open PRs.
2. Record feature area, exact files/components, current base commit, planned tests, and deployment impact in a shared issue.
3. Claim a scope. A GitHub comment is **not an atomic lock**: use a serialized claim mechanism (e.g. one coordination bot/queue or repository rule) for genuinely exclusive work. If two agents claim the same component simultaneously, neither may integrate until the overlap is resolved.
4. Use distinct branches; never push to the same work branch as another agent.
5. Keep tasks separate when possible (student game, teacher reporting, scoring backend, etc.).

Before integration/deployment:
1. Re-fetch latest target branch and current issues/PRs.
2. Check both **Git code conflicts** and **semantic/design conflicts** (including layout requests that both compile but disagree).
3. Run automated checks and a fictional-account staging journey.
4. If changes disagree, ask the designated educational decision-maker; **do not** silently choose the last edit. Record the decision as an issue acceptance criterion.
5. Protected branches and deployment workflows must enforce these checks. Instructions alone do not prevent accidental merges.
6. Ensure only one serialized staging publish is active for the shared site. Independent per-PR previews can run in parallel.
7. No merge/deploy to B3 production or access to B3 student data; school real-student release only after security/privacy/backup checks and explicit release approval.

## Educational and operational responsibilities

Rabbi Kosofsky: curriculum, classroom assignment interactions, student experience, school feature acceptance, school-specific priorities and routine staging decisions.

Simcha: reusable Fun Torah Tools components, integration guidance, shared-code change reviews, B3 production authority.

Joint decision only when changes affect **both** products, licenses/rights, billing/privileged infrastructure, access to student information, or previously agreed shared functionality.

## First prompt Rabbi Kosofsky can give his AI

> You are my school-platform development assistant. I am Rabbi Mayer Kosofsky, the educational owner for School Classroom. Work only in the separate school repository to which I have been invited, not in production Fun Torah Tools. First read AGENTS.md, this onboarding guide, the project issue, active work claims, and open PRs. Verify staging and fictional accounts before any deploy. I want to explain features in ordinary language and see working prototypes rather than exchange programming instructions. Record my requirements and acceptance criteria in GitHub. Claim a narrow scope, work on a dedicated branch, test it, and publish an independent preview or isolated school staging change where authorized. Before merging, compare both open work and product requirements for semantic conflicts. If another assistant is changing the same component, do not overwrite their work. Ask me only for genuine educational decisions; consult Simcha only for B3 changes or shared security/infrastructure matters. Do not touch real student information or unapproved production systems.

## First session acceptance test

- Rabbi Kosofsky can see the new school repo and create a branch/PR using his own AI.
- He can request a small fictional-content change and see the result on a temporary preview or isolated school staging.
- CI passes and fails intentionally on a deliberately invalid test.
- A second concurrent conflicting layout PR is detected by integration review before both can land.
- Nothing at https://funtorahtools.com or the current B3 Firebase system changes.

**Until the repository and staging are provisioned, the above are goals, not completed capabilities.**
