'use strict';
// Student zones on the shared whiteboard: the rules (board-zones-core.js), what is saved with a board, and how the pages use them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'class-pointer-prototype');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const Z = require(path.join(root, 'board-zones-core.js'));

const dan = { k: 'stu-dan', n: 'Dan' };
const yosef = { k: 'stu-yosef', n: 'Yosef' };
const box = (id, x, y, w, h, owners = []) => ({ id, x, y, w, h, owners });
const line = points => ({ tool: 'pen', color: '#000000', size: .006, points });

test('a student is known by dashboard id, or by name when there is none', () => {
  assert.equal(Z.keyOf({ studentId: 'abc123', name: 'Dan' }), 'abc123');
  assert.equal(Z.keyOf({ studentId: null, name: '  Dan   Cohen ' }), 'name:dan cohen');
  assert.equal(Z.keyOf(null), '');
});

test('zones are checked: kept inside the board, never tiny, no repeated ids, owners cleaned', () => {
  const list = Z.cleanList([
    box('z1', .1, .1, .3, .3, [dan, dan, { k: '', n: 'x' }]),
    box('z1', .5, .5, .2, .2),
    box('z2', .9, .9, .5, .5),
    box('z3', .1, .1, .001, .5),
    box('bad id', .1, .1, .2, .2),
    null
  ]);
  assert.deepEqual(list.map(z => z.id), ['z1', 'z2']);
  assert.deepEqual(list[0].owners, [dan]);
  assert.ok(list[1].x + list[1].w <= 1 && list[1].y + list[1].h <= 1);
  assert.equal(Z.cleanList('nope').length, 0);
  assert.equal(Z.cleanList(Array.from({ length: 50 }, (_, i) => box('z' + (i + 1), .1, .1, .2, .2))).length, Z.LIMITS.zones);
});

test('drawing a zone takes two corners in any order, and refuses a tiny box', () => {
  assert.deepEqual(Z.make([], { x: .6, y: .7 }, { x: .2, y: .1 }), box('z1', .2, .1, .4, .6));
  assert.equal(Z.make([], { x: .2, y: .2 }, { x: .21, y: .21 }), null);
  assert.equal(Z.make([box('z4', .1, .1, .2, .2)], { x: 0, y: 0 }, { x: .5, y: .5 }).id, 'z5');
});

test('splitting the board gives equal boxes that fill it without overlap', () => {
  const made = Z.grid(2, 3);
  assert.equal(made.length, 6);
  for (const a of made) for (const b of made) if (a !== b) {
    const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    assert.ok(apart, 'boxes ' + a.id + ' and ' + b.id + ' must not overlap');
  }
  assert.equal(Z.grid(0, 3), null);
  assert.equal(Z.grid(10, 10), null);
});

test('one box for each of N students gives exactly N boxes, for any class size', () => {
  for (let n = 1; n <= Z.LIMITS.zones; n++) {
    const made = Z.gridFor(n);
    assert.equal(made.length, n, 'n=' + n);
    assert.ok(made.every(z => z.w >= Z.LIMITS.minSize && z.h >= Z.LIMITS.minSize && z.x + z.w <= 1.0001 && z.y + z.h <= 1.0001));
  }
  assert.equal(Z.gridFor(0), null);
  assert.equal(Z.gridFor(Z.LIMITS.zones + 1), null);
});

test('a board with no zones is free for everyone, as it always was', () => {
  assert.equal(Z.allows([], false, 'stu-dan', line([{ x: .5, y: .5 }, { x: .6, y: .6 }])), true);
  assert.equal(Z.active([]), false);
});

test('a student can write only inside a zone that is theirs', () => {
  const zones = [box('z1', .05, .05, .4, .4, [dan]), box('z2', .55, .05, .4, .4, [yosef]), box('z3', .05, .55, .9, .4, [dan, yosef])];
  const inside = line([{ x: .1, y: .1 }, { x: .4, y: .4 }]);
  assert.equal(Z.allows(zones, false, 'stu-dan', inside), true);
  assert.equal(Z.allows(zones, false, 'stu-yosef', inside), false, 'Yosef cannot write in Dan’s zone');
  assert.equal(Z.allows(zones, false, 'stu-dan', line([{ x: .3, y: .3 }, { x: .6, y: .3 }])), false, 'a line that leaves the zone');
  assert.equal(Z.allows(zones, false, 'stu-dan', line([{ x: .3, y: .3 }, { x: .6, y: .7 }])), false, 'a line across two zones');
  assert.equal(Z.allows(zones, false, 'stu-dan', line([{ x: .1, y: .6 }, { x: .9, y: .9 }])), true, 'a zone shared by two students');
  assert.equal(Z.allows(zones, false, 'stu-yosef', line([{ x: .1, y: .6 }, { x: .9, y: .9 }])), true);
  assert.equal(Z.allows(zones, false, 'someone-else', inside), false, 'a student with no zone can write nowhere');
  assert.equal(Z.allows(zones, false, '', inside), false);
});

