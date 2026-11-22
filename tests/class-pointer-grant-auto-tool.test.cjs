const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'class-pointer-prototype', f), 'utf8');

test('raising a student to Highlight or Pen switches their lesson tool to it', () => {
  const js = read('activity-share.js');
  assert.match(js, /const raised=message\.level!==lessonLevel&&\(message\.level==='highlight'\|\|message\.level==='pen'\);lessonLevel=message\.level;if\(raised\)lessonTool=message\.level;/);
});

test('the screen-share toolbar also picks the granted tool', () => {
  const js = read('annotation-toolbar.js');
  assert.match(js, /if\(\(level==='highlight'\|\|level==='pen'\)&&LEVEL_TOOLS\[level\]\.includes\(level\)\)st\.tool=level;/);
});
