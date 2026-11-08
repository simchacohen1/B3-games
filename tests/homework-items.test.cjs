'use strict';
// Homework checklist items: validation, student itemDone, hand-in rules, and
// that old assignments without items behave exactly as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { homeworkApi } = require('../backend/functions/homework-core.cjs');
const staging = require('../backend/functions/homework-staging/homework-core.cjs');
const items = require('../backend/functions/homework-items-core.cjs');

function makeStore(seed) {
  const data = JSON.parse(JSON.stringify(seed));
  const parts = p => p.split('/');
  const get = async p => { let n = data; for (const k of parts(p)) { if (n == null) return null; n = n[k]; } return n === undefined ? null : JSON.parse(JSON.stringify(n)); };
  const set = async (p, v) => { const k = parts(p); let n = data; for (const s of k.slice(0, -1)) n = n[s] = n[s] || {}; if (v === null) delete n[k[k.length - 1]]; else n[k[k.length - 1]] = JSON.parse(JSON.stringify(v)); };
  const tx = async (p, fn) => { const cur = await get(p); const out = fn(cur); if (out === undefined) return { committed: false }; await set(p, out); return { committed: true }; };
  return { get, set, tx, data };
}
const seed = () => ({
  b3Games: {
    admins: {},
    workspaces: { 'b3-2026': {
      classes: { et: { name: 'ET', toolGrants: { homework: true }, members: { s1: { active: true }, s2: { active: true } } } },
      teachers: { t1: { active: true, classIds: { et: true } } }
    } },
    students: {
      s1: { profile: { name: 'Sam One' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } },
      s2: { profile: { name: 'Dan Two' }, memberships: { m: { workspaceId: 'b3-2026', classId: 'et' } } }
    }
  },
  b3Private: { passcodes: { s1: { passcode: '1111' }, s2: { passcode: '2222' } } }
});
const T = { identity: { uid: 't1', email: 't1@x.org', email_verified: true, firebase: { sign_in_provider: 'google.com' } } };
const S1 = { studentId: 's1', studentName: 'Sam One', pin: '1111', classId: 'et' };
let n = 0; const newId = () => 'x' + (++n);
const defs = store => store.data.assignmentCenter.workspaces['b3-2026'].classes.et.definitions;
const ITEMS = [
  { type: 'posuk', details: { sefer: 'Bereishis', perek: 18, from: 12, to: 14, skills: ['reading', 'translate'] } },
  { type: 'rashiLetters', details: { letters: ['alef', 'zayin', 'nope'] } },
  { type: 'chazara', details: { perek: 18, from: 1, to: 3, times: 2 }, note: 'Out loud <b>please</b>' }
];
async function published(list = ITEMS) {
  const store = makeStore(seed());
  const { id } = await homeworkApi(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Week 3', details: '', items: list, assignedAt: 0 }, 500, newId);
  await homeworkApi(store, T, { action: 'publish', classId: 'et', assignmentId: id }, 501, newId);
  return { store, id };
}
const studentList = (store, now) => homeworkApi(store, {}, { action: 'studentList', ...S1 }, now);
const itemDone = (store, id, itemId, now) => homeworkApi(store, {}, { action: 'itemDone', ...S1, assignmentId: id, itemId }, now);

test('create keeps cleaned items in order; type follows the first item', async () => {
  const { store, id } = await published();
  const def = defs(store)[id];
  assert.equal(def.type, 'posuk');
  assert.deepEqual(def.items.map(i => i.type), ['posuk', 'rashiLetters', 'chazara']);
  assert.deepEqual(def.items[0].details, { sefer: 'Bereishis', perek: 18, from: 12, to: 14, skills: ['reading', 'translate'] });
  assert.deepEqual(def.items[1].details, { letters: ['zayin', 'alef'] }, 'unknown letters dropped, quest order kept');
  assert.equal(def.items[2].note, 'Out loud bplease/b');
  assert.deepEqual(def.items[2].details, { perek: 18, from: 1, to: 3, times: 2 });
  assert.equal(new Set(def.items.map(i => i.id)).size, 3);
});

test('bad items are refused with a clear message', async () => {
  const store = makeStore(seed());
  const create = list => homeworkApi(store, T, { action: 'create', classId: 'et', type: 'other', title: 'x', items: list }, 1, newId);
  await assert.rejects(create([{ type: 'posuk', details: { perek: 18, from: 14, to: 12 } }]), /last posuk/);
  await assert.rejects(create([{ type: 'posuk', details: { sefer: 'Yehoshua', perek: 1, from: 1 } }]), /sefer/);
  await assert.rejects(create([{ type: 'rashiLetters', details: { letters: [] } }]), /Rashi letter/);
  await assert.rejects(create([{ type: 'audio' }]), /choose an activity/);
  await assert.rejects(create(Array.from({ length: 13 }, () => ({ type: 'other' }))), /12 items/);
  assert.equal(store.data.assignmentCenter, undefined, 'nothing was saved');
});

test('student sees items; itemDone marks only real items and starts the work', async () => {
  const { store, id } = await published();
  const a = (await studentList(store, 600)).assignments[0];
  assert.equal(a.items.length, 3);
  assert.deepEqual(a.itemsDone, {});
  await assert.rejects(itemDone(store, id, 'nope', 601), { code: 404 });
  const r = await itemDone(store, id, a.items[0].id, 602);
  assert.equal(r.allDone, false);
  let b = (await studentList(store, 603)).assignments[0];
  assert.equal(b.status, 'in_progress');
  assert.equal(b.itemsDone[a.items[0].id], 602);
  // A repeat report keeps the first time.
  await itemDone(store, id, a.items[0].id, 700);
  b = (await studentList(store, 701)).assignments[0];
  assert.equal(b.itemsDone[a.items[0].id], 602);
  // The teacher report shows the same.
  const t = await homeworkApi(store, T, { action: 'teacherList', classId: 'et' }, 702);
  assert.deepEqual(Object.keys(t.assignments[0].students.s1.itemsDone), [a.items[0].id]);
  assert.deepEqual(t.assignments[0].students.s2.itemsDone, {});
  assert.equal(t.assignments[0].items.length, 3);
});

test('hand-in note is optional only once every item is done', async () => {
  const { store, id } = await published();
  const a = (await studentList(store, 600)).assignments[0];
  await assert.rejects(homeworkApi(store, {}, { action: 'submit', ...S1, assignmentId: id, answer: '' }, 601), /short note/);
  for (const item of a.items) await itemDone(store, id, item.id, 602);
  await homeworkApi(store, {}, { action: 'submit', ...S1, assignmentId: id, answer: '' }, 603);
  assert.equal((await studentList(store, 604)).assignments[0].status, 'submitted');
});

test('editing keeps finished items finished and can remove items', async () => {
  const { store, id } = await published();
  const a = (await studentList(store, 600)).assignments[0];
  await itemDone(store, id, a.items[1].id, 601);
  // Teacher drops the first item and adds a Shorashim item.
  await homeworkApi(store, T, { action: 'edit', classId: 'et', assignmentId: id, items: [a.items[1], a.items[2], { type: 'shorashim' }] }, 602, newId);
  const b = (await studentList(store, 603)).assignments[0];
  assert.equal(b.type, 'rashiLetters');
  assert.deepEqual(b.items.map(i => i.type), ['rashiLetters', 'chazara', 'shorashim']);
  assert.deepEqual(Object.keys(b.itemsDone), [a.items[1].id]);
  // Editing only the title leaves items alone.
  await homeworkApi(store, T, { action: 'edit', classId: 'et', assignmentId: id, title: 'Renamed' }, 604, newId);
  assert.equal((await studentList(store, 605)).assignments[0].items.length, 3);
  // An empty list turns it back into a plain assignment.
  await homeworkApi(store, T, { action: 'edit', classId: 'et', assignmentId: id, items: [] }, 606, newId);
  assert.deepEqual((await studentList(store, 607)).assignments[0].items, []);
  assert.equal('items' in defs(store)[id], false);
});

test('assignments without items work exactly as before', async () => {
  const store = makeStore(seed());
  const { id } = await homeworkApi(store, T, { action: 'create', classId: 'et', type: 'shorashim', title: 'Old', details: 'x', assignedAt: 0 }, 500, newId);
  assert.equal('items' in defs(store)[id], false);
  await homeworkApi(store, T, { action: 'publish', classId: 'et', assignmentId: id }, 501, newId);
  const a = (await studentList(store, 600)).assignments[0];
  assert.equal(a.type, 'shorashim');
  assert.deepEqual(a.items, []);
  await assert.rejects(itemDone(store, id, 'i1', 601), { code: 404 });
});

test('a student cannot mark items on homework given to someone else, or with a wrong passcode', async () => {
  const store = makeStore(seed());
  const { id } = await homeworkApi(store, T, { action: 'create', classId: 'et', type: 'other', title: 'Only Dan', items: [{ type: 'other' }], studentIds: ['s2'], assignedAt: 0 }, 500, newId);
  await homeworkApi(store, T, { action: 'publish', classId: 'et', assignmentId: id }, 501, newId);
  const itemId = defs(store)[id].items[0].id;
  await assert.rejects(itemDone(store, id, itemId, 600), { code: 404 });
  await assert.rejects(homeworkApi(store, {}, { action: 'itemDone', ...S1, studentId: 's2', studentName: 'Dan Two', pin: '0000', assignmentId: id, itemId }, 600));
});

test('staging copy behaves the same and shares the item module', async () => {
  const root = path.resolve(__dirname, '..');
  assert.equal(fs.readFileSync(path.join(root, 'backend/functions/homework-items-core.cjs'), 'utf8'),
    fs.readFileSync(path.join(root, 'backend/functions/homework-staging/homework-items-core.cjs'), 'utf8'));
  const store = makeStore(seed());
  await staging.homeworkApi(store, T, { action: 'create', classId: 'et', type: 'other', title: 'S', items: ITEMS, assignedAt: 0 }, 500, newId);
  const def = Object.values(defs(store))[0];
  assert.equal(def.items.length, 3);
  assert.equal(items.allDone(def, { itemsDone: Object.fromEntries(def.items.map(i => [i.id, 1])) }), true);
});

// ---------- browser helpers ----------
const vm = require('node:vm');
function loadItems() {
  const context = { window: { location: { href: 'https://funtorahtools.com/assignment-center/student.html' } }, URL };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assignment-center/homework-items.js'), 'utf8'), context);
  return context.window.HomeworkItems;
}

test('item links open the real activity at the assigned spot in homework mode', () => {
  const HI = loadItems();
  const a = { id: 'A1', title: 'Week 3', assignedAt: 1700000000000 };
  const posuk = new URL(HI.itemUrl(a, { id: 'i1', type: 'posuk', details: { sefer: 'Shemos', perek: 18, from: 12, to: 14, skills: ['translate', 'reading'] } }));
  assert.equal(posuk.pathname, '/record_pesukim/student.html');
  const q = Object.fromEntries(posuk.searchParams);
  assert.deepEqual(q, { hw: 'A1', hwItem: 'i1', hwTitle: 'Week 3', hwSince: '1700000000000', sefer: 'Shemos', perek: '18', posuk: '12', endPosuk: '14', hwSkills: 'translate,reading', tab: 'translate' });
  const one = new URL(HI.itemUrl(a, { id: 'i2', type: 'posuk', details: { perek: 1, from: 1, to: 1, skills: ['understand'] } }));
  assert.equal(one.searchParams.has('endPosuk'), false);
  assert.equal(one.searchParams.get('tab'), 'comprehension');
  const rashi = new URL(HI.itemUrl(a, { id: 'i3', type: 'rashiLetters', details: { letters: ['zayin', 'alef'] } }));
  assert.equal(rashi.pathname, '/rashi-letters/student.html');
  assert.equal(rashi.searchParams.get('hwLetters'), 'zayin,alef');
  const chazara = new URL(HI.itemUrl(a, { id: 'i4', type: 'chazara', details: { perek: 18, from: 1, to: 3, times: 2 } }));
  assert.deepEqual([chazara.searchParams.get('hwPerek'), chazara.searchParams.get('hwFrom'), chazara.searchParams.get('hwTo'), chazara.searchParams.get('hwTimes')], ['18', '1', '3', '2']);
  assert.match(HI.itemUrl(a, { id: 'i5', type: 'shorashim' }), /\/shorashim\/index\.html\?hw=A1&hwItem=i5/);
  assert.equal(HI.itemUrl(a, { id: 'i6', type: 'workbook' }), '', 'workbook items are ticked on the homework page');
});

test('items read clearly for teachers and students', () => {
  const I = v => '\u2068' + v + '\u2069';
  const HI = loadItems();
  assert.equal(HI.describe({ type: 'posuk', details: { sefer: 'Bereishis', perek: 18, from: 12, to: 14, skills: ['reading', 'translate'] } }),
    'Bereishis · '+I('פרק י״ח')+' · pesukim '+I('י״ב–י״ד')+' (12–14) · Reading, Translate');
  assert.equal(HI.describe({ type: 'chazara', details: { perek: 1, from: 5, to: 5, times: 1 } }), I('פרק א׳')+' · posuk '+I('ה׳')+' (5) · once each');
  assert.equal(HI.describe({ type: 'rashiLetters', details: { letters: ['alef'] } }), 'Letters: '+I('א'));
  assert.equal(HI.hebNum(15), 'ט״ו');
});

test('student checklist links keep the sign-in (opener) and never hand in by opening', () => {
  const src = fs.readFileSync(path.join(__dirname, '../assignment-center/homework-items.js'), 'utf8');
  assert.match(src, /a\.target = '_blank'; a\.rel = 'opener';/);
  const student = fs.readFileSync(path.join(__dirname, '../assignment-center/student.html'), 'utf8');
  assert.match(student, /<script src="homework-items\.js"><\/script>/);
  assert.match(student, /HI\.checklist\(a,/);
  const teacher = fs.readFileSync(path.join(__dirname, '../assignment-center/teacher.html'), 'utf8');
  assert.match(teacher, /HI\.builder\(\$\('itemsBuilder'\)/);
  assert.match(teacher, /action:'edit',[^\n]*items:itemsBox\.get\(\)/);
});

test('every activity page loads homework mode; the lock only switches on with ?hw=', () => {
  const page = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  for (const [file, marker] of [['record_pesukim/student.html', "hwSkills"], ['rashi-letters/student.html', "hwLetters"], ['chazara/index.html', "hwPerek"],
    ['shorashim/index.html', 'data-manual-done'], ['weekly-quiz/index.html', 'data-manual-done']]) {
    const html = page(file);
    assert.match(html, /<script src="\.\.\/assignment-center\/homework-mode\.js\?v=[^"]+"/, file);
    assert.ok(html.includes(marker), file + ' has its homework adapter');
  }
  const mode = page('assignment-center/homework-mode.js');
  assert.match(mode, /var active = KEY\.test\(assignmentId\) && KEY\.test\(itemId\);/);
  assert.match(mode, /if \(!active\) return;/);
  assert.match(mode, /action: 'itemDone'/);
});
