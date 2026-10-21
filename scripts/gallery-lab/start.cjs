'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),net=require('node:net');
const ROOT=path.resolve(__dirname,'../..'),run=process.env.GALLERY_LAB_RUN||path.join(__dirname,'.run');fs.mkdirSync(run,{recursive:true});
const deps=path.resolve(__dirname,'node_modules');
const env={...process.env,NODE_PATH:deps,NODE_OPTIONS:`--require=${path.join(__dirname,'isolation.cjs')}`,CI:'1',FIREBASE_CLI_DISABLE_UPDATE_CHECK:'1',GALLERY_LAB_RUN:run};
for(const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy','FIREBASE_TOKEN','GOOGLE_APPLICATION_CREDENTIALS'])delete env[k];
const children=[];let stopping=false;
function launch(name,args){const fd=fs.openSync(path.join(run,name+'.log'),'w');const child=spawn(process.execPath,args,{cwd:ROOT,env,stdio:['ignore',fd,fd]});children.push(child);if(name==='emulators'||name==='server')child.on('exit',code=>{if(!stopping){console.error(name+' exited unexpectedly ('+code+'); lab tests invalidated');stop();process.exitCode=1;}});return child;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function isUp(n){return new Promise(r=>{const s=net.connect(n,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false))})}
async function port(n){for(let i=0;i<90;i++){const ok=await new Promise(r=>{const s=net.connect(n,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true)});s.once('error',()=>r(false))});if(ok)return;await sleep(500)}throw Error('Port '+n+' did not start. Read .run logs.');}
function stop(){stopping=true;for(const c of children)c.kill('SIGTERM');}process.on('SIGTERM',stop);process.on('SIGINT',()=>{stop();process.exit()});
(async()=>{
 for(const p of [9299,9200,9399,9440,9450,8887])if(await isUp(p))throw Error('Refusing to reuse occupied lab port '+p);
 launch('emulators',[path.join(deps,'firebase-tools/lib/bin/firebase.js'),'emulators:start','--config','firebase.gallery-lab.json','--only','auth,database,storage','--project','demo-gallery-lab']);
 for(const p of [9299,9200,9399])await port(p);
 const seed=launch('seed',[path.join(__dirname,'seed.cjs')]);await new Promise((resolve,reject)=>seed.on('exit',code=>code===0?resolve():reject(Error('Seed failed'))));
 launch('server',[path.join(__dirname,'server.cjs')]);await port(8887);console.log('Isolated Gallery lab ready: http://127.0.0.1:8887/_lab/login');if(process.argv.includes('--render-probe')){const test=launch('render-probe',[path.join(__dirname,'render-probe.cjs')]);test.on('exit',code=>{stop();process.exitCode=code;});}if(process.argv.includes('--smoke')){const test=launch('media-smoke',[path.join(__dirname,'media-smoke.cjs')]);test.on('exit',code=>{stop();process.exitCode=code;});}if(process.argv.includes('--verify')){const test=launch('verify',[path.join(__dirname,'verify.cjs')]);test.on('exit',code=>{stop();process.exitCode=code;});}
})().catch(e=>{console.error(e);stop();process.exitCode=1});
