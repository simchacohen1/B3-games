'use strict';
// Undo on the lesson whiteboard and PDF: it takes back the LAST thing a person did, exactly, whatever it was: a new mark of any
// kind, a delete, a move, a resize, a recolor, a block of words laid out again, or Clear. (Before, Undo only removed the newest
// mark, so after a Delete it removed other marks instead.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HighlightStore } = require('../class-pointer-prototype/classroom-core.js');

const pts = (x, y, w = .2, h = .2) => [{ x, y }, { x: x + w, y: y + h }];
const KINDS = {
  pen: { tool: 'pen', color: '#1f2937', size: 0.016, points: [{ x: .1, y: .1 }, { x: .2, y: .15 }, { x: .3, y: .1 }] },
  line: { tool: 'line', color: '#1f2937', size: 0.016, points: pts(.1, .2) },
  arrow: { tool: 'pen-arrow', color: '#1f2937', size: 0.016, points: pts(.1, .3) },
  rectangle: { tool: 'rectangle', color: '#1f2937', size: 0.016, points: pts(.2, .2) },
  filled: { tool: 'rectangle', color: '#1f2937', size: 0.016, fill: true, points: pts(.3, .2) },
  ellipse: { tool: 'ellipse', color: '#1f2937', size: 0.016, points: pts(.4, .2) },
  triangle: { tool: 'triangle', color: '#1f2937', size: 0.016, points: pts(.5, .2) },
  text: { tool: 'text', color: '#1f2937', size: 0.05, text: 'Hello', points: pts(.3, .5, .1, .05) },
  highlightRect: { tool: 'highlight-rectangle', color: '#ffcc00', size: 0.016, points: pts(.6, .2) },
  highlightEllipse: { tool: 'highlight-ellipse', color: '#ffcc00', size: 0.016, points: pts(.6, .5) },
  highlight: { tool: 'highlight', color: '#ffcc00', size: 0.016, points: pts(.1, .6, .3, 0) }
};
const ids = s => s.strokes.map(m => m.id);
const snap = s => JSON.stringify(s.strokes);
const board = () => { const s = new HighlightStore(); for (const kind of Object.values(KINDS)) assert.equal(s.add('teacher', kind), true, kind.tool); return s; };

for (const [name, kind] of Object.entries(KINDS)) {
  test(`Delete then Undo brings back a ${name}, in the same place, and nothing else changes`, () => {
    const s = board(); const before = snap(s);
    const target = s.strokes.find(m => m.tool === kind.tool && JSON.stringify(m.points) === JSON.stringify(kind.points));
    s.group('teacher', () => s.edit('teacher', 'erase', target.id));
    assert.equal(s.strokes.some(m => m.id === target.id), false);
    s.edit('teacher', 'undo');
    assert.equal(snap(s), before, 'exactly as before the delete (same id, same position in the pile)');
  });
  test(`Move then Undo puts a ${name} back exactly`, () => {
    const s = board(); const before = snap(s);
    const target = s.strokes.find(m => m.tool === kind.tool && JSON.stringify(m.points) === JSON.stringify(kind.points));
    const moved = { ...target, points: target.points.map(p => ({ x: p.x + .05, y: p.y + .05 })) };
    assert.equal(s.group('teacher', () => s.replace('teacher', target.id, moved)), true);
    assert.notEqual(snap(s), before);
    s.edit('teacher', 'undo');
    assert.equal(snap(s), before);
  });
}

test('the bug: add A, add B, delete A, Undo brings A back (it does not remove B); Undo again removes B', () => {
  const s = new HighlightStore();
  s.add('teacher', KINDS.highlightRect); s.add('teacher', KINDS.pen);
  const [a, b] = ids(s);
  s.group('teacher', () => s.edit('teacher', 'erase', a));
  assert.deepEqual(ids(s), [b]);
  s.edit('teacher', 'undo');
  assert.deepEqual(ids(s), [a, b], 'the deleted shape is back, the other mark was not touched');
  s.edit('teacher', 'undo');
  assert.deepEqual(ids(s), [a], 'then Undo goes back to the mark made before the delete');
  s.edit('teacher', 'undo');
  assert.deepEqual(ids(s), []);
});

