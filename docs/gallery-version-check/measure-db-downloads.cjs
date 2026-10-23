'use strict';
// Read-only snapshot of database downloads and key function call counts from Cloud Monitoring.
// Uses your own gcloud login; reads no student data and adds essentially no database traffic.
//
//   node docs/gallery-version-check/measure-db-downloads.cjs 72        (last 72 hours; default 48)
//
// Save the output before and after a release and compare the SAME weekday and class hours.
const {execSync}=require('node:child_process');
const hours=Number(process.argv[2])||48;
const project='b3-games';
const token=execSync('gcloud auth print-access-token',{encoding:'utf8'}).trim();
const val=p=>Number(p.value.int64Value??p.value.doubleValue??0);
async function series(filter,aligner,reducer,groupBy){
  const end=new Date(),start=new Date(end-hours*3600e3);
  const p=new URLSearchParams({filter,'interval.startTime':start.toISOString(),'interval.endTime':end.toISOString(),'aggregation.alignmentPeriod':'3600s','aggregation.perSeriesAligner':aligner});
  if(reducer)p.set('aggregation.crossSeriesReducer',reducer);
  (groupBy||[]).forEach(g=>p.append('aggregation.groupByFields',g));
  const out=[];let page='';
  do{
    if(page)p.set('pageToken',page);
    const r=await fetch(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries?`+p,{headers:{Authorization:'Bearer '+token}});
    const j=await r.json();if(j.error)throw new Error(j.error.message);
    out.push(...(j.timeSeries||[]));page=j.nextPageToken||'';
  }while(page);
  return out;
}
const hourKey=p=>new Date(new Date(p.interval.endTime)-1).toISOString().slice(0,13)+':00Z';
const byHour=s=>{const o={};s.points.forEach(p=>{o[hourKey(p)]=(o[hourKey(p)]||0)+val(p)});return o};
(async()=>{
  const db=m=>`metric.type="firebasedatabase.googleapis.com/${m}"`;
  const fn=name=>`metric.type="cloudfunctions.googleapis.com/function/execution_count" AND resource.labels.function_name="${name}"`;
  const bytes=byHour((await series(db('network/sent_bytes_count'),'ALIGN_DELTA'))[0]||{points:[]});
  const watch=['classGalleryRead','privateMediaUrl','funTorahStudentAuth','classPointerShareAuth'];
  const calls={};
  for(const name of watch){const s=await series(fn(name),'ALIGN_DELTA','REDUCE_SUM');calls[name]=s[0]?byHour(s[0]):{};}
  const ops={};
  for(const s of await series(db('network/api_hits_count'),'ALIGN_DELTA'))ops[s.metric.labels.operation_type]=byHour(s);
  const hoursList=Object.keys(bytes).sort();
  const sum=o=>Object.values(o||{}).reduce((a,b)=>a+b,0);
  console.log(`Window: last ${hours} hours, ending ${new Date().toISOString()}`);
  console.log(`Database sent: ${(sum(bytes)/1e9).toFixed(2)} GB total`);
  for(const name of watch)console.log(`  calls  ${name.padEnd(22)} ${sum(calls[name])}`);
  for(const op of ['realtime_listen','realtime_get','rest_get','realtime_set'])console.log(`  ops    ${op.padEnd(22)} ${sum(ops[op])}`);
  console.log('\nHour (UTC)         GB   classGalleryRead  privateMediaUrl  listen');
  for(const h of hoursList)console.log(`${h}  ${(bytes[h]/1e9).toFixed(2).padStart(6)}  ${String(calls.classGalleryRead[h]||0).padStart(16)}  ${String(calls.privateMediaUrl[h]||0).padStart(15)}  ${String(ops.realtime_listen?.[h]||0).padStart(6)}`);
})().catch(e=>{console.error('Failed:',e.message);process.exit(1);});
