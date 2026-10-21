# Synthetic sign-in / security lab

Run from the repository root on the existing PR #283 development branch. This lab uses `demo-signin-lab` and `demo-b3-security`, synthetic student/custom-token identities, and synthetic Google identities accepted only by the Auth emulator. It never imports production configuration, accounts, passcodes, or records.

Prerequisites:
- `npm ci --ignore-scripts`
- Java 17+ and database emulator 4.11.2 at `~/.cache/firebase/emulators/firebase-database-emulator-v4.11.2.jar` (or set `FIREBASE_DATABASE_EMULATOR_JAR`).
- A cached `firebase-tools@14.22.0` installation (`npx --yes firebase-tools@14.22.0 --version`), or set `FIREBASE_TOOLS_ROOT` to the installed package folder. The runner loads its Auth emulator directly, so Java/Node tests share one process tree.
- Playwright-compatible Chromium. Set `SIGNIN_LAB_CHROMIUM` to its executable. In the restricted Work runtime, `npx --yes --package playwright@1.51.1 playwright install chromium` downloaded the working Chromium 134 headless shell; the runner detects its standard cache location. Newer synthetic-version browser downloads were unavailable. Single-process/no-zygote flags avoid unavailable Unix sockets in this runtime; each isolated scenario launches a fresh browser.

```sh
node scripts/signin-lab/run.cjs
```

If this environment proxies even local WebSockets, run with proxy variables removed for this local-only process:

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u WS_PROXY -u WSS_PROXY -u ws_proxy -u wss_proxy NODE_USE_ENV_PROXY=0 SIGNIN_LAB_RESULTS=/tmp/pr283-results.json node scripts/signin-lab/run.cjs
```

The runner binds HTTP to 127.0.0.1:18783, Auth to 127.0.0.1:19099, and RTDB to 127.0.0.1:19100. All writes seed synthetic emulator data. The checked-in hardened rules are installed only into the emulator. Browser request routing aborts unexpected non-local HTTP traffic; deliberate CDN failures exercise the local SDK fallback, and font CSS is stubbed. SDK-created named apps are connected to the emulators, and any non-demo project initialization is rejected. No Firebase CLI deploy command is used.

The runner first runs the 18 existing RTDB security tests, then browser scenarios and controlled before/after gate timings. It uses the actual checked-in gate, site-settings, Firebase SDK, and student-tool policy; the gate database URL is replaced only in the HTTP response served by the lab. Synthetic tool-shell tests cover representative activity IDs. Additional page tests use actual Halacha and Rewards HTML/JS with injected emulator bootstrap and a single bundled SDK version. They do not establish that every exercise, save operation, tool-specific login path, or production dependency works.

Timing baseline is `3aafc7c:game-gate.js`; candidate is the current file. Each REST response gets a controlled 120 ms delay. Samples measure navigation to first verified access in a reused authenticated session. Request counts are recorded both at first access and after settling. These measurements are local gate performance, not real-world homepage credential sign-in latency or production p95.

Keep the PR draft if any required check fails. Do not use `tests/auth-check.test.cjs` here: it navigates to the live site and expects a real account.

## HTTP handler / passcode / Google popup staging

The extended mode uses the actual checked-in `onRequest` handlers with Express, Firebase Admin SDK, and the same local Auth/RTDB emulators. It does not load the aggregate functions entrypoint or start AI, speech, storage, or production services.

Install its development-only dependencies outside the repository:

```sh
npm install --prefix /tmp/pr283-backend-deps --no-audit --no-fund --ignore-scripts firebase-admin@12 firebase-functions@5 express@4
```

Set `SIGNIN_LAB_BACKEND_DEPS` to another `node_modules` directory if desired. No production service-account credential is used; the lab initializes only the demo project and emulator owner credential. Handler logs retain only endpoint name, action, and HTTP status.

The Google popup emulator needs Google's public GAPI JavaScript loader and iframe library. Download these public static dependencies before isolated testing; the browser receives local cached copies and does not contact Google OAuth or a real account:

```sh
curl -fsSL https://apis.google.com/js/api.js -o /tmp/pr283-google-api.js
curl -fsSL 'https://apis.google.com/_/scs/abc-static/_/js/k=gapi.lb.en.etOqPKhAhvg.O/m=gapi_iframes/rt=j/sv=1/d=1/ed=1/rs=AHpOoo-l5JrVgGKVELwC844E6riBHX86-w/cb=gapi.loaded_0' -o /tmp/pr283-google-iframes.js
```

Tested SHA-256 values:
- Loader: `0b457226090bfca08168d9e4d6dcaef5d483731bd19b57dbd7f5d18d4f3e61cc`
- Iframes: `b3c43cab4f24dcc540ac867d50feb0dc31f2f3261685f65e221f5f0277395f75`

Override paths with `SIGNIN_LAB_GAPI` and `SIGNIN_LAB_GAPI_IFRAMES`. The cached loader receives the SDK-requested onload callback locally. Font styles and optional emulator Material UI assets are stubbed; authentication itself uses the real Firebase SDK popup flow and Auth emulator.

```sh
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy -u WS_PROXY -u WSS_PROXY -u ws_proxy -u wss_proxy NODE_USE_ENV_PROXY=0 SIGNIN_LAB_STAGE=1 SIGNIN_LAB_RESULTS=/tmp/pr283-staging.json node scripts/signin-lab/run.cjs
```

This mode verifies actual homepage name/passcode submission, wrong-password refusal, refresh, real Halacha/Rewards token exchanges, separate ET/WT tool sessions, Rewards token reuse, Google popup/invitation claim, unauthorized teacher refusal, Quiz UI submission, server-side scoring/duplicate protection, and disabled/invalid-token denial. Writes are synthetic emulator fixtures/results only. Unexpected non-local browser requests fail the run. This is local HTTP staging; it does not validate Cloud Functions hosting, production CORS/IAM, or Google production OAuth configuration.

`SIGNIN_LAB_CASE` runs a matching staging case and skips the already completed security suite for focused debugging. Unset it for a complete run. `SIGNIN_LAB_SKIP_PERFORMANCE=1` runs the original nine browser regression scenarios without repeating the earlier controlled-delay benchmark.
