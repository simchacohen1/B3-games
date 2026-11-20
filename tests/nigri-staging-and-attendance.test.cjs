const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

test('staging package blanks every Nigri page that holds the real roster or the shared key', () => {
  const src = read('staging/prepare-site.cjs');
  for (const page of ['sync-to-nigri/school-marks.html', 'weekly-quiz/b3schoolmarksbridge.html', 'sync-to-nigri/chossid-lamdan.html', 'weekly-quiz/chossid-lamdan.html'])
    assert.ok(src.includes("'" + page + "'"), page);
  assert.match(src, /NIGRI_PAGES_DISABLED_IN_STAGING\.has\(relative\)/);
});

test('staging package blanks the API_KEY too, swaps the Attendance roster, and audits for "Last First" names', () => {
  const src = read('staging/prepare-site.cjs');
  assert.match(src, /SYNC_KEY\|API_KEY/);
  assert.match(src, /const ROSTERS=\{"Test Class Alef"/);
  assert.match(src, /PRODUCTION_ROSTER_MARKERS/);
  assert.match(src, /contains a real student name/);
  assert.match(src, /relative === 'guest-mode\.js'/);
});

test('Attendance opens only for the owner and signs in with Google before the old key', () => {
  const html = read('sync-to-nigri/index.html');
  assert.match(html, /id="attendanceChoice" hidden/);
  assert.match(html, /r\.reason === 'owner'/);
  assert.match(html, /if \(!attendanceOwner\) return;/);
  assert.match(html, /NigriAuth\.request\("\/sync-points"[\s\S]*?API_KEY\)/);
  assert.doesNotMatch(html, /"X-Sync-Key"\s*:/);
  assert.match(html, /href="school-marks\.html"/);   // teachers still reach School Marks
});
