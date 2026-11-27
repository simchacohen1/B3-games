const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = f => fs.readFileSync(path.join(__dirname, '..', 'class-pointer-prototype', f), 'utf8');

test("a student's own board shows one toolbar: the old tool row hides when the drawing toolbar is there", () => {
  const js = read('student-boards.js');
  assert.match(js, /const oneToolbar=boardsOn&&!!window\.FTTAnnotate;view\.classList\.toggle\('boards-annotated',oneToolbar\);/);
  assert.match(js, /drawGroup\.hidden=!boardsOn\|\|oneToolbar;/);
});

test('the slim top bar keeps Paste, Copy board, Back to Activity and Full screen; Save and My files are still added to it', () => {
  const js = read('student-boards.js');
  assert.match(js, /📋 Paste/);
  assert.match(js, /📄 Copy board/);
  assert.match(js, /↩ Back to Activity/);
  assert.match(js, /⛶ Full screen/);
  assert.match(read('saved-work.js'), /#myBoard \.boards-bar/);
});

test('the bar and the board start to the right of the floating toolbar so it cannot cover Back to Activity', () => {
  const css = read('student-boards.css');
  assert.match(css, /\.student-board\.boards-annotated \.boards-bar\{padding-left:84px\}/);
  assert.match(css, /\.student-board\.boards-annotated \.boards-focus\{padding-left:84px\}/);
});

test('the new version tokens are used by both pages that load the board', () => {
  for (const f of ['classroom.html', 'activity-share.js']) {
    const text = read(f);
    assert.match(text, f === 'classroom.html' ? /student-boards\.js\?v=20261127-pc1/ : /student-boards\.js\?v=20261127-pc1/, f);
    assert.match(text, f === 'classroom.html' ? /student-boards\.css\?v=20261127-sel1/ : /student-boards\.css\?v=20261127-sel1/, f);
  }
});
