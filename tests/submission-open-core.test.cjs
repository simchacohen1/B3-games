'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../backend/functions/submission-open-core.cjs');
const stagingCore = require('../backend/functions-staging/submission-open-core.cjs');
const rashi = require('../backend/functions/rashi-recording-core.cjs');
const { manageClassAccess } = require('../backend/functions/class-access-core.cjs');

test('staging copy matches the production copy', () => {
  const fs = require('node:fs');
  for (const file of ['submission-open-core.cjs', 'class-access-core.cjs']) {
    assert.equal(
      fs.readFileSync(`${__dirname}/../backend/functions/${file}`, 'utf8'),
      fs.readFileSync(`${__dirname}/../backend/functions-staging/${file}`, 'utf8'), file);
  }
  assert.equal(typeof stagingCore.isPosukOpen, 'function');
});

test('everything is closed by default', () => {
  assert.equal(core.isPosukOpen({}, 's1', ['Vayeira_18_1']), false);
  assert.equal(core.isPosukOpen(null, 's1', ['Vayeira_18_1']), false);
  assert.equal(core.isRashiOpen({}, 's1', 'zayin'), false);
  assert.equal(core.isPosukOpen({ items: { 'p:Vayeira': true } }, 's1', []), false);
});

test('a parsha, perek or posuk range opens the posuk keys it covers', () => {
  const cfg = { items: { 'p:Vayeira_18': true, 'p:Noach_6_2-4': true, 'p:Lech_12': false } };
  assert.equal(core.isPosukOpen(cfg, 's1', ['Vayeira_18_7']), true);
  assert.equal(core.isPosukOpen(cfg, 's1', ['Vayeira_19_1']), false);
  assert.equal(core.isPosukOpen(cfg, 's1', ['Noach_6_2', 'Noach_6_3', 'Noach_6_4']), true);
  assert.equal(core.isPosukOpen(cfg, 's1', ['Noach_6_1', 'Noach_6_2']), false, 'every posuk of a selection must be open');
  assert.equal(core.isPosukOpen(cfg, 's1', ['Lech_12_1']), false, 'a rule set to false is closed');
  assert.equal(core.isPosukOpen({ items: { 'p:Noach': true } }, 's1', ['Noach_9_29']), true);
  assert.equal(core.isPosukOpen({ items: { 'p:Noach': true } }, 's1', ['NoachX_9_29']), false);
});

test('open for one boy does not open it for another', () => {
  const cfg = { items: { 'p:Vayeira_18': true }, students: { s2: { items: { 'p:Vayeira_19': true, 'r:zayin': true } } } };
  assert.equal(core.isPosukOpen(cfg, 's2', ['Vayeira_19_3']), true);
  assert.equal(core.isPosukOpen(cfg, 's1', ['Vayeira_19_3']), false);
  assert.equal(core.isPosukOpen(cfg, 's2', ['Vayeira_18_3']), true, 'class items still apply to him');
  assert.equal(core.isRashiOpen(cfg, 's2', 'zayin'), true);
  assert.equal(core.isRashiOpen(cfg, 's1', 'zayin'), false);
});

test('Open all opens every posuk and Rashi item, for a class or for one boy', () => {
  assert.equal(core.isPosukOpen({ all: true }, 's1', ['Noach_6_1']), true);
  assert.equal(core.isRashiOpen({ all: true }, 's1', 'vayeira-18-1'), true);
  const one = { students: { s2: { all: true } } };
  assert.equal(core.isRashiOpen(one, 's2', 'bet'), true);
  assert.equal(core.isRashiOpen(one, 's1', 'bet'), false);
});

test('rules are validated and given readable names', () => {
  for (const ok of ['p:Vayeira', 'p:Vayeira_18', 'p:Vayeira_18_1-5', 'r:zayin', 'r:vayeira-18-1']) assert.equal(core.validRule(ok), true, ok);
  for (const bad of ['', 'p:', 'p:V', 'p:Vayeira_x', 'p:Vayeira_18_5', 'x:zayin', 'p:Vayeira/18', 'r:a b', null, 5]) assert.equal(core.validRule(bad), false, String(bad));
  assert.equal(core.ruleLabel('p:KiSeitzei_21_10-12'), 'Ki Seitzei · Perek 21 · Posuk 10–12');
  assert.equal(core.ruleLabel('p:Vayeira_18'), 'Vayeira · Perek 18');
  assert.equal(core.ruleLabel('r:zayin', rashi.sectionLabel), 'Rashi · ' + rashi.SECTIONS.zayin);
  assert.match(core.checkRule('p:Vayeira_18_9-3'), /range/);
  assert.match(core.checkRule('r:nonsense', rashi.isSection), /does not exist/);
  assert.equal(core.checkRule('r:zayin', rashi.isSection), '');
});

test('changesFor writes only the intended paths', () => {
  const isMember = id => id === 's1';
  assert.deepEqual(core.changesFor({ op: 'open', rule: 'p:Vayeira_18' }, rashi.isSection, isMember), { 'submissionOpen/items/p:Vayeira_18': true });
  assert.deepEqual(core.changesFor({ op: 'close', rule: 'r:zayin', studentId: 's1' }, rashi.isSection, isMember), { 'submissionOpen/students/s1/items/r:zayin': null });
  assert.deepEqual(core.changesFor({ op: 'openAll' }, rashi.isSection, isMember), { 'submissionOpen/all': true });
  assert.deepEqual(core.changesFor({ op: 'closeAll' }, rashi.isSection, isMember), { submissionOpen: null });
  assert.throws(() => core.changesFor({ op: 'open', rule: 'p:Vayeira', studentId: 'someoneElse' }, rashi.isSection, isMember), /not in this class/);
  assert.throws(() => core.changesFor({ op: 'open', rule: 'bad' }, rashi.isSection, isMember), /valid/);
  assert.throws(() => core.changesFor({ op: 'wipe' }, rashi.isSection, isMember), /Unknown/);
});

