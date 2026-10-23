'use strict';
// Runs the real Gallery triggers and the real classGalleryRead against LOCAL Firebase emulators
// (database + functions + auth, demo project "demo-gallery"). Nothing here can reach production.
//
//   node docs/gallery-version-check/emulator-check.cjs
//
// Needs: Java (for the database emulator) and the firebase CLI. It copies the three gallery files into a
// temporary folder, links backend/functions/node_modules, and points the trigger at the demo database.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'../..');
const src=path.join(repo,'backend/functions');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gallery-emu-'));
const fnDir=path.join(tmp,'functions');
fs.mkdirSync(fnDir);
for(const f of ['class-gallery-read.js','class-gallery-meta.js','class-gallery-version.js'])fs.copyFileSync(path.join(src,f),path.join(fnDir,f));
// Only change: the emulator's database is named after the demo project, not b3-games-default-rtdb.
const vf=path.join(fnDir,'class-gallery-version.js');
const patched=fs.readFileSync(vf,'utf8').replace("instance:'b3-games-default-rtdb'","instance:'demo-gallery'");
if(patched===fs.readFileSync(vf,'utf8'))throw new Error('instance option not found; update this script');
fs.writeFileSync(vf,patched);
fs.writeFileSync(path.join(fnDir,'index.js'),[
  "exports.classGalleryRead=require('./class-gallery-read').classGalleryRead;",
  "exports.classGalleryVersionLegacy=require('./class-gallery-version').classGalleryVersionLegacy;",
  "exports.classGalleryVersionWorkspace=require('./class-gallery-version').classGalleryVersionWorkspace;"].join('\n'));
fs.writeFileSync(path.join(fnDir,'package.json'),JSON.stringify({name:'emu-functions',main:'index.js',engines:{node:'22'},dependencies:{'firebase-admin':'*','firebase-functions':'*'}}));
// Link (never copy) the installed packages. Set FUNCTIONS_NODE_MODULES if this checkout has none (e.g. a worktree).
const modules=process.env.FUNCTIONS_NODE_MODULES||path.join(src,'node_modules');
if(!fs.existsSync(path.join(modules,'firebase-admin')))throw new Error('No installed packages at '+modules+'. Run: npm --prefix backend/functions ci  (or set FUNCTIONS_NODE_MODULES)');
fs.symlinkSync(modules,path.join(fnDir,'node_modules'),'junction');
fs.writeFileSync(path.join(tmp,'database.rules.json'),'{"rules":{".read":true,".write":true}}');
fs.writeFileSync(path.join(tmp,'firebase.json'),JSON.stringify({functions:{source:'functions',codebase:'default'},database:{rules:'database.rules.json'},emulators:{database:{port:9000},functions:{port:5001},auth:{port:9099},ui:{enabled:false},singleProjectMode:true}}));
fs.copyFileSync(path.join(__dirname,'emulator-e2e.cjs'),path.join(tmp,'e2e.cjs'));
// The temp folder path has no spaces, so a single command string is safe on Windows and elsewhere.
const cmd='firebase emulators:exec --config "'+path.join(tmp,'firebase.json')+'" --project demo-gallery --only functions,database,auth "node '+path.join(tmp,'e2e.cjs')+'"';
const r=spawnSync(cmd,{stdio:'inherit',shell:true});
// Remove the link itself first so cleanup can never reach into the real node_modules.
try{fs.rmdirSync(path.join(fnDir,'node_modules'));}catch(e){}
fs.rmSync(tmp,{recursive:true,force:true});
process.exit(r.status||0);
