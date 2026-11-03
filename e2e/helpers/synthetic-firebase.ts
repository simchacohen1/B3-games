import { type Page, type Route } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const ROOT=path.resolve(__dirname,'../..');
export const PROJECT='demo-ftt-readiness', WORKSPACE='b3-2026', CLASS_ID='pilot_room_alpha';
export const DB_PORT=Number(process.env.FIREBASE_DATABASE_EMULATOR_PORT||19100);
const STORAGE_PORT=Number(process.env.FIREBASE_STORAGE_EMULATOR_PORT||19199);
const AUTH_PORT=19099, FUNCTIONS_PORT=15001;
const OWNER='owner@example.test';
const BOOTSTRAP='simcha5770@gmail.com';
// Rename one literal in a test-only copy, keeping the exact owner/verified-email
// restrictions. Neither production sources nor checked-in rules are rewritten.
function fictionalOwner(source:string){return source.replaceAll(BOOTSTRAP,OWNER);}
export function fictionalOwnerRules(){return fictionalOwner(fs.readFileSync(path.join(ROOT,'firebase-rules.json'),'utf8'));}
export async function serveSyntheticSite():Promise<{server:http.Server,origin:string}>{
  if(!PROJECT.startsWith('demo-'))throw Error('Synthetic setup requires a demo project.');
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url||'/','http://local.test').pathname);
    const filename=path.resolve(ROOT,'.'+pathname);
    if(!filename.startsWith(ROOT+path.sep)||!fs.existsSync(filename)||fs.statSync(filename).isDirectory()){res.writeHead(404).end('not found');return;}
    const mime:Record<string,string>={'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg'};
    res.writeHead(200,{'content-type':mime[path.extname(filename)]||'application/octet-stream','cache-control':'no-store'});
    if(['owner-admin.html','site-settings.js'].includes(pathname.slice(1)))res.end(fictionalOwner(fs.readFileSync(filename,'utf8')));
    else fs.createReadStream(filename).pipe(res);
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();if(!address||typeof address==='string')throw Error('No local site address');
  return {server,origin:`http://127.0.0.1:${address.port}`};
}
export async function closeSyntheticSite(server:http.Server){if(!server)return;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
export async function configureBrowser(page:Page,errors:string[],failed:string[],identity:'owner'|'teacher'='teacher'){
  const origin=()=>new URL(page.url()).origin;
      const config={apiKey:'fake-api-key',authDomain:'127.0.0.1',databaseURL:`http://127.0.0.1:${DB_PORT}?ns=${PROJECT}`,projectId:PROJECT,storageBucket:'synthetic.invalid',messagingSenderId:'1',appId:'synthetic'};
  const bootstrap=`
        window.B3_FIREBASE_CONFIG=${JSON.stringify(config)};
        window.B3_APP_CONTEXT={workspaceId:${JSON.stringify(WORKSPACE)}};
        (function(){
          var sdk=window.firebase;
          function configure(auth){
            if(!auth.__syntheticConfigured){
              auth.useEmulator('http://127.0.0.1:${AUTH_PORT}',{disableWarnings:true});
              auth.__syntheticConfigured=true;
              auth.signInWithPopup=function(){return auth.signInWithCredential(sdk.auth.GoogleAuthProvider.credential(JSON.stringify({sub:${JSON.stringify('fictional-'+identity)},email:${JSON.stringify(identity==='owner'?OWNER:'teacher@example.test')},email_verified:true,name:${JSON.stringify('Fictional '+identity)}})));};
            }
            return auth;
          }
          // Legacy tools load app/database before Auth. Configure their app
          // options immediately, and connect Auth as soon as its SDK arrives.
          if(!sdk.initializeApp.__syntheticConfigured){
            var initialize=sdk.initializeApp;
            sdk.initializeApp=function(options,name){
              var app=initialize.call(sdk,window.B3_FIREBASE_CONFIG,name);
              if(typeof app.auth==='function')configure(app.auth());
              if(typeof app.storage==='function'&&!app.storage().__syntheticConfigured){
                var storage=app.storage();
                storage.useEmulator('127.0.0.1',${STORAGE_PORT});
                storage.__syntheticConfigured=true;
              }
              return app;
            };
            sdk.initializeApp.__syntheticConfigured=true;
          }
          if(sdk.auth){
            var realAuth=sdk.auth.__syntheticOriginal||sdk.auth;
            function syntheticAuth(){return configure(realAuth.apply(this,arguments));}
            Object.assign(syntheticAuth,realAuth);
            syntheticAuth.__syntheticOriginal=realAuth;sdk.auth=syntheticAuth;
            sdk.apps.forEach(function(app){configure(app.auth());});
          }
        })();`;

  await page.context().route('**/*',async(route:Route)=>{
    const req=route.request(),url=new URL(req.url());
    if(url.hostname==='www.gstatic.com'&&url.pathname.includes('/firebasejs/')){
      const sdkFile=path.basename(url.pathname).replace(/^firebase-(app|auth|database|storage)\.js$/, 'firebase-$1-compat.js');
      const file=path.join(ROOT,'vendor/firebase/12.15.0',sdkFile);
      if(!fs.existsSync(file))throw Error('Missing Firebase SDK '+file);
      return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8')+(['firebase-app-compat.js','firebase-auth-compat.js'].includes(path.basename(file))?'\n'+bootstrap:'')});
    }
    if(url.pathname==='/firebase-config.js'){
      return route.fulfill({contentType:'text/javascript',body:bootstrap});
    }
    if(url.hostname==='b3-games-default-rtdb.firebaseio.com'){
      url.protocol='http:';url.host=`127.0.0.1:${DB_PORT}`;url.searchParams.set('ns',PROJECT);
      const response=await route.fetch({url:url.href});
      return route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':origin()}});
    }
    if(url.hostname==='us-central1-b3-games.cloudfunctions.net'){
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':origin(),'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'authorization,content-type'}});
      const syntheticFunctions:Record<string,unknown>={
        generateTranslationChunks:{levels:[{chunks:[{hebrew:'וַיֵּרָ֤א אֵלָיו֙',english:['appeared to him'],posukNum:1}]}]},
        generateComprehensionQuestions:{items:[{question:'What happened to Abraham?',expectedAnswer:'Hashem appeared to him.',answerHebrewPhrases:['וַיֵּרָ֤א אֵלָיו֙'],answerWordSets:[[0,1]]}]},
        privateMediaUrl:{url:'data:audio/webm;base64,AA=='},
      };
      const functionName=path.basename(url.pathname);
      if(functionName in syntheticFunctions)return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(syntheticFunctions[functionName]),headers:{'access-control-allow-origin':origin(),'access-control-allow-headers':'authorization,content-type'}});
      try{
        const response=await route.fetch({url:`http://127.0.0.1:${FUNCTIONS_PORT}/${PROJECT}/us-central1/${path.basename(url.pathname)}`,headers:{...req.headers(),origin:'https://funtorahtools.com'}});
        if(!response.ok())failed.push(`${response.status()} ${url.pathname}`);
        return route.fulfill({response,headers:{...response.headers(),'access-control-allow-origin':origin(),vary:'Origin'}});
      }catch(error){
        // A page can close while a synthetic emulator request is still in flight.
        // Playwright disposes its route context during teardown; that is not an app failure.
        if(/request context disposed|target closed/i.test(String(error)))return;
        throw error;
      }
    }
    if(['fonts.googleapis.com','fonts.gstatic.com'].includes(url.hostname))return route.fulfill({status:204,body:''});
    if(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))return route.continue();
    failed.push('Unexpected external request: '+url.origin+url.pathname);return route.abort();
  });
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('requestfailed',r=>{if(!r.failure()?.errorText.includes('ERR_ABORTED'))failed.push('FAILED '+r.url());});
}
