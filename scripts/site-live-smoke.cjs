'use strict';
// Anonymous, read-only check of the LIVE site at funtorahtools.com.
//
// What this does NOT do: sign in, use any account, read or write any class or
// student data, or deploy anything. It only looks at the public pages the way a
// stranger with no account would.
//
// It answers two questions:
//   1. Did the change I merged actually reach the live site?
//   2. Do the main pages still load without crashing, and stay locked to
//      visitors who are not signed in?

const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = 'https://funtorahtools.com/';

// Files whose published copy must match this repository. If one of these is
// stale, a merged change never reached the live site.
const PUBLISHED = [
  'index.html',
  'shorashim/index.html',
  'shorashim/app.js',
  'sefer-hamitzvos/index.html',
  'class-pointer-prototype/dashboard.html'
];

// Pages to open in a real browser. Each entry says what must be true for a
// visitor who is NOT signed in.
const PAGES = [
  {
    name: 'Home',
    path: 'index.html',
    title: 'Fun Torah Tools'
  },
  {
    name: 'Shorashim',
    path: 'shorashim/index.html',
    title: 'Shorashim Learning Lab',
    // The practice area must stay hidden until a student or teacher signs in.
    mustStayHidden: '#appShell'
  },
  {
    name: 'Sefer HaMitzvos',
    path: 'sefer-hamitzvos/index.html',
    title: 'Daily Sefer HaMitzvos • Fun Torah Tools'
  },
  {
    name: 'Class Pointer',
    path: 'class-pointer-prototype/dashboard.html?teacher=1',
    heading: 'Classroom Sharing',
    // Nobody signed out may see a class to start.
    mustHaveNone: '#teacherClassButtons button'
  }
];

const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = process.env.GITHUB_SHA || 'site-smoke';

const problems = [];
const warnings = [];

async function verifyPublishedFiles() {
  // GitHub Pages and its CDN can take a few minutes after a merge, so keep
  // retrying before calling a file stale.
  const pending = new Set(PUBLISHED);
  const deadline = Date.now() + 6 * 60 * 1000;

  while (pending.size && Date.now() < deadline) {
    for (const path of Array.from(pending)) {
      try {
        const url = new URL(path, ROOT);
        url.searchParams.set('release-check', stamp);
        const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (response.ok && sha(await response.text()) === sha(fs.readFileSync(path, 'utf8'))) {
          pending.delete(path);
          console.log('Live copy matches the repository:', path);
        }
      } catch (error) {
        console.log('Still waiting for:', path, '(' + error.name + ')');
      }
    }
    if (pending.size) {
      console.log('Waiting for GitHub Pages:', pending.size, 'file(s) not updated yet');
      await pause(15000);
    }
  }

  for (const path of pending) {
    problems.push('The live site is still serving an old copy of ' + path +
      '. A merged change has not reached funtorahtools.com.');
  }
}

async function checkPages() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();

    // Keep this check anonymous: never touch the real database, stored files or
    // backend functions.
    await context.route(
      /(?:firebaseio\.com|firebasedatabase\.app|firebasestorage\.googleapis\.com|cloudfunctions\.net)/,
      route => route.abort()
    );
    await context.routeWebSocket(
      /(?:firebaseio\.com|firebasedatabase\.app)/,
      ws => ws.close()
    );

    for (const page of PAGES) {
      const tab = await context.newPage();
      const errors = [];
      tab.on('pageerror', error => errors.push(error.message));

      try {
        const url = ROOT + page.path + (page.path.includes('?') ? '&' : '?') +
          'release-check=' + encodeURIComponent(stamp);
        const response = await tab.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });

        if (!response || response.status() !== 200) {
          problems.push(page.name + ' did not load. The server answered with ' +
            (response ? response.status() : 'no response') + '.');
          continue;
        }

        if (page.title) {
          const title = await tab.title();
          if (title !== page.title) {
            problems.push(page.name + ' loaded but the page title was "' + title +
              '" instead of "' + page.title + '".');
          }
        }

        if (page.heading) {
          try {
            await tab.getByRole('heading', { name: page.heading, exact: true })
              .waitFor({ state: 'visible', timeout: 20000 });
          } catch {
            problems.push(page.name + ' loaded but the "' + page.heading +
              '" heading never appeared.');
          }
        }

        if (page.mustStayHidden) {
          const visible = await tab.locator(page.mustStayHidden).isVisible().catch(() => false);
          if (visible) {
            problems.push(page.name + ' showed its practice area to a visitor who is not ' +
              'signed in. This is a security problem, not only a reliability one.');
          }
        }

        if (page.mustHaveNone) {
          const count = await tab.locator(page.mustHaveNone).count();
          if (count > 0) {
            problems.push(page.name + ' offered ' + count + ' class(es) to a visitor who is ' +
              'not signed in. This is a security problem, not only a reliability one.');
          }
        }

        console.log('Checked:', page.name);
      } catch (error) {
        problems.push(page.name + ' could not be checked at all: ' + error.message);
      } finally {
        // These are reported but do not fail the run. Because this check blocks
        // the database on purpose, some of these errors are caused by the check
        // itself rather than by a real fault. Read them, do not panic at them.
        if (errors.length) {
          warnings.push(page.name + ': ' + errors.join(' | '));
        }
        await tab.close();
      }
    }
  } finally {
    await browser.close();
  }
}

(async () => {
  await verifyPublishedFiles();
  await checkPages();

  if (warnings.length) {
    console.log('\nJavaScript messages seen (not failures):');
    for (const warning of warnings) console.log('  - ' + warning);
  }

  if (problems.length) {
    console.log('\nProblems found on the live site:');
    for (const problem of problems) console.log('  - ' + problem);
  } else {
    console.log('\nAll checked pages are live, up to date, and still locked to signed-out visitors.');
  }

  assert.deepEqual(problems, [], 'The live site has problems listed above.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
