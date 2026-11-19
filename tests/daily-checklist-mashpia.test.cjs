'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '..', 'daily-checklist');
const coreText = fs.readFileSync(path.join(dir, 'mashpia-core.js'), 'utf8');
const agentText = fs.readFileSync(path.join(dir, 'mashpia-agent.js'), 'utf8');
const Core = require('../daily-checklist/mashpia-core.js');
const Sync = require('../daily-checklist/mashpia-sync.js');

/* ---------- matching (made-up names) ---------- */
function grid() {
  const cats = [[22001, 'Daily Tzedaka', 0], [22002, 'Shacharis', 0], [22004, 'Mincha', 0], [16006, "Rebbe's Kapitel", 0],
    [11014, 'Listen to Parents', 1], [13002, 'נעגל וואסער', 0]];
  return {
    missions: cats.map(([grid_id, cat, disabled]) => ({ grid_id, cat, disabled, mandatory_qty: grid_id === 22002 ? 1 : 0 })),
    soldiers: [
      { user_id: 1, name: 'Arik Fake', registered: true, absent: false, marks: {} },
      { user_id: 2, name: 'Moshe Fake', registered: true, absent: false, marks: { 22002: { done_qty: 1 } } },
      { user_id: 3, name: 'Chaim Fake', registered: false, absent: false, marks: {} },
      { user_id: 4, name: 'Levi Fake', registered: true, absent: true, marks: {} },
      { user_id: 5, name: 'Sam Twin', registered: true, absent: false, marks: {} },
      { user_id: 6, name: 'Twin Sam', registered: true, absent: false, marks: {} }
    ]
  };
}

test('julian day matches the real site', () => {
  assert.equal(Core.julianDay('2026-11-18'), 2461363);
  assert.equal(Core.julianDay('2026-02-30'), null);
  assert.equal(Core.julianDay('nope'), null);
});

test('matching: names by any word order, items by name, skips and never guesses', () => {
  const p = Core.plan(grid(), [
    { name: 'Fake Arik', items: ['Daily Tzedaka', 'shacharis', 'Rebbes Kapitel', 'נעגל וואסער', 'Homework', 'Listen to Parents'] },
    { name: 'Moshe Fake', items: ['Shacharis', 'Mincha'] },
    { name: 'Chaim Fake', items: ['Mincha'] }, { name: 'Levi Fake', items: ['Mincha'] },
    { name: 'Sam Twin', items: ['Mincha'] }, { name: 'Nobody Here', items: ['Mincha'] }]);
  assert.deepEqual(p.sends, { 22001: [1], 22002: [1], 16006: [1], 13002: [1], 22004: [2] });   /* #2 Shacharis already checked */
  assert.deepEqual(p.greyed, ['Chaim Fake', 'Levi Fake']);
  assert.deepEqual(p.notFound, ['Sam Twin', 'Nobody Here']);
  assert.deepEqual(p.missingItems, ['Homework', 'Listen to Parents']);   /* disabled items never match */
});

test('roster students with Yes list, No list; blanks are left out of both', () => {
  const answers = {
    s1: { items: { a: { v: 1, n: 'Shacharis', o: 1 }, b: { v: 0, n: 'Mincha', o: 2 }, c: { v: 1, n: 'Daily Tzedaka', o: 0 } } },
    s2: { items: { a: { v: 0, n: 'Shacharis', o: 1 } } }, s4: { items: {} }
  };
  const roster = [{ id: 's1', name: 'Arik Fake' }, { id: 's2', name: 'Levi Fake' }, { id: 's3', name: 'Silent' }, { id: 's4', name: 'Ghost' }];
  const E = { mashpiaName: '' };
  assert.deepEqual(Core.buildStudents(answers, roster), [{ id: 's1', name: 'Arik Fake', ...E, items: ['Daily Tzedaka', 'Shacharis'], no: ['Mincha'] },
    { id: 's2', name: 'Levi Fake', ...E, items: [], no: ['Shacharis'] },
    { id: 's3', name: 'Silent', ...E, items: [], no: [] }, { id: 's4', name: 'Ghost', ...E, items: [], no: [] }]);
});