test('a long mixed session is undone step by step, in reverse, back to empty', () => {
  const s = new HighlightStore(); const states = [snap(s)];
  const step = fn => { fn(); states.push(snap(s)); };
  step(() => s.add('teacher', KINDS.pen));
  step(() => s.add('teacher', KINDS.highlightEllipse));
  step(() => s.add('teacher', KINDS.text));
  step(() => s.group('teacher', () => s.replace('teacher', s.strokes[1].id, { ...s.strokes[1], points: pts(.7, .7) })));
  step(() => s.group('teacher', () => s.edit('teacher', 'erase', s.strokes[0].id)));
  step(() => s.add('teacher', KINDS.filled));
  step(() => s.group('teacher', () => s.replace('teacher', s.strokes[0].id, { ...s.strokes[0], color: '#1d4ed8' })));
  for (let k = states.length - 2; k >= 0; k--) { s.edit('teacher', 'undo'); assert.equal(snap(s), states[k], 'undo step back to state ' + k); }
  s.edit('teacher', 'undo');
  assert.deepEqual(ids(s), [], 'nothing left to undo, nothing breaks');
});

test('moving several marks together (or deleting a block of words) is ONE step', () => {
  const s = board(); const before = snap(s);
  const group = s.strokes.slice(0, 3);
  s.group('teacher', () => { for (const m of group) s.replace('teacher', m.id, { ...m, points: m.points.map(p => ({ x: p.x + .02, y: p.y })) }); });
  s.edit('teacher', 'undo');
  assert.equal(snap(s), before, 'one Undo moves the whole group back');
  s.group('teacher', () => { for (const m of group) s.edit('teacher', 'erase', m.id); });
  assert.equal(s.strokes.length, Object.keys(KINDS).length - 3);
  s.edit('teacher', 'undo');
  assert.equal(snap(s), before, 'one Undo brings the whole deleted group back');
});

test('words: Undo removes the whole block that was typed; a deleted block comes back whole; a laid-out-again block goes back', () => {
  const s = new HighlightStore();
  for (const line of ['one', 'two', 'three']) s.add('teacher', { ...KINDS.text, text: line, block: 'blk1', points: pts(.2, .3 + s.strokes.length * .05, .1, .04) });
  assert.equal(s.strokes.length, 3);
  const before = snap(s);
  s.group('teacher', () => { for (const m of [...s.strokes]) s.edit('teacher', 'erase', m.id); });
  assert.equal(s.strokes.length, 0);
  s.edit('teacher', 'undo'); assert.equal(snap(s), before);
  const old = s.strokes.map(m => m.id);
  const made = s.group('teacher', () => s.swap('teacher', old, [{ ...KINDS.text, text: 'one two', block: 'blk1' }, { ...KINDS.text, text: 'three', block: 'blk1', points: pts(.2, .6, .1, .04) }]));
  assert.equal(made.length, 2); assert.equal(s.strokes.length, 2);
  s.edit('teacher', 'undo'); assert.equal(snap(s), before, 'the block is laid out the way it was');
  s.edit('teacher', 'undo');
  assert.equal(s.strokes.length, 0, 'Undo of the typing removes every line of the block');
  s.edit('teacher', 'undo'); assert.equal(s.strokes.length, 0, 'leftover steps for lines that are gone are skipped');
});

test('Clear removes everything and Undo brings everything back; a student clearing only touches their own', () => {
  const s = board(); s.add('s1', KINDS.pen); const before = snap(s);
  assert.equal(s.clearAll('teacher'), true); assert.equal(s.strokes.length, 0);
  s.edit('teacher', 'undo'); assert.equal(snap(s), before);
  s.edit('s1', 'clear'); assert.equal(s.strokes.some(m => m.owner === 's1'), false); assert.equal(s.strokes.some(m => m.owner === 'teacher'), true);
  s.edit('s1', 'undo'); assert.equal(snap(s), before, 'the student gets their own mark back');
});

