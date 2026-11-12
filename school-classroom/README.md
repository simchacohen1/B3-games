# School Classroom · Phase 1 foundation preview

Tracking: [B3-games Issue #792](https://github.com/simchacohen1/B3-games/issues/792). **Not deployed; not production-ready.**

This is an isolated, zero-dependency, static **fictional UI preview**. The tiles describe planned workflows, not working games, assignments, reports, authentication, or scoring. Preview role switching is illustrative and **NOT authorization**.

## Local preview
Serve the repository with any local static server, then visit `/school-classroom/index.html`. E.g. from the repository root: `python -m http.server 8000`. Run `node --test school-classroom/tests/*.test.mjs` for preview model tests.

## Isolation boundary
- No Firebase SDK, authentication, database rules, storage, Cloud Functions, service-account credentials, or deployment workflow.
- No imports or runtime navigation to the existing production Fun Torah Tools app.
- No live student data or user records; sample classes and teachers are invented.
- No automatic school-project creation; separate provisioning requires verified operator control.
- Do not add this directory to an existing live-site index or deploy it until isolation is tested.

## Full Phase 1 still required (not implemented)
1. Establish a genuinely separate Firebase project (distinct project ID, RTDB/Firestore, Storage, Auth, Hosting and billing configuration), with least-privilege service principals and verified project alias.
2. Implement Google sign-in for teachers and administrators; student-specific secure authentication; backend claims and grants; revocation handling.
3. Implement principal/admin roster and class management with backend-enforced permissions; do not rely on the role dropdown shown here.
4. Write security rules and emulator tests for school/teacher/class/student separation, including negative permission tests.
5. Authenticate fictional accounts against isolated staging. Never reuse existing B3 production credentials or student data.
6. Audit reuse candidates: PR #790 Weekly Shorashim, #779/#782 Teacher Login, #411 Homework, plus PDF Library, Rewards, assessment and report modules. Review licensing before copying from school-games.
7. Open focused feature issues/PRs for the backend, authentication and each reused module. Require explicit production deployment approval.

## Scope boundary
The original Classroom Assignment Platform scope document is authoritative when supplied. Until then avoid locking down unspecified interaction details. No Chumash Racer/Lava Traveler in the school platform (they remain part of Weekly Shorashim).
