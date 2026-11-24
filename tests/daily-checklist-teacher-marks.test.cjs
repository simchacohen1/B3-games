'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.join(__dirname, '..', 'daily-checklist');
const ctx = { window: {}, Intl, Date, Object, Array, String, Number, Math };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'common.js'), 'utf8'), ctx);
const C = ctx.window.B3DailyChecklist;
const plain = x => JSON.parse(JSON.stringify(x));

test('clicking a cell cycles blank -> yes -> no -> blank', () => {
  assert.equal(C.nextMark(null), 1);
  assert.equal(C.nextMark(undefined), 1);
  assert.equal(C.nextMark(1), 0);
  assert.equal(C.nextMark(0), null);
  let v = null; const seen = [];
  for (let i = 0; i < 4; i++) { v = C.nextMark(v); seen.push(v); }
  assert.deepEqual(seen, [1, 0, null, 1]);
});

test('a teacher mark saves in exactly the shape a student answer does', () => {
  const item = { id: 'mincha', name: 'Mincha', star: false, order: 2 };
  assert.deepEqual(plain(C.markUpdate(item, 1, 'Test Student A1', 'TS')),
    { name: 'Test Student A1', t: 'TS', 'items/mincha': { v: 1, n: 'Mincha', s: 0, o: 2 } });
  assert.deepEqual(plain(C.markUpdate({ id: 'tanya-lines', name: 'New Tanya Lines', star: true, order: 5 }, 0, 'X', 'TS')['items/tanya-lines']),
    { v: 0, n: 'New Tanya Lines', s: 1, o: 5 });
  /* blank removes only that item's answer, nothing else */
  const blank = C.markUpdate(item, null, 'Test Student A1', 'TS');
  assert.equal(blank['items/mincha'], null);
  assert.deepEqual(Object.keys(blank).sort(), ['items/mincha', 'name', 't']);
});

test('the student page saves the same fields (so the two stay in step)', () => {
  const student = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(student, /upd\["items\/"\+it\.id\]=\{v:v,n:it\.name,s:it\.star\?1:0,o:it\.order\}/);
});

test('teacher page: only current items are clickable, with keyboard support, and failures are reported', () => {
  const html = fs.readFileSync(path.join(dir, 'teacher.html'), 'utf8');
  assert.match(html, /edit:!x\.removed/);
  assert.match(html, /edit:false/);
  assert.match(html, /td\.edit/);
  assert.match(html, /e\.key!=="Enter"&&e\.key!==" "/);
  assert.match(html, /Could not save that mark/);
  assert.match(html, /C\.markUpdate\(col,v,person\.name,firebase\.database\.ServerValue\.TIMESTAMP\)/);
  const inline = html.match(/<script>([\s\S]*?)<\/script>/g).map(s => s.replace(/<\/?script>/g, '')).join('\n');
  assert.doesNotThrow(() => new Function(inline));
});

test('day arrows: shiftDate crosses month/year edges and every standard item has a picture', () => {
  assert.equal(C.shiftDate('2026-12-01', -1), '2026-11-30');
  assert.equal(C.shiftDate('2027-01-01', -1), '2026-12-31');
  assert.equal(C.shiftDate('2026-03-01', -1), '2026-02-28');
  C.DEFAULT_ITEMS.forEach(it => assert.ok(C.iconFor(it) && C.iconFor(it) !== '📝', it.id));
  assert.equal(C.iconFor({ id: 'i123', name: 'Something new' }), '📝');
});

test('teacher-chosen pictures: stored on the item, "-" means none, survive a Mashpia sync', () => {
  const items = C.itemsFromConfig({ a: { name: 'A', order: 0, icon: '🍎' }, b: { name: 'B', order: 1, icon: '-' }, c: { name: 'C', order: 2 } }, false);
  assert.deepEqual(items.map(i => C.iconFor(i)), ['🍎', '', '📝']);
  assert.equal(C.iconFor({ id: 'mincha', name: 'Mincha' }), '☀️');
  assert.equal(C.cleanIcon(' 🍎 and more'), '🍎');
  assert.equal(C.cleanIcon('👨‍👩‍👦x'), '👨‍👩‍👦');
  assert.equal(C.cleanIcon('abc'), '');
  assert.equal(C.cleanIcon('7'), '');
  const M = require('../daily-checklist/mashpia-core.js');
  const cfg = { a: { name: 'A', order: 0, star: false, removed: false, icon: '🍎' } };
  const out = M.mergeItems(cfg, [{ name: 'A', gridId: 1 }, { name: 'New', gridId: 2 }], []);
  assert.equal(out.a.icon, '🍎');
  assert.equal(out.m2.icon, undefined);
});
