const test = require('node:test');
const assert = require('node:assert/strict');
const { assess } = require('../scripts/approved-development-preflight.cjs');

// Fabricated approval IDs and status values are unit-test fixtures only.
const sample = () => ({
  repository: 'simchacohen1/B3-games',
  issue: { number: 107, state: 'OPEN', labels: ['owner-approved-for-development'],
    approval: { author: 'simchacohen1', commentId: 123, scopeId: 'posuk-translation-grading-v1', developmentOnly: true } },
  existingWorkReviewed: true, activeRuns: [], securityTests: 'passed',
  githubAccess: 'verified', costApproval: 'verified', runner: 'verified'
});

test('even a fully positive fixture cannot enable or launch execution', () => {
  assert.deepEqual(assess(sample()), { issue: 107, ready: false,
    blockers: ['execution-disabled', 'execution-adapter-not-installed'] });
});

for (const [name, mutate, blocker] of [
  ['other repository', s => s.repository = 'other/repo', 'repository-mismatch'],
  ['unlisted issue', s => s.issue.number = 108, 'issue-not-allowlisted'],
  ['closed issue', s => s.issue.state = 'CLOSED', 'issue-not-open'],
  ['generic label', s => s.issue.labels = ['approved'], 'missing-approval-label'],
  ['nonowner comment', s => s.issue.approval.author = 'collaborator', 'missing-owner-scope-approval'],
  ['different scope', s => s.issue.approval.scopeId = 'anything', 'missing-owner-scope-approval'],
  ['missing evidence', s => delete s.issue.approval.commentId, 'missing-owner-scope-approval'],
  ['broader permission', s => s.issue.approval.developmentOnly = false, 'missing-owner-scope-approval'],
  ['unreviewed existing work', s => s.existingWorkReviewed = false, 'existing-work-not-reviewed'],
  ['busy runner', s => s.activeRuns = ['existing'], 'concurrency-unavailable'],
  ['unknown runner state', s => delete s.activeRuns, 'concurrency-unavailable'],
  ['security failure', s => s.securityTests = 'failed', 'security-tests-not-passed'],
  ['missing GitHub access', s => delete s.githubAccess, 'github-api-access-unverified'],
  ['cost uncertainty', s => delete s.costApproval, 'cost-approval-unverified'],
  ['unverified runner', s => delete s.runner, 'runner-unverified']
]) test(`blocks ${name}`, () => {
  const s = sample(); mutate(s);
  assert.ok(assess(s).blockers.includes(blocker));
});

test('missing snapshot fails closed', () => {
  const result = assess(null);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('missing-owner-scope-approval'));
});
