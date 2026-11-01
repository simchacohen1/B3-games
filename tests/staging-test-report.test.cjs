'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SECRET_JSON = JSON.stringify({
  studentAccounts: [{ name: 'Test Student A1', passcode: '918273', classId: 'TEST-ALEF' }],
  adultAccounts: [{ role: 'teacher', email: 'teacher.alef@funtorahtools-staging.test', password: 'fictional-Pass-77', classId: 'TEST-ALEF' }],
});
process.env.FTT_STAGING_CREDENTIALS_JSON = SECRET_JSON;
const report = require('../scripts/staging-test-report.cjs');

function tmpFile(name, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftt-report-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return file;
}

test('credentials from the secret are redacted from any report text', () => {
  const text = report.sanitize('fill 918273 then password fictional-Pass-77 and {"passcode":"abc"} Bearer eyJhbGciOi.x.y');
  assert.doesNotMatch(text, /918273|fictional-Pass-77|eyJhbGciOi|"abc"/);
  assert.match(text, /\[REDACTED\]/);
});

test('Playwright results separate passed, retried, failed and could-not-run checks', () => {
  const file = tmpFile('results.json', JSON.stringify({
    suites: [{ title: 'authenticated.spec.ts', specs: [], suites: [{ title: 'staging student journeys @auth', suites: [], specs: [
      { title: 'passes', file: 'a.ts', line: 1, tests: [{ status: 'expected', annotations: [], results: [{ status: 'passed' }] }] },
      { title: 'flaky one', file: 'a.ts', line: 2, tests: [{ status: 'flaky', annotations: [], results: [{ status: 'failed' }, { status: 'passed' }] }] },
      { title: 'breaks', file: 'a.ts', line: 3, tests: [{ status: 'unexpected', annotations: [], results: [{ status: 'failed', errors: [{ message: 'expected 918273 to be visible' }] }] }] },
      { title: 'needs secret', file: 'a.ts', line: 4, tests: [{ status: 'skipped', annotations: [{ type: 'skip', description: 'NOT VERIFIED: secret missing' }], results: [{ status: 'skipped' }] }] },
    ] }] }],
  }));
  const rows = report.collectPlaywright(file);
  const counts = report.summarize(rows);
  assert.deepEqual(counts, { passed: 1, flaky: 1, failed: 1, blocked: 1, total: 4 });
  const failed = rows.find(row => row.state === 'failed');
  assert.equal(failed.title, 'staging student journeys @auth › breaks');
  assert.doesNotMatch(failed.error, /918273/);
  assert.equal(rows.find(row => row.state === 'blocked').reason, 'NOT VERIFIED: secret missing');
  const markdown = report.markdownSummary({ suite: 's', title: 'Suite' }, rows, counts, 'run-url');
  assert.match(markdown, /FAILED/);
  assert.match(markdown, /Could not run \(NOT verified/);
});

test('a suite where nothing could run is never reported as passed', () => {
  const rows = [{ title: 'x', state: 'blocked', reason: 'NOT VERIFIED', file: '', error: '' }];
  const markdown = report.markdownSummary({ suite: 's' }, rows, report.summarize(rows), 'u');
  assert.match(markdown, /NOT VERIFIED \(nothing could run\)/);
  assert.doesNotMatch(markdown, /✅ PASSED/);
});

test('node TAP output reports only the failing leaf tests', () => {
  const file = tmpFile('node.tap', [
    'TAP version 13',
    '# Subtest: group',
    '    ok 1 - child passes',
    '    not ok 2 - child fails',
    'not ok 1 - group',
    'ok 2 - plain pass',
    'ok 3 - emulator only # SKIP set B3_RUN_RTDB_EMULATOR_TESTS',
    'not ok 4 - file level crash',
  ].join('\n'));
  const rows = report.collectNodeTap(file);
  assert.deepEqual(rows.filter(r => r.state === 'failed').map(r => r.title), ['child fails', 'file level crash']);
  assert.deepEqual(rows.filter(r => r.state === 'passed').map(r => r.title), ['child passes', 'plain pass']);
});

test('severity is highest for production-isolation failures', () => {
  assert.equal(report.severityFor('Chazara loads without production calls @isolation'), 'critical');
  assert.equal(report.severityFor('student cannot read another class @permissions'), 'high');
  assert.equal(report.severityFor('Rashi Letters opens'), 'medium');
});

test('issue body keeps a dedupe marker and round-trips its metadata', () => {
  const body = report.issueBody({ args: { suite: 'staging-smoke', title: 'Smoke' }, kind: 'failed', rows: [{ title: 't', state: 'failed', file: '', error: 'e' }], link: 'u', sig: 'abc123', lastComment: '2026-10-27T00:00:00.000Z', firstSeen: '2026-10-26T00:00:00.000Z', runs: 3 });
  assert.match(body, /<!-- ftt-auto-test suite=staging-smoke kind=failed -->/);
  assert.deepEqual(report.readMeta(body), { sig: 'abc123', lastComment: '2026-10-27T00:00:00.000Z', firstSeen: '2026-10-26T00:00:00.000Z', runs: 3 });
  assert.equal(report.signature([{ title: 'b' }, { title: 'a' }]), report.signature([{ title: 'a' }, { title: 'b' }]));
});

function fakeGitHub(openIssues) {
  const calls = [];
  global.fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ method, url, body: options.body ? JSON.parse(options.body) : null });
    const json = method === 'GET' ? openIssues : { number: 901 };
    return { ok: true, status: 200, json: async () => json, text: async () => '' };
  };
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_TOKEN = 'test-token';
  return calls;
}