test('one short line', () => {
  assert.equal(Core.summary({ synced: 10, notFound: [], greyed: [], missingItems: [] }), 'Synced 10 students');
  assert.equal(Core.summary({ synced: 9, notFound: ['Moshe Fake'], greyed: [], missingItems: [] }), "Synced 9, couldn't find: Moshe Fake");
});

/* ---------- Mashpia is the source of the checklist items ---------- */
const DEFAULTS = [{ id: 'tzedaka', name: 'Daily Tzedaka', star: false }, { id: 'shacharis', name: 'Shacharis', star: true }, { id: 'mincha', name: 'Mincha', star: false }];

test('items come from the grid: available missions only, grid order, red star = mandatory', () => {
  assert.deepEqual(Core.itemsFromMashpia(grid().missions), [
    { name: 'Daily Tzedaka', star: false, gridId: 22001 }, { name: 'Shacharis', star: true, gridId: 22002 },
    { name: 'Mincha', star: false, gridId: 22004 }, { name: "Rebbe's Kapitel", star: false, gridId: 16006 },
    { name: 'נעגל וואסער', star: false, gridId: 13002 }]);
  assert.deepEqual(Core.itemsFromMashpia([{ grid_id: 1, cat: ' A ', disabled: 0 }, { grid_id: 2, cat: 'a', disabled: 0 }, { grid_id: 3, cat: '', disabled: 0 }]).map(i => i.name), ['A']);
});

test('merge: never-synced class (null config) keeps ids of matching defaults, so old answers stay joined', () => {
  const next = Core.mergeItems(null, [{ name: 'Shacharis', star: true, gridId: 22002 }, { name: 'Daily Tzedaka', star: false, gridId: 22001 }, { name: 'New Thing', star: true, gridId: 77 }], DEFAULTS);
  assert.deepEqual(next, {
    shacharis: { name: 'Shacharis', star: true, order: 0, removed: false },
    tzedaka: { name: 'Daily Tzedaka', star: false, order: 1, removed: false },
    m77: { name: 'New Thing', star: true, order: 2, removed: false },
    mincha: { name: 'Mincha', star: false, order: 2, removed: true }   /* no longer in Mashpia: kept (hidden) so past answers keep their name */
  });
});

test('merge: identical to what is saved changes nothing; a star or order change does; removed items come back by name', () => {
  const same = Core.mergeItems(null, [{ name: 'Daily Tzedaka', star: false, gridId: 1 }, { name: 'Shacharis', star: true, gridId: 2 }, { name: 'Mincha', star: false, gridId: 3 }], DEFAULTS);
  assert.equal(same, null);
  const saved = { a: { name: 'Mincha', star: false, order: 0, removed: false }, b: { name: 'Old', star: false, order: 1, removed: true } };
  assert.equal(Core.mergeItems(saved, [{ name: 'mincha', star: false, gridId: 3 }, { name: 'Old', star: false, gridId: 9 }], DEFAULTS).b.removed, false);
  assert.equal(Core.mergeItems(saved, [{ name: 'Mincha', star: true, gridId: 3 }], DEFAULTS).a.star, true);
  assert.equal(Core.mergeItems(saved, [], DEFAULTS), null);   /* never wipes the list */
});

