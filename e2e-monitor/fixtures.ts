import { test as base, expect } from '@playwright/test';
import { installReadOnlyGuard, BlockedWrite } from './read-only-guard';

/** All monitor tests import `test` from here so every page is read-only. */
export const test = base.extend<{ blockedWrites: BlockedWrite[] }>({
  blockedWrites: [async ({ context, baseURL }, use, testInfo) => {
    const blocked: BlockedWrite[] = [];
    await installReadOnlyGuard(context, new URL(baseURL!).origin, blocked);
    await use(blocked);
    // Show what the site tried to save, so new writes are noticed.
    const unique = [...new Set(blocked.map(b => `${b.kind}: ${b.detail}`))];
    if (unique.length) testInfo.annotations.push({ type: 'blocked writes (not sent)', description: unique.join('\n') });
  }, { auto: true }],
});

export { expect };
