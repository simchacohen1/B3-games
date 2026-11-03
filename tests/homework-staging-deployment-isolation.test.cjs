'use strict';
// Staging-only guardrails: an ordinary production Functions deployment must not
// export the Homework prototype or point it at a production Firebase project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const file = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('live Functions index exposes the live homework function, staging keeps its own copy', () => {
  const index = file('backend/functions/index.js');
  assert.match(index, /exports\.homeworkPortal\s*=\s*require\("\.\/homework"\)\.homeworkPortal/);
  assert.doesNotMatch(file('backend/functions/homework.js'), /fun-torah-tools-staging/);
  assert.match(file('backend/functions/homework-staging/index.js'), /homework/);
  assert.doesNotMatch(file('backend/functions/homework-staging/homework.js'), /funtorahtools\.com/);
});

test('live homework function accepts only Google teachers, staging also accepts verified email teachers', () => {
  const live = file('backend/functions/homework-core.cjs');
  const staging = file('backend/functions/homework-staging/homework-core.cjs');
  assert.doesNotMatch(live, /'password'/);
  assert.match(live, /sign_in_provider !== 'google\.com'/);
  assert.match(staging, /\['google\.com', 'password'\]/);
});

test('homework deploy script and configuration remain staging preview only', () => {
  const config = JSON.parse(file('firebase.staging-preview.json'));
  assert.equal(config.hosting.site, 'fun-torah-tools-staging');
  assert.equal(config.functions[0].codebase, 'homework-staging');
  assert.equal(config.functions[0].source, 'backend/functions/homework-staging');
  const deploy = file('scripts/deploy-homework-staging-preview.ps1');
  assert.match(deploy, /\$projectId\s*=\s*'fun-torah-tools-staging'/);
  assert.match(deploy, /\$channelId\s*=\s*'homework-406-preview'/);
  assert.match(deploy, /hosting:channel:deploy/);
  assert.doesNotMatch(deploy, /--project\s+['"]?b3-games/);
});
