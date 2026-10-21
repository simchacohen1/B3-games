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
