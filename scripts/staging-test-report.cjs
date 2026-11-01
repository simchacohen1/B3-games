#!/usr/bin/env node
'use strict';

// Turns unattended test results into a readable summary and, on scheduled
// runs, into one deduplicated GitHub issue per failing suite (issue #390).
//
//   node scripts/staging-test-report.cjs --suite staging-smoke --title "Staging public smoke" \
//        --playwright staging-results/results.json [--node-tap file.tap] [--issues]
//   node scripts/staging-test-report.cjs --suite overnight --title "Overnight reliability" \
//        --workflow-run <run id> --issues
//
// Without --issues it only prints/writes the summary. With --issues it needs
// GITHUB_TOKEN and GITHUB_REPOSITORY. It never prints or posts credentials:
// every passcode/password in FTT_STAGING_CREDENTIALS_JSON is redacted.

const fs = require('node:fs');
const crypto = require('node:crypto');

const LABEL = 'automated-test-failure';
const REPEAT_COMMENT_HOURS = 24;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key.slice(2)] = true;
    else { args[key.slice(2)] = next; i++; }
  }
  return args;
}

function secretValues() {
  const values = new Set();
  const raw = process.env.FTT_STAGING_CREDENTIALS_JSON || '';
  if (!raw) return values;
  try {
    const walk = node => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string' && /pass|code|token|secret/i.test(key) && value.length >= 4) values.add(value);
        else walk(value);
      }
    };
    walk(JSON.parse(raw));
  } catch (_) {
    // Unparseable secret: redact the whole string if it ever shows up.
    values.add(raw);
  }
  return values;
}

const SECRETS = secretValues();

function sanitize(text, max = 1200) {
  let out = String(text || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/("?(?:passcode|password|token|apiKey)"?\s*[:=]\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, '$1[REDACTED]');
  for (const secret of SECRETS) out = out.split(secret).join('[REDACTED]');
  if (out.length > max) out = out.slice(0, max) + '\n…(truncated)';
  return out.trim();
}

function severityFor(title) {
  if (/@isolation|production/i.test(title)) return 'critical';
  if (/@permissions|@signin|cannot read|sign-in|security|rules/i.test(title)) return 'high';
  return 'medium';
}

const SEVERITY_ORDER = { critical: 3, high: 2, medium: 1 };

function collectPlaywright(file) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = [];
  const visit = (suite, path) => {
    const here = suite.title && !/\.(ts|js|cjs)$/.test(suite.title) ? [...path, suite.title] : path;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const last = results[results.length - 1] || {};
        const title = [...here, spec.title].join(' › ');
        const skipNote = (test.annotations || []).find(a => a.type === 'skip');
        let state;
        if (test.status === 'skipped' || last.status === 'skipped') state = 'blocked';
        else if (test.status === 'expected') state = 'passed';
        else if (test.status === 'flaky') state = 'flaky';
        else state = 'failed';
        rows.push({
          title,
          file: spec.file ? `${spec.file}:${spec.line}` : '',
          state,
          reason: state === 'blocked' ? (skipNote?.description || 'skipped') : '',
          error: state === 'failed' ? sanitize((last.errors || [last.error]).filter(Boolean).map(e => e.message || e.value || '').join('\n')) : '',
        });
      }
    }
    for (const child of suite.suites || []) visit(child, here);
  };
  for (const suite of report.suites || []) visit(suite, []);
  if (!rows.length && (report.errors || []).length) {
    rows.push({ title: 'Playwright could not start the suite', file: '', state: 'failed', reason: '',
      error: sanitize(report.errors.map(e => e.message).join('\n')) });
  }
  return rows;
}

function collectNodeTap(file) {
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^(\s*)(not ok|ok) \d+ - (.+?)(?:\s+#\s*(SKIP|TODO)\b(.*))?$/);
    if (match) entries.push({ depth: match[1].length, failed: match[2] === 'not ok', title: match[3], skip: match[4], note: (match[5] || '').trim() });
  }
  // Subtests are printed before their parent and indented deeper. Report a
  // failing parent only when none of its own subtests failed.
  const rows = [];
  entries.forEach((entry, index) => {
    let hasChildren = false;
    let childFailed = false;
    for (let j = index - 1; j >= 0 && entries[j].depth > entry.depth; j--) {
      hasChildren = true;
      if (entries[j].failed) childFailed = true;
    }
    if (entry.failed && !childFailed) rows.push({ title: entry.title, file: '', state: 'failed', reason: '', error: '' });
    // Skipped node tests are the emulator-only ones; Overnight reliability
    // and Migration access checks run those with emulators, so they are not
    // counted here as passes or as gaps.
    else if (!entry.failed && !hasChildren && !entry.skip) {
      rows.push({ title: entry.title, file: '', state: 'passed', reason: '', error: '' });
    }
  });
  return rows;
}