/* ---------- the script that runs on the Mashpia tab ---------- */
function mashpiaTab({ loggedIn = true, failIds = [], origin = 'https://fun-torah-tools-staging.web.app' } = {}) {
  const calls = [], listeners = [], opened = [], replies = [];
  const win = {
    location: { hostname: 'mashpia.com' },
    opener: { postMessage: (m, o) => opened.push([m, o]) },
    addEventListener: (t, fn) => listeners.push(fn)
  };
  const el = { style: {}, appendChild() {} };
  const ctx = vm.createContext({
    window: win, location: win.location, alert: () => {}, setTimeout, clearTimeout, JSON, Promise, Array, String, Object, Date, Math,
    document: { getElementById: () => el, createElement: () => el, body: { appendChild() {} } },
    fetch: async (url, opt) => {
      const body = JSON.parse(opt.body); calls.push({ url, body, credentials: opt.credentials });
      if (url.includes('grid')) return { status: 200, json: async () => (loggedIn ? { success: true, data: grid() } : { success: false, error: 'Invalid Credentials' }) };
      const data = {}; body.user_ids.forEach(i => { if (!failIds.includes(i)) data[i] = {}; });
      return { status: 200, json: async () => ({ success: true, data }) };
    }
  });
  vm.runInContext('(function(){' + coreText + '\n' + agentText + '\n})();', ctx);
  const send = async data => {
    const ev = { origin, data, source: { postMessage: (m, o) => replies.push([m, o]) } };
    listeners.forEach(fn => fn(ev));
    await new Promise(r => setTimeout(r, 20));
  };
  return { calls, opened, replies, send };
}
const STUDENTS = [{ name: 'Arik Fake', items: ['Mincha', 'Daily Tzedaka'] }, { name: 'Moshe Fake', items: ['Shacharis'] }];

test('agent: announces ready to B3 origins, answers ping, syncs with the teacher session, only mark "1"', async () => {
  const t = mashpiaTab();
  assert.ok(t.opened.length > 0 && t.opened.every(([m]) => m.b3 === 'mashpia-ready'));
  await t.send({ b3: 'mashpia-ping' });
  assert.equal(t.replies[0][0].b3, 'mashpia-pong');
  await t.send({ b3: 'mashpia-sync', id: 'x1', date: '2026-11-18', students: STUDENTS });
  const marks = t.calls.filter(c => c.url.includes('/mark'));
  assert.deepEqual(marks.map(c => [c.body.grid_id, c.body.user_ids, c.body.dates, c.body.mark]), [[22001, [1], [2461363], '1'], [22004, [1], [2461363], '1']]);
  assert.ok(t.calls.every(c => c.credentials === 'same-origin'));
  const res = t.replies.find(([m]) => m.b3 === 'mashpia-result')[0];
  assert.deepEqual(JSON.parse(JSON.stringify([res.ok, res.id, res.result.synced, res.result.notFound])), [true, 'x1', 2, []]);
});

test('agent: accepts the live sols.tools sites', async () => {
  for (const origin of ['https://sols.tools', 'https://www.sols.tools']) {
    const t = mashpiaTab({ origin });
    await t.send({ b3: 'mashpia-ping' });
    assert.equal(t.replies[0][0].b3, 'mashpia-pong');
    assert.ok(t.opened.some(([, o]) => o === origin), 'ready announced to ' + origin);
  }
});

test('agent: every sync also sends the Mashpia items; with no students it only reads them and marks nothing', async () => {
  const t = mashpiaTab();
  await t.send({ b3: 'mashpia-sync', id: 'i1', date: '2026-11-18', students: [] });
  const res = t.replies.find(([m]) => m.b3 === 'mashpia-result')[0];
  assert.equal(res.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(res.result.items.map(i => [i.name, i.star]))), [['Daily Tzedaka', false], ['Shacharis', true], ['Mincha', false], ["Rebbe's Kapitel", false], ['נעגל וואסער', false]]);
  assert.equal(t.calls.filter(c => c.url.includes('/mark')).length, 0);
});

test('agent: ignores other websites', async () => {
  const t = mashpiaTab({ origin: 'https://evil.example.com' });
  await t.send({ b3: 'mashpia-sync', id: 'x', date: '2026-11-18', students: STUDENTS });
  assert.equal(t.calls.length, 0);
  assert.equal(t.replies.length, 0);
});

test('agent: not logged in to Mashpia says so and marks nothing', async () => {
  const t = mashpiaTab({ loggedIn: false });
  await t.send({ b3: 'mashpia-sync', id: 'x', date: '2026-11-18', students: STUDENTS });
  const res = t.replies.find(([m]) => m.b3 === 'mashpia-result')[0];
  assert.deepEqual([res.ok, res.code], [false, 'login']);
  assert.equal(t.calls.filter(c => c.url.includes('/mark')).length, 0);
});

