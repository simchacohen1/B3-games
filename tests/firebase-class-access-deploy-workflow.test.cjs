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
  // Once PR #779 is merged, only its exact merge commit on main is accepted,
  // and the reviewed PR-head checks are still required.
  assert.match(workflow, /pr\.merged/);
  assert.match(workflow, /pr\.merge_commit_sha !== sha/);
  assert.match(workflow, /basehead: `main\.\.\.\$\{sha\}`/);
  assert.match(workflow, /\["behind", "identical"\]\.includes\(comparison\.status\)/);
  assert.match(workflow, /ref: pr\.head\.sha/);
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

test("deployment loads only the class-access function, so no unrelated secret is read", () => {
  // Firebase CLI resolves every defineSecret param in the loaded codebase, even with --only.
  const limit = workflow.indexOf("Limit the deployed source to funTorahClassAccess");
  const auth = workflow.indexOf("Authenticate with GitHub OIDC");
  const deploy = workflow.indexOf("firebase deploy --only functions:funTorahClassAccess");
  assert.ok(limit > 0 && limit < auth && auth < deploy, "the entry file is written before authentication and deployment");
  assert.match(workflow, /exports\.funTorahClassAccess = require\("\.\/class-access"\)\.funTorahClassAccess;/);
  assert.match(workflow, /npm pkg set main=class-access-deploy-entry\.js --prefix backend\/functions/);
  assert.match(workflow, /Deploy entry must export only funTorahClassAccess/);
  // The workflow itself must never be given a secret value or a secret-reading step.
  assert.doesNotMatch(workflow, /secrets\.[A-Z_]+/);
  assert.doesNotMatch(workflow, /^\s+(?:run:.*|- .*)(?:PARENT_DASHBOARD|functions:secrets|gcloud secrets)/m);
});
