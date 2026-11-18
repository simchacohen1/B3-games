'use strict';
// Teacher Add-ons step 2: the separate add-ons host and the sandboxed viewer. Static checks; the real-browser isolation check
// runs against the deployed staging host (see docs/teacher-addons-plan.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../teacher-addons-core.js');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const json = f => JSON.parse(read(f));

const headersOf = file => Object.fromEntries(json(file).hosting.headers[0].headers.map(h => [h.key, h.value]));
const directives = csp => Object.fromEntries(csp.split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k, v.join(' ')]; }));

for (const [file, site, ancestors] of [
  ['firebase.apps-staging.json', 'fun-torah-tools-staging-apps', ['https://fun-torah-tools-staging.web.app']],
  ['firebase.apps-live.json', 'b3-games-apps', ['https://sols.tools', 'https://www.sols.tools', 'https://funtorahtools.com', 'https://www.funtorahtools.com']],
]) {
  test(file + ': its own site, only the add-ons folder, and a strict policy', () => {
    const h = json(file).hosting;
    assert.equal(h.site, site);
    assert.equal(h.public, '_apps-host');
    const csp = directives(headersOf(file)['Content-Security-Policy']);
    assert.equal(csp['default-src'], "'none'");
    assert.equal(csp['connect-src'], "'self'", 'an add-on cannot send data to other sites');
    assert.equal(csp['frame-src'], "'none'");
    assert.equal(csp['object-src'], "'none'");
    assert.equal(csp['form-action'], "'self'");
    assert.ok(!/\*/.test(csp['script-src']) && !/https?:/.test(csp['script-src']), 'scripts only from the add-on itself');
    assert.deepEqual(csp['frame-ancestors'].split(' ').sort(), [...ancestors].sort(), 'only our own pages may frame it');
    const hd = headersOf(file);
    assert.equal(hd['X-Content-Type-Options'], 'nosniff');
    assert.equal(hd['Referrer-Policy'], 'no-referrer');
    assert.match(hd['Permissions-Policy'], /camera=\(\), microphone=\(\), geolocation=\(\)/);
    assert.match(hd['Cache-Control'], /no-cache/);
    assert.ok(!('Set-Cookie' in hd), 'the add-ons host sets no cookies');
  });
}

test('the add-ons folder holds only the host page and the self-test add-on, and no site code', () => {
  const files = [];
  (function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(path.relative(path.join(root, '_apps-host'), p).split(path.sep).join('/')); } })(path.join(root, '_apps-host'));
  assert.deepEqual(files.sort(), ['a/ad_selftest01/app.js', 'a/ad_selftest01/index.html', 'index.html']);
  for (const f of files) assert.ok(!/firebase|B3_FIREBASE_CONFIG/i.test(read('_apps-host/' + f)), f + ' must not touch the site\'s Firebase');
});

test('the add-ons folder is never published with the main sites: it starts with an underscore (not served by GitHub Pages) and is left out of the staging package', () => {
  assert.ok(fs.statSync(path.join(root, '_apps-host')).isDirectory());
  assert.match(read('staging/prepare-site.cjs'), /EXCLUDED_DIRS = new Set\(\[[^\]]*'_apps-host'\]\)/);
  assert.match(read('staging/package-site.cjs'), /SKIP_DIRS = new Set\(\[[\s\S]*?'_apps-host'\s*\]\)/);
});

test('staging pages are told to use the staging add-ons host', () => {
  assert.match(read('staging/staging-config.js'), /root\.B3_ADDON_HOST = 'https:\/\/fun-torah-tools-staging-apps\.web\.app';/);
  assert.ok(core.ALLOWED_HOSTS.includes('https://fun-torah-tools-staging-apps.web.app') && core.ALLOWED_HOSTS.includes('https://apps.sols.tools'));
});

test('the viewer builds the frame address only from the allowed host and a well-formed add-on id', () => {
  assert.equal(core.viewerFrameUrl('https://apps.sols.tools', 'ad_selftest01'), 'https://apps.sols.tools/a/ad_selftest01/');
  assert.equal(core.viewerFrameUrl('https://evil.example', 'ad_selftest01'), '', 'a host that is not on the list');
  assert.equal(core.viewerFrameUrl('https://apps.sols.tools.evil.example', 'ad_selftest01'), '');
  assert.equal(core.viewerFrameUrl('https://apps.sols.tools', '../../x'), '');
  assert.equal(core.viewerFrameUrl('https://apps.sols.tools', 'ad_selftest01/../..'), '');
  assert.equal(core.viewerFrameUrl('', 'ad_selftest01'), '');
});

test('the sandbox gives the add-on no origin, no top navigation and no pop-ups', () => {
  const tokens = core.SANDBOX.split(' ');
  assert.deepEqual(tokens.sort(), ['allow-forms', 'allow-modals', 'allow-scripts']);
  for (const bad of ['allow-same-origin', 'allow-top-navigation', 'allow-top-navigation-by-user-activation', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-downloads', 'allow-storage-access-by-user-activation'])
    assert.ok(!tokens.includes(bad), bad);
});

test('the viewer page: our top bar with Back, the sandbox is set before the address, nothing from the link becomes HTML or an address', () => {
  const js = read('addon-view.js'), html = read('addon-view.html');
  assert.match(html, /id="back"[^>]*>← Back/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.ok(js.indexOf("setAttribute('sandbox', core.SANDBOX)") > 0 && js.indexOf("setAttribute('sandbox'") < js.indexOf('frame.src = url'));
  assert.match(js, /core\.viewerFrameUrl\(host, params\.get\('addon'\) \|\| ''\)/);
  assert.doesNotMatch(js, /innerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(js, /location\.href\s*=\s*params|location\.replace\(params/);
  assert.match(js, /textContent = name/);
  assert.match(js, /referrerpolicy', 'no-referrer'/);
});

test('the self-test add-on tries the forbidden things and expects every one to be blocked', () => {
  const app = read('_apps-host/a/ad_selftest01/app.js');
  for (const probe of ['parent.document', 'localStorage', 'document.cookie', "fetch('https://example.com/'", 'top.location.href', 'window.open', "window.origin === 'null'", 'https://example.com/x.js'])
    assert.ok(app.includes(probe), probe);
});