test('agent: a mark Mashpia did not accept is reported, not hidden', async () => {
  const t = mashpiaTab({ failIds: [1] });
  await t.send({ b3: 'mashpia-sync', id: 'x', date: '2026-11-18', students: STUDENTS });
  const res = t.replies.find(([m]) => m.b3 === 'mashpia-result')[0].result;
  assert.deepEqual(JSON.parse(JSON.stringify([res.synced, res.notFound])), [1, ['Arik Fake']]);
});

/* ---------- three states: check, X, blank ---------- */
test('X removes an existing Mashpia check; blank never changes anything; a check in Mashpia is pulled into a blank cell', () => {
  /* Moshe has Shacharis checked in Mashpia. */
  const none = Core.plan(grid(), [{ name: 'Moshe Fake', items: [], no: [] }]);
  assert.deepEqual([none.sends, none.clears], [{}, {}]);                         /* blank: no change in Mashpia */
  assert.deepEqual(JSON.parse(JSON.stringify(none.pulls)), [{ name: 'Moshe Fake', items: ['Shacharis'] }]);   /* shows on this side */
  const x = Core.plan(grid(), [{ name: 'Moshe Fake', items: [], no: ['Shacharis'] }]);
  assert.deepEqual(x.clears, { 22002: [2] });                                     /* X replaces the check */
  assert.deepEqual(x.pulls, []);                                                  /* and it is not pulled back */
  const yes = Core.plan(grid(), [{ name: 'Moshe Fake', items: ['Shacharis'], no: [] }]);
  assert.deepEqual([yes.sends, yes.clears, yes.pulls], [{}, {}, []]);             /* already a check on both sides */
  const xNotChecked = Core.plan(grid(), [{ name: 'Arik Fake', items: [], no: ['Mincha'] }]);
  assert.deepEqual([xNotChecked.sends, xNotChecked.clears], [{}, {}]);            /* nothing to remove */
});

test('agent: an X sends mark "0" only for a cell Mashpia shows checked, and blank sends nothing', async () => {
  const t = mashpiaTab();
  await t.send({ b3: 'mashpia-sync', id: 'z1', date: '2026-11-18', students: [
    { name: 'Moshe Fake', items: [], no: ['Shacharis'] }, { name: 'Arik Fake', items: [], no: ['Mincha'] }, { name: 'Chaim Fake', items: [], no: [] }] });
  const marks = t.calls.filter(c => c.url.includes('/mark'));
  assert.deepEqual(marks.map(c => [c.body.grid_id, c.body.user_ids, c.body.mark]), [[22002, [2], '0']]);
  const res = t.replies.find(([m]) => m.b3 === 'mashpia-result')[0].result;
  assert.equal(res.cleared, 1);
});

/* ---------- the checklist page side ---------- */
function fakeEnv(w) {
  const listeners = new Set(), timers = [];
  const e = {
    statusLog: [], setup: 0,
    open: () => w, newId: () => 'id1',
    listen: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    timer: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return () => { t.live = false; }; },
    repeat: (fn, ms) => { const t = { fn, ms, live: true, rep: true }; timers.push(t); return () => { t.live = false; }; },
    status(text) { e.statusLog.push(text); },
    needSetup() { e.setup++; },
    fire: m => listeners.forEach(fn => fn({ origin: 'https://mashpia.com', data: m })),
    firePlain: (origin, m) => listeners.forEach(fn => fn({ origin, data: m })),
    advance(ms) { timers.filter(t => t.live && t.ms === ms && !t.rep).forEach(t => { t.live = false; t.fn(); }); }
  };
  return e;
}
const fakeWin = () => { const sent = []; return { sent, location: { href: 'about:blank' }, postMessage: (m, o) => sent.push([m, o]) }; };
const syncs = w => w.sent.filter(([m]) => m.b3 === 'mashpia-sync');