test('a new failure opens exactly one issue', async () => {
  const calls = fakeGitHub([]);
  await report.syncIssue({ suite: 'staging-smoke', title: 'Smoke' }, 'failed', [{ title: 'Home loads', state: 'failed', file: '', error: '' }], 'run-1', { complete: true });
  const posts = calls.filter(c => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/issues$/);
  assert.deepEqual(posts[0].body.labels, ['automated-test-failure', 'bug']);
});

test('the same failure again updates the issue quietly instead of commenting', async () => {
  const rows = [{ title: 'Home loads', state: 'failed', file: '', error: '' }];
  const body = report.issueBody({ args: { suite: 'staging-smoke' }, kind: 'failed', rows, link: 'u', sig: report.signature(rows), lastComment: new Date().toISOString(), firstSeen: new Date().toISOString(), runs: 1 });
  const calls = fakeGitHub([{ number: 55, body }]);
  await report.syncIssue({ suite: 'staging-smoke', title: 'Smoke' }, 'failed', rows, 'run-2', { complete: true });
  assert.equal(calls.filter(c => c.method === 'POST').length, 0, 'no comment, no new issue');
  const patch = calls.find(c => c.method === 'PATCH');
  assert.match(patch.url, /\/issues\/55$/);
  assert.match(patch.body.body, /runs=2/);
});

test('a changed failing set comments once on the existing issue', async () => {
  const old = [{ title: 'Home loads', state: 'failed' }];
  const body = report.issueBody({ args: { suite: 'staging-smoke' }, kind: 'failed', rows: old, link: 'u', sig: report.signature(old), lastComment: new Date().toISOString(), firstSeen: new Date().toISOString(), runs: 1 });
  const calls = fakeGitHub([{ number: 55, body }]);
  await report.syncIssue({ suite: 'staging-smoke' }, 'failed', [{ title: 'Chazara loads', state: 'failed', file: '', error: '' }], 'run-3', { complete: true });
  const comments = calls.filter(c => c.method === 'POST' && /\/comments$/.test(c.url));
  assert.equal(comments.length, 1);
  assert.match(comments[0].body.body, /Chazara loads/);
});

test('a passing run closes the open issue, but an incomplete run does not', async () => {
  const body = '<!-- ftt-auto-test suite=staging-smoke kind=failed -->';
  let calls = fakeGitHub([{ number: 55, body }]);
  await report.syncIssue({ suite: 'staging-smoke' }, 'failed', [], 'run-4', { complete: false });
  assert.equal(calls.filter(c => c.method !== 'GET').length, 0);
  calls = fakeGitHub([{ number: 55, body }]);
  await report.syncIssue({ suite: 'staging-smoke' }, 'failed', [], 'run-5', { complete: true });
  const close = calls.find(c => c.method === 'PATCH');
  assert.equal(close.body.state, 'closed');
});
