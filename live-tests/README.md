# Live checks

These tests require real network access and, for account checks, an authorized **test** browser session. They have been moved out of the Node and isolated browser suites because `@playwright/test` needs its own runner. Their assertions are retained; no failing test was skipped or disabled.

Run account and public navigation checks separately:

```bash
FTT_TEACHER_STORAGE_STATE=playwright/.auth/test-teacher.json \
FTT_TEACHER_DISPLAY_NAME='Test Teacher' \
npm run test:live -- auth-check.spec.cjs

npm run test:live -- dashboard-navigation.spec.ts firebase-bandwidth.spec.cjs
```

The Firebase session export must include IndexedDB (`context.storageState({ path, indexedDB: true })`). Generate it only with an authorized test account and keep it in the existing ignored `playwright/.auth/` directory. It contains authentication material: never commit it, paste it into chat, or upload test-result traces containing authenticated sessions without review.

`interactive-bandwidth.spec.ts` uses an interactive browser pause and is a manual diagnostic, not an unattended CI acceptance test:

```bash
npm run test:live -- interactive-bandwidth.spec.ts --headed
```

`FTT_TEST_CHROMIUM=/usr/bin/chromium` optionally uses an existing system Chromium binary. Keep TLS verification enabled and use the platform's trusted certificate configuration when a network proxy is present.

These tests exercise the deployed website, not the unmerged repair branch. A passing guest or navigation check does not verify real recording approval, account saves, screen capture permissions, or delivered video. Those need the authenticated acceptance steps in `docs/OCTOBER-13-REPAIRS.md`.
