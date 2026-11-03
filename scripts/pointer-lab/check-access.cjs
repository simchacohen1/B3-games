'use strict';
// Who can open which student tool, in real Edge (or Chrome), against the running Pointer lab. Made-up data only.
// Legitimate students must get their granted tools; wrong-class, removed, forged and anonymous visitors must be blocked.
// Run: node scripts/pointer-lab/check-access.cjs   (LAB_CHANNEL=chrome for Chrome; start the lab first, see README.md)
const PW = process.env.LAB_PLAYWRIGHT || '@playwright/test';
const { chromium } = require(PW);
const BASE = process.env.LAB_URL || 'http://localhost:8787', sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGES = [
  ['Rashi Letters', '/rashi-letters/student.html'], ['Chazara', '/chazara/index.html'], ['Gematria', '/gematria/index.html'], ['Shorashim', '/shorashim/index.html'],
  ['Weekly Quiz', '/weekly-quiz/index.html'], ['Halacha', '/halacha/index.html'], ['Yiddish', '/yiddish/index.html'], ['Sefer HaMitzvos', '/sefer-hamitzvos/index.html']
];
// a page counts as blocked when the shared gate shows its lock (#b3-gate-overlay) or the page itself says the student is not signed in / still checking
const OWN_BLOCK = /Not signed in|stars will not be saved|sign in on Fun Torah Tools|Open Fun Torah Tools and sign in|Checking your sign-in|Student Sign In|from Fun Torah Tools to use your signed-in account|Still checking access|Having trouble checking|Join your Yiddish lesson|This function is not part/i;
// scenario: how the browser pretends to be someone
const SCENARIOS = [
  { name: 'A legit (Pointer Test class)', who: 'A', expect: PAGES.map(() => 'open') },
  { name: 'C other class (only Gematria granted)', who: 'C', expect: PAGES.map(p => p[0] === 'Gematria' ? 'open' : 'blocked') },
  { name: 'D removed, forged sign-in, no token', forge: { id: 'studentD', pin: '4444', cls: 'pointer-test', name: 'Removed Student D' }, expect: PAGES.map(() => 'blocked') },
  { name: 'forged as A, no token', forge: { id: 'studentA', pin: '1111', cls: 'pointer-test', name: 'Pointer Test Student A' }, expect: PAGES.map(() => 'blocked') },
  { name: 'not signed in', expect: PAGES.map(() => 'blocked') },
];
(async () => {
  const browser = await chromium.launch({ channel: process.env.LAB_CHANNEL || 'msedge', headless: true });
  console.log('browser:', browser.version());
  let wrong = 0;
  for (const sc of SCENARIOS.filter(s => !process.env.LAB_ONLY || s.name.startsWith(process.env.LAB_ONLY))) {
    const ctx = await browser.newContext();
    if (sc.forge) await ctx.addInitScript(f => { sessionStorage.setItem('b3Games_studentId', f.id); sessionStorage.setItem('b3Games_studentName', f.name); sessionStorage.setItem('b3Games_studentClass', f.cls); sessionStorage.setItem('b3Games_classPin', f.pin); }, sc.forge);
    if (sc.who) { const p = await ctx.newPage(); await p.goto(`${BASE}/_lab/student?who=${sc.who}&go=/index.html`); await p.waitForURL('**/index.html', { timeout: 90000 }); await sleep(5000);
      // sessionStorage belongs to one tab; give the tool pages the same sign-in values the home page keeps (Firebase's own sign-in is shared by the browser)
      const keep = await p.evaluate(() => Object.fromEntries(Object.entries(sessionStorage)));
      await ctx.addInitScript(kv => { for (const [k, v] of Object.entries(kv)) sessionStorage.setItem(k, v); }, keep);
      await p.close(); }
    console.log('\n' + sc.name);
    // one page at a time, like a real student: wait until it opens (up to 25 s) or settle as blocked (12 s)
    for (let i = 0; i < PAGES.length; i++) {
      const pg = await ctx.newPage(); pg.goto(BASE + PAGES[i][1]).catch(() => {});
      let text = '', lock = '', got = 'blocked';
      const limit = sc.expect[i] === 'open' ? 25 : 12;
      for (let t = 0; t < limit; t++) {
        await sleep(1000);
        try {
          const r = await pg.evaluate(() => ({ lock: ((document.getElementById('b3-gate-overlay') || {}).innerText || '').replace(/\s+/g, ' '), text: document.body.innerText.replace(/\s+/g, ' ') }));
          text = r.text; lock = r.lock;
        } catch { text = '(page error)'; }
        got = (lock || OWN_BLOCK.test(text) || text.length < 20) ? 'blocked' : 'open';
        if (got === 'open' && t >= 3) break;
      }
      const ok = got === sc.expect[i];
      if (!ok) wrong++;
      console.log('  ' + (ok ? 'OK  ' : 'WRONG') + ' ' + PAGES[i][0].padEnd(16) + got.padEnd(8) + '(expected ' + sc.expect[i] + ')  ' + (lock ? '[lock: ' + lock.slice(0, 60) + '] ' : '') + text.slice(0, 80));
      await pg.close();
    }
    await ctx.close();
  }
  await browser.close();
  console.log('\n' + (wrong ? wrong + ' unexpected result(s)' : 'all results as expected'));
  process.exit(wrong ? 1 : 0);
})().catch(e => { console.error('check-access error:', e.message.slice(0, 300)); process.exit(2); });
