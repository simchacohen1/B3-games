#!/usr/bin/env node
'use strict';

// Offline readiness assessment only. This module never launches jobs or accesses
// GitHub. A future trusted controller must obtain and authenticate fresh inputs.
const fs = require('node:fs');
const policy = require('../automation/approved-development.json');

function assess(snapshot, config = policy) {
  const blockers = [];
  const issue = snapshot?.issue;
  const task = config.tasks[String(issue?.number)];
  if (snapshot?.repository !== config.repository) blockers.push('repository-mismatch');
  if (!task) blockers.push('issue-not-allowlisted');
  if (issue?.state !== 'OPEN') blockers.push('issue-not-open');
  if (!issue?.labels?.includes(config.approvalLabel)) blockers.push('missing-approval-label');
  // The controller must derive this from an owner-authored issue comment, not
  // an arbitrary task description, label actor, collaborator or generic comment.
  const approval = issue?.approval;
  if (!approval || approval.author !== config.owner || !Number.isSafeInteger(approval.commentId)
      || approval.commentId <= 0 || approval.scopeId !== task?.scopeId
      || approval.developmentOnly !== true) blockers.push('missing-owner-scope-approval');
  if (snapshot?.existingWorkReviewed !== true) blockers.push('existing-work-not-reviewed');
  if (!Array.isArray(snapshot?.activeRuns) || snapshot.activeRuns.length >= config.maxConcurrentTasks) {
    blockers.push('concurrency-unavailable');
  }
  if (snapshot?.securityTests !== 'passed') blockers.push('security-tests-not-passed');
  if (snapshot?.githubAccess !== 'verified') blockers.push('github-api-access-unverified');
  if (snapshot?.costApproval !== 'verified') blockers.push('cost-approval-unverified');
  if (snapshot?.runner !== 'verified') blockers.push('runner-unverified');
  if (!config.enabled) blockers.push('execution-disabled');
  // Even all-green sample inputs cannot launch anything: adapter, authoritative
  // approval revalidation, durable leases and real pilot evidence are not built.
  blockers.push('execution-adapter-not-installed');
  return { issue: issue?.number ?? null, ready: false, blockers };
}

if (require.main === module) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/approved-development-preflight.cjs SNAPSHOT.json');
    const result = assess(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2; // blocked is deliberately nonzero
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { assess };
