'use strict';
// Issue #439: every Teacher Tool must be closed to strangers, students, revoked/unclaimed
// teachers and teachers of other classes, even when the address is typed directly.
// Fictional identities only; real site-settings.js decides access. No network, no real data.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const H = require('./helpers/teacher-gate-harness.cjs');
const inventory = JSON.parse(fs.readFileSync(path.join(H.ROOT, 'security/teacher-tools-inventory.json'), 'utf8'));
const gated = inventory.pages.filter(p => p.gate === 'gate');
const DENIED = ['anonymous', 'student', 'randomGoogle', 'unclaimedInvite', 'revokedTeacher', 'teacherNoClasses'];
const withParam = (url, k, v) => url + (url.includes('?') ? '&' : '?') + k + '=' + encodeURIComponent(v);

async function pool(items, size, fn) {
  const results = []; let next = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i]); } }));
  return results;
}
async function check(browser, port, who, url) {
  const { page, context } = await H.openAs(browser, port, who, url, { settleMs: 0 });
  try {
    await page.waitForFunction(() => { const s = document.documentElement.dataset.b3Gate; return s && s !== 'checking'; }, null, { timeout: 15000 });
  } catch { /* snapshot below records the state */ }
  const snap = await H.snapshot(page);
  snap.state = await page.evaluate(() => document.documentElement.dataset.b3Gate || 'none').catch(() => 'error');
  await context.close();
  return snap;
}

test('inventory covers every teacher page and every gated page loads the shared gate first', () => {
  for (const p of gated) {
    const html = fs.readFileSync(path.join(H.ROOT, p.path.split('?')[0]), 'utf8');
    const head = html.slice(html.search(/<head[^>]*>/i));
    const first = head.match(/<script[^>]*>/i);
    assert.match(first[0], /teacher-tool-gate\.js/, p.path + ': the gate must be the first script in <head>');
  }
  // Any file whose name says "teacher" must be listed, so a new teacher page cannot be forgotten.
  const listed = new Set(inventory.pages.map(p => p.path.split('?')[0]));
  const stack = [H.ROOT]; const missing = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (/^(node_modules|\.git|_worktrees|backup|preview-|vendor|docs|e2e|tests|backend)/.test(e.name)) continue;
      const full = path.join(dir, e.name), rel = path.relative(H.ROOT, full).replace(/\\/g, '/');
      if (e.isDirectory()) stack.push(full);
      else if (/teacher[^/]*\.html$/i.test(rel) && !listed.has(rel)) missing.push(rel);
    }
  }
  assert.deepEqual(missing, [], 'teacher pages missing from security/teacher-tools-inventory.json');
});

test('Teacher Tools deny strangers, students, unverified/revoked teachers; allow the right teachers', { timeout: 900000 }, async () => {
  const server = await H.startServer(), port = server.address().port, browser = await H.chromium.launch();
  const failures = [];
  try {
    const jobs = [];
    for (const p of gated) {
      for (const who of DENIED) jobs.push({ p, who, url: p.path, expect: 'deny' });
      for (const who of ['teacherET', 'teacherWT']) jobs.push({ p, who, url: p.path, expect: p.scope === 'admin' ? 'deny' : 'allow' });
      // A teacher of a brand-new class (not ET/WT) may use every general teacher page but not B3-only or admin pages.
      jobs.push({ p, who: 'teacherNew', url: p.path, expect: p.scope === 'teacher' ? 'allow' : 'deny' });
      for (const who of ['admin', 'owner']) jobs.push({ p, who, url: p.path, expect: 'allow' });
      // Class-ID substitution: a teacher may only use ?class= for an assigned class.
      jobs.push({ p, who: 'teacherET', url: withParam(p.path, 'class', 'wt'), expect: 'deny' });
      jobs.push({ p, who: 'teacherET', url: withParam(p.path, 'class', 'et'), expect: p.scope === 'admin' ? 'deny' : 'allow' });
      jobs.push({ p, who: 'teacherET', url: withParam(p.path, 'class', '../../x'), expect: 'deny' });
      jobs.push({ p, who: 'admin', url: withParam(p.path, 'class', 'wt'), expect: 'allow' });
    }
    await pool(jobs, 6, async job => {
      const s = await check(browser, port, job.who, job.url);
      const label = `${job.who} -> ${job.url}`;
      if (job.expect === 'deny') {
        if (!(s.gate && s.locked && s.state !== 'allowed' && s.state !== 'checking' && s.visibleControlsOutsideGate === 0)) failures.push(`${label}: expected DENIED, got state=${s.state} gate=${s.gate} controls=${s.visibleControlsOutsideGate} text="${s.visibleTextOutsideGate}"`);
        if (s.writes.length) failures.push(`${label}: denied user caused database writes ${s.writes.join(',')}`);
      } else if (s.state !== 'allowed' || s.locked || s.gate) {
        failures.push(`${label}: expected ALLOWED, got state=${s.state} locked=${s.locked}`);
      }
    });
  } finally { await browser.close(); server.close(); }
  assert.deepEqual(failures, [], failures.slice(0, 40).join('\n'));
});

