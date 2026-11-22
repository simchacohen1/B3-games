const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const js = fs.readFileSync(path.join(__dirname, '..', 'class-pointer-prototype', 'classroom.js'), 'utf8');

test('the teacher page drops a student who has been silent for a minute', () => {
  assert.match(js, /const SILENT_MS=60000;/);
  assert.match(js, /presence\.values\(\)\)\)if\(m\.lastPing&&now-m\.lastPing>SILENT_MS\)\{try\{m\.connection\.close\(\)\}catch\{\}dropPresence\(m\)\}/);
  assert.match(js, /members\.values\(\)\)\)if\(m\.lastPing&&now-m\.lastPing>SILENT_MS\)\{try\{m\.connection\.close\(\)\}catch\{\}removeMember\(m\)\}/);
});
