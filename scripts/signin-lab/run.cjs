'use strict';
// Isolated synthetic Auth/RTDB lab. No production configuration, accounts, or data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const http=require('node:http');
const root=path.resolve(__dirname,'../..');
const project='demo-signin-lab',namespace=project+'-default-rtdb';
const port=18783,dbPort=19100,authPort=19099;
const base=`http://127.0.0.1:${port}`;
const tools=process.env.FIREBASE_TOOLS_ROOT||fs.readdirSync(path.join(os.homedir(),'.npm/_npx')).map(p=>path.join(os.homedir(),'.npm/_npx',p,'node_modules/firebase-tools')).find(p=>fs.existsSync(path.join(p,'lib/emulator/auth/index.js')));
if(!tools)throw Error('Install firebase-tools@14.22.0 or set FIREBASE_TOOLS_ROOT');
const {AuthEmulator}=require(path.join(tools,'lib/emulator/auth/index.js'));
const jar=process.env.FIREBASE_DATABASE_EMULATOR_JAR||path.join(os.homedir(),'.cache/firebase/emulators/firebase-database-emulator-v4.11.2.jar');
const data={b3Games:{siteSettings:{siteEnabled:true,classAccess:{et:{mode:'open'},wt:{mode:'open'}},classGames:{et:{},wt:{}}},students:{},workspaces:{'b3-2026':{teachers:{},classes:{}}}}};
const activities=['halacha','posuk-practice-scroll','chazara','weekly-quiz','shorashim','student-rewards'];
for(const track of ['et','wt']){
 const sid='synthetic_'+track;
 data.b3Games.students[sid]={profile:{active:true,classId:track,name:'Synthetic '+track},memberships:{one:{active:true,workspaceId:'b3-2026',classId:track}}};
 data.b3Games.workspaces['b3-2026'].classes[track]={active:true,siteEnabled:true,access:{mode:'open'},toolGrants:Object.fromEntries(activities.map(t=>[t,true])),members:{[sid]:{active:true}}};
}
const requests=[];let backend=null;
const localize=source=>source.replaceAll("https://us-central1-b3-games.cloudfunctions.net",base+"/api");
async function rest(p,method='GET',body){
 const u=new URL(`http://127.0.0.1:${dbPort}/${p}.json`);u.searchParams.set('ns',namespace);
 const r=await fetch(u,{method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw Error('Local emulator '+r.status+' '+await r.text());return r.json();
}
const config={apiKey:'synthetic-key',authDomain:project+'.firebaseapp.com',databaseURL:`https://${namespace}.firebaseio.com`,projectId:project,storageBucket:project+'.appspot.com',messagingSenderId:'1234567890',appId:'1:1234567890:web:synthetic'};
const bootstrap=`
(function(){
window.B3_FIREBASE_CONFIG=${JSON.stringify(config)};
if (!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
firebase.auth().useEmulator('http://127.0.0.1:${authPort}',{disableWarnings:true});
firebase.database().useEmulator('127.0.0.1',${dbPort});
const remembered=firebase.initializeApp(window.B3_FIREBASE_CONFIG,'FTTRememberedTeacher');
remembered.auth().useEmulator('http://127.0.0.1:${authPort}',{disableWarnings:true});
window.FTTFollowStudent={start:async()=>{},allowsLockedActivity:async()=>false};
window.labReady=Promise.all([firebase.auth().setPersistence(firebase.auth.Auth.Persistence.SESSION),remembered.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)]);
const initialize=firebase.initializeApp.bind(firebase);
firebase.initializeApp=function(options,name){
 if(options.projectId!==${JSON.stringify(project)})throw new Error('Non-lab Firebase project refused');
 const app=initialize(options,name);app.auth().useEmulator('http://127.0.0.1:${authPort}',{disableWarnings:true});app.database().useEmulator('127.0.0.1',${dbPort});return app;
};
window.__labConnected=true;
})();
`;
const html=(tool)=>`<!doctype html><html><head><meta charset="utf-8"><script src="/vendor/firebase/12.15.0/firebase-app-compat.js"></script><script src="/vendor/firebase/12.15.0/firebase-auth-compat.js"></script><script src="/vendor/firebase/12.15.0/firebase-database-compat.js"></script><script>${bootstrap}</script>${tool?'<script src="/site-settings.js"></script><script src="/game-gate.js" data-game-id="'+tool+'"></script>':''}</head><body><h1 id="labContent">Synthetic sign-in lab</h1></body></html>`;
let delay=0,deny=false,baseline=false;
const server=http.createServer(async(req,res)=>{
 try{
 const u=new URL(req.url,base);
 if(u.pathname.startsWith('/api/')){if(!backend){res.writeHead(503);res.end();return;}return backend.router(req,res);}
 if(u.pathname.startsWith('/db/')){
  requests.push({path:u.pathname,method:req.method,at:Date.now()});
  if(delay)await new Promise(r=>setTimeout(r,delay));
  if(deny){res.writeHead(503);res.end('{}');return;}
  const target=new URL(`http://127.0.0.1:${dbPort}/`+u.pathname.slice(4));
  target.search=u.search;target.searchParams.set('ns',namespace);
  const r=await fetch(target);res.writeHead(r.status,{'Content-Type':'application/json'});res.end(await r.text());return;
 }
 if(u.pathname==='/firebase-config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.B3_FIREBASE_CONFIG='+JSON.stringify(config));return;}
 if(['/index.html','/halacha/index.html','/student-rewards/student.html','/weekly-quiz/index.html'].includes(u.pathname)){
  let page=fs.readFileSync(path.join(root,u.pathname),'utf8');
  page=page.replace(/<script[^>]*src=["'][^"']*vendor\/firebase\/[^"']+["'][^>]*><\/script>/g,'');
  page=page.replace(/<script[^>]*src=["']https:\/\/www\.gstatic\.com[^"']+["'][^>]*><\/script>/g,'');
  const localSDK=['app','auth','database'].map(part=>'<script src="/vendor/firebase/12.15.0/firebase-'+part+'-compat.js"></script>').join('');
  page=page.replace(/<head[^>]*>/i,match=>match+localSDK+'<script>'+bootstrap+'</script>');
  res.setHeader('Content-Type','text/html');res.end(localize(page));return;
 }
 if(u.pathname==='/login'){res.setHeader('Content-Type','text/html');res.end(html());return;}
 if(u.pathname==='/tool'){
  res.setHeader('Content-Type','text/html');
  const tool=u.searchParams.get('tool')||'halacha';
  res.end(u.searchParams.has('gateLoadsSDK')?`<!doctype html><html><head><script src="/vendor/firebase/12.15.0/firebase-app-compat.js"></script><script>window.B3_FIREBASE_CONFIG=${JSON.stringify(config)};</script><script src="/game-gate.js" data-game-id="${tool}"></script></head><body>Synthetic fallback test</body></html>`:html(tool));return;
 }
 if(u.pathname==='/site-settings.js'){res.setHeader('Content-Type','text/javascript');res.end(`if(!window.__labConnected){${bootstrap}}`+localize(fs.readFileSync(path.join(root,'site-settings.js'),'utf8')));return;}
 if(u.pathname==='/game-gate.js'){
  const src=baseline?require('node:child_process').execFileSync('git',['show','3aafc7c:game-gate.js'],{cwd:root,encoding:'utf8'}):fs.readFileSync(path.join(root,'game-gate.js'),'utf8');
  res.setHeader('Content-Type','text/javascript');res.end(src.replace('https://b3-games-default-rtdb.firebaseio.com',base+'/db'));return;
 }
 if(['/audio-mode.js','/follow-teacher/core.js','/follow-teacher/student.js'].includes(u.pathname)){res.setHeader('Content-Type','text/javascript');res.end('');return;}
 const p=path.resolve(root,'.'+decodeURIComponent(u.pathname));
 if(!p.startsWith(root+path.sep)||!fs.existsSync(p)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2'})[path.extname(p)]||'application/octet-stream');res.end(p.endsWith(".js")?localize(fs.readFileSync(p,"utf8")):fs.readFileSync(p));
 }catch(e){res.writeHead(500);res.end(String(e));}
});
(async()=>{
 const log=fs.openSync(path.join(os.tmpdir(),'pr283-rtdb-lab.log'),'w');
 const java=spawn('java',['-jar',jar,'--host','127.0.0.1','--port',String(dbPort)],{stdio:['ignore',log,log]});
 const auth=new AuthEmulator({projectId:project,host:'127.0.0.1',port:authPort});
 try{
  await auth.start();
  if(process.env.SIGNIN_LAB_STAGE==='1')backend=require('./backend.cjs')({root,project,namespace,authPort,dbPort,config});
  for(let i=0;i<100;i++){try{await rest('.settings/rules','PUT',JSON.parse(fs.readFileSync(path.join(root,'firebase-rules.hardened.json'),'utf8')));break;}catch(e){if(i===99)throw e;await new Promise(r=>setTimeout(r,100));}}
  await rest('','PUT',data);
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  if(!process.env.SIGNIN_LAB_CASE){
  const security=spawn(process.execPath,['--test','tests/security-rules-emulator.test.cjs'],{cwd:root,env:{...process.env,B3_RUN_RTDB_EMULATOR_TESTS:'1',FIREBASE_DATABASE_EMULATOR_PORT:String(dbPort)},stdio:'inherit'});
  const securityCode=await new Promise(resolve=>security.on('exit',resolve));
  if(securityCode!==0)throw Error('Database security tests failed: '+securityCode);
  }
  await require(process.env.SIGNIN_LAB_STAGE==='1'?'./staging.cjs':'./browser.cjs')({base,authPort,activities,requests,rest,namespace,dbPort,backend,setDelay:v=>delay=v,setDeny:v=>deny=v,setBaseline:v=>baseline=v});
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));if(backend)await backend.close();await auth.stop();java.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
