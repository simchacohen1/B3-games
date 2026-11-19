// The staging packager must never publish other worktrees or untracked local files. (The safety audit in
// prepare-site.cjs is untouched and still blocks real student names and production endpoints.)
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { copyTree, trackedFiles, SKIP_DIRS } = require('../staging/package-site.cjs');

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-test-'));
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  git('init', '-q');
  const put = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('index.html'); put('rashi-letters/student.html'); put('yiddish/index.html');
  git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return { dir, put };
}
const names = root => { const out = []; (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; e.isDirectory() ? walk(path.join(d, e.name), r) : out.push(r); } })(root, ''); return out.sort(); };

test('_worktrees and worktrees are never packaged', () => {
  assert.ok(SKIP_DIRS.has('_worktrees') && SKIP_DIRS.has('worktrees'));
});

test('only git-tracked files are copied; untracked folders and a nested worktree are left out', () => {
  const { dir, put } = tempRepo();
  put('_worktrees/teacher-tool-registry/leak.html'); put('local-notes/untracked.html'); put('rashi-letters/untracked-here.html');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-out-'));
  const tracked = trackedFiles(dir);
  assert.ok(tracked, 'a git checkout is detected');
  copyTree(dir, out, tracked);
  assert.deepEqual(names(out), ['index.html', 'rashi-letters/student.html', 'yiddish/index.html']);
});

test('without git the old rules still apply (and _worktrees is skipped by name)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-plain-'));
  fs.mkdirSync(path.join(dir, '_worktrees/x'), { recursive: true }); fs.writeFileSync(path.join(dir, '_worktrees/x/leak.html'), 'x');
  fs.writeFileSync(path.join(dir, 'index.html'), 'x');
  assert.equal(trackedFiles(dir), null);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-out-'));
  copyTree(dir, out, null);
  assert.deepEqual(names(out), ['index.html']);
});

test('a folder inside someone else\'s checkout is not treated as a repository root', () => {
  const { dir, put } = tempRepo();
  put('sub/page.html');
  assert.equal(trackedFiles(path.join(dir, 'sub')), null);
});

test('.gitignore keeps _worktrees out of git', () => {
  assert.match(fs.readFileSync('.gitignore', 'utf8'), /^\/_worktrees\/$/m);
});
