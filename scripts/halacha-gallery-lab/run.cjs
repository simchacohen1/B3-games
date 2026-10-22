'use strict';
// Halacha -> Class Gallery end-to-end lab (synthetic students only).
// Usage: node scripts/halacha-gallery-lab/run.cjs [--repo <checkout>] [--rules <rules.json>] [--out <dir>]
// Needs: playwright-core, targaryen, a Chromium binary (CHROMIUM_PATH or @sparticuz/chromium).
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBackend, makeToken } = require('./fake-backend.cjs');
const { seed, students } = require('./seed.cjs');
const { openStudentPage } = require('./browser.cjs');

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const repoRoot = path.resolve(arg('repo', path.join(__dirname, '../..')));
const rulesFile = arg('rules', path.join(repoRoot, 'firebase-rules.hardened.json'));
const outDir = path.resolve(arg('out', path.join(require('node:os').tmpdir(), 'halacha-gallery-lab')));
const only = arg('only', '');
fs.mkdirSync(outDir, { recursive: true });
const req = name => { try { return require(name); } catch (_) { return require(require.resolve(name, { paths: [process.cwd(), repoRoot, ...(process.env.NODE_PATH || '').split(':').filter(Boolean)] })); } };
const { chromium } = req('playwright-core');
const targaryen = req('targaryen');

const svgData = svg => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
const DRAW1 = svgData('<svg xmlns="http://www.w3.org/2000/svg" width="690" height="800"><path d="M60 700 C 200 560, 400 760, 620 620" stroke="#8e24aa" stroke-width="14" fill="none" stroke-linecap="round"/></svg>');
const DRAW2 = svgData('<svg xmlns="http://www.w3.org/2000/svg" width="690" height="800"><circle cx="520" cy="620" r="90" stroke="#43a047" stroke-width="12" fill="none"/></svg>');
const PHOTO = svgData('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#ffb74d"/><circle cx="150" cy="150" r="70" fill="#e53935"/><rect y="150" width="300" height="50" fill="#1e88e5"/></svg>');
function scrapbookState(id, words) {
  return {
    [id + '_scrap_pages']: [
      `<div class="scrap textbox" style="left:40px;top:70px;width:300px;height:110px"><div class="tb-move">✥ drag</div><div class="tb-text" contenteditable="true">${words[0]}</div></div>` +
      `<div class="scrap" style="left:60px;top:260px;width:240px"><img src="${PHOTO}"></div>` +
      `<div class="scrap sticker" style="left:380px;top:300px;width:150px"><img src="art/stickers/book.jpg"></div>`,
      `<div class="scrap textbox" style="left:50px;top:90px;width:320px;height:120px"><div class="tb-text" contenteditable="true">${words[1]}</div></div>` +
      `<div class="scrap sticker" style="left:300px;top:320px;width:160px"><img src="art/stickers/heart.jpg"></div>`
    ],
    [id + '_draw']: [DRAW1, DRAW2]
  };
}

