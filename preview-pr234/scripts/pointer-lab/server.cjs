'use strict';
// POINTER LAB: an isolated copy of Fun Torah Tools on this computer.
//  - serves this checkout's website on http://localhost:<PORT>
//  - redirects every Firebase call to the local emulators (Auth 9099, Realtime Database 9000)
//  - runs the real backend handlers (student sign-in, Class Pointer share/join) against the emulators
// Nothing here talks to the real Firebase project and no real student data is involved.
// Needs: firebase emulators running (see README.md) and a folder with firebase-admin, firebase-functions, express.
const fs = require('node:fs');
const path = require('node:path');
const REPO = path.resolve(process.env.LAB_REPO || path.join(__dirname, '..', '..'));
const DEPS = process.env.LAB_DEPS; // folder containing node_modules with firebase-admin, firebase-functions, express
if (!DEPS) { console.error('Set LAB_DEPS to a folder that has node_modules with firebase-admin, firebase-functions and express.'); process.exit(1); }
process.env.NODE_PATH = path.join(DEPS, 'node_modules');
require('node:module').Module._initPaths();
const PROJECT = 'demo-pointer-lab', DB_NS = PROJECT + '-default-rtdb', PORT = Number(process.env.LAB_PORT || 8787);
process.env.GCLOUD_PROJECT = PROJECT;
process.env.FIREBASE_DATABASE_EMULATOR_HOST = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const express = require('express');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: PROJECT, databaseURL: 'https://' + DB_NS + '.firebaseio.com' });

const FUNCTIONS = {
  funTorahStudentAuth: () => require(path.join(REPO, 'backend/functions/student-auth.js')).funTorahStudentAuth,
  classPointerShareAuth: () => require(path.join(REPO, 'backend/functions/class-pointer-share-auth.js')).classPointerShareAuth,
};
const app = express();
app.disable('x-powered-by');
// Realtime Database REST (game gate and other pages read it with plain fetch): forwarded to the emulator, same origin as the page
app.all('/_rtdb/*', express.text({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query); qs.set('ns', DB_NS);
    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && typeof req.body === 'string' && req.body.length;
    const r = await fetch('http://127.0.0.1:9000/' + req.params[0] + '?' + qs.toString(), { method: req.method, headers: { 'Content-Type': req.get('content-type') || 'application/json' }, body: hasBody ? req.body : undefined });
    res.status(r.status).set('Content-Type', r.headers.get('content-type') || 'application/json').set('Cache-Control', 'no-store').send(await r.text());
  } catch (e) { res.status(502).json({ error: 'Lab database is not reachable: ' + e.message }); }
});
app.use('/_fn/:name', express.json({ limit: '1mb' }), (req, res) => {
  const make = FUNCTIONS[req.params.name];
  if (!make) return res.status(501).json({ error: 'This function is not part of the lab.' });
  try { make()(req, res); } catch (e) { console.error(e); res.status(500).json({ error: 'Lab function failed: ' + e.message }); }
});

// shim appended to the Firebase SDK files: every app/auth/database call uses the emulators
const SHIM = `
;(function(){
  var f=window.firebase; if(!f) return; f.__labWrapped=f.__labWrapped||{};
  function wrap(name,after){
    var orig=f[name]; if(typeof orig!=='function'||f.__labWrapped[name]) return; f.__labWrapped[name]=true;
    var w=function(){ var inst=orig.apply(this,arguments); try{ if(!inst.__lab){ inst.__lab=true; after(inst);} }catch(e){} return inst; };
    var d=Object.getOwnPropertyDescriptors(orig); delete d.length; delete d.name; delete d.prototype;
    Object.defineProperties(w,d); f[name]=w;
  }
  if(f.auth) wrap('auth',function(a){ a.useEmulator('http://127.0.0.1:9099',{disableWarnings:true}); });
  if(f.database) wrap('database',function(db){ db.useEmulator('127.0.0.1',9000); });
})();
`;



// the shared game gate adds missing Firebase pieces at run time from gstatic; fetch them here so they also talk to the emulators
const gcache = {};
app.get('/_gstatic/*', async (req, res) => {
  const rest = req.path.slice('/_gstatic/'.length);
  if (!/^[0-9.]+\/firebase-[a-z-]+\.js$/.test(rest)) return res.status(400).send('bad path');
  try {
    if (!gcache[rest]) { const r = await fetch('https://www.gstatic.com/firebasejs/' + rest); if (!r.ok) throw new Error('HTTP ' + r.status); gcache[rest] = (await r.text()) + SHIM; }
    res.type('text/javascript').send(gcache[rest]);
  } catch (e) { res.status(502).send('// lab could not fetch ' + rest + ': ' + e.message); }
});