test('locking every zone stops all students at once, and unlocking gives it back', () => {
  const zones = [box('z1', .05, .05, .4, .4, [dan])];
  const inside = line([{ x: .1, y: .1 }, { x: .2, y: .2 }]);
  assert.equal(Z.allows(zones, true, 'stu-dan', inside), false);
  assert.equal(Z.allows(zones, false, 'stu-dan', inside), true);
});

test('words only need to start inside the box (their width is a guess)', () => {
  const zones = [box('z1', .05, .05, .3, .3, [dan])];
  const words = { tool: 'text', text: 'hello', points: [{ x: .3, y: .1 }, { x: .5, y: .16 }] };
  assert.equal(Z.allows(zones, false, 'stu-dan', words), true);
  assert.equal(Z.allows(zones, false, 'stu-dan', { ...words, points: [{ x: .4, y: .1 }, { x: .6, y: .16 }] }), false);
});

test('a mark that is a hair outside is still accepted, but not one that is clearly outside', () => {
  const zones = [box('z1', .2, .2, .3, .3, [dan])];
  assert.equal(Z.allows(zones, false, 'stu-dan', line([{ x: .1995, y: .3 }, { x: .3, y: .3 }])), true);
  assert.equal(Z.allows(zones, false, 'stu-dan', line([{ x: .18, y: .3 }, { x: .3, y: .3 }])), false);
  assert.equal(Z.allows(zones, false, 'stu-dan', { tool: 'pen', points: [] }), false);
});

test('a line dragged out of the box stops at its edge, and a mark moves only as far as the box lets it', () => {
  const zone = box('z1', .2, .2, .3, .3);
  assert.deepEqual(Z.clampTo(zone, { x: .9, y: .1 }), { x: .5, y: .2 });
  const fit = Z.fitMove(zone, [{ x: .3, y: .3 }, { x: .4, y: .4 }], .5, -.5);
  assert.ok(Math.abs(fit.dx - .1) < 1e-9 && Math.abs(fit.dy - -.1) < 1e-9);
  assert.deepEqual(Z.fitMove(zone, [], .1, .1), { dx: 0, dy: 0 });
});

test('a student is told every box and which are theirs, but only other students’ names', () => {
  const zones = [box('z1', .05, .05, .4, .4, [dan]), box('z2', .55, .05, .4, .4, [yosef, dan])];
  const told = Z.forStudent(zones, false, 'stu-dan');
  assert.deepEqual(told.zones.map(z => z.mine), [true, true]);
  assert.equal(told.zones[1].label, 'Yosef, Dan');
  assert.ok(!JSON.stringify(told).includes('stu-yosef'), 'other students’ keys are never sent');
  assert.equal(Z.forStudent(zones, true, 'stu-yosef').locked, true);
  assert.deepEqual(Z.forStudent(zones, false, 'stu-yosef').zones.map(z => z.mine), [false, true]);
});

test('what a student page keeps of that message is checked, and its own rules agree with the teacher’s', () => {
  const zones = [box('z1', .05, .05, .4, .4, [dan]), box('z2', .55, .05, .4, .4, [yosef])];
  const state = Z.cleanForStudent(JSON.parse(JSON.stringify(Z.forStudent(zones, false, 'stu-dan'))));
  const inside = line([{ x: .1, y: .1 }, { x: .2, y: .2 }]), outside = line([{ x: .6, y: .1 }, { x: .7, y: .2 }]);
  for (const stroke of [inside, outside, line([{ x: .3, y: .3 }, { x: .6, y: .3 }])]) {
    assert.equal(Z.studentAllows(state, stroke), Z.allows(zones, false, 'stu-dan', stroke));
  }
  assert.equal(Z.studentZoneAt(state, { x: .1, y: .1 }).id, 'z1');
  assert.equal(Z.studentZoneAt(state, { x: .6, y: .1 }), null);
  assert.equal(Z.studentZoneAt({ ...state, locked: true }, { x: .1, y: .1 }), null);
  assert.equal(Z.cleanForStudent({ zones: [{ id: 'z9', x: 2, y: 2, w: 1, h: 1, mine: true }, 'x'] }).zones.length, 0);
  assert.deepEqual(Z.cleanForStudent(null), { locked: false, zones: [] });
  assert.equal(Z.studentAllows(null, outside), true);
});