function fakeStore(data) {
  const writes = [];
  return {
    writes,
    get: async path => data[path] ?? null,
    update: async updates => { writes.push(updates); },
    updateSettings: async () => ({ committed: true })
  };
}
const teacher = { uid: 't1', email: 'teacher@example.com' };
const data = {
  'b3Games/workspaces/b3-2026/teachers/t1': { active: true, classIds: { c1: true } },
  'b3Games/workspaces/b3-2026/classes/c1': { active: true, members: { s1: { active: true }, s9: { active: false } } },
  'b3Games/workspaces/b3-2026/classes/c2': { active: true, members: {} },
  'b3Games/workspaces/b3-2026/classes/c1/submissionOpen': { items: { 'p:Vayeira_18': true }, students: { s1: { items: { 'r:zayin': true } } } }
};

test('a teacher can open and close items only in a class they are assigned to', async () => {
  const store = fakeStore(data);
  await manageClassAccess(store, teacher, { classId: 'c1', action: 'submissionOpenChange', op: 'open', rule: 'p:Noach_6' });
  assert.deepEqual(store.writes[0], { 'b3Games/workspaces/b3-2026/classes/c1/submissionOpen/items/p:Noach_6': true });
  await manageClassAccess(store, teacher, { classId: 'c1', action: 'submissionOpenChange', op: 'closeAll' });
  assert.deepEqual(store.writes[1], { 'b3Games/workspaces/b3-2026/classes/c1/submissionOpen': null });
  await assert.rejects(manageClassAccess(store, teacher, { classId: 'c2', action: 'submissionOpenChange', op: 'openAll' }), /not assigned/);
  await assert.rejects(manageClassAccess(store, teacher, { classId: 'c1', action: 'submissionOpenChange', op: 'open', rule: 'p:Noach', studentId: 's9' }), /not in this class/);
  assert.equal(store.writes.length, 2);
});

test('the teacher can read what is open, with names, per class and per boy', async () => {
  const out = await manageClassAccess(fakeStore(data), teacher, { classId: 'c1', action: 'submissionOpenRead' });
  assert.equal(out.all, false);
  assert.deepEqual(out.rules, [{ rule: 'p:Vayeira_18', label: 'Vayeira · Perek 18' }]);
  assert.equal(out.students.s1.rules[0].rule, 'r:zayin');
});

test('the teacher browser copy is identical to the server copy and works without Node', () => {
  const fs = require('node:fs');
  const server = fs.readFileSync(`${__dirname}/../backend/functions/submission-open-core.cjs`, 'utf8');
  assert.equal(fs.readFileSync(`${__dirname}/../shared/submission-open-core.js`, 'utf8'), server);
  const sandbox = { self: {} };
  new Function('self', 'module', server.replace("'use strict';", ''))(sandbox.self, undefined);
  assert.equal(sandbox.self.B3SubmissionOpenCore.isPosukOpen({ items: { 'p:Vayeira_18': true } }, 's1', ['Vayeira_18_2']), true);
});

test('a Rashi group opens every passage it contains', () => {
  assert.equal(core.isRashiOpen({ items: { 'r:vayeira-18': true } }, 's1', 'vayeira-18-5'), true);
  assert.equal(core.isRashiOpen({ items: { 'r:vayeira-18': true } }, 's1', 'vayeira-19-1'), false);
  assert.equal(core.isRashiOpen({ items: { 'r:vayeira': true } }, 's1', 'vayeira-22-3'), true);
  assert.equal(core.isRashiOpen({ items: { 'r:bet': true } }, 's1', 'betx'), false);
  assert.equal(core.ruleLabel('r:vayeira-18', rashi.sectionLabel), 'Rashi · Vayeira · Perek 18 (all)');
  assert.equal(core.ruleLabel('r:vayeira', rashi.sectionLabel), 'Rashi · Vayeira (all)');
});

test('the teacher can open a Vayeira perek but not an unknown Rashi item', async () => {
  const store = fakeStore(data);
  await manageClassAccess(store, teacher, { classId: 'c1', action: 'submissionOpenChange', op: 'open', rule: 'r:vayeira-18' });
  await manageClassAccess(store, teacher, { classId: 'c1', action: 'submissionOpenChange', op: 'open', rule: 'r:vayeira' });
  await assert.rejects(manageClassAccess(store, teacher, { classId: 'c1', action: 'submissionOpenChange', op: 'open', rule: 'r:nonsense' }), /does not exist/);
  assert.equal(store.writes.length, 2);
});

test('the Chumash list for the picker matches the posuk page', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(`${__dirname}/../record_pesukim/student.html`, 'utf8').split('\n');
  const start = html.findIndex(line => line.startsWith('const SEFORIM = {'));
  let end = start; while (!html[end].startsWith('};')) end++;
  const SEFORIM = new Function(html.slice(start, end + 1).join('\n').replace('const SEFORIM =', 'return '))();
  const expected = Object.entries(SEFORIM).map(([name, s]) => ({ name, hebrew: s.hebrew, parshiyos: Object.entries(s.parshiyos).map(([p, per]) => ({ name: p, slug: p.replace(/\s+/g, ''), perakim: [...new Set(per.map(x => x.num))] })) }));
  const sandbox = {}; new Function('window', fs.readFileSync(`${__dirname}/../shared/chumash-parshiyos.js`, 'utf8'))(sandbox);
  assert.deepEqual(sandbox.B3ChumashParshiyos, expected);
});
