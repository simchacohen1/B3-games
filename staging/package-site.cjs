'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { stageSource } = require('./prepare-site.cjs');

const SKIP_DIRS = new Set([
  '.git', '.github', '.firebase', '.vscode', '.idea', '.claude', '.codex', '.agents', '.aws',
  'node_modules', 'backend', 'docs', 'e2e', 'tests', 'security', 'scripts', 'staging', 'staging-build',
  'test-results', 'playwright-report',
  // Separate git worktrees kept inside the checkout. They hold other branches' files (real student names,
  // production endpoints) and must never be published to staging.
  '_worktrees', 'worktrees'
]);
const SKIP_FILES = /^(?:firebase.*\.json|package(?:-lock)?\.json|\.env(?:\..*)?|\.firebaserc|firebase-debug(?:\..*)?\.log|.*(?:service-account|firebase-adminsdk|credentials|secret).*\.json|.*\.(?:pem|key|p12|pfx|jks|md|markdown|ps1|cjs|rules|map|log))$/i;

// The files git tracks in `source`, as { files, dirs } sets of '/'-separated relative paths, or null when `source` is
// not the root of a git checkout (a plain export or test fixture). Untracked and ignored files, other worktrees and
// local leftovers are therefore never packaged. `git` is a real executable on Windows, so no shell is needed.
function trackedFiles(source) {
  const root = path.resolve(source);
  let top, listing;
  try {
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    top = git(['rev-parse', '--show-toplevel']).trim();
    listing = git(['ls-files', '-z']);
  } catch (_) { return null; }
  const norm = p => path.resolve(p).replace(/[\\/]+$/, '');
  const same = process.platform === 'win32' ? (a, b) => a.toLowerCase() === b.toLowerCase() : (a, b) => a === b;
  if (!same(norm(top), norm(root))) return null;   // a folder inside some other checkout: not the repository root
  const files = new Set(), dirs = new Set();
  for (const name of listing.split('\0')) {
    if (!name) continue;
    files.add(name);
    for (let i = name.indexOf('/'); i !== -1; i = name.indexOf('/', i + 1)) dirs.add(name.slice(0, i));
  }
  return { files, dirs };
}

// `tracked` (from trackedFiles) only ever narrows what is copied: every skip rule below still applies.
function copyTree(source, output, tracked = null, rel = '') {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && (SKIP_DIRS.has(entry.name) || /^(?:backup|preview|staging-build)(?:-|$)/i.test(entry.name))) continue;
    if (entry.isFile() && (SKIP_FILES.test(entry.name) || entry.name.toLowerCase().endsWith('.pem'))) continue;
    const relPath = rel ? rel + '/' + entry.name : entry.name;
    if (tracked && entry.isDirectory() && !tracked.dirs.has(relPath)) continue;
    if (tracked && entry.isFile() && !tracked.files.has(relPath)) continue;
    const from = path.join(source, entry.name);
    const to = path.join(output, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copyTree(from, to, tracked, relPath);
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
  const tracked = trackedFiles(source);
  copyTree(source, output, tracked);
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
  return { ...result, output, trackedOnly: !!tracked };
}

if (require.main === module) {
  const [, , source, output] = process.argv;
  if (!source || !output) throw new Error('Usage: node staging/package-site.cjs <source-checkout> <empty-output-directory>');
  try {
    const result = packageSite(source, output);
    console.log('Packaged ' + result.fileCount + ' text files for Firebase project ' + result.projectId + ' at ' + result.output +
      (result.trackedOnly ? ' (git-tracked files only).' : ' (not a git checkout: every non-skipped file was considered).'));
  } catch (error) {
    // Print the cause plainly (a file-system error names the file and code, which is what matters on Windows:
    // EBUSY/EPERM = a file is locked by another program, ENOENT = a path that is too long).
    console.error('Staging packaging failed: ' + error.message + (error.code ? ' [' + error.code + ']' : '') + (error.path ? ' (' + error.path + ')' : ''));
    process.exitCode = 1;
  }
}

module.exports = { packageSite, copyTree, trackedFiles, SKIP_DIRS, SKIP_FILES };