test('Teacher Center (own sign-in) shows no classes to strangers, students or unverified teachers', { timeout: 120000 }, async () => {
  const server = await H.startServer(), port = server.address().port, browser = await H.chromium.launch();
  try {
    for (const who of DENIED) {
      const { page, context } = await H.openAs(browser, port, who, 'teacher-home.html', { settleMs: 2500 });
      const s = await page.evaluate(() => ({ appHidden: document.getElementById('app').classList.contains('hidden'), cards: document.querySelectorAll('#classes .class-card').length, gate: document.getElementById('gate').innerText }));
      assert.equal(s.cards, 0, who + ' must not see class cards');
      assert.equal(s.appHidden, true, who + ': Teacher Center app must stay hidden');
      await context.close();
    }
    const { page, context } = await H.openAs(browser, port, 'teacherET', 'teacher-home.html', { settleMs: 2500 });
    assert.equal(await page.evaluate(() => document.querySelectorAll('#classes .class-card').length), 1, 'ET teacher sees exactly their class');
    await context.close();
  } finally { await browser.close(); server.close(); }
});

test('pages that double as a student screen keep working for students; only teacher mode is gated', { timeout: 60000 }, async () => {
  const server = await H.startServer(), port = server.address().port, browser = await H.chromium.launch();
  try {
    const student = await check(browser, port, 'student', 'class-pointer-prototype/dashboard.html');
    assert.equal(student.gate, false, 'student Class Pointer screen must not be locked');
    const teacherMode = await check(browser, port, 'student', 'class-pointer-prototype/dashboard.html?teacher=1');
    assert.equal(teacherMode.locked, true, 'teacher mode must lock for a student');
  } finally { await browser.close(); server.close(); }
});

test('revoking a teacher or removing their class while a tool stays open locks it at once', { timeout: 120000 }, async () => {
  const server = await H.startServer(), port = server.address().port, browser = await H.chromium.launch();
  try {
    for (const change of [
      { name: 'teacher marked inactive', path: 'b3Games/workspaces/b3-2026/teachers/teacher_et/active', value: false },
      { name: 'assigned class removed', path: 'b3Games/workspaces/b3-2026/teachers/teacher_et/classIds', value: {} },
      { name: 'teacher record deleted', path: 'b3Games/workspaces/b3-2026/teachers/teacher_et', value: undefined }
    ]) {
      const { page, context } = await H.openAs(browser, port, 'teacherET', 'chazara/teacher.html?class=et', { settleMs: 0 });
      await page.waitForFunction(() => document.documentElement.dataset.b3Gate === 'allowed', null, { timeout: 15000 });
      await page.evaluate(c => window.__setTree(c.path, c.value), change);
      await page.waitForFunction(() => document.documentElement.dataset.b3Gate !== 'allowed', null, { timeout: 5000 }).catch(() => {});
      const s = await H.snapshot(page);
      assert.equal(s.locked, true, change.name + ': tool must lock without reload or sign-out');
      assert.equal(s.visibleControlsOutsideGate, 0, change.name + ': no tool controls may remain visible');
      await context.close();
    }
  } finally { await browser.close(); server.close(); }
});
