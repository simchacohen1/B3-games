'use strict';
// Install BEFORE loading Firebase. No ambient production credentials or network.
const fs=require('node:fs'),path=require('node:path');
const PROJECT='demo-gallery-lab';
const ports={auth:9299,database:9200,storage:9399,site:8887};
const run=process.env.GALLERY_LAB_RUN||path.join(__dirname,'.run');fs.mkdirSync(run,{recursive:true});
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','GOOGLE_CLOUD_PROJECT','GOOGLE_APPLICATION_CREDENTIALS_JSON'])delete process.env[key];
Object.assign(process.env,{GCLOUD_PROJECT:PROJECT,GOOGLE_CLOUD_PROJECT:PROJECT,FIREBASE_AUTH_EMULATOR_HOST:`127.0.0.1:${ports.auth}`,FIREBASE_DATABASE_EMULATOR_HOST:`127.0.0.1:${ports.database}`,FIREBASE_STORAGE_EMULATOR_HOST:`127.0.0.1:${ports.storage}`});
function allowed(host){return ['localhost','127.0.0.1','::1','[::1]'].includes(String(host));}
const net=require('node:net'),original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let a=args[0];if(Array.isArray(a))a=a[0];
 const host=typeof a==='object'?a.host:(typeof args[1]==='string'?args[1]:'localhost');
 if(host&&!allowed(host)){fs.appendFileSync(path.join(run,'blocked-server.jsonl'),JSON.stringify({host,at:new Date().toISOString()})+'\n');throw Error('Gallery lab blocked nonlocal network: '+host);}
 return original.apply(this,args);
};
module.exports={PROJECT,ports,run,allowed};
