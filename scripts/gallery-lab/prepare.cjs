'use strict';
// Dependency bootstrap only: run before starting the local-only lab. Downloads
// official emulator binaries, never Firebase project data or account sessions.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const dir=process.env.FIREBASE_EMULATORS_PATH||path.join(os.homedir(),'.cache/firebase/emulators');
const binaries=[['firebase-database-emulator-v4.11.2.jar','2fd771101c0e1f7898c04c9204f2ce63'],['cloud-storage-rules-runtime-v1.1.3.jar','2ca11ec1193003bea89f806cc085fa25']];
(async()=>{fs.mkdirSync(dir,{recursive:true});for(const [name,md5] of binaries){const file=path.join(dir,name);if(fs.existsSync(file)&&crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')===md5)continue;const r=await fetch('https://storage.googleapis.com/firebase-preview-drop/emulator/'+name);if(!r.ok)throw Error('Download failed: '+r.status);const bytes=Buffer.from(await r.arrayBuffer());if(crypto.createHash('md5').update(bytes).digest('hex')!==md5)throw Error('Emulator checksum mismatch: '+name);fs.writeFileSync(file,bytes);console.log('Verified '+name)}})().catch(e=>{console.error(e);process.exitCode=1});