// One-click lab sign-in for the teacher (and an owner/admin test account) so no Google pop-up is needed.
app.get('/_lab/login', (req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pointer Lab sign-in</title>
<body style="font:16px system-ui;max-width:560px;margin:40px auto;padding:0 16px">
<h1>Pointer Lab</h1><p>An isolated test copy on this computer. Nothing here is the real Fun Torah Tools data.</p>
<p><button id="t" style="font:inherit;padding:12px 18px">Sign in as the lab teacher (teacher@pointer.lab)</button></p>
<p><button id="o" style="font:inherit;padding:12px 18px">Sign in as the lab owner/admin (simcha5770@gmail.com, lab only)</button></p>
<p id="m"></p>
<script src="/vendor/firebase/12.15.0/firebase-app-compat.js"></script><script src="/vendor/firebase/12.15.0/firebase-auth-compat.js"></script><script src="/vendor/firebase/12.15.0/firebase-database-compat.js"></script><script src="/firebase-config.js"></script>
<script>
firebase.initializeApp(window.B3_FIREBASE_CONFIG);
async function go(email){
  document.getElementById('m').textContent='Signing in…';
  const idp=JSON.stringify({sub:'lab-'+email,email:email,email_verified:true,provider_id:'google.com'});
  await firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(idp));
  location.href='/teacher-home.html';
}
document.getElementById('t').onclick=()=>go('teacher@pointer.lab').catch(e=>document.getElementById('m').textContent=e.message);
document.getElementById('o').onclick=()=>go('simcha5770@gmail.com').catch(e=>document.getElementById('m').textContent=e.message);
</script></body>`);
});

// One-click lab sign-in for a made-up student (does exactly what the home page does after the passcode check).
app.get('/_lab/student', (req, res) => {
  const PEOPLE = { A: { name: 'Pointer Test Student A', pin: '1111' }, B: { name: 'Pointer Test Student B', pin: '2222' }, C: { name: 'Other Class Student C', pin: '3333' }, D: { name: 'Removed Student D', pin: '4444' } };
  const who = PEOPLE[req.query.who] || PEOPLE.A;
  const go = String(req.query.go || '/index.html').replace(/[^A-Za-z0-9_./?=&-]/g, '');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Pointer Lab student sign-in</title><p id="m">Signing in as ${who.name}…</p>
<script src="/vendor/firebase/12.15.0/firebase-app-compat.js"></script><script src="/vendor/firebase/12.15.0/firebase-auth-compat.js"></script><script src="/vendor/firebase/12.15.0/firebase-database-compat.js"></script><script src="/firebase-config.js"></script>
<script>
(async()=>{try{
  firebase.initializeApp(window.B3_FIREBASE_CONFIG);
  const r=await fetch('/_fn/funTorahStudentAuth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',name:${JSON.stringify(who.name)},pin:${JSON.stringify(who.pin)}})});
  const d=await r.json(); if(!r.ok||!d.ok) throw new Error(d.error||'sign-in failed');
  if(d.customToken) await firebase.auth().signInWithCustomToken(d.customToken);
  sessionStorage.setItem('b3Games_studentId',d.id);sessionStorage.setItem('b3Games_studentName',d.name);sessionStorage.setItem('b3Games_studentClass',d.classId);sessionStorage.setItem('b3Games_classPin',${JSON.stringify(who.pin)});
  location.href=${JSON.stringify(go)};
}catch(e){document.getElementById('m').textContent=String(e.message||e)}})();
</script>`);
});

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };
const rewrite = text => text
  // game-gate.js adds missing SDK pieces as "gstatic/firebasejs/"+sdk+"/firebase-..."; serve those through /_gstatic so they use the emulators too
  .split('"https://www.gstatic.com/firebasejs/"+sdk').join('"/_gstatic/"+sdk')
  // pages that carry their own copy of the Firebase settings must use the lab's fake key, or their sign-in would not match the one the lab created
  .replace(/AIzaSy[A-Za-z0-9_-]{33}/g, 'lab-fake-api-key')
  .replace(/https:\/\/us-central1-b3-games\.cloudfunctions\.net\//g, '/_fn/')
  // only the version we vendor is served locally; older SDKs (v8 pages such as Rashi Letters) load from gstatic and are pointed at the emulator in the page below
  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/12\.[0-9.]+\//g, '/vendor/firebase/12.15.0/')
  // the real project's database address becomes the lab's (the SDK shim sends SDK calls to the emulator; SHIM_FETCH sends REST calls there)
  // every other SDK version (10.x, 8.x) is fetched through /_gstatic so its auth and database also use the emulators
  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/([0-9][0-9.]*)\//g, '/_gstatic/$1/')
  .replace(/https:\/\/b3-games-default-rtdb\.firebaseio\.com/g, 'https://' + DB_NS + '.firebaseio.com');
// plain REST reads (game gate, Shorashim, ...) go to the emulator, never to the real project
const SHIM_FETCH = `
;(function(){
  // same-origin proxy (/_rtdb) so every browser (Edge, Chrome) can reach the emulator without special host names or cross-origin rules
  var FROM='https://${DB_NS}.firebaseio.com', TO=location.origin+'/_rtdb';
  var f=window.fetch; if(f&&!f.__lab){ var w=function(u,o){ if(typeof u==='string'&&u.indexOf(FROM)===0)u=TO+u.slice(FROM.length); return f.call(this,u,o); }; w.__lab=true; window.fetch=w; }
  var open=XMLHttpRequest.prototype.open; if(!open.__lab){ XMLHttpRequest.prototype.open=function(m,u){ var a=[].slice.call(arguments); if(typeof u==='string'&&u.indexOf(FROM)===0)a[1]=TO+u.slice(FROM.length); return open.apply(this,a); }; XMLHttpRequest.prototype.open.__lab=true; }
})();
`;
function labConfig(text) {
  return text
    .replace(/apiKey:\s*"[^"]*"/, 'apiKey: "lab-fake-api-key"')
    .replace(/authDomain:\s*"[^"]*"/, 'authDomain: "localhost"')
    .replace(/databaseURL:\s*"[^"]*"/, 'databaseURL: "https://' + DB_NS + '.firebaseio.com"')
    .replace(/projectId:\s*"[^"]*"/, 'projectId: "' + PROJECT + '"')
    .replace(/storageBucket:\s*"[^"]*"/, 'storageBucket: "' + PROJECT + '.appspot.com"');
}
app.use((req, res) => {
  let p = decodeURIComponent(req.path);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(REPO, p);
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.status(404).type('text/plain').send('Not found: ' + p);
  const ext = path.extname(file).toLowerCase();
  res.set('Cache-Control', 'no-store');
  if (!['.html', '.js'].includes(ext) || p.includes('/vendor/pdf') || p.includes('peerjs')) return res.type(MIME[ext] || 'application/octet-stream').send(fs.readFileSync(file));
  let body = fs.readFileSync(file, 'utf8');
  if (/\/firebase-config\.js$/.test(p)) body = labConfig(body);
  body = rewrite(body);
  if (ext === '.html') {
    // plain REST/XHR reads (game gate etc.) go to the emulator on every page, whatever SDK it uses
    const head = /<head[^>]*>/i;
    body = head.test(body) ? body.replace(head, m => m + '<script>' + SHIM_FETCH + '</script>') : '<script>' + SHIM_FETCH + '</script>' + body;
    if (/firebasejs\/8\.[0-9.]+\/firebase-database\.js/.test(body)) {
      // Firebase v8 pages: send database calls to the emulator (same idea as SHIM for the newer SDK)
      const V8 = '<script>(function(){var o=firebase.database;var w=function(){var d=o.apply(this,arguments);if(!d.__lab){d.__lab=1;try{d.useEmulator("127.0.0.1",9000)}catch(e){}}return d};for(var k in o)try{w[k]=o[k]}catch(e){}firebase.database=w})();</script>';
      body = body.replace(/(<script[^>]*firebasejs\/8\.[0-9.]+\/firebase-database\.js[^>]*><\/script>)/, m => m + V8);
    }
  }
  if (/\/vendor\/firebase\/12\.15\.0\/firebase-(auth|database)-compat\.js$/.test(p)) body += SHIM;
  if (/\/vendor\/firebase\/12\.15\.0\/firebase-app-compat\.js$/.test(p)) body += SHIM_FETCH;
  res.type(MIME[ext]).send(body);
});
app.listen(PORT, '127.0.0.1', () => console.log('Pointer lab running at http://localhost:' + PORT + '/  (repo: ' + REPO + ')'));
