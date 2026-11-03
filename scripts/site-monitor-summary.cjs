#!/usr/bin/env node
'use strict';
// Turns the Playwright JSON report from the live site monitor into a short,
// plain-language Markdown summary (used for the run summary and the issue).
const fs = require('node:fs');

const file = process.argv[2] || 'monitor-report/results.json';
let report;
try { report = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) {
  console.log('## Live site check\n\nThe tests did not finish, so there is no report. Open the run log to see which step failed.');
  process.exit(0);
}

const rows = [];
(function walk(suite, trail) {
  const names = suite.title ? [...trail, suite.title] : trail;
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      const results = t.results || [];
      const last = results[results.length - 1] || {};
      const status = t.status === 'skipped' ? 'skipped'
        : t.status === 'expected' ? 'passed'
        : t.status === 'flaky' ? 'passed after retry'
        : 'FAILED';
      const error = (last.errors || [last.error]).filter(Boolean).map(e => e.message || '').join('\n');
      rows.push({ name: [...names.filter(n => !/\.spec\.ts$/.test(n)), spec.title].join(' > '), project: t.projectName, status, error });
    }
  }
  for (const child of suite.suites || []) walk(child, names);
})({ suites: report.suites || [] }, []);

const count = s => rows.filter(r => r.status === s).length;
const failed = rows.filter(r => r.status === 'FAILED');
const clean = s => s.replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join('\n').slice(0, 900);

const out = [];
out.push(failed.length ? '## ❌ Live site check found problems' : '## ✅ Live site check passed');
out.push('');
out.push(`Passed: ${count('passed')} · Passed after retry: ${count('passed after retry')} · Failed: ${failed.length} · Skipped: ${count('skipped')}`);
if (failed.length) {
  out.push('', '### What failed');
  for (const r of failed) out.push('', `**${r.name}** (${r.project})`, '```', clean(r.error) || '(no message)', '```');
}
const flaky = rows.filter(r => r.status === 'passed after retry');
if (flaky.length) out.push('', '### Slow or shaky (passed on the second try)', ...flaky.map(r => `- ${r.name} (${r.project})`));
const skipped = rows.filter(r => r.status === 'skipped');
if (skipped.length) out.push('', '### Skipped', ...skipped.map(r => `- ${r.name}`));
console.log(out.join('\n'));