test('Undo is per person: the teacher undo never touches a student mark, and the student never touches the teacher', () => {
  const s = new HighlightStore();
  s.add('teacher', KINDS.pen); s.add('s1', KINDS.highlightRect); s.add('teacher', KINDS.line); s.add('s1', KINDS.pen);
  s.edit('s1', 'undo'); assert.deepEqual(s.strokes.map(m => m.owner + ':' + m.tool), ['teacher:pen', 's1:highlight-rectangle', 'teacher:line']);
  s.edit('teacher', 'undo'); assert.deepEqual(s.strokes.map(m => m.owner + ':' + m.tool), ['teacher:pen', 's1:highlight-rectangle']);
  // the teacher deletes a student's mark: the TEACHER's Undo brings it back (as the student's own mark, same id)
  const mark = s.strokes.find(m => m.owner === 's1');
  s.group('teacher', () => s.edit('s1', 'erase', mark.id));
  s.edit('teacher', 'undo');
  assert.equal(JSON.stringify(s.strokes.find(m => m.id === mark.id)), JSON.stringify(mark));
});

test('a student\'s own delete and move are undone by the student\'s Undo, exactly', () => {
  const s = new HighlightStore();
  s.add('s1', KINDS.highlightRect); s.add('s1', KINDS.highlightEllipse); const before = snap(s);
  const [a] = s.strokes;
  s.group('s1', () => s.replace('s1', a.id, { ...a, points: pts(.8, .8) }));
  s.group('s1', () => s.edit('s1', 'erase', s.strokes[1].id));
  s.edit('s1', 'undo'); s.edit('s1', 'undo');
  assert.equal(snap(s), before);
});

test('marks that came back from a saved whiteboard have no history: Undo still removes the newest one, as before', () => {
  const s = new HighlightStore();
  s.restore([{ ...KINDS.pen, owner: 'teacher' }, { ...KINDS.line, owner: 'teacher' }]);
  assert.equal(s.strokes.length, 2);
  s.edit('teacher', 'undo'); assert.equal(s.strokes.length, 1);
  s.add('teacher', KINDS.ellipse); s.edit('teacher', 'undo'); s.edit('teacher', 'undo'); assert.equal(s.strokes.length, 0);
});

test('a new lesson (reset) starts with a clean history', () => {
  const s = new HighlightStore(); s.add('teacher', KINDS.pen); s.group('teacher', () => s.edit('teacher', 'erase', s.strokes[0].id));
  s.reset(); s.add('teacher', KINDS.line);
  s.edit('teacher', 'undo'); assert.equal(s.strokes.length, 0, 'it removes the new line, it does not bring back the old pen mark');
});

test('only the last 100 steps are kept per person, and the limits on marks are unchanged', () => {
  const s = new HighlightStore();
  for (let i = 0; i < 120; i++) { s.add('teacher', { ...KINDS.pen, points: [{ x: (i % 90) / 100, y: .1 }, { x: .5, y: .2 }] }); if (s.strokes.length >= 140) break; }
  assert.ok(s.history.get('teacher').length <= 100);
});

test('the classroom page files every teacher and student change as one step of the person who made it', () => {
  const page = fs.readFileSync(path.join(__dirname, '../class-pointer-prototype/classroom.js'), 'utf8');
  for (const fragment of [
    "highlightStore.group('teacher',()=>highlightStore.edit(markOwner(id),'erase',id))",
    "highlightStore.group('teacher',()=>{for(const id of ids)highlightStore.edit(markOwner(id),'erase',id)})",
    "highlightStore.group('teacher',()=>highlightStore.swap(owner,ids,strokes))",
    "highlightStore.group('teacher',()=>highlightStore.replace(markOwner(id),id,stroke))",
    "highlightStore.group('teacher',()=>{for(const [id,stroke] of list)changed=highlightStore.replace(markOwner(id),id,stroke)||changed})",
    "highlightStore.group(member.id,()=>{",
    "if(action==='all')highlightStore.clearAll('teacher')"
  ]) assert.ok(page.replace(/\r\n/g, '\n').includes(fragment), fragment);
});
