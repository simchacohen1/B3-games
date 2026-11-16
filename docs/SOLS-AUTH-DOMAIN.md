# SOLS Google sign-in domain

Status (2026-11-15): implementation enabled in PR #838; **not deployed**.
**HIGH RISK authentication change: do not merge until real sign-in verification
passes and the owner explicitly approves release.**

## Implementation and scope

`sols-site/auth-domain.json` enables `auth.sols.tools` in the generated SOLS
copy. `sols-site/auth-domain.cjs` changes all 12 production configuration files
containing authDomain literals together, including the shared Firebase config
and inline fallbacks in teacher/game/recording tools. Default and named apps
(including FTTRememberedTeacher) consequently receive the same domain.
The production project remains b3-games. The build refuses staging source configs.

Source funtorahtools.com configuration remains b3-games.firebaseapp.com. The main
SOLS website remains on GitHub Pages through the existing sync workflow; Firebase
Hosting serves the authentication subdomain only. No Hosting release is required
by this PR. The optional firebase.auth-hosting.json is not run by this change.

No SDK upgrade, sign-in-method, persistence, app-name, API-key, UID, role,
permission, database, function, student-data, recording or reward change is made.
The remembered-teacher restoration and explicit sign-out behavior are retained.
Changing authDomain does not change the application's origin or its existing
Firebase persistence keys (API key and app name). This supports continuity but
is not evidence that existing live sessions have been tested after cutover.

## External setup and independent checks

The owner reports Firebase Hosting Connected with working HTTPS for auth.sols.tools,
Cloudflare DNS-only CNAME auth -> b3-games.web.app, no redirect, Google enabled,
public-facing project name sols.tools, and both redirect URIs retained on the
existing Google Web OAuth client. Handler and iframe were opened by the owner.
No DNS, Firebase, OAuth, account or permission settings were modified here.

Independent read-only checks in this session:

- Production Firebase Auth public project configuration includes localhost,
  b3-games.firebaseapp.com, b3-games.web.app, simchacohen1.github.io,
  funtorahtools.com, www.funtorahtools.com, sols.tools, www.sols.tools and
  **auth.sols.tools** as authorized domains.
- Firebase accounts:createAuthUri produces Google authorization URLs using the
  **same existing client** for both handler addresses:
  `568530046190-635djfva1m4s1rbl07t2d5pvq8q27hhs.apps.googleusercontent.com`.
  The custom request uses https://auth.sols.tools/__/auth/handler; the legacy
  request uses https://b3-games.firebaseapp.com/__/auth/handler. These are URL
  generation checks, not successful Google consent or redirect acceptance.
- The legacy handler returns HTTP 200.
- Direct requests to sols.tools and auth.sols.tools are denied by this Cloud
  environment's enforced outbound hostname policy (proxy CONNECT 403). The
  custom handler/iframe content, TLS and DNS could not be independently inspected.
  This is an environment limitation, not evidence that the endpoint is broken.
- No shared-desktop/browser-control tool is exposed for an interactive account
  handoff. Headless Chromium is available for isolated synthetic browser tests.

## Automated verification

73/73 focused Node tests passed:

```
node --test tests/sols-auth-domain.test.cjs tests/sols-pointer-only.test.cjs \
  tests/teacher-remember-login.test.cjs tests/migration-access.test.cjs \
  tests/student-auth.test.cjs tests/homework-staging-deployment-isolation.test.cjs
```

The source-wide audit checks all 12 production config files, unchanged session
and permission code, consistent inline fallbacks, idempotence, disabled-build
legacy fallback, resource preservation and staging exclusion. The SOLS build
fixture runs with activation enabled.

The existing `tests/teacher-center-auth-browser.test.cjs` passed in Chromium:
synthetic ET/WT/new-class teachers, principal, owner, remembered returning teacher
and popup sign-in rendering, including class scoping and authorization waits.
Firebase is mocked in that suite; no real account or student data is used.
An additional isolated browser smoke check loaded the actual vendored Firebase
SDK and initialized default and FTTRememberedTeacher apps with auth.sols.tools,
b3-games and the existing SESSION/LOCAL persistence modes. It did not authenticate.
Syntax checks and git diff --check passed.

## Remaining release blockers

Real Google login is **BLOCKED, not passed**. No safe authenticated Google test
account/session with known role assignments was available during verification.
Before merge, allow sols.tools and auth.sols.tools in the test environment's
outbound policy and provide an owner-operated fictional adult test session on an
approved preview. Do not use real students, change permissions, or modify staging.

Verify desktop Chrome and real Android: sign-in starts on SOLS, the chooser uses
the custom domain and existing client, and authentication returns to teacher home;
teacher/admin/principal permissions remain correct; Pointer and Class Access
reuse the session; sign-out/sign-in works; refresh and tab reopening work;
student passcode access remains functional with fictional fixtures. Exercise
popup-blocked redirect fallback and recovery: a sibling auth domain alone does
not prove cross-origin redirect-storage compatibility. No authenticated staging
test was performed; staging is outside this task's mutation scope.

An isolated preview has different browser storage and cannot prove preservation
of existing sols.tools sessions. Check an existing production session immediately
after an explicitly approved release. No production merge, sync, Firebase Hosting
release or deploy has been performed. PR #838 remains draft and not safe to merge
until the above pre-release checks pass and the owner approves.

## Rollback

Set `sols-site/auth-domain.json` enabled to false, then build/sync from a **fresh
source checkout**, after explicit production approval. The source production
config and all source inline fallbacks retain b3-games.firebaseapp.com. Do not
reuse an already transformed output for rollback. Keep both OAuth redirect URIs,
all authorized domains and the custom helper available; let in-flight sign-ins
finish. No account/data migration or replacement OAuth client is needed.
