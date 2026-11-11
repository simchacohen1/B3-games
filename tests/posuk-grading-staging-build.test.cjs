'use strict';
// Issue #107: grading-only staging Functions build (no deploy, no network).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, buildIndex, KEEP, DROP, STAGING_ORIGIN } = require('../staging/build-posuk-grading-functions.cjs');

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'posuk-grading-staging-'));
build(out);
const index = fs.readFileSync(path.join(out, 'index.js'), 'utf8');
const paidApi = fs.readFileSync(path.join(out, 'paid-api.js'), 'utf8');
process.on('exit', () => fs.rmSync(out, { recursive: true, force: true }));

test('only the Pasuk Practice grading functions are deployed', () => {
  const defined = [...index.matchAll(/^exports\.(\w+)\s*=/gm)].map(m => m[1]).sort();
  assert.deepEqual(defined, [...KEEP, ...DROP].sort());
  for (const name of DROP) assert.match(index, new RegExp('^delete exports\\.' + name + ';$', 'm'));
  // Everything below the grading code (weekly quiz, rewards, homework, gallery...) is cut off.
  assert.doesNotMatch(index, /exports\.generateWeeklyQuiz|require\(["']\.\/(?:student-rewards|homework|yiddish|class-gallery)/);
});

test('grading code is the production code, unchanged', () => {
  const source = fs.readFileSync('backend/functions/index.js', 'utf8');
  const head = source.slice(0, source.indexOf('\nexports.generateWeeklyQuiz = onRequest(') + 1);
  assert.ok(index.includes(head));
});

test('CORS allows only the staging site', () => {
  assert.match(paidApi, new RegExp('const ALLOWED_ORIGINS = \\[' + JSON.stringify(STAGING_ORIGIN).replace(/[.\/]/g, '\\$&') + '\\];'));
  assert.doesNotMatch(paidApi, /funtorahtools\.com|github\.io/);
});

test('every local module the grading code needs is included', () => {
  for (const file of [index, paidApi, ...fs.readdirSync(out).filter(f => f.endsWith('.cjs')).map(f => fs.readFileSync(path.join(out, f), 'utf8'))]) {
    for (const m of file.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) {
      const name = /\.c?js$/.test(m[1]) ? m[1] : m[1] + '.js';
      assert.ok(fs.existsSync(path.join(out, name)), 'missing ' + name);
    }
  }
});

test('build fails loudly if a new production function appears above the cut', () => {
  const source = fs.readFileSync('backend/functions/index.js', 'utf8')
    .replace('exports.gradeQuestionAnswer = onRequest(', 'exports.somethingNew = onRequest(() => {});\nexports.gradeQuestionAnswer = onRequest(');
  assert.throws(() => buildIndex(source), /somethingNew/);
});

test('staging deploy config never targets production', () => {
  const config = JSON.parse(fs.readFileSync('firebase.staging-posuk-grading.json', 'utf8'));
  assert.equal(config.functions.length, 1);
  assert.equal(config.functions[0].codebase, 'posuk-grading-staging');
  assert.equal(config.functions[0].source, '.staging-posuk-grading');
  assert.equal(config.hosting, undefined);
  const script = fs.readFileSync('scripts/deploy-posuk-grading-staging.ps1', 'utf8');
  assert.match(script, /\$projectId = 'fun-torah-tools-staging'/);
  for (const line of script.split('\n').filter(l => /^\s*firebase /.test(l))) {
    assert.match(line, /--project \$projectId/, line);
    assert.doesNotMatch(line, /b3-games|--only (?:database|functions(?!:posuk-grading-staging))/, line);
  }
});