test('zones are saved with the board and come back checked (slides and templates too)', () => {
  const { cleanLessonBoard } = (() => {
    global.window = { ClassPointerZones: Z };
    delete require.cache[require.resolve(path.join(root, 'board-clipboard.js'))];
    const api = require(path.join(root, 'board-clipboard.js'));
    return api;
  })();
  const cleanStroke = stroke => stroke;
  const zones = [box('z1', .05, .05, .4, .4, [dan]), box('z2', .55, .05, .4, .4)];
  const one = cleanLessonBoard({ version: 1, kind: 'lesson-whiteboard', pictures: [], strokes: [], zones, zonesLocked: true }, cleanStroke);
  assert.deepEqual(one.pages[0].zones, zones);
  assert.equal(one.zonesLocked, true);
  const many = cleanLessonBoard({ version: 2, kind: 'lesson-whiteboard', current: 1, pages: [{ pictures: [], strokes: [], zones }, { pictures: [], strokes: [] }, { pictures: [], strokes: [], zones: [box('z1', .1, .1, .5, .5), box('bad', 0, 0, 1, 1)] }] }, cleanStroke);
  assert.deepEqual(many.pages.map(p => p.zones.length), [2, 0, 1], 'each slide keeps its own zones');
  assert.equal(many.zonesLocked, false);
  // An old file, from before zones, opens with none.
  assert.deepEqual(cleanLessonBoard({ version: 1, kind: 'lesson-whiteboard', pictures: [], strokes: [] }, cleanStroke).pages[0].zones, []);
  delete global.window;
});

test('the teacher’s page checks every mark a student sends against that student’s zones', () => {
  const src = read('classroom.js');
  assert.match(src, /const zoneAllows=\(member,stroke\)=>!zonesOn\(\)\|\|Z\.allows\(zoneState\.zones,zoneState\.locked,Z\.keyOf\(member\),stroke\)/);
  // new marks, changed marks, taken-away marks, undo and clear
  assert.match(src, /if\(!zoneAllows\(member,message\.stroke\)\)\{send\(member\.connection,\{type:'lesson-zone-denied'\}\);return\}/);
  assert.match(src, /zoneAllows\(member,highlightStore\.strokes\.find\(mark=>mark\.id===change\.id\)\)&&zoneAllows\(member,converted\)/);
  assert.match(src, /canEditStudentMark\(member,mark\)&&zoneAllows\(member,mark\)/);
  assert.match(src, /zonesOn\(\)&&zoneState\.locked\)\{send\(member\.connection,\{type:'lesson-zone-denied'\}\)/);
  // who the student is comes from the connection, never from the message
  assert.doesNotMatch(src, /Z\.keyOf\(message/);
  // every student that joins is told, and the teacher is never held back
  assert.equal((src.match(/sendZones\(/g) || []).length >= 4, true);
  assert.match(src, /setZones\(list,locked\)\{if\(!isTeacher\|\|!Z\)return/);
});

test('zones are kept per slide, saved, and sent again after the board or the page changes', () => {
  const src = read('pdf-mode.js');
  assert.match(src, /page\.zones=cloneStrokes\(zones\)/, 'a slide keeps its zones when the teacher leaves it');
  assert.match(src, /zones=Z\?Z\.cleanList\(page\.zones\):\[\];syncZones\(\)/, 'a slide brings its zones back');
  assert.match(src, /page\.zones=cloneStrokes\(from\.zones\)/, 'a copied slide copies its zones');
  assert.match(src, /\.\.\.keep\(zones\),\.\.\.lock/);
  assert.match(src, /\.\.\.keep\(page\.zones\)/);
  assert.match(src, /zones=pages\[data\.current\]\.zones\.slice\(\);zonesLocked=data\.zonesLocked===true&&zones\.length>0;syncZones\(\)/);
  // a student cannot start, drag or stretch a mark outside their own box
  assert.match(src, /const zone=zoneStart\(p\);if\(zone===false\)/);
  assert.match(src, /if\(draftZone\)p=Z\.clampTo\(draftZone,p\)/);
  assert.match(src, /Z\.fitMove\(edit\.zone,all\.points,dx,dy\)/);
  // a new board or a closed board clears the zones; the document being replaced does not
  assert.match(src, /reset:\(\)=>\{myZones=null;renderZones\(\);studentReset\(\)\}/);
});

test('private student copies are not touched by zones', () => {
  const boards = read('student-boards.js');
  assert.doesNotMatch(boards, /ClassPointerZones|zoneAllows|myZones|lesson-zones/);
  // the only addition is the list of group names the zones window offers
  assert.match(boards, /list:\(\)=>groupsOn\(\)\?gstate\.groups\.map/);
});

test('the classroom page loads the zone files in an order that works, and the toolbar has a Zones button', () => {
  const html = read('classroom.html');
  const order = ['board-zones-core.js', 'classroom.js', 'pdf-mode.js', 'student-boards.js', 'board-zones.js', 'classroom-annotate.js'].map(name => html.indexOf('src="' + name));
  assert.ok(order.every(i => i > 0), 'all six scripts are on the page');
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'core first, tools after the whiteboard, toolbar last');
  const bar = read('classroom-annotate.js');
  assert.match(bar, /id:'zones'/);
  assert.match(bar, /ClassPointerZoneTools\?\.signature/);
});

test('the zones window only ever shows names as text and works only on the teacher’s page', () => {
  const src = read('board-zones.js');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(src, /if\(!B\|\|!B\.isTeacher\|\|!Z\)return/);
  for (const word of ['Draw a zone', 'Lock all zones', 'Unlock all zones', 'Remove all zones', 'One box for each student', 'Make boxes']) assert.ok(src.includes(word), word);
});
