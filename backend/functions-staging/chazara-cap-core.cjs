'use strict';
// Server-side daily cap for Chazara points.
//
// The Chazara page limits a student to 2 Chazaras per posuk per day, but that
// limit lived only in the browser. A second tab, a second device, or a script
// could create as many events as it liked and every one became a point
// request (one student collected 35 recorded Chazaras on a single posuk in an
// hour). The cap now lives here, next to the point request, where a student
// cannot get around it.
//
// What counts toward the cap: this student's Chazara point requests for the
// same perek+posuk on the same school day (New York time) that are pending,
// being processed, or approved. Cancelled/rejected requests (including events
// the student deleted) free their slot, matching the page. Teacher-entered
// Chazaras are not capped.
const SR='studentRewards';
const MAX_PER_POSUK_PER_DAY=2;
const LOCK_MS=8000;
const CHAZARA_SOURCES=new Set(['chazara','chazara-recording']);
const COUNTED=new Set(['pending','processing','approved']);

function nyDay(ms){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
const posukId=(perek,posuk)=>`${perek==null?'':perek}_${posuk==null?'':posuk}`;
function requestMs(item){
  const n=Number(item?.createdAt);
  if(Number.isFinite(n)&&n>0)return n;
  const p=Date.parse(String(item?.createdAt||''));
  return Number.isFinite(p)?p:0;
}
function dayOf(item){return String(item?.chazaraDay||'')||nyDay(requestMs(item));}

// How many requests in `rows` ({requestId: item}) use up a slot.
function countUsed(rows,{perek,posuk,day,requestId}){
  let n=0;
  for(const [id,item] of Object.entries(rows||{})){
    if(!item||id===requestId)continue;
    if(!CHAZARA_SOURCES.has(String(item.source||'')))continue;
    if(item.teacherEntered===true)continue;
    if(!COUNTED.has(String(item.status||'pending')))continue;
    if(posukId(item.perek,item.posuk)!==posukId(perek,posuk))continue;
    if(dayOf(item)!==day)continue;
    n++;
  }
  return n;
}

// Checks (and, with lock:true, briefly serialises) a new Chazara request.
// Returns {ok:true,release()} or {ok:false,code,error,limit}. The caller must
// call release() once the request is saved (or failed).
//   store.get(path)       -> value at path
//   store.tx(path, fn)    -> RTDB-style transaction
//   store.range(prefix)   -> {key: value} for keys starting with prefix
async function guard({store,studentId,perek,posuk,requestId,keyOf,nowMs=Date.now(),dayMs=nowMs,lock=true}){
  const noop=()=>{};
  if(!studentId||!requestId)return {ok:false,code:400,error:'Missing Chazara details.',release:noop};
  // A retry of a request that already exists is always fine (createPendingRequest is idempotent).
  if(await store.get(`${SR}/pointRequests/${requestId}`))return {ok:true,release:noop,existing:true};
  let held=false;
  const lockPath=`${SR}/chazaraGate/${studentId}`;
  if(lock){
    const tx=await store.tx(lockPath,cur=>cur&&Number(cur.at)>nowMs-LOCK_MS?undefined:{at:nowMs});
    if(!tx||!tx.committed)return {ok:false,code:429,error:'Please wait a moment and try again.',release:noop};
    held=true;
  }
  const release=async()=>{if(held){held=false;try{await store.tx(lockPath,()=>null);}catch(_e){}}};
  try{
    const rows=await store.range(keyOf(`chazara_${studentId}_`));
    const day=nyDay(dayMs);
    const used=countUsed(rows,{perek,posuk,day,requestId});
    if(used>=MAX_PER_POSUK_PER_DAY){
      await release();
      return {ok:false,code:409,error:`Maximum ${MAX_PER_POSUK_PER_DAY} Chazaras for this Posuk today.`,limit:true,release:noop};
    }
    return {ok:true,release,day};
  }catch(err){await release();throw err;}
}

module.exports={guard,countUsed,nyDay,MAX_PER_POSUK_PER_DAY,LOCK_MS,CHAZARA_SOURCES};
