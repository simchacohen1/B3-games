'use strict';
/* Every student page checks the lock. This fails for:
 *   - a new HTML page nobody classified (add it to STUDENT_PAGES with its feature, or to EXEMPT_PAGES with the reason),
 *   - a student page that does not load student-lock.js with its feature,
 *   - a feature in the lock catalog that no page uses, a home-page tile with no lock feature, or an "exempt" page that
 *     uses the student sign-in (it is a student page after all). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const manifest = require('./student-lock-pages.manifest.cjs');
const core = require('../student-lock-core.js');

const ROOT = path.join(__dirname, '..');
const FEATURES = new Set(core.FEATURES.map(f => f.id));
const TAG = /<script\b[^>]*\bsrc="([^"]*student-lock\.js)(?:\?[^"]*)?"[^>]*>/gi;
const TILE_ALIAS = { gallery: 'class-gallery', tag: 'class-gallery', rashi: 'rashi-letters' };

// Tracked files and new files not yet added (but not ignored ones): a new page is caught while you are still writing it.
function trackedHtml() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.html'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
}
const ignored = file => manifest.IGNORED_DIRS.some(d => file.startsWith(d) || file.includes('/' + d));

// The check itself, on any set of files, so the test can be run against deliberately broken input.
function check({ files, read, manifest: m, features = FEATURES, resolves = () => true }) {
  const problems = [];
  const student = m.STUDENT_PAGES, exempt = m.EXEMPT_PAGES;
  for (const file of files) {
    if (!student[file] && !exempt[file] && !ignored(file)) problems.push(`${file}: new page. Add it to STUDENT_PAGES (with its feature) or EXEMPT_PAGES (with the reason) in tests/student-lock-pages.manifest.cjs.`);
  }
  for (const [file, feature] of Object.entries(student)) {
    if (exempt[file]) problems.push(`${file}: listed as both a student page and exempt.`);
    if (feature !== 'home' && !features.has(feature)) problems.push(`${file}: "${feature}" is not a feature in student-lock-core.js.`);
    if (!files.includes(file)) { problems.push(`${file}: listed but the file does not exist.`); continue; }
    const html = read(file), tags = [...html.matchAll(TAG)];
    if (tags.length !== 1) { problems.push(`${file}: must load student-lock.js exactly once (found ${tags.length}).`); continue; }
    const full = tags[0][0], declared = /\bdata-feature="([^"]*)"/.exec(full);
    if (!declared || declared[1] !== feature) problems.push(`${file}: the script says data-feature="${declared ? declared[1] : ''}" but this page is "${feature}".`);
    if (!/\bdefer\b/.test(full)) problems.push(`${file}: the lock script must be deferred (so it never blocks the page).`);
    if (!resolves(file, tags[0][1])) problems.push(`${file}: ${tags[0][1]} does not point at student-lock.js.`);
    const gate = /<script\b[^>]*game-gate\.js[^>]*data-game-id="([^"]+)"/i.exec(html) || /<script\b[^>]*data-game-id="([^"]+)"[^>]*game-gate\.js/i.exec(html);
    const quiz = (m.QUIZ_FEATURES || {})[file], declaredQuiz = /\bdata-feature-quiz="([^"]*)"/.exec(full);
    if (quiz && (!declaredQuiz || declaredQuiz[1] !== quiz)) problems.push(`${file}: the script must say data-feature-quiz="${quiz}".`);
    if (!quiz && declaredQuiz) problems.push(`${file}: data-feature-quiz is set but ${file} is not in QUIZ_FEATURES.`);
    if (quiz && !features.has(quiz)) problems.push(`${file}: quiz feature "${quiz}" is not a feature in student-lock-core.js.`);
    if (gate && (m.GATE_IS_TOOL_GRANT || {})[file] === gate[1]) { /* the older gate id is the tool grant, by design */ }
    else if (gate && gate[1] !== feature) problems.push(`${file}: the older gate says "${gate[1]}" but the lock feature is "${feature}".`);
  }
  for (const file of Object.keys(exempt)) {
    if (!files.includes(file)) problems.push(`${file}: exempt but the file does not exist.`);
    else if (/b3Games_studentId/.test(read(file))) problems.push(`${file}: marked exempt but it uses the student sign-in, so it is a student page.`);
  }
  const used = new Set([...Object.values(student), ...Object.values(m.QUIZ_FEATURES || {})]);
  for (const f of features) if (!used.has(f)) problems.push(`feature "${f}" is in the catalog but no page uses it.`);
  return problems;
}
const realRead = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const realResolves = (file, src) => fs.existsSync(path.resolve(path.dirname(path.join(ROOT, file)), src)) && path.resolve(path.dirname(path.join(ROOT, file)), src) === path.join(ROOT, 'student-lock.js');

test('every student page on the site checks the lock, and every page is classified', () => {
  const problems = check({ files: trackedHtml(), read: realRead, manifest, resolves: realResolves });
  assert.deepEqual(problems, [], '\n' + problems.join('\n'));
});

test('every tile on the student home page is a lockable feature', () => {
  const html = require('./render-home-html.cjs')();
  const ids = [...html.matchAll(/class="game-card"[^>]*\bdata-game-id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length >= 15, 'found the tiles: ' + ids.length);
  for (const id of ids) assert.ok(FEATURES.has(TILE_ALIAS[id] || id), `home tile "${id}" has no lock feature in student-lock-core.js`);
});

test('the check really fails: a new page, a missing script, a wrong feature and a sneaky exemption are all caught', () => {
  const m = { STUDENT_PAGES: { 'a/index.html': 'gematria' }, EXEMPT_PAGES: { 'a/teacher.html': 'teacher' }, IGNORED_DIRS: [] };
  const good = '<head><script defer src="../student-lock.js?v=1" data-feature="gematria"></script></head>';
  const pages = { 'a/index.html': good, 'a/teacher.html': '<p>teacher</p>' };
  const run = (over = {}, mm = m) => check({ files: Object.keys({ ...pages, ...over }), read: f => ({ ...pages, ...over })[f], manifest: mm, features: new Set(['gematria']) });
  assert.deepEqual(run(), [], 'the good case passes');
  assert.match(run({ 'b/new-game.html': '<p>a new student page</p>' }).join('\n'), /b\/new-game\.html: new page/);
  assert.match(run({ 'a/index.html': '<head></head>' }).join('\n'), /exactly once \(found 0\)/);
  assert.match(run({ 'a/index.html': good + good }).join('\n'), /exactly once \(found 2\)/);
  assert.match(run({ 'a/index.html': good.replace('gematria', 'chazara') }).join('\n'), /data-feature="chazara"/);
  assert.match(run({ 'a/index.html': good.replace('defer ', '') }).join('\n'), /must be deferred/);
  assert.match(run({ 'a/teacher.html': "sessionStorage.getItem('b3Games_studentId')" }).join('\n'), /uses the student sign-in/);
  assert.match(run({ 'a/index.html': '<script src="../game-gate.js" data-game-id="chazara"></script>' + good }).join('\n'), /older gate says "chazara"/);
  assert.match(check({ files: ['a/index.html'], read: () => good, manifest: { ...m, STUDENT_PAGES: { 'a/index.html': 'gematria' }, EXEMPT_PAGES: {} }, features: new Set(['gematria', 'unused']) }).join('\n'), /feature "unused" is in the catalog but no page uses it/);
});
