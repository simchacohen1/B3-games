'use strict';
// Staging-only guardrails: an ordinary production Functions deployment must not
// export the Homework prototype or point it at a production Firebase project.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const file = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('general production Functions index does not expose staging homework', () => {
  const index = file('backend/functions/index.js');
  assert.doesNotMatch(index, /exports\.homeworkPortal\s*=/);
  assert.match(file('backend/functions/homework-staging/index.js'), /homework/);
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