test('page: tab already set up -> one click, result line', async () => {
  const w = fakeWin(), e = fakeEnv(w);
  const p = Sync.run(e, '2026-11-18', STUDENTS);
  assert.equal(w.sent[0][0].b3, 'mashpia-ping');
  e.fire({ b3: 'mashpia-pong' });
  const m = syncs(w)[0];
  assert.deepEqual([m[1], m[0].date, m[0].students.length], ['https://mashpia.com', '2026-11-18', 2]);
  e.fire({ b3: 'mashpia-result', id: 'id1', ok: true, result: { synced: 2, notFound: [], greyed: [], missingItems: [] } });
  assert.deepEqual(await p, { ok: true, message: 'Synced 2 students', items: null, pulls: [], unmatched: [], candidates: null });   /* null = an older bookmark that sends no items */
  assert.equal(e.setup, 0);
  assert.equal(w.location.href, 'about:blank');   /* an existing tab is never reloaded */
});

test('page: new tab -> opens Mashpia, shows setup, syncs once the bookmark announces ready', async () => {
  const w = fakeWin(), e = fakeEnv(w);
  const p = Sync.run(e, '2026-11-18', STUDENTS);
  e.advance(1500);
  assert.equal(w.location.href, 'https://mashpia.com/new/missions/mark');
  assert.equal(e.setup, 1);
  e.fire({ b3: 'mashpia-ready' });
  e.fire({ b3: 'mashpia-ready' });   /* a second announce must not send twice */
  assert.equal(syncs(w).length, 1);
  e.fire({ b3: 'mashpia-result', id: 'id1', ok: true, result: { synced: 1, notFound: ['Moshe Fake'], greyed: [], missingItems: [] } });
  assert.equal((await p).message, "Synced 1, couldn't find: Moshe Fake");
});

test('page: not logged in to Mashpia waits for the bookmark again, then succeeds', async () => {
  const w = fakeWin(), e = fakeEnv(w);
  const p = Sync.run(e, '2026-11-18', STUDENTS);
  e.fire({ b3: 'mashpia-pong' });
  e.fire({ b3: 'mashpia-result', id: 'id1', ok: false, code: 'login', message: 'Log in to Mashpia on this tab, then click the bookmark again.' });
  assert.equal(e.setup, 1);
  e.fire({ b3: 'mashpia-ready' });
  assert.equal(syncs(w).length, 2);
  e.fire({ b3: 'mashpia-result', id: 'id1', ok: true, result: { synced: 2, notFound: [], greyed: [], missingItems: [] } });
  assert.equal((await p).ok, true);
});

test('page: ignores other sites and other runs; explains popup block; nothing to send', async () => {
  const w = fakeWin(), e = fakeEnv(w);
  const p = Sync.run(e, '2026-11-18', STUDENTS);
  e.firePlain('https://evil.example.com', { b3: 'mashpia-pong' });
  assert.equal(syncs(w).length, 0);
  e.fire({ b3: 'mashpia-pong' });
  e.fire({ b3: 'mashpia-result', id: 'other', ok: true, result: { synced: 9 } });
  e.advance(90000);
  assert.match((await p).message, /did not answer/);
  assert.match((await Sync.run({ open: () => null }, 'd', STUDENTS)).message, /pop-ups/);
});

test('bookmark text is self-contained and parses', () => {
  const href = Sync.bookmarkletHref(coreText, agentText);
  assert.ok(href.startsWith('javascript:'));
  assert.doesNotThrow(() => new Function(decodeURIComponent(href.slice('javascript:'.length))));
  assert.ok(href.length < 30000, 'bookmark is ' + href.length + ' chars');
  assert.doesNotMatch(coreText + agentText, /^\s*\/\/ /m);
});

