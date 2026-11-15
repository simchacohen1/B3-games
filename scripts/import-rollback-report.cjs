#!/usr/bin/env node
'use strict';
// Issue #706: read-only rollback report from a database export.
//
//   firebase database:get / --project <project> > export.json   (owner only)
//   node scripts/import-rollback-report.cjs export.json <outDir> [--legacy from,to,uid | --batch imp_xxx]
//
// Runs the SAME classification code the server uses (student-rollback-core),
// against a local JSON file. It never connects to Firebase and never writes to
// it. With no --legacy/--batch it reports every import run it can find.
// The output contains student names and ids: keep it private, never commit it.
const fs=require('node:fs'),path=require('node:path');
const {buildManifest,legacyRuns}=require('../backend/functions/student-rollback-core.cjs');

const [file,outDir,flag,arg]=process.argv.slice(2);
if(!file||!outDir){console.error('usage: import-rollback-report.cjs export.json outDir [--legacy from,to,uid | --batch id]');process.exit(2);}
const tree=JSON.parse(fs.readFileSync(file,'utf8'));
const get=async p=>{const v=p.split('/').filter(Boolean).reduce((o,k)=>o?.[k],tree);return v===undefined?null:v;};
const store={get,update:async()=>{throw new Error('read-only report');},keys:async p=>Object.keys(await get(p)||{})};

const csvCell=v=>{v=String(v??'');return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
const iso=t=>t?new Date(t).toISOString():'';
(async()=>{
 fs.mkdirSync(outDir,{recursive:true});
 const classes=await get('b3Games/workspaces/b3-2026/classes')||{};
 let sources;
 if(flag==='--batch')sources=[{batchId:arg}];
 else if(flag==='--legacy'){const [from,to,uid]=arg.split(',');sources=[{legacy:{from:Number(from),to:Number(to),createdBy:uid}}];}
 else sources=legacyRuns(classes).map(r=>({legacy:{from:r.from,to:r.to,createdBy:r.uid}}));
 const all=[];
 for(const s of sources){
  const src=s.batchId?{kind:'batch',batchId:s.batchId}:{kind:'legacy',...s.legacy,uid:s.legacy.createdBy};
  const m=await buildManifest(store,src);
  const label=s.batchId||('run '+iso(src.from)+' to '+iso(src.to));
  console.log(label,JSON.stringify(m.summary));
  for(const r of m.records)all.push({run:label,manifestHash:m.manifestHash,...r,classNames:r.classIds.map(id=>classes[id]?.name||id)});
  fs.writeFileSync(path.join(outDir,'manifest-'+m.rollbackId+'.json'),JSON.stringify({source:m.source,rollbackId:m.rollbackId,manifestHash:m.manifestHash,summary:m.summary,records:m.records},null,1));
 }
 const header=['Run','Status','Student ID','Name','Classes','Created (UTC)','Reasons'];
 fs.writeFileSync(path.join(outDir,'rollback-records.csv'),[header,...all.map(r=>[r.run,r.status,r.studentId,r.name,r.classNames.join('; '),iso(r.createdAt),(r.reasons||[]).join(' | ')])].map(r=>r.map(csvCell).join(',')).join('\n'));
 console.log('wrote',all.length,'records to',outDir);
})().catch(e=>{console.error(e);process.exit(1);});
