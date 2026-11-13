"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/deploy-class-access.yml"), "utf8");

test("production class-access deployment is manual, owner-only, and target-bound", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s{2}(?:push|pull_request):/m);
  assert.match(workflow, /github\.actor == 'simchacohen1'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /pull_number: 779/);
  assert.match(workflow, /pr\.head\.sha !== sha/);
  assert.match(workflow, /checks\.listForRef/);
  assert.match(workflow, /check\.conclusion !== "success"/);
  assert.match(workflow, /workloadIdentityPools\/github-actions-prod\/providers\/teacher-class-access/);
  assert.match(workflow, /github-functions-deployer@b3-games\.iam\.gserviceaccount\.com/);
  assert.match(workflow, /functions:funTorahClassAccess/);
  assert.match(workflow, /--project=b3-games/);
  assert.doesNotMatch(workflow, /firebase deploy --only functions(?:\s|$)/);
  assert.doesNotMatch(workflow, /FIREBASE_TOKEN|firebase login|secrets\.FIREBASE/);
});

test("deployment guard requires every branch-protection check and only checks that run on PR #779", () => {
  const expected = workflow.match(/const expected = \[([\s\S]*?)\];/);
  assert.ok(expected, "guard keeps an explicit expected-check list");
  const names = [...expected[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  for (const required of ["test", "access-tests", "critical-security", "coloring"]) {
    assert.ok(names.includes(required), `guard must require branch-protection check: ${required}`);
  }
  for (const extra of ["teacher-access", "principal-access", "real-browser-follow",
    "Synthetic learning tools and access boundaries"]) {
    assert.ok(names.includes(extra), `guard must keep access check: ${extra}`);
  }
  // follow-teacher-tests.yml is path-filtered and does not run on PR #779.
  assert.ok(!names.includes("navigation-policy"));
  assert.match(workflow, /missing\.length \|\| failed\.length/);
});
