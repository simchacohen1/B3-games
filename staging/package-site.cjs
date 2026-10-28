'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { stageSource } = require('./prepare-site.cjs');

const SKIP_DIRS = new Set([
  '.git', '.github', '.firebase', '.vscode', '.idea', '.claude', '.codex', '.agents', '.aws',
  'node_modules', 'backend', 'docs', 'e2e', 'tests', 'security', 'scripts', 'staging', 'staging-build',
  'test-results', 'playwright-report'
]);
const SKIP_FILES = /^(?:firebase.*\.json|package(?:-lock)?\.json|\.env(?:\..*)?|\.firebaserc|firebase-debug(?:\..*)?\.log|.*(?:service-account|firebase-adminsdk|credentials|secret).*\.json|.*\.(?:pem|key|p12|pfx|jks|md|markdown|ps1|cjs|rules|map|log))$/i;

function copyTree(source, output) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && (SKIP_DIRS.has(entry.name) || /^(?:backup|preview|staging-build)(?:-|$)/i.test(entry.name))) continue;
    if (entry.isFile() && (SKIP_FILES.test(entry.name) || entry.name.toLowerCase().endsWith('.pem'))) continue;
    const from = path.join(source, entry.name);
    const to = path.join(output, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function packageSite(sourceRoot, outputRoot, env = process.env) {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputRoot);
  const inPlaceBuild = path.join(source, 'staging-build');
  if (source === output || (output.startsWith(source + path.sep) && output !== inPlaceBuild)) {
    throw new Error('Staging output must be outside the source checkout.');
  }
  if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('Source checkout has no root index.html.');
  if (fs.existsSync(output) && fs.readdirSync(output).length) {
    throw new Error('Staging output directory must be empty.');
  }
  fs.mkdirSync(output, { recursive: true });
  copyTree(source, output);
  // The homepage and teacher page use this dependency-free browser policy
  // module from backend/functions/. Keep just that shared client file public;
  // never copy the Functions source tree or server-side credentials.
  const browserPolicy = path.join(source, 'backend', 'functions', 'student-tool-policy.js');
  if (!fs.existsSync(browserPolicy)) throw new Error('Missing browser-safe student tool policy module.');
  const policyOutput = path.join(output, 'backend', 'functions', 'student-tool-policy.js');
  fs.mkdirSync(path.dirname(policyOutput), { recursive: true });
  fs.copyFileSync(browserPolicy, policyOutput);
  const result = stageSource(output, env);
  if (!fs.existsSync(path.join(output, 'index.html'))) throw new Error('Packaged staging site has no root index.html.');
  return { ...result, output };
}

if (require.main === module) {
  const [, , source, output] = process.argv;
  if (!source || !output) throw new Error('Usage: node staging/package-site.cjs <source-checkout> <empty-output-directory>');
  const result = packageSite(source, output);
  console.log('Packaged ' + result.fileCount + ' text files for Firebase project ' + result.projectId + ' at ' + result.output + '.');
}

module.exports = { packageSite, copyTree, SKIP_DIRS, SKIP_FILES };
