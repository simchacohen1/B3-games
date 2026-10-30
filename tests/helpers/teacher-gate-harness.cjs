'use strict';
// Loads real Teacher Tools pages in Chromium with a fictional Firebase (no network,
// no real accounts). The real site-settings.js decides who is authorized.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('@playwright/test')); }
const ROOT = path.resolve(__dirname, '..', '..');
const OWNER_EMAIL = 'simcha5770@gmail.com';
const TREE = { b3Games: { admins: { admin_uid: { active: true } }, workspaces: { 'b3-2026': {
  teachers: {
    teacher_et: { active: true, classIds: { et: true } },
    teacher_wt: { active: true, classIds: { wt: true } },
    teacher_new: { active: true, classIds: { 'new-room': true } },
    revoked_uid: { active: false, classIds: { et: true } },
    no_class_uid: { active: true, classIds: {} }
  },
  teacherInvites: { unclaimed_example_test: { active: true, email: 'unclaimed@example.test' } },
  classes: {
    et: { name: 'ET', active: true, members: { student_et: { active: true, name: 'ET Student' } } },
    wt: { name: 'WT', active: true, members: { student_wt: { active: true, name: 'WT Student' } } }
  }
} } } };
const google = (uid, email, verified = true) => ({ uid, email, emailVerified: verified, providerData: [{ providerId: 'google.com' }] });
const IDENTITIES = {
  anonymous: null,
  student: { uid: 'student_et', email: null, emailVerified: false, providerData: [{ providerId: 'custom' }] },
  randomGoogle: google('rand_uid', 'random@example.test'),
  unclaimedInvite: google('unclaimed_uid', 'unclaimed@example.test'),
  revokedTeacher: google('revoked_uid', 'revoked@example.test'),
  teacherNoClasses: google('no_class_uid', 'noclass@example.test'),
  teacherET: google('teacher_et', 'et@example.test'),
  teacherWT: google('teacher_wt', 'wt@example.test'),
  teacherNew: google('teacher_new', 'new@example.test'),
  admin: google('admin_uid', 'admin@example.test'),
  owner: google('owner_uid', OWNER_EMAIL)
};
function stubSource(identity) {
  const user = identity ? { ...identity } : null;
  return `(()=>{
 const T=${JSON.stringify(TREE)},U=${JSON.stringify(user)},reads=[],writes=[],watchers={};
 const USER=U?Object.assign({},U,{getIdToken:async()=> 'token-'+U.uid}):null;
 const at=p=>p.split('/').filter(Boolean).reduce((v,k)=>v==null?undefined:v[k],T);
 const snap=v=>({val:()=>v==null?null:structuredClone(v),exists:()=>v!=null,forEach:()=>false,numChildren:()=>0,key:null});
 const ref=p=>{const r={
  once:async()=>{reads.push(p);return snap(at(p))},get:async()=>{reads.push(p);return snap(at(p))},
  on:(e,cb)=>{reads.push(p);(watchers[p]=watchers[p]||[]).push(cb);setTimeout(()=>{try{cb&&cb(snap(at(p)))}catch(x){}},0);return cb},off:()=>{},
  set:async()=>{writes.push(p)},update:async()=>{writes.push(p)},remove:async()=>{writes.push(p)},transaction:async()=>{writes.push(p);return{committed:false,snapshot:snap(null)}},
  push:()=>ref(p+'/pushed'),child:c=>ref(p+'/'+c),orderByChild:()=>r,orderByKey:()=>r,equalTo:()=>r,limitToLast:()=>r,limitToFirst:()=>r,startAt:()=>r,endAt:()=>r,
  onDisconnect:()=>({set:async()=>{},remove:async()=>{},cancel:async()=>{}}),key:p.split('/').pop(),parent:null};return r};
 const db={ref,goOnline(){},goOffline(){}};
 const listeners=[];
 const auth={currentUser:USER,onAuthStateChanged(cb){listeners.push(cb);setTimeout(()=>cb(USER),15);return()=>{}},authStateReady:async()=>{},signOut:async()=>{},setPersistence:async()=>{},signInWithPopup:async()=>({user:USER}),signInWithRedirect:async()=>{},getRedirectResult:async()=>({user:null}),updateCurrentUser:async()=>{},signInWithCustomToken:async()=>({user:USER})};
 const remembered={currentUser:null,onAuthStateChanged(cb){setTimeout(()=>cb(null),0);return()=>{}},authStateReady:async()=>{},setPersistence:async()=>{},signOut:async()=>{},signInWithPopup:async()=>({user:USER})};
 function GoogleAuthProvider(){this.setCustomParameters=()=>{};this.addScope=()=>{}}
 const rememberedApp={auth:()=>remembered,delete:async()=>{}};
 const firebase={apps:[{}],initializeApp(){return rememberedApp},app:n=>{if(n==='FTTRememberedTeacher')return rememberedApp;return{auth:()=>auth,database:()=>db}},database:Object.assign(()=>db,{ServerValue:{TIMESTAMP:{'.sv':'timestamp'}}}),auth:Object.assign(()=>auth,{Auth:{Persistence:{LOCAL:'local',SESSION:'session',NONE:'none'}},GoogleAuthProvider}),storage:()=>({ref:()=>({put:async()=>{},getDownloadURL:async()=>''})}),functions:()=>({httpsCallable:()=>async()=>({data:{}})})};
 window.__setTree=(p,v)=>{const k=p.split('/').filter(Boolean),last=k.pop();let o=T;for(const x of k)o=o[x]=o[x]||{};if(v===undefined)delete o[last];else o[last]=v;for(const w of Object.keys(watchers)){if(w===p||w.startsWith(p+'/')||p.startsWith(w+'/'))for(const cb of watchers[w])try{cb(snap(at(w)))}catch(x){}}};
 window.firebase=firebase;window.__reads=reads;window.__writes=writes;
 })();`;
}
const CONFIG = "window.B3_FIREBASE_CONFIG={apiKey:'synthetic',authDomain:'localhost',databaseURL:'https://synthetic.invalid',projectId:'demo',storageBucket:'synthetic',messagingSenderId:'1',appId:'synthetic'};window.B3_APP_CONTEXT={workspaceId:'b3-2026'};";
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function startServer() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname), file = path.resolve(ROOT, '.' + p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(s));
  });
}
async function openAs(browser, port, identityName, relativeUrl, { settleMs = 1800 } = {}) {
  const context = await browser.newContext(), page = await context.newPage();
  await page.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: stubSource(IDENTITIES[identityName]) }));
  await page.route(/firebase-config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: CONFIG }));
  // The fictional teacher-claim function always refuses (an unclaimed invite is not a teacher).
  await page.route(/cloudfunctions\.net/, r => r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"denied"}' }));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)(?!.*(gstatic|cloudfunctions))/, r => r.abort());
  await page.goto(`http://127.0.0.1:${port}/${relativeUrl}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(settleMs);
  return { page, context };
}
async function snapshot(page) {
  return page.evaluate(() => {
    const gate = document.getElementById('b3-teacher-gate');
    const visible = el => { const s = getComputedStyle(el), r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
    const hiddenAncestor = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { if (n.hidden || getComputedStyle(n).display === 'none') return true; } return false; };
    const outside = [...document.body.querySelectorAll('button,a[href],input,select,textarea,table,canvas')].filter(el => !(gate && gate.contains(el)) && visible(el) && !hiddenAncestor(el));
    const outsideText = [...document.body.children].filter(el => el !== gate && visible(el) && !['SCRIPT', 'STYLE'].includes(el.tagName)).map(el => el.innerText || '').join(' ').replace(/\s+/g, ' ').trim();
    return { gate: !!gate, gateText: gate ? gate.innerText.replace(/\s+/g, ' ').trim() : '', locked: document.documentElement.classList.contains('b3-tg-locked'), visibleControlsOutsideGate: outside.length, visibleTextOutsideGate: outsideText.slice(0, 160), reads: (window.__reads || []).slice(), writes: (window.__writes || []).slice(), url: location.pathname + location.search };
  }).catch(() => ({ gate: false, error: true, reads: [], writes: [], visibleControlsOutsideGate: -1, visibleTextOutsideGate: '(page navigated/failed)', url: '' }));
}
module.exports = { ROOT, IDENTITIES, startServer, openAs, snapshot, chromium };
