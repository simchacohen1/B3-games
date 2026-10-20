'use strict';
// Real-browser check against the running Pointer lab (see README.md): the teacher shares a screen, then
// switches to ANOTHER TAB (which is exactly what sharing a browser tab makes a teacher do), and a student must
// still receive moving, non-black video. Uses Chromium's built-in fake camera as the "shared screen" so no picker is needed.
// A visible Chromium window opens for about 40 seconds. Run: node scripts/pointer-lab/check-share.cjs
const path = require('node:path');
const PW = process.env.LAB_PLAYWRIGHT || path.join(__dirname, '..', '..', 'node_modules', '@playwright', 'test');
const { chromium } = require(PW);
const BASE = process.env.LAB_URL || 'http://localhost:8787';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: false, ignoreDefaultArgs: ['--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'], args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--window-size=900,700'] });
  const result = { ok: false }; let student, teacher;
  try {
    const tctx = await browser.newContext(), sctx = await browser.newContext();
    teacher = await tctx.newPage();
    await teacher.addInitScript(() => {
      const realRaf = window.requestAnimationFrame.bind(window); let hidden = false;
      window.requestAnimationFrame = cb => hidden ? 0 : realRaf(cb);
      window.__hide = () => { hidden = true; Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); }; navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } }); });
    await teacher.goto(BASE + '/_lab/login');
    await Promise.all([teacher.waitForURL('**/teacher-home.html'), teacher.click('#t')]);
    await teacher.goto(BASE + '/class-pointer-prototype/classroom.html?dashboard=teacher&class=pointer-test');
    await teacher.waitForFunction(() => /room=/.test((document.getElementById('joinLink') || {}).value || ''), null, { timeout: 30000 });

    student = await sctx.newPage(); result.studentLog = []; student.on('console', m => { if (['error','warning'].includes(m.type())) result.studentLog.push(m.text().slice(0, 160)); }); student.on('requestfailed', r => result.studentLog.push('FAILED ' + r.url().slice(0, 100)));
    // sign-in is the same sessionStorage the home page writes after the server accepts the passcode
    const room = new URL(await teacher.inputValue('#joinLink')).searchParams.get('room');
    await student.addInitScript(({ room }) => {
      sessionStorage.setItem('b3Games_studentId', 'studentA'); sessionStorage.setItem('b3Games_studentName', 'Pointer Test Student A');
      sessionStorage.setItem('b3Games_studentClass', 'pointer-test'); sessionStorage.setItem('b3Games_classPin', '1111');
      sessionStorage.setItem('classPointerDashboardJoin', JSON.stringify({ room, name: 'Pointer Test Student A', studentId: 'studentA', classId: 'pointer-test', at: Date.now() }));
    }, { room });
    await student.goto(BASE + '/class-pointer-prototype/classroom.html?dashboard=student&room=' + encodeURIComponent(room));
    await student.waitForFunction(() => /Admitted/.test((document.getElementById('connectionStatus') || {}).textContent || ''), null, { timeout: 40000 });
    result.joined = true;

    await teacher.waitForFunction(() => !document.getElementById('shareScreen').disabled, null, { timeout: 20000 });
    await teacher.evaluate(() => document.getElementById('shareScreen').click());
    await teacher.waitForFunction(() => document.getElementById('placeholder').hidden, null, { timeout: 20000 });
    // the teacher now looks at the shared tab: the Pointer page goes to the background
    // a browser does not run animation frames for a hidden tab/covered window; the teacher page is in exactly that state
    await teacher.evaluate(() => { window.__hide(); });
    result.teacherHidden = await teacher.evaluate(() => document.hidden);
    await sleep(8000);

    const sample = () => student.evaluate(() => {
      const v = document.getElementById('lesson'), c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const x = c.getContext('2d'); try { x.drawImage(v, 0, 0, 64, 36); } catch (e) { return { error: String(e) }; }
      const d = x.getImageData(0, 0, 64, 36).data; let sum = 0, bright = 0;
      for (let i = 0; i < d.length; i += 4) { const l = d[i] + d[i + 1] + d[i + 2]; sum += l; if (l > 120) bright++; }
      return { w: v.videoWidth, h: v.videoHeight, readyState: v.readyState, paused: v.paused, sum, bright, placeholderHidden: document.getElementById('placeholder').hidden };
    });
    const a = await sample(); await sleep(1500); const b = await sample();
    result.studentFirst = a; result.studentSecond = b;
    result.ok = a.w > 0 && a.bright > 30 && (a.sum !== b.sum);
  } catch (e) { result.error = String(e).slice(0, 300); try { result.studentText = (await student.evaluate(() => document.body.innerText)).slice(0, 300); } catch (x) { /* none */ } }
  finally { await browser.close(); }
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
})();
