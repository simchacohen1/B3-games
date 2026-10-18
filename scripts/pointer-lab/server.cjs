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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };
const rewrite = text => text
  .replace(/https:\/\/us-central1-b3-games\.cloudfunctions\.net\//g, '/_fn/')
  .replace(/https:\/\/www\.gstatic\.com\/firebasejs\/[0-9.]+\//g, '/vendor/firebase/12.15.0/');
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
  if (/\/vendor\/firebase\/12\.15\.0\/firebase-(auth|database)-compat\.js$/.test(p)) body += SHIM;
  res.type(MIME[ext]).send(body);
});
app.listen(PORT, '127.0.0.1', () => console.log('Pointer lab running at http://localhost:' + PORT + '/  (repo: ' + REPO + ')'));
