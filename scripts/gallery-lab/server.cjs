'use strict';
const {PROJECT,ports,run}=require('./isolation.cjs');
const fs=require('node:fs'),path=require('node:path'),express=require('express'),admin=require('firebase-admin');
const ROOT=path.resolve(__dirname,'../..'),DEPS=path.dirname(require.resolve('firebase/package.json'));
const people=JSON.parse(fs.readFileSync(path.join(run,'people.json')));
admin.initializeApp({projectId:PROJECT,databaseURL:`https://${PROJECT}-default-rtdb.firebaseio.com`,storageBucket:PROJECT+'.appspot.com'});
// The production handlers explicitly name a bucket. Map only that bucket to
// the synthetic emulator bucket; never alter the handler files themselves.
const mediaTickets=new Map();
const storage=admin.storage();const originalBucket=storage.bucket.bind(storage);
storage.bucket=name=>{if(name&&![PROJECT+'.appspot.com','b3-games.firebasestorage.app'].includes(name))throw Error('Unexpected bucket');const bucket=originalBucket(PROJECT+'.appspot.com');const originalFile=bucket.file.bind(bucket);bucket.file=(name,...args)=>{const file=originalFile(name,...args);file.getSignedUrl=async()=>{const ticket=require('node:crypto').randomUUID();mediaTickets.set(ticket,{path:name,expires:Date.now()+300000});return ['http://127.0.0.1:'+ports.site+'/_lab/private-media/'+ticket]};return file};return bucket;};
const functions={funTorahStudentAuth:require('../../backend/functions/student-auth.js').funTorahStudentAuth,classGalleryRead:require('../../backend/functions/class-gallery-read.js').classGalleryRead,classGallerySubmit:require('../../backend/functions/class-gallery-submit.js').classGallerySubmit,privateMediaUrl:require('../../backend/functions/private-media-url.js').privateMediaUrl};
const app=express();app.disable('x-powered-by');
app.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('Content-Security-Policy',"default-src 'self'; script-src 'self' http://127.0.0.1:9200 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: http://127.0.0.1:9399; media-src 'self' blob: http://127.0.0.1:9399; connect-src 'self' http://127.0.0.1:9299 http://127.0.0.1:9200 http://127.0.0.1:9399 ws://127.0.0.1:9200; worker-src 'self' blob:; frame-src 'self' http://127.0.0.1:9200");next();});
app.get('/_lab/private-media/:ticket',async(req,res)=>{const row=mediaTickets.get(req.params.ticket);if(!row||row.expires<Date.now())return res.sendStatus(403);try{const [bytes]=await originalBucket(PROJECT+'.appspot.com').file(row.path).download();res.type('application/octet-stream').send(bytes)}catch{res.sendStatus(404)}});
app.get('/_lab/health',(_req,res)=>res.json({project:PROJECT,ports,syntheticOnly:true}));
app.all('/_rtdb/*',express.text({type:'*/*'}),async(req,res)=>{try{const qs=new URLSearchParams(req.query);qs.set('ns',PROJECT+'-default-rtdb');const r=await fetch(`http://127.0.0.1:${ports.database}/`+req.params[0]+'?'+qs,{method:req.method,headers:{'Content-Type':'application/json'},body:['GET','HEAD'].includes(req.method)?undefined:req.body});res.status(r.status).type('json').send(await r.text());}catch(e){res.status(502).json({error:e.message})}});
app.use('/_fn/:name',express.json({limit:'2mb'}),async(req,res)=>{
 const fn=functions[req.params.name];if(!fn)return res.status(501).json({error:'Function not present in isolated Gallery lab.'});
 // Storage download URLs point to the local emulator in JSON responses.
 const json=res.json.bind(res);res.json=v=>json(JSON.parse(JSON.stringify(v).replaceAll('https://firebasestorage.googleapis.com',`http://127.0.0.1:${ports.storage}`)));
 try{await fn(req,res)}catch(e){console.error(e);res.status(500).json({error:e.message})}
});
const sdkShim=`;(function(){const f=window.firebase;if(!f)return;for(const [key,init] of Object.entries({auth:a=>a.useEmulator('http://127.0.0.1:${ports.auth}',{disableWarnings:true}),database:d=>d.useEmulator('127.0.0.1',${ports.database}),storage:s=>s.useEmulator('127.0.0.1',${ports.storage})})){const orig=f[key];if(!orig||orig.__galleryLab)continue;const wrap=function(){const value=orig.apply(this,arguments);if(!value.__galleryLab){value.__galleryLab=true;init(value)}return value};Object.defineProperties(wrap,Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(orig)).filter(([k])=>!['length','name','prototype'].includes(k))));wrap.__galleryLab=true;f[key]=wrap}})();`;
app.get('/_sdk/:file',(req,res)=>{if(!/^firebase-(app|auth|database|storage)-compat\.js$/.test(req.params.file))return res.sendStatus(404);res.type('js').send(fs.readFileSync(path.join(DEPS,req.params.file),'utf8')+sdkShim)});
app.get('/_three.js',(_q,res)=>res.type('js').sendFile(require.resolve('three').replace(/three\.cjs$/,'three.min.js')));
app.get('/_lab/login',(_q,res)=>res.type('html').send(`<!doctype html><title>Synthetic Gallery sign-in</title><h1>Gallery emulator lab — synthetic only</h1>${['et','wt'].map(c=>`<p><a href="/_lab/sign-in?role=student&class=${c}">Student ${c.toUpperCase()}</a> <a href="/_lab/sign-in?role=teacher&class=${c}">Teacher ${c.toUpperCase()}</a></p>`).join('')}`));
const sdkScripts=['app','auth','database','storage'].map(n=>`<script src="/_sdk/firebase-${n}-compat.js"></script>`).join('');
app.get('/_lab/sign-in',async(req,res)=>{
 const cls=req.query.class,role=req.query.role,p=people[cls];if(!p||!['student','teacher'].includes(role))return res.sendStatus(400);
 const next=String(req.query.go||'/class-gallery/index.html?class='+cls);if(!/^\/(?!\/)/.test(next))return res.sendStatus(400);
 res.type('html').send(`<!doctype html><title>Synthetic ${role} ${cls}</title><p id="status">Signing in…</p>${sdkScripts}<script src="/firebase-config.js"></script><script>
 (async()=>{try{firebase.initializeApp(B3_FIREBASE_CONFIG);await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION);await firebase.auth().signOut();sessionStorage.clear();
 ${role==='student'?`const r=await fetch('/_fn/funTorahStudentAuth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',name:${JSON.stringify(p.name)},pin:${JSON.stringify(p.pin)},classId:${JSON.stringify(cls)}})});const d=await r.json();if(!r.ok)throw Error(d.error);await firebase.auth().signInWithCustomToken(d.customToken);for(const [k,v] of Object.entries({b3Games_studentId:d.id,b3Games_studentName:d.name,b3Games_studentClass:d.classId,b3Games_classPin:${JSON.stringify(p.pin)}}))sessionStorage.setItem(k,v);`:`const idp=JSON.stringify({sub:'gallery-${cls}',email:${JSON.stringify(p.teacher.email)},email_verified:true,provider_id:'google.com'});await firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(idp));`}
 location.href=${JSON.stringify(next)};}catch(e){document.getElementById('status').textContent=e.message}})();</script>`);
});
// Neutral synthetic artwork surface tests the real site-wide gallery-share.js,
// without entering or testing any unrelated learning tool.
app.get('/_lab/art.html',(_q,res)=>res.type('html').send(`<!doctype html><html><head><title>Synthetic Gallery Artwork</title></head><body style="background:#fef3c7;font:28px sans-serif"><h1>Gallery Lab — Synthetic Artwork</h1><svg width="500" height="300"><rect width="500" height="300" fill="#bfdbfe"/><circle cx="250" cy="140" r="90" fill="#16a34a"/></svg><script src="/gallery-share.js"></script></body></html>`));
function rewrite(text){return text.replace(/https:\/\/us-central1-b3-games\.cloudfunctions\.net\//g,'/_fn/').replace(/https:\/\/www\.gstatic\.com\/firebasejs\/(?:[0-9.]+|"\+sdk\+")\//g,'/_sdk/').replace(/https:\/\/(?:cdnjs.cloudflare.com\/ajax\/libs\/three.js\/0.160.1\/three.min.js|cdn.jsdelivr.net\/npm\/three@0.160.1\/build\/three.min.js|unpkg.com\/three@0.160.1\/build\/three.min.js)/g,'/_three.js').replace(/https:\/\/b3-games-default-rtdb\.firebaseio\.com/g,'/_rtdb').replace(/<link[^>]+https:\/\/fonts.googleapis.com[^>]*>/g,'');}
app.use((req,res)=>{
 const url=decodeURIComponent(req.path),file=path.resolve(ROOT,'.'+(url.endsWith('/')?url+'index.html':url));if(!file.startsWith(ROOT+path.sep)||url.includes('..')||url.includes('/.git')||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.sendStatus(404);
 if(!/\.(js|html)$/.test(file))return res.sendFile(file);
 let body=fs.readFileSync(file,'utf8');
 if(url==='/firebase-config.js')body=body.replace(/apiKey:\s*"[^"]*"/,'apiKey:"gallery-lab-key"').replace(/authDomain:\s*"[^"]*"/,'authDomain:"localhost"').replace(/projectId:\s*"[^"]*"/,`projectId:"${PROJECT}"`).replace(/databaseURL:\s*"[^"]*"/,`databaseURL:"https://${PROJECT}-default-rtdb.firebaseio.com"`).replace(/storageBucket:\s*"[^"]*"/,`storageBucket:"${PROJECT}.appspot.com"`);
 body=rewrite(body);res.type(file.endsWith('.js')?'js':'html').send(body);
});
app.listen(ports.site,'127.0.0.1',()=>console.log('Gallery lab on http://127.0.0.1:'+ports.site));