async function main() {
  const executablePath = process.env.CHROMIUM_PATH || await req('@sparticuz/chromium').executablePath();
  const results = [];
  const record = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : '')); };
  async function scenario(name, fn) {
    if (only && !name.includes(only)) return;
    try { const d = await fn(); record(name, true, d || ''); } catch (e) { record(name, false, e.message.split('\n')[0]); if (process.env.LAB_DEBUG) console.error(e); }
  }

  const localStates = {};
  function freshBackend(extraState = {}) {
    for (const k of Object.keys(localStates)) delete localStates[k];
    Object.assign(localStates, extraState);
    const data = seed();
    for (const [sid, state] of Object.entries(extraState)) data.b3Games.students[sid].halacha = { siman1: { version: 1, updatedAt: 1, state } };
    return createBackend({ seed: data, repoRoot, rulesFile, targaryen });
  }
  async function login(backend, sid) {
    const s = students[sid];
    const r = await backend.invoke(backend.handlers.funTorahStudentAuth, { body: { action: 'login', name: s.name, pin: s.pin, classId: s.classId } });
    assert.equal(r.status, 200, 'synthetic login failed: ' + JSON.stringify(r.body));
    return r.body.customToken;
  }
  async function open(backend, sid, overrides = {}, pagePath) {
    const s = { ...students[sid], ...overrides.student };
    const token = await login(backend, sid);
    const ctx = await openStudentPage({ chromium, executablePath, repoRoot, backend, student: s, studentId: overrides.studentId || sid, token, pagePath, localState: localStates[sid] || null });
    await ctx.page.waitForFunction(() => typeof halachaCloudLoading !== 'undefined' && !halachaCloudLoading, null, { timeout: 30000 });
    await ctx.page.waitForTimeout(1200);
    return ctx;
  }
  async function openLesson(page, siman, id) {
    // Siman unlocking is a separate teacher setting; open every Siman for these tests.
    await page.evaluate(([siman, id]) => { HALACHA_MAX_SIMAN = 'ו'; refreshHubLocks(); openSiman(siman); show(id); }, [siman, id]);
    const on = await page.evaluate(() => document.querySelector('#sections > .section.on')?.id);
    assert.equal(on, id, 'lesson did not open');
    await page.waitForTimeout(1200);
  }
  async function sendFromLesson(page, id, { title, beforeSend } = {}) {
    const btn = page.locator(`#${id} .halacha-gallery-button:visible`).first();
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.click();
    await page.waitForFunction(() => { const d = document.getElementById('halachaGalleryDialog'); return d && d.open && !d.querySelector('[data-close]').disabled; }, null, { timeout: 60000 });
    const prepared = await page.evaluate(() => { const d = document.getElementById('halachaGalleryDialog'); return { status: d.querySelector('[role=status]').textContent, src: d.querySelector('img').getAttribute('src') || '', sendDisabled: d.querySelector('[data-send]').disabled }; });
    if (prepared.sendDisabled) return { prepared, final: prepared.status };
    if (beforeSend) prepared.extra = await beforeSend(page);
    if (title) await page.fill('#halachaGalleryTitle', title);
    await page.click('#halachaGalleryDialog [data-send]');
    await page.waitForFunction(() => { const d = document.getElementById('halachaGalleryDialog'); return !d.querySelector('[data-close]').disabled && !/Sending/.test(d.querySelector('[role=status]').textContent); }, null, { timeout: 60000 });
    const final = await page.evaluate(() => document.querySelector('#halachaGalleryDialog [role=status]').textContent);
    return { prepared, final };
  }
  // Count pixels close to given colors in the dialog preview (proves drawings/coloring are included).
  async function previewColors(page, colors) {
    return page.evaluate(async colors => {
      const img = document.querySelector('#halachaGalleryDialog img');
      await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
      const out = {};
      for (const [name, hex] of Object.entries(colors)) {
        const [r, g, b] = [1, 3, 5].map(n => parseInt(hex.slice(n, n + 2), 16)); let n = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 40 && Math.abs(d[i + 1] - g) < 40 && Math.abs(d[i + 2] - b) < 40) n++;
        out[name] = n;
      }
      return out;
    }, colors);
  }
  const existing = backend => ({
    et: backend.store.get('classGallery/posts/-SynExistingApproved'),
    wt: backend.store.get('classGallery/posts/-SynExistingPending'),
    alpha: backend.store.get('b3Games/workspaces/b3-2026/classes/synalpha/resources/gallery/posts/-SynExistingAlpha')
  });
  const newPosts = (backend, p) => Object.entries(backend.store.get(p) || {}).filter(([k]) => !k.startsWith('-SynExisting'));
  function saveImage(backend, post, name) {
    const fp = decodeURIComponent(post.image.split('/o/')[1].split('?')[0]);
    const file = backend.files.get(fp);
    assert.ok(file, 'image was not stored: ' + fp);
    assert.equal(file.bytes.subarray(0, 3).toString('hex'), 'ffd8ff', 'stored image is not a JPEG');
    fs.writeFileSync(path.join(outDir, name + '.jpg'), file.bytes);
    return { fp, bytes: file.bytes.length };
  }
  function jpegSize(buf) { // read SOF0/SOF2 dimensions
    for (let i = 2; i < buf.length;) { if (buf[i] !== 0xff) return null; const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m === 0xc0 || m === 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + len; }
    return null;
  }

  if (process.argv.includes('--baseline')) {
    // Reproduce the original behaviour on an unfixed checkout.
    await scenario('BASELINE (unfixed): Halacha button visibility and submitted picture', async () => {
      const state = { halacha_picture_siman_a_v2_b: [{ t: 'brush', c: '#248df0', pts: [[120, 120], [400, 300], [800, 160]] }], ...scrapbookState('b', ['I say Modeh Ani every morning', 'Thank You Hashem!']) };
      const backend = freshBackend({ syn_et_a: state });
      const drawBefore = JSON.stringify(backend.store.get('b3Games/students/syn_et_a/halacha/siman1/state/b_draw'));
      const { browser, page, calls } = await open(backend, 'syn_et_a');
      try {
        await openLesson(page, 'א', 'b');
        const visible = await page.locator('#b .halacha-gallery-button:visible').count();
        await page.evaluate(() => document.querySelector('#b .halacha-gallery-button').click());
        await page.waitForFunction(() => !document.querySelector('#halachaGalleryDialog [data-close]').disabled, null, { timeout: 60000 });
        await page.evaluate(() => document.querySelector('#halachaGalleryDialog [data-send]').click());
        await page.waitForTimeout(2500);
        const status = await page.evaluate(() => document.querySelector('#halachaGalleryDialog [role=status]').textContent);
        const posts = newPosts(backend, 'classGallery/posts');
        await page.waitForTimeout(1500);
        const drawAfter = JSON.stringify(backend.store.get('b3Games/students/syn_et_a/halacha/siman1/state/b_draw'));
        return JSON.stringify({ visibleButtons: visible, status, posts: posts.map(([k, p]) => ({ image: String(p.image).slice(0, 30), imageLength: String(p.image).length, studentName: p.studentName, status: p.status })),
          directClientWrites: calls.read.filter(c => /allery/.test(c.path)).length, savedDrawingsChanged: drawBefore !== drawAfter });
      } finally { await browser.close(); }
    });
  }

  // 1. ET student, Siman Alef lesson (coloring classroom) + legacy scrapbook pages.
  await scenario('ET student: Siman Alef lesson sends picture + both scrapbook pages as a pending ET post', async () => {
    const state = { halacha_picture_siman_a_v2_b: [{ t: 'brush', c: '#248df0', pts: [[120, 120], [400, 300], [800, 160]] }, { t: 'fill', x: 500, y: 60, c: '#fddd27' }], ...scrapbookState('b', ['I say Modeh Ani every morning', 'Thank You Hashem!']) };
    const backend = freshBackend({ syn_et_a: state });
    const before = existing(backend), savedBefore = JSON.stringify(backend.store.get('b3Games/students/syn_et_a/halacha'));
    const { browser, page, calls, consoleLines } = await open(backend, 'syn_et_a');
    try {
      await openLesson(page, 'א', 'b');
      await page.screenshot({ path: path.join(outDir, 'et-lesson-with-button.png') });
      const { prepared, final } = await sendFromLesson(page, 'b', { beforeSend: p => previewColors(p, { brushBlue: '#248df0', fillYellow: '#fddd27', drawPurple: '#8e24aa', drawGreen: '#43a047', photoRed: '#e53935' }) });
      await page.screenshot({ path: path.join(outDir, 'et-dialog-sent.png') });
      for (const [k, n] of Object.entries(prepared.extra)) assert.ok(n > 300, `${k} missing from the picture (${n} px)`);
      assert.ok(prepared.src.startsWith('data:image/jpeg;base64,') && prepared.src.length > 20000, 'preview is blank: ' + prepared.src.slice(0, 40) + ' / ' + prepared.status);
      assert.match(final, /Sent!/, 'final status: ' + final);
      const posts = newPosts(backend, 'classGallery/posts');
      assert.equal(posts.length, 1, 'expected exactly one new ET/WT post');
      const [, post] = posts[0];
      assert.equal(post.studentId, 'syn_et_a'); assert.equal(post.classId, 'et'); assert.equal(post.status, 'pending');
      assert.equal(post.studentName, 'Synthetic Aleph'); assert.equal(post.category, 'Halacha'); assert.equal(post.workspaceId, 'b3-2026');
      assert.equal(newPosts(backend, 'b3Games/workspaces/b3-2026/classes/et/resources/gallery/posts').length, 0);
      const img = saveImage(backend, post, 'et-siman-alef-submission');
      const dim = jpegSize(fs.readFileSync(path.join(outDir, 'et-siman-alef-submission.jpg')));
      assert.ok(dim && dim.w >= 900 && dim.h > dim.w, 'unexpected picture size ' + JSON.stringify(dim));
      assert.ok(img.fp.startsWith('classGallery/verified/et/'), img.fp);
      assert.deepEqual(existing(backend), before, 'existing posts changed');
      assert.equal(JSON.stringify(backend.store.get('b3Games/students/syn_et_a/halacha')), savedBefore, 'saved Halacha work was modified');
      assert.equal(calls.read.filter(c => /allery/.test(c.path)).length, 0, 'client wrote to a gallery path directly');
      assert.equal(calls.submit.length, 1);
      const denied = calls.read.filter(c => !c.ok).concat(calls.rest.filter(c => !c.ok));
      assert.equal(denied.length, 0, 'authorized student was denied: ' + JSON.stringify(denied));
      return `${img.bytes} byte JPEG ${dim.w}x${dim.h}; colors ${JSON.stringify(prepared.extra)}`;
    } finally { if (process.env.LAB_DEBUG) console.log(consoleLines.join('\n')); await browser.close(); }
  });

  // 2. WT student, Siman Beis picture study.
  await scenario('WT student: Siman Beis lesson goes to the WT gallery as pending', async () => {
    const state = { halacha_sefer_color_s2b: [{ tool: 'fill', part: 'cup', color: '#1e88e5' }, { tool: 'fill', part: 'water', color: '#43a047' }, { tool: 'brush', color: '#e53935', size: 8, points: [[60, 60], [200, 120], [300, 60]] }] };
    const backend = freshBackend({ syn_wt_c: state });
    const before = existing(backend);
    const { browser, page } = await open(backend, 'syn_wt_c');
    try {
      await openLesson(page, 'ב', 's2b');
      const { prepared, final } = await sendFromLesson(page, 's2b', { beforeSend: p => previewColors(p, { cupBlue: '#1e88e5', waterGreen: '#43a047', inkRed: '#e53935' }) });
      assert.ok(prepared.src.length > 10000, 'blank preview');
      for (const [k, n] of Object.entries(prepared.extra)) assert.ok(n > 200, `${k} missing from the picture (${n} px)`);
      assert.match(final, /Sent!/, final);
      const posts = newPosts(backend, 'classGallery/posts');
      assert.equal(posts.length, 1);
      const [, post] = posts[0];
      assert.equal(post.classId, 'wt'); assert.equal(post.studentId, 'syn_wt_c'); assert.equal(post.status, 'pending');
      saveImage(backend, post, 'wt-siman-beis-submission');
      assert.deepEqual(existing(backend), before);
      return 'post in classGallery/posts with classId wt';
    } finally { await browser.close(); }
  });

  // 3. Non-ET/WT class goes to its own class gallery.
  await scenario('Custom-class student: post goes to that class gallery, pending', async () => {
    const backend = freshBackend({ syn_alpha_d: { halacha_picture_siman_a_v2_a: [{ t: 'brush', c: '#e53838', pts: [[100, 100], [600, 500]] }] } });
    const before = existing(backend);
    const { browser, page } = await open(backend, 'syn_alpha_d');
    try {
      await openLesson(page, 'א', 'a');
      const { final } = await sendFromLesson(page, 'a');
      assert.match(final, /Sent!/, final);
      assert.equal(newPosts(backend, 'classGallery/posts').length, 0, 'leaked into ET/WT gallery');
      const posts = newPosts(backend, 'b3Games/workspaces/b3-2026/classes/synalpha/resources/gallery/posts');
      assert.equal(posts.length, 1);
      assert.equal(posts[0][1].status, 'pending'); assert.equal(posts[0][1].classId, 'synalpha');
      assert.deepEqual(existing(backend), before);
      return 'post in classes/synalpha/resources/gallery/posts';
    } finally { await browser.close(); }
  });

  // 4. Impersonation: tamper session to a classmate's identity.
  await scenario('Impersonation blocked: classmate id/name with own PIN is refused, no post', async () => {
    const backend = freshBackend({ syn_et_a: { halacha_picture_siman_a_v2_a: [{ t: 'brush', c: '#e53838', pts: [[100, 100], [600, 500]] }] } });
    const { browser, page } = await open(backend, 'syn_et_a');
    try {
      await openLesson(page, 'א', 'a');
      await page.evaluate(() => { sessionStorage.setItem('b3Games_studentId', 'syn_et_b'); sessionStorage.setItem('b3Games_studentName', 'Synthetic Bet'); });
      const { final } = await sendFromLesson(page, 'a');
      assert.match(final, /sign in/i, 'expected a sign-in message, got: ' + final);
      assert.equal(newPosts(backend, 'classGallery/posts').length, 0, 'a post was created');
      return final;
    } finally { await browser.close(); }
  });

  await scenario('Impersonation blocked: classmate identity with a guessed PIN is refused by the server', async () => {
    const backend = freshBackend({ syn_et_a: { halacha_picture_siman_a_v2_a: [{ t: 'brush', c: '#e53838', pts: [[100, 100], [600, 500]] }] } });
    const { browser, page } = await open(backend, 'syn_et_a');
    try {
      await openLesson(page, 'א', 'a');
      // Change only the name/pin the request carries; the page identity stays the same.
      await page.evaluate(() => { sessionStorage.setItem('b3Games_studentName', 'Synthetic Bet'); sessionStorage.setItem('b3Games_classPin', '0000'); });
      const { final } = await sendFromLesson(page, 'a');
      assert.match(final, /could not be checked|sign in/i, final);
      assert.equal(newPosts(backend, 'classGallery/posts').length, 0);
      return final;
    } finally { await browser.close(); }
  });

  await scenario('Class spoofing blocked: ET student claiming WT still posts only to ET', async () => {
    const backend = freshBackend({ syn_et_a: { halacha_picture_siman_a_v2_a: [{ t: 'brush', c: '#e53838', pts: [[100, 100], [600, 500]] }] } });
    const { browser, page } = await open(backend, 'syn_et_a');
    try {
      await openLesson(page, 'א', 'a');
      await page.evaluate(() => sessionStorage.setItem('b3Games_studentClass', 'wt'));
      const { final } = await sendFromLesson(page, 'a');
      const posts = newPosts(backend, 'classGallery/posts');
      assert.ok(posts.every(([, p]) => p.classId === 'et'), 'post landed outside the student\'s verified class');
      return final + ' / posts: ' + posts.map(([, p]) => p.classId).join(',');
    } finally { await browser.close(); }
  });

  // 5. Rate limit and network errors are explained.
  await scenario('Clear message when sending twice too quickly (429)', async () => {
    const backend = freshBackend({ syn_et_a: { halacha_picture_siman_a_v2_a: [{ t: 'brush', c: '#e53838', pts: [[100, 100], [600, 500]] }] } });
    const { browser, page } = await open(backend, 'syn_et_a');
    try {
      await openLesson(page, 'א', 'a');
      const first = await sendFromLesson(page, 'a');
      assert.match(first.final, /Sent!/);
      await page.click('#halachaGalleryDialog [data-close]');
      const second = await sendFromLesson(page, 'a');
      assert.match(second.final, /wait a minute/i, second.final);
      assert.equal(newPosts(backend, 'classGallery/posts').length, 1);
      return second.final;
    } finally { await browser.close(); }
  });

  await scenario('Clear message when the Gallery cannot be reached (offline)', async () => {
    const backend = freshBackend({ syn_et_a: { halacha_picture_siman_a_v2_a: [{ t: 'brush', c: '#e53838', pts: [[100, 100], [600, 500]] }] } });
    const { browser, context, page } = await open(backend, 'syn_et_a');
    try {
      await openLesson(page, 'א', 'a');
      await context.route('**/classGallerySubmit', r => r.abort());
      const { final } = await sendFromLesson(page, 'a');
      assert.match(final, /Could not reach the Class Gallery/i, final);
      return final;
    } finally { await browser.close(); }
  });

  // 6. Site-wide floating button now sends the same full lesson picture.
  await scenario('Site-wide "Add to Gallery" button on Halacha sends the full lesson picture', async () => {
    const backend = freshBackend({ syn_et_a: { halacha_picture_siman_a_v2_c: [{ t: 'brush', c: '#248df0', pts: [[100, 100], [600, 500]] }], ...scrapbookState('c', ['Brave like a lion', 'Fast like a deer']) } });
    const { browser, page } = await open(backend, 'syn_et_a');
    try {
      await openLesson(page, 'א', 'c');
      // The back-to-home pill overlaps this floating button (pre-existing layout); click it directly.
      await page.$eval('#fttGalleryShareButton', b => b.click());
      await page.waitForSelector('#fttGalleryShareDialog[open]', { timeout: 60000 });
      await page.click('#fttGalleryShareDialog [data-send]');
      await page.waitForFunction(() => /Sent!|Could not|Please/.test(document.querySelector('#fttGalleryShareDialog [role=status]').textContent), null, { timeout: 60000 });
      const final = await page.evaluate(() => document.querySelector('#fttGalleryShareDialog [role=status]').textContent);
      assert.match(final, /Sent!/, final);
      const posts = newPosts(backend, 'classGallery/posts');
      assert.equal(posts.length, 1); assert.equal(posts[0][1].category, 'Halacha'); assert.equal(posts[0][1].status, 'pending');
      const img = saveImage(backend, posts[0][1], 'et-sitewide-button-submission');
      const dim = jpegSize(fs.readFileSync(path.join(outDir, 'et-sitewide-button-submission.jpg')));
      assert.ok(dim.h > dim.w, 'expected the stacked lesson picture, got a window screenshot ' + JSON.stringify(dim));
      return `${img.bytes} bytes ${dim.w}x${dim.h}`;
    } finally { await browser.close(); }
  });

  // 7. Approval flow via the real classGalleryRead function.
  await scenario('Pending until approved: teacher sees it; classmates do not until approval', async () => {
    const backend = freshBackend({ syn_et_a: { halacha_picture_siman_a_v2_a: [{ t: 'brush', c: '#e53838', pts: [[100, 100], [600, 500]] }] } });
    const { browser, page } = await open(backend, 'syn_et_a');
    let postId;
    try {
      await openLesson(page, 'א', 'a');
      const { final } = await sendFromLesson(page, 'a');
      assert.match(final, /Sent!/);
      postId = newPosts(backend, 'classGallery/posts')[0][0];
    } finally { await browser.close(); }
    const read = async token => (await backend.invoke(backend.handlers.classGalleryRead, { method: 'GET', headers: { authorization: 'Bearer ' + token }, query: { classId: 'et' } })).body.posts || {};
    const teacher = makeToken({ uid: 'syn_teacher_et', provider: 'google.com', email: 'teacher-et@example.test', email_verified: true });
    const classmate = makeToken({ uid: 'student_b', b3StudentId: 'syn_et_b', b3ClassId: 'et', b3StudentRole: 'student' });
    const wtTeacher = makeToken({ uid: 'syn_teacher_wt', provider: 'google.com' });
    assert.ok((await read(teacher))[postId], 'ET teacher cannot see the pending post');
    assert.ok(!(await read(classmate))[postId], 'classmate can see a pending post');
    const wt = await backend.invoke(backend.handlers.classGalleryRead, { method: 'GET', headers: { authorization: 'Bearer ' + wtTeacher }, query: { classId: 'et' } });
    assert.equal(wt.status, 403, 'WT teacher could read ET gallery');
    // Approve as the ET teacher, exactly as the Gallery review button does (client write, rules applied).
    const approve = backend.client('update', 'classGallery/posts/' + postId, { status: 'approved' }, teacher);
    assert.ok(approve.ok, 'teacher approval was denied by rules');
    assert.ok((await read(classmate))[postId], 'approved post not visible to classmate');
    return 'teacher sees pending; classmate sees only after approval; WT teacher 403';
  });

  // 8. Teacher preview shows no student send button.
  await scenario('Teacher preview has no send button', async () => {
    const backend = freshBackend();
    const { browser, page } = await open(backend, 'syn_et_a', {}, '/halacha/index.html?teacherView=syn_et_a');
    try {
      await page.evaluate(() => { openSiman('א'); show('a'); });
      await page.waitForTimeout(800);
      const count = await page.locator('.halacha-gallery-button').count();
      assert.equal(count, 0);
      return 'no buttons';
    } finally { await browser.close(); }
  });

  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ repoRoot, rulesFile: path.basename(rulesFile), at: new Date().toISOString(), results }, null, 2));
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
  process.exitCode = failed ? 1 : 0;
}
main().catch(e => { console.error(e); process.exit(1); });
