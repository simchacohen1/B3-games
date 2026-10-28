'use strict';
// Static menu coverage only. This test DOES NOT establish that any URL or
// underlying Firebase/API action denies unauthorized access. See issue #439.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const manifest = JSON.parse(fs.readFileSync('docs/teacher-tools-route-inventory.json', 'utf8'));
const homepage = fs.readFileSync('index.html', 'utf8');
const teacherCenter = fs.readFileSync('teacher-home.html', 'utf8');

function menuPaths() {
  const start = homepage.indexOf('id="teacherToolsSection"');
  const end = homepage.indexOf('id="versionModal"', start);
  assert.ok(start >= 0 && end > start, 'homepage Teacher Tools menu must exist');
  const section = homepage.slice(start, end);
  const home = [...section.matchAll(/<a\b[^>]*class="teacher-tool-card"[^>]*href="([^"]+)"/g)]
    .map(match => match[1].split('?')[0]);
  assert.match(section, /id="actAsStudentCard"/, 'student preview action must be audited separately');

  const source = teacherCenter.match(/const TOOLS=\{([\s\S]*?)\};\s*const STUDENT_TOOLS=/);
  assert.ok(source, 'Teacher Center tool map must exist');
  const center = [...source[1].matchAll(/\[\s*"[^"]+"\s*,\s*"([^"]+)"\s*\]/g)]
    .map(match => match[1].split('?')[0]);
  return {home, center};
}

test('every teacher menu destination has an explicitly unverified audit entry', () => {
  const {home, center} = menuPaths();
  assert.ok(home.length >= 21, 'homepage menu shrank: review before changing coverage');
  assert.ok(center.length >= 18, 'Teacher Center menu shrank: review before changing coverage');
  const actual = [...new Set([...home, ...center])].sort();
  assert.deepEqual(actual, manifest.routes.map(row => row.path).sort(),
    'new, removed or renamed teacher routes require an updated security inventory');
  for (const row of manifest.routes) {
    assert.equal(row.homepage, home.includes(row.path), row.path + ' homepage classification changed');
    assert.equal(row.teacherCenter, center.includes(row.path), row.path + ' Teacher Center classification changed');
    assert.equal(row.authorization, 'NOT_VERIFIED',
      'do not mark a route secure based on this static inventory');
  }
});

test('teacher menu links remain local paths, not external or script URLs', () => {
  const {home, center} = menuPaths();
  for (const path of [...home, ...center]) {
    assert.match(path, /^[A-Za-z0-9_/-]+\.html$/, 'unexpected tool URL: ' + path);
    assert.ok(!path.includes('..') && !path.startsWith('/'), 'nonlocal tool URL: ' + path);
  }
});
