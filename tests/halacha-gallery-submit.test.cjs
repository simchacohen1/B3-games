'use strict';
// Halacha -> Class Gallery: the client must use the authenticated function, and
// the real classGallerySubmit handler must verify identity, route ET/WT vs other
// classes, keep posts pending and leave existing posts untouched.
// Synthetic data only; firebase-admin is replaced by an in-memory fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBackend } = require('../scripts/halacha-gallery-lab/fake-backend.cjs');
const { seed, students } = require('../scripts/halacha-gallery-lab/seed.cjs');

const root = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'halacha/gallery.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'halacha/index.html'), 'utf8');
// Smallest valid JPEG header + payload accepted by the server's magic-byte check.
const JPEG = 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from('ffd8ffe000104a46494600', 'hex'), Buffer.alloc(2048, 7), Buffer.from('ffd9', 'hex')]).toString('base64');

function backend() { return createBackend({ seed: seed(), repoRoot: root }); }
async function submit(b, sid, overrides = {}) {
  const s = students[sid];
  const body = { studentId: sid, studentName: s.name, classId: s.classId, pin: s.pin, title: 'Halacha — test', description: '', source: 'halacha', image: JPEG, ...overrides };
  return b.invoke(b.handlers.classGallerySubmit, { body });
}
const fresh = (b, p) => Object.entries(b.store.get(p) || {}).filter(([k]) => !k.startsWith('-SynExisting'));

test('Halacha client sends through the authenticated classGallerySubmit API only', () => {
  assert.match(client, /cloudfunctions\.net\/classGallerySubmit/);
  assert.match(client, /source: 'halacha'/);
  assert.doesNotMatch(client, /halachaDb|\.ref\(|firebase\.database/, 'Halacha Gallery must not write to the database directly');
  assert.doesNotMatch(client, /status\s*:\s*'pending'/, 'approval status is set by the server, not the browser');
  assert.doesNotMatch(client, /\bpersist\(|saveDrawing\(|\bsave\(\)/, 'capturing must never rewrite saved student work');
  assert.match(client, /window\.FTTGalleryCaptureImage\s*=/, 'site-wide button should send the same lesson picture');
  assert.match(html, /<script src="gallery\.js\?v=[^"]+"><\/script>/, 'Halacha page still loads gallery.js');
});

test('Client asks for scrapbook pages, coloring and student-friendly errors', () => {
  assert.match(client, /\.spread \.page/);
  assert.match(client, /_draw'/);
  assert.match(client, /ha-classroom canvas/);
  assert.match(client, /hal-sefer-study/);
  for (const status of [401, 403, 429, 413]) assert.match(client, new RegExp('status === ' + status));
  assert.match(client, /Could not reach the Class Gallery/);
  assert.match(client, /MAX_IMAGE_BYTES = 860 \* 1024/);
});

test('ET and WT Halacha submissions go to the legacy gallery as pending', async () => {
  const b = backend();
  const before = JSON.stringify(b.store.get('classGallery/posts'));
  for (const sid of ['syn_et_a', 'syn_wt_c']) {
    // A made-up display name is refused; browser-sent status/category are ignored.
    assert.equal((await submit(b, sid, { studentName: 'Someone Else' })).status, 401);
    const r = await submit(b, sid, { status: 'approved', category: 'Other', className: 'Fake' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }
  const posts = fresh(b, 'classGallery/posts').map(([, p]) => p);
  assert.deepEqual(posts.map(p => [p.studentId, p.classId, p.status, p.category]).sort(),
    [['syn_et_a', 'et', 'pending', 'Halacha'], ['syn_wt_c', 'wt', 'pending', 'Halacha']]);
  assert.deepEqual(posts.map(p => p.studentName).sort(), ['Synthetic Aleph', 'Synthetic Gimel'], 'name comes from the verified profile');
  const existing = JSON.parse(before);
  for (const [k, v] of Object.entries(existing)) assert.deepEqual(b.store.get('classGallery/posts/' + k), v, 'existing post changed: ' + k);
  for (const p of posts) assert.ok(b.files.has(decodeURIComponent(p.image.split('/o/')[1].split('?')[0])));
});

test('Other classes go to their own class gallery', async () => {
  const b = backend();
  const r = await submit(b, 'syn_alpha_d');
  assert.equal(r.status, 201);
  assert.equal(fresh(b, 'classGallery/posts').length, 0);
  const posts = fresh(b, 'b3Games/workspaces/b3-2026/classes/synalpha/resources/gallery/posts');
  assert.equal(posts.length, 1); assert.equal(posts[0][1].status, 'pending');
  assert.ok(b.store.get('b3Games/workspaces/b3-2026/classes/synalpha/resources/gallery/posts/-SynExistingAlpha'));
});

test('A student cannot submit as a classmate or into another class', async () => {
  const b = backend();
  const asClassmate = await submit(b, 'syn_et_a', { studentId: 'syn_et_b', studentName: 'Synthetic Bet' });
  assert.equal(asClassmate.status, 401);
  const wrongPin = await submit(b, 'syn_et_a', { pin: '0000' });
  assert.equal(wrongPin.status, 401);
  assert.equal(fresh(b, 'classGallery/posts').length, 0);
  const otherClass = await submit(b, 'syn_et_a', { classId: 'synalpha' });
  assert.equal(otherClass.status, 201);
  assert.equal(fresh(b, 'b3Games/workspaces/b3-2026/classes/synalpha/resources/gallery/posts').length, 0, 'spoofed class received a post');
  assert.equal(fresh(b, 'classGallery/posts')[0][1].classId, 'et');
});

test('Repeated sends are rate-limited with a message the client explains', async () => {
  const b = backend();
  assert.equal((await submit(b, 'syn_et_a')).status, 201);
  const again = await submit(b, 'syn_et_a');
  assert.equal(again.status, 429);
  assert.equal(fresh(b, 'classGallery/posts').length, 1);
});
