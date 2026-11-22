const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const js = fs.readFileSync(path.join(__dirname, '..', 'class-pointer-prototype', 'classroom.js'), 'utf8');

test("a student's connection vanishing never shows the teacher the student's 'class is no longer open' error", () => {
  const at = js.indexOf("if(isTeacher&&started&&kind==='peer-unavailable')");
  assert.ok(at > 0, 'teacher guard exists');
  assert.ok(at < js.indexOf('fail(message);if(!started&&!admitted)'), 'the guard runs before the error is shown');
  assert.match(js.slice(at, at + 140), /status\('A student has just left\.'\);return/);
});
