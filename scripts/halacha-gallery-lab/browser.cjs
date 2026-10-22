'use strict';
// Shared Playwright plumbing: serves a local checkout as https://funtorahtools.com,
// routes Firebase SDK/REST/Functions to the synthetic backend, blocks all else.
const fs = require('node:fs');
const path = require('node:path');

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const ORIGIN = 'https://funtorahtools.com';

async function openStudentPage({ chromium, executablePath, repoRoot, backend, student, studentId, token, pagePath = '/halacha/index.html', localState = null, log = () => {} }) {
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu', '--single-process', '--no-zygote'] });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const mock = fs.readFileSync(path.join(__dirname, 'mock-firebase-compat.js'), 'utf8');
  const html2canvas = fs.readFileSync(path.join(repoRoot, 'halacha/html2canvas.min.js'), 'utf8');
  const calls = { submit: [], auth: [], read: [], rest: [], blocked: [] };
  await context.exposeFunction('__labDb', async json => {
    const { op, path: p, value, token: t } = JSON.parse(json);
    const r = backend.client(op, p, value, t);
    if (op !== 'read') calls.read.push({ op, path: p, ok: r.ok });
    return JSON.stringify(r);
  });
  const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' };
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    try {
      if (url.origin === ORIGIN || url.origin === 'https://www.funtorahtools.com') {
        let file = path.join(repoRoot, decodeURIComponent(url.pathname));
        if (file.endsWith('/')) file += 'index.html';
        if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
        return route.fulfill({ status: 200, contentType: MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', body: fs.readFileSync(file) });
      }
      if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: /app-compat|firebase-compat\.js/.test(url.pathname) ? mock : '/* lab: provided by mock app */' });
      }
      if (/html2canvas/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: html2canvas });
      if (url.hostname === 'b3-games-default-rtdb.firebaseio.com') {
        const p = url.pathname.replace(/\.json$/, '');
        const r = backend.client('read', p, undefined, url.searchParams.get('auth'));
        calls.rest.push({ path: p, ok: r.ok });
        return route.fulfill({ status: r.ok ? 200 : 401, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r.ok ? r.value : { error: 'Permission denied' }) });
      }
      if (url.hostname === 'us-central1-b3-games.cloudfunctions.net') {
        const name = url.pathname.slice(1);
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
        const handler = backend.handlers[name];
        if (!handler) { calls.blocked.push(req.url()); return route.fulfill({ status: 404, headers: cors, body: '{"error":"not in lab"}' }); }
        let body = {};
        try { body = JSON.parse(req.postData() || '{}'); } catch (_) {}
        const out = await backend.invoke(handler, { method: req.method(), body, headers: req.headers(), query: Object.fromEntries(url.searchParams) });
        if (name === 'classGallerySubmit' && req.method() === 'POST') calls.submit.push({ request: { ...body, image: body.image ? '[' + String(body.image).length + ' chars]' : body.image, pin: body.pin ? '[redacted]' : body.pin }, status: out.status, response: out.body });
        if (name === 'funTorahStudentAuth') calls.auth.push({ action: body.action, status: out.status });
        return route.fulfill({ status: out.status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(out.body) });
      }
      calls.blocked.push(req.url());
      return route.abort();
    } catch (e) { log('route error ' + req.url() + ' ' + e.stack); return route.abort(); }
  });
  await context.addInitScript(({ student, studentId, token, localState }) => {
    try {
      if (sessionStorage.getItem('__labSeeded')) return;
      sessionStorage.setItem('__labSeeded', '1');
      // Same work on this device, so the lab also works when rules deny the account copy.
      if (localState) localStorage.setItem('halachaV14:' + studentId, JSON.stringify(localState));
      sessionStorage.setItem('b3Games_studentId', studentId);
      sessionStorage.setItem('b3Games_studentName', student.name);
      sessionStorage.setItem('b3Games_studentClass', student.classId);
      sessionStorage.setItem('b3Games_classPin', student.pin);
      sessionStorage.setItem('b3Games_workspaceId', 'b3-2026');
      if (token) sessionStorage.setItem('__labAuth:[DEFAULT]', token);
    } catch (_) {}
  }, { student, studentId, token, localState });
  const page = await context.newPage();
  const consoleLines = [];
  page.on('console', m => consoleLines.push(m.type() + ': ' + m.text()));
  page.on('pageerror', e => consoleLines.push('pageerror: ' + e.message));
  page.on('dialog', d => { consoleLines.push('alert: ' + d.message()); d.dismiss().catch(() => {}); });
  await page.goto(ORIGIN + pagePath, { waitUntil: 'load', timeout: 60000 });
  return { browser, context, page, calls, consoleLines };
}

module.exports = { openStudentPage, ORIGIN };
