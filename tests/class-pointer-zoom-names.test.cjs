const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const V = require('../class-pointer-prototype/viewport-core.js');
const C = require('../class-pointer-prototype/classroom-core.js');

const dir = path.join(__dirname, '..', 'class-pointer-prototype');
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const full = { x: 0, y: 0, w: 1, h: 1 };

test('zoomAt keeps the point under the cursor fixed', () => {
  const result = V.zoomAt(full, full, 2, { x: 0.25, y: 0.75 });
  assert.equal(result.zoom, 2);
  assert.ok(Math.abs(result.view.w - 0.5) < 1e-9);
  // the point at 25%/75% of the old view is still at 25%/75% of the new view
  assert.ok(Math.abs(result.view.x + 0.25 * result.view.w - 0.25) < 1e-9);
  assert.ok(Math.abs(result.view.y + 0.75 * result.view.h - 0.75) < 1e-9);
});

test('zoomAt clamps to the shared area and to 100%-600%', () => {
  const corner = V.zoomAt(full, full, 99, { x: 1, y: 1 });
  assert.equal(corner.zoom, 6);
  assert.ok(corner.view.x + corner.view.w <= 1 + 1e-9);
  assert.ok(corner.view.y + corner.view.h <= 1 + 1e-9);
  const back = V.zoomAt(full, corner.view, 1, { x: 0.5, y: 0.5 });
  assert.deepEqual(back.view, full);
  const inner = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };
  const z = V.zoomAt(inner, inner, 3, { x: 0, y: 0 });
  assert.ok(z.view.x >= 0.2 - 1e-9 && z.view.y >= 0.2 - 1e-9);
});

test('zoomToBox fills the picture with the dragged box and stays in bounds', () => {
  const result = V.zoomToBox(full, full, 1, { x: 0.4, y: 0.4, w: 0.2, h: 0.1 });
  assert.ok(Math.abs(result.zoom - 5) < 1e-9);
  assert.ok(Math.abs(result.view.x + result.view.w / 2 - 0.5) < 1e-9);
  assert.equal(V.zoomToBox(full, full, 1, { x: 0, y: 0, w: 0, h: 0.2 }), null);
  const edge = V.zoomToBox(full, full, 1, { x: 0.9, y: 0.9, w: 0.1, h: 0.1 });
  assert.ok(edge.view.x + edge.view.w <= 1 + 1e-9 && edge.view.y + edge.view.h <= 1 + 1e-9);
  // zooming an already zoomed view compounds
  const again = V.zoomToBox(full, result.view, result.zoom, { x: 0, y: 0, w: 0.5, h: 0.5 });
  assert.ok(again.zoom > result.zoom);
});

test('teacher view has Reset zoom, Zoom to box and Ctrl/Cmd+wheel zoom wired in', () => {
  const src = read('viewport.js');
  for (const id of ['viewZoomReset', 'viewZoomBox']) assert.ok(src.includes(id));
  assert.ok(/addEventListener\('wheel'|listen\(stage,'wheel'/.test(src));
  assert.ok(src.includes('event.ctrlKey||event.metaKey'));
  assert.ok(src.includes('V.zoomToBox') && src.includes('V.zoomAt'));
  // existing controls remain
  for (const id of ['viewZoomIn', 'viewZoomOut', 'viewMove', 'viewChooseArea', 'viewShareFull']) assert.ok(src.includes(id));
  // overlays reset on any zoom so pointers/highlights cannot sit in the wrong place
  assert.ok(/function applyZoom[^]*resetOverlays\(\)/.test(src));
});

test('student names are no longer cut off', () => {
  const longName = 'Yaakov Shmuel Menachem Mendel Dovid Cohen';
  assert.equal(C.cleanName(longName), longName);
  assert.equal(C.cleanName('x'.repeat(200)).length, 60);
  assert.ok(!/text-overflow:ellipsis/.test(/\.board-name\{[^}]*\}/.exec(read('student-boards.css'))[0]));
  assert.ok(!/text-overflow:ellipsis/.test(/\.cp-name-text\{[^}]*\}/.exec(read('teacher-dashboard.css'))[0]));
  assert.ok(!/text-overflow:ellipsis/.test(/heading\.style\.cssText='[^']*'/.exec(read('activity-screen-teacher.js'))[0]));
});