test('page: an items-only sync (no answers yet) still runs and returns the items', async () => {
  const w = fakeWin(), e = fakeEnv(w);
  const p = Sync.run(e, '2026-11-18', []);
  e.fire({ b3: 'mashpia-pong' });
  assert.deepEqual(syncs(w)[0][0].students, []);
  e.fire({ b3: 'mashpia-result', id: 'id1', ok: true, result: { synced: 0, notFound: [], greyed: [], missingItems: [], items: [{ name: 'Mincha', star: false, gridId: 1 }] } });
  assert.deepEqual((await p).items, [{ name: 'Mincha', star: false, gridId: 1 }]);
});

test('teacher page: the item editor is gone and items come from Mashpia', () => {
  const html = fs.readFileSync(path.join(dir, 'teacher.html'), 'utf8');
  assert.doesNotMatch(html, /Edit checklist items|id="saveItems"|id="addItem"|drawEditor|editList/);
  assert.match(html, /applyMashpiaItems/);
  assert.match(html, /Core\.mergeItems\(configRaw,items,C\.DEFAULT_ITEMS\)/);
});

test('teacher page: one button, one-time setup panel, no password fields, no server', () => {
  const html = fs.readFileSync(path.join(dir, 'teacher.html'), 'utf8');
  assert.equal((html.match(/id="mashpiaSync"/g) || []).length, 1);
  assert.match(html, /id="mashpiaSetup"/);
  assert.match(html, /mashpia-core\.js/);
  assert.doesNotMatch(html, /type="password"|nigri-auth|onrender\.com/);
  const inline = html.match(/<script>([\s\S]*?)<\/script>/g).map(s => s.replace(/<\/?script>/g, '')).join('\n');
  assert.doesNotThrow(() => new Function(inline));
});

/* ---------- loose names, saved matches, demo students ---------- */
test('loose matching: spellings, case and spaces; ambiguous names are still never guessed', () => {
  const g = grid();
  g.soldiers.push({ user_id: 7, name: 'Sholom  HUEBNER', registered: true, absent: false, marks: {} },
    { user_id: 8, name: 'Ber Raichik', registered: true, absent: false, marks: {} },
    { user_id: 9, name: 'Moishe Raichman', registered: true, absent: false, marks: {} });
  const p = Core.plan(g, [
    { id: 'a', name: 'Shalom Huebner', items: ['Mincha'] },
    { id: 'b', name: 'Berel Raichik', items: ['Mincha'] },
    { id: 'c', name: 'Moshe Raichman', items: ['Mincha'] },
    { id: 'd', name: 'Sam Twin', items: ['Mincha'] }
  ]);
  assert.deepEqual(p.synced.map(s => s.userId).sort(), [7, 8, 9]);
  assert.deepEqual(p.notFound, ['Sam Twin']);
});

test('unmatched students get a candidate list of unclaimed Mashpia names; a saved match is used next time', () => {
  const g = grid();
  g.soldiers.push({ user_id: 10, name: 'Berel Raichick', registered: true, absent: false, marks: {} });
  let p = Core.plan(g, [{ id: 's1', name: 'Berel Raichik', items: ['Mincha'] }, { id: 's2', name: 'Arik Fake', items: [] }]);
  assert.deepEqual(p.unmatched, [{ id: 's1', name: 'Berel Raichik' }]);
  assert.ok(p.candidates.includes('Berel Raichick'));
  assert.ok(!p.candidates.includes('Arik Fake'), 'a matched soldier is not offered');
  p = Core.plan(g, [{ id: 's1', name: 'Berel Raichik', mashpiaName: 'Berel Raichick', items: ['Mincha'] }]);
  assert.deepEqual(p.notFound, []);
  assert.deepEqual(p.sends[22004], [10]);
});

test('demo/test students are skipped entirely', () => {
  const roster = [{ id: 'x1', name: 'Real Kid' }, { id: 'demo_t', name: 'Teacher Demo' }, { id: 'x2', name: 'Fake Test', demo: true }];
  const s = Core.buildStudents({}, roster, { x1: 'Real K' });
  assert.deepEqual(s.map(x => x.name), ['Real Kid']);
  assert.equal(s[0].mashpiaName, 'Real K');
});