async function collectWorkflowRun(runId) {
  const run = await gh(`/actions/runs/${runId}`);
  const jobs = await gh(`/actions/runs/${runId}/jobs?per_page=100`);
  const rows = [];
  for (const job of jobs.jobs || []) {
    if (job.conclusion === 'success') { rows.push({ title: job.name, state: 'passed', file: '', reason: '', error: '' }); continue; }
    if (job.conclusion === 'skipped' || job.conclusion === 'cancelled') {
      rows.push({ title: job.name, state: 'blocked', file: '', reason: `job ${job.conclusion}`, error: '' });
      continue;
    }
    const steps = (job.steps || []).filter(step => step.conclusion === 'failure').map(step => step.name);
    rows.push({ title: `${job.name}${steps.length ? ' › ' + steps.join(', ') : ''}`, state: 'failed', file: '',
      reason: '', error: `Job concluded "${job.conclusion}". See the job log: ${job.html_url}` });
  }
  return { rows, runUrl: run.html_url, conclusion: run.conclusion };
}

async function gh(path, options = {}) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required.');
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${options.method || 'GET'} ${path} failed: ${response.status} ${sanitize(await response.text(), 300)}`);
  }
  return response.status === 204 ? null : response.json();
}

function summarize(rows) {
  const count = state => rows.filter(row => row.state === state).length;
  return { passed: count('passed'), flaky: count('flaky'), failed: count('failed'), blocked: count('blocked'), total: rows.length };
}

function runLink() {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: id, GITHUB_RUN_ATTEMPT: attempt } = process.env;
  return server && repo && id ? `${server}/${repo}/actions/runs/${id}${attempt && attempt !== '1' ? `/attempts/${attempt}` : ''}` : '(local run)';
}

function markdownSummary(args, rows, counts, link) {
  const status = counts.failed ? '❌ FAILED'
    : counts.blocked ? (counts.passed || counts.flaky ? '⚠️ PASSED, BUT SOME CHECKS COULD NOT RUN' : '⚠️ NOT VERIFIED (nothing could run)')
    : '✅ PASSED';
  const lines = [
    `## ${args.title || args.suite}: ${status}`,
    '',
    '| Passed | Passed on retry | Failed | Could not run |',
    '|---:|---:|---:|---:|',
    `| ${counts.passed} | ${counts.flaky} | ${counts.failed} | ${counts.blocked} |`,
    '',
    `Run: ${link}`,
  ];
  const failed = rows.filter(row => row.state === 'failed');
  if (failed.length) {
    lines.push('', '### Failed');
    for (const row of failed) {
      lines.push(`- **${row.title}** _(severity: ${severityFor(row.title)})_${row.file ? ` — \`${row.file}\`` : ''}`);
      if (row.error) lines.push('', '  ```', ...row.error.split('\n').map(l => '  ' + l), '  ```');
    }
  }
  const flaky = rows.filter(row => row.state === 'flaky');
  if (flaky.length) {
    lines.push('', '### Passed only on retry (watch for flakiness)');
    for (const row of flaky) lines.push(`- ${row.title}`);
  }
  const blocked = rows.filter(row => row.state === 'blocked');
  if (blocked.length) {
    lines.push('', '### Could not run (NOT verified — these are not passes)');
    const byReason = new Map();
    for (const row of blocked) byReason.set(row.reason, [...(byReason.get(row.reason) || []), row.title]);
    for (const [reason, titles] of byReason) {
      lines.push(`- **${reason}** (${titles.length})`);
      for (const title of titles.slice(0, 15)) lines.push(`  - ${title}`);
      if (titles.length > 15) lines.push(`  - …and ${titles.length - 15} more`);
    }
  }
  if (!rows.length) lines.push('', '**No test results were produced.** The suite did not start; treat everything as NOT verified.');
  return lines.join('\n');
}

function signature(rows) {
  return crypto.createHash('sha256').update(rows.map(row => row.title).sort().join('\n')).digest('hex').slice(0, 12);
}

function issueBody({ args, kind, rows, link, sig, lastComment, firstSeen, runs }) {
  const marker = `<!-- ftt-auto-test suite=${args.suite} kind=${kind} -->`;
  const meta = `<!-- sig=${sig} last-comment=${lastComment} first-seen=${firstSeen} runs=${runs} -->`;
  const severity = rows.reduce((max, row) => SEVERITY_ORDER[severityFor(row.title)] > SEVERITY_ORDER[max] ? severityFor(row.title) : max, 'medium');
  const lines = [marker, meta, ''];
  if (kind === 'failed') {
    lines.push(
      `**Severity:** ${severity}  ·  **Suite:** ${args.title || args.suite}  ·  **Failing checks:** ${rows.length}`,
      `**First seen:** ${firstSeen}  ·  **Last seen:** ${new Date().toISOString()} ([run](${link}))  ·  **Failing runs so far:** ${runs}`,
      '',
      'Opened automatically by the unattended test system (#390). Only the isolated staging site and fictional accounts are used. This issue is updated in place (no new issue per run) and closed automatically when the suite passes again.',
      '',
      '### Failing checks',
    );
    for (const row of rows) {
      lines.push(`- **${row.title}** _(severity: ${severityFor(row.title)})_${row.file ? ` — \`${row.file}\`` : ''}`);
      if (row.error) lines.push('', '  ```', ...row.error.split('\n').map(l => '  ' + l), '  ```');
    }
    lines.push(
      '',
      '### How to reproduce',
      args.repro ? String(args.repro) : '1. Open the run link above and read the failed step.',
      '',
      '### Evidence',
      `Failure screenshots and the JSON report are attached to the run as a short-retention artifact (no traces or videos, so no typed passcodes are recorded).`,
      '',
      '### For a fix',
      'A fix must come as a separate draft PR with a regression test, reviewed and merged by a human. To ask an AI agent to investigate, the owner can add the `ai-investigate` label or comment `@codex investigate this failure and open a draft PR with a regression test`.',
    );
  } else {
    lines.push(
      `**Suite:** ${args.title || args.suite}  ·  **Checks that could not run:** ${rows.length}  ·  **Last seen:** ${new Date().toISOString()} ([run](${link}))`,
      '',
      'These checks were **skipped, not passed**. They need a credential, a staging deployment, or another owner action before they can verify anything. This issue is updated quietly and closed automatically once every check can run.',
      '',
    );
    const byReason = new Map();
    for (const row of rows) byReason.set(row.reason, [...(byReason.get(row.reason) || []), row.title]);
    for (const [reason, titles] of byReason) {
      lines.push(`- **${reason}**`);
      for (const title of titles) lines.push(`  - ${title}`);
    }
  }
  return lines.join('\n');
}

function readMeta(body) {
  const match = String(body || '').match(/<!-- sig=(\S+) last-comment=(\S+) first-seen=(\S+) runs=(\d+) -->/);
  return match ? { sig: match[1], lastComment: match[2], firstSeen: match[3], runs: Number(match[4]) } : null;
}

async function ensureLabels() {
  const wanted = [
    [LABEL, 'b60205', 'Opened by the unattended test system (#390)'],
    ['automated-coverage-gap', 'fbca04', 'Automated checks that could not run (#390)'],
  ];
  for (const [name, color, description] of wanted) {
    try { await gh(`/labels/${encodeURIComponent(name)}`); }
    catch (_) { await gh('/labels', { method: 'POST', body: JSON.stringify({ name, color, description }) }); }
  }
}

async function findIssue(suite, kind) {
  const label = kind === 'failed' ? LABEL : 'automated-coverage-gap';
  const issues = await gh(`/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`);
  return issues.find(issue => String(issue.body || '').includes(`<!-- ftt-auto-test suite=${suite} kind=${kind} -->`)) || null;
}

async function syncIssue(args, kind, rows, link, { complete }) {
  const existing = await findIssue(args.suite, kind);
  const now = new Date().toISOString();
  const name = args.title || args.suite;
  if (!rows.length) {
    // Close only when the suite really ran; a run that produced nothing must not hide a known problem.
    if (existing && complete) {
      await gh(`/issues/${existing.number}/comments`, { method: 'POST', body: JSON.stringify({
        body: kind === 'failed' ? `✅ Passing again in ${link}. Closing automatically.` : `✅ Every check in this suite ran in ${link}. Closing automatically.` }) });
      await gh(`/issues/${existing.number}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
      console.log(`Closed issue #${existing.number}`);
    }
    return;
  }
  const sig = signature(rows);
  const title = kind === 'failed'
    ? `[Automated test] ${name}: ${rows.length} failing`
    : `[Automated test] ${name}: ${rows.length} check${rows.length === 1 ? '' : 's'} could not run`;
  if (!existing) {
    const body = issueBody({ args, kind, rows, link, sig, lastComment: now, firstSeen: now, runs: 1 });
    const labels = kind === 'failed' ? [LABEL, 'bug'] : ['automated-coverage-gap'];
    const created = await gh('/issues', { method: 'POST', body: JSON.stringify({ title, body, labels }) });
    console.log(`Opened issue #${created.number}`);
    return;
  }
  const meta = readMeta(existing.body) || { sig: '', lastComment: now, firstSeen: now, runs: 0 };
  const changed = meta.sig !== sig;
  const stale = Date.now() - Date.parse(meta.lastComment) > REPEAT_COMMENT_HOURS * 3600 * 1000;
  // Coverage-gap issues never get repeat comments; failures get one when the
  // failing set changes, or a daily reminder while still failing.
  const comment = kind === 'failed' && (changed || stale);
  const body = issueBody({ args, kind, rows, link, sig, lastComment: comment ? now : meta.lastComment, firstSeen: meta.firstSeen, runs: meta.runs + 1 });
  await gh(`/issues/${existing.number}`, { method: 'PATCH', body: JSON.stringify({ title, body }) });
  if (comment) {
    const text = changed
      ? `The failing set changed in ${link}. Now failing:\n${rows.map(row => `- ${row.title}`).join('\n')}`
      : `Still failing in ${link} (${meta.runs + 1} failing runs since ${meta.firstSeen}).`;
    await gh(`/issues/${existing.number}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) });
  }
  console.log(`Updated issue #${existing.number}${comment ? ' with a comment' : ' quietly'}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.suite) throw new Error('--suite is required');
  let rows = [];
  let link = runLink();
  let complete = true;
  if (args['workflow-run']) {
    const run = await collectWorkflowRun(args['workflow-run']);
    rows = run.rows;
    link = run.runUrl;
    complete = run.conclusion === 'success' || run.conclusion === 'failure';
  }
  if (args.playwright) {
    if (fs.existsSync(args.playwright)) rows.push(...collectPlaywright(args.playwright));
    else { rows.push({ title: `${args.title || args.suite} did not produce results`, file: '', state: 'failed', reason: '', error: 'No Playwright JSON report was written. The suite crashed before running, or the install step failed.' }); }
  }
  if (args['node-tap']) {
    if (fs.existsSync(args['node-tap'])) rows.push(...collectNodeTap(args['node-tap']));
    else rows.push({ title: 'Node regression suite did not produce results', file: '', state: 'failed', reason: '', error: 'No TAP output was written.' });
  }
  const counts = summarize(rows);
  const markdown = markdownSummary(args, rows, counts, link);
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n\n');
  if (args.out) fs.writeFileSync(args.out, markdown + '\n');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `failed=${counts.failed}\nblocked=${counts.blocked}\npassed=${counts.passed + counts.flaky}\n`);
  }
  if (args.issues) {
    await ensureLabels();
    await syncIssue(args, 'failed', rows.filter(row => row.state === 'failed'), link, { complete });
    await syncIssue(args, 'blocked', rows.filter(row => row.state === 'blocked'), link, { complete: complete && !counts.failed });
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(sanitize(error.stack || error.message, 2000));
    process.exit(1);
  });
}

module.exports = { sanitize, severityFor, collectPlaywright, collectNodeTap, summarize, signature, readMeta, issueBody, markdownSummary, syncIssue };
