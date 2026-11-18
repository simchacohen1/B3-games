'use strict';
// Tool access overview, editing (owner only): checkboxes, clickable cells, a bulk bar, a confirm and an Undo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'owner-admin.html'), 'utf8');
const block = html.slice(html.indexOf('// ---- Editing the overview (owner only) ----'), html.indexOf('q("toolAccessSearch").addEventListener("input"'));

test('each teacher row starts with a checkbox, tool cells are buttons, and the bulk bar and Undo bar exist', () => {
  assert.match(html, /<th scope="row"><label><input type="checkbox" data-pick=/);
  assert.match(html, /<button type="button" class="tool-cell" data-teacher=/);
  for (const id of ['toolAccessSelectAll', 'toolAccessClearSel', 'toolAccessTool', 'toolAccessGive', 'toolAccessRemove', 'toolAccessUndoBar', 'toolAccessUndo'])
    assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /Select all shown/);
  assert.match(html, /Give to selected/);
  assert.match(html, /Remove from selected/);
});

test('a change applies to ALL of the teacher\'s active classes and warns about classes shared with other teachers', () => {
  assert.match(block, /const activeClassIds=id=>\{const t=teacherData\[id\];if\(!t\|\|t\.active===false\)return \[\];/);
  assert.match(block, /classData\[c\]\.active!==false/);
  assert.match(block, /Those classes are also used by /);
  assert.match(block, /if\(now===give\)continue;/, 'classes that already have the wanted value are not touched');
});

test('every change is confirmed first with the number of teachers and classes, and is written in one update', () => {
  assert.match(block, /This changes "\+p\.items\.length\+" class/);
  assert.match(block, /if\(!confirm\(message\)\)return;/);
  assert.match(block, /await db\.ref\(\)\.update\(updates\)/);
  assert.match(block, /updates\["b3Games\/workspaces\/"\+WS\+"\/classes\/"\+i\.classId\+"\/toolGrants\/"\+i\.tool\]=i\.next/);
});

test('Undo puts back exactly what was there (removing a value that did not exist before)', () => {
  assert.match(block, /prev:classData\[c\]\.toolGrants&&Object\.hasOwn\(classData\[c\]\.toolGrants,tool\)\?classData\[c\]\.toolGrants\[tool\]:null/);
  assert.match(block, /\]=i\.prev;\s*\/\/ null removes a value that did not exist before/);
  assert.match(block, /toolAccessLastChange=null;q\("status"\)\.textContent="Undone ✓"/);
});

test('only the verified owner can change anything, and a failed save changes nothing on screen', () => {
  assert.match(block, /if\(!isOwner\(auth\.currentUser\)\)\{q\("status"\)\.textContent="Only the owner can change tool access\.";return\}/);
  assert.match(block, /catch\(error\)\{console\.error\(error\);q\("status"\)\.textContent="Could not save\. Nothing was changed\.";return\}/);
  assert.ok(block.indexOf('await db.ref().update(updates)') < block.indexOf('classData[i.classId].toolGrants=Object.assign'), 'the screen changes only after the save worked');
});

test('the CSV export and the earlier overview features are unchanged by the editing controls', () => {
  assert.match(html, /const toolAccessHeaders=\["Name","School","Classes",\.\.\.PLATFORM_TOOLS\.map\(\(\[,name\]\)=>name\)\];/);
  assert.match(html, /downloadFile\("tool-access-overview\.csv",FTTOwnerExport\.toCsv\(\[toolAccessHeaders,\.\.\.rows\]\)\)/);
  assert.match(html, /\.access-overview-table thead th:first-child,\.access-overview-table tbody th\{position:sticky;left:0;/);
});
