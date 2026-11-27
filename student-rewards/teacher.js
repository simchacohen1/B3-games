// PERSONAL + CLASS REWARDS MODEL - 2026-09-25
(function(){
'use strict';
const C=window.StudentRewardsCommon;
const {db,auth}=C.ensureFirebase();
const ROOT=C.ROOT, ADMIN=C.ADMIN_EMAIL;
const OWNER_NAV=["Today","Students","Prize Store","Settings"];
// Teachers other than the owner award points for their own classes through the
// studentRewardsTeacher backend; owner-only settings stay with the owner.
const TEACHER_NAV=["Today","Students","Prize Store","Settings"];
let NAV=OWNER_NAV;
// Old tab names (links from other pages, bookmarks) open the place the content moved to.
const TAB_ALIASES={"Today":["Today"],"Overview":["Today"],"Daily Points":["Today"],"Approvals":["Today"],"Students":["Students"],"Points Dashboard":["Students"],"Reports":["Students","reports"],"Prize Store":["Prize Store"],"Rewards":["Prize Store"],"Settings":["Settings"],"Categories":["Settings","categories"],"Comments":["Settings","comments"],"People & Classes":["Settings","classes"]};
const TEACHER_API="https://us-central1-b3-games.cloudfunctions.net/studentRewardsTeacher";
async function teacherApi(action,extra={}){
  const token=await auth.currentUser.getIdToken();
  const response=await fetch(TEACHER_API,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({action,...extra})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||("HTTP "+response.status));
  return data;
}
// Classes made in Teacher Center run their own prize store; ET/WT and older
// classes share the main store.
function isTeacherStore(classId){const c=state.root?.classes?.[classId];return Boolean(c&&c.b3ClassId&&!["et","wt"].includes(String(c.b3ClassId)))}
function itemInStore(item,classId=state.classId){return item&&(isTeacherStore(classId)?item.ownerClassId===classId:!item.ownerClassId)}
function classStoreOpen(classId=state.classId){if(isTeacherStore(classId))return state.root?.settings?.classStoreEnabled?.[classId]===true;const v=state.root?.settings?.rewardStoreEnabled;return v===true||String(v)==="true"}
// In teacher mode, store edits go to the backend, which checks every change.
const teacherDb={ref(path){
  const send=async updates=>{await teacherApi("storeWrite",{classId:state.classId,updates});await loadRoot();render()};
  return {
    key:db.ref().push().key,
    set:v=>send({[path]:v}),
    remove:()=>send({[path]:null}),
    update:obj=>send(path?Object.fromEntries(Object.entries(obj).map(([k,v])=>[path+"/"+k,v])):obj),
    push:()=>({key:db.ref().push().key})
  };
}};
function sdb(){return state.teacherMode?teacherDb:db}
const REQUESTED_TAB=new URLSearchParams(window.location.search).get("tab");
// Opened from the teacher home page as ?class=<id> (a site class id); pick the matching rewards class.
const REQUESTED_CLASS=new URLSearchParams(window.location.search).get("class")||"";
function requestedClassId(){if(!REQUESTED_CLASS)return "";const list=activeClasses();return (list.find(c=>c.id===REQUESTED_CLASS)||list.find(c=>String(state.root?.classes?.[c.id]?.b3ClassId||"")===REQUESTED_CLASS))?.id||""}
const REQUESTED_STUDENT=new URLSearchParams(window.location.search).get("student")||"";
const START=(()=>{const a=TAB_ALIASES[REQUESTED_TAB]||TAB_ALIASES["Today"];return {tab:a[0],section:a[1]||""}})();
const ICONS={"Today":"★","Students":"♙","Prize Store":"◇","Settings":"⚙"};
const CLASS_REWARD_PRESETS=[
  {key:"gimkit",name:"Gimkit",icon:"🎯"},
  {key:"kahoot",name:"Kahoot",icon:"❓"},
  {key:"video",name:"Video",icon:"🎬"},
  {key:"create-new-game",name:"Create a New Game",icon:"🎮"},
  {key:"extra-class-game-time",name:"Extra Class Time for a Game",icon:"⏰"},
  {key:"extra-recess",name:"Extra Recess",icon:"🏃"}
];
const GIMKIT_MODE_PRESETS=[
  {id:"fishtopia",name:"Fishtopia"},
  {id:"tag-domination",name:"Tag: Domination"},
  {id:"capture-the-flag",name:"Capture the Flag"},
  {id:"farmchain",name:"Farmchain"},
  {id:"snowbrawl",name:"Snowbrawl"},
  {id:"snowy-survival",name:"Snowy Survival"},
  {id:"one-way-out",name:"One Way Out"},
  {id:"dont-look-down",name:"Don't Look Down"},
  {id:"blastball",name:"Blastball"}
]
let state={root:null,user:null,tab:START.tab,settingsSection:START.tab==="Settings"&&START.section?START.section:"school",studentsSection:START.tab==="Students"?START.section:"",studentOpen:"",studentsAll:false,draftDirty:false,classId:"",date:C.schoolDateString(),draft:{},awardDraft:{},absent:new Set(),selectedId:"",pointClassId:"all",pointStudent:"all",pointRange:"30",pointType:"all",pointStatus:"all",pointSearch:""};
const $=s=>document.querySelector(s), esc=C.escapeHtml;
function vals(o){return o&&typeof o==="object"?Object.values(o):[]}
// One clear name per class: the two big classes are always "B3 ET" and "B3 WT", and an empty duplicate class
// (for example the old "ET" shell) is hidden from the pickers instead of showing the same name twice.
function normalizeClassNames(root){
  for(const c of vals(root?.classes)){
    const link=String(c.b3ClassId||"").toLowerCase();let n=String(c.name||c.id||"").trim();
    if(link==="et"||link==="wt")n="B3 "+link.toUpperCase();else n=n.replace(/^class\s+(?=b3\b)/i,"");
    c.name=n;
  }
}
function allActiveClasses(){return C.activeClasses(state.root||{})}
function activeClasses(){const all=allActiveClasses(),withStudents=all.filter(c=>C.classRoster(state.root||{},c.id).length);return withStudents.length?withStudents:all}
// Every change to a balance goes through here: it never works from a balance that has not loaded yet
// (treating it as 0 once turned 122 points into -5), and a negative change never raises a negative balance.
async function changeBalance(sid,delta,{clamp=false}={}){
  const ref=db.ref(`${ROOT}/students/${sid}/rewardBalance`);
  const known=(await ref.once("value")).val();
  let before=0,applied=0;
  const tx=await ref.transaction(cur=>{
    if(cur===null&&known!==null)return null;
    const old=Number(cur||0);let next=old+delta;
    if(clamp&&delta<0)next=Math.max(Math.min(old,0),next);
    before=old;applied=next-old;return next;
  });
  return {committed:tx.committed,applied,before,balanceAfter:Number(tx.snapshot.val()||0)};
}
function roster(){return C.classRoster(state.root||{},state.classId)}
function pointsRoster(){
  if(state.pointClassId!=="all")return C.classRoster(state.root||{},state.pointClassId);
  const byId=new Map();
  for(const c of activeClasses())for(const s of C.classRoster(state.root||{},c.id))byId.set(s.id,s);
  return [...byId.values()].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||"")));
}
function pointsClassLabel(){
  if(state.pointClassId==="all")return "All Classes";
  return state.root?.classes?.[state.pointClassId]?.name||"All Classes";
}
function pointsStudentClassLabel(studentId){
  const names=activeClasses().filter(c=>C.classRoster(state.root||{},c.id).some(s=>s.id===studentId)).map(c=>c.name);
  return names.join(" / ");
}
function categories(){return C.activeCategories(state.root||{})}
function cls(){return state.root?.classes?.[state.classId]||null}
function initials(name){return String(name||"SC").trim().split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()}
function toast(msg,type="ok"){C.toast(msg,type)}
function now(){return new Date().toISOString()}
const DAY_MS=24*60*60*1000;
function timeMs(value){
  if(typeof value==="number"&&Number.isFinite(value))return value;
  const n=Number(value);if(Number.isFinite(n)&&n>0)return n;
  const p=Date.parse(String(value||""));return Number.isFinite(p)?p:0;
}
function cooldownDaysValue(value){const n=Number(value||0);return Number.isFinite(n)&&n>0?n:0}
function cooldownText(until){
  const ms=Math.max(0,timeMs(until)-Date.now()),mins=Math.max(1,Math.ceil(ms/60000)),days=Math.floor(mins/1440),hours=Math.floor((mins%1440)/60);
  if(days>=7){const weeks=Math.floor(days/7),rem=days%7;return `${weeks} week${weeks===1?"":"s"}${rem?`, ${rem} day${rem===1?"":"s"}`:""}`}
  if(days>=1)return `${days} day${days===1?"":"s"}${hours?`, ${hours} hour${hours===1?"":"s"}`:""}`;
  if(hours>=1){const rem=mins%60;return `${hours} hour${hours===1?"":"s"}${rem?`, ${rem} min`:""}`}
  return `${mins} min`;
}
function personalCooldownInfo(item){
  const days=cooldownDaysValue(item?.cooldownDays),until=timeMs(item?.cooldownUntil),cooling=days>0&&until>Date.now();
  return {days,until,cooling,label:cooling?`Available again in ${cooldownText(until)}`:(days?`Cooldown: ${days} day${days===1?"":"s"}`:"No cooldown")};
}
function isGimkitClassReward(item){const id=String(item?.id||"").toLowerCase(),name=String(item?.name||"").trim().toLowerCase();return item?.modeVotingEnabled===true||id.includes("gimkit")||name==="gimkit"}
function gimkitModeId(name){return String(name||"mode").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"mode"}
function gimkitModesForItem(item){
  const raw=item?.modes;let modes=[];
  if(Array.isArray(raw))modes=raw.map((m,i)=>({id:String(m?.id||gimkitModeId(m?.name||`mode-${i+1}`)),name:String(m?.name||"").trim(),active:m?.active!==false}));
  else if(raw&&typeof raw==="object")modes=Object.entries(raw).map(([key,m])=>({id:String(m?.id||key),name:String(m?.name||key).trim(),active:m?.active!==false}));
  modes=modes.filter(m=>m.active!==false&&m.name);
  if(!modes.length)modes=GIMKIT_MODE_PRESETS.map(m=>({...m,active:true}));
  const seen=new Set();return modes.filter(m=>{if(seen.has(m.id))return false;seen.add(m.id);return true});
}
function modePoints(n){const x=Number(n)||0;return Number.isInteger(x)?String(x):x.toFixed(1).replace(/\.0$/,"")}
function gimkitTeacherModesHTML(g){
  if(!g?.modeVoting)return "";
  return `<div class="gimkit-mode-race"><div class="gimkit-mode-race-head"><b>🎮 Gimkit Mode Race</b><span>First bar to ${g.goal} ★ wins</span></div>${(g.modes||[]).map(m=>`<div class="gimkit-mode-row"><div><strong>${esc(m.name)}</strong><small>${m.voters} voter${m.voters===1?"":"s"}</small></div><div class="gimkit-mode-bar"><i style="width:${m.pct}%"></i></div><b>${modePoints(m.total)} / ${g.goal} ★</b></div>`).join("")}${g.lastWinner?`<p class="gimkit-last-winner">Last winner: <strong>${esc(g.lastWinner.name||g.lastWinner.id||"Gimkit mode")}</strong></p>`:""}</div>`;
}
function scoreFor(s){return C.cumulativeProgress(C.allProgressRows(state.root,s.id,state.classId))??100}
function currentStudent(){const r=roster();return r.find(s=>s.id===state.selectedId)||r[0]||null}
function getRedemptions(){const out=[];for(const [sid,rows] of Object.entries(state.root?.redemptionsByStudent||{}))for(const [key,item] of Object.entries(rows||{}))out.push({sid,key,item});return out.sort((a,b)=>String(b.item.requestedAt||"").localeCompare(String(a.item.requestedAt||"")))}
function getActivityPointRequests(){
  return Object.entries(state.root?.pointRequests||{})
    .map(([id,item])=>({id,item:item||{}}))
    .filter(x=>!state.classId || !x.item.classId || x.item.classId===state.classId)
    .sort((a,b)=>(Number(b.item.createdAt)||0)-(Number(a.item.createdAt)||0));
}
// Posuk Practice 100% milestones are automatic and never wait in this queue
// (shared rule in ../approval-queue.js, also used by the homepage and Chazara page).
function approvalQueueRules(){return window.FunTorahApprovalQueue||{needsManualApproval:i=>i?.status==="pending"&&!["reading100","translation100","understand100"].includes(String(i?.source||"")),isPendingAutomatic:i=>i?.status==="pending"&&["reading100","translation100","understand100"].includes(String(i?.source||""))}}
function pendingActivityPointRequests(){const Q=approvalQueueRules();return getActivityPointRequests().filter(x=>x.item.status==="pending"&&Q.needsManualApproval(x.item))}
let automaticPointSweepRunning=false;
async function sweepAutomaticPosukPoints(){
  if(automaticPointSweepRunning)return;
  const Q=approvalQueueRules(), ids=getActivityPointRequests().filter(x=>Q.isPendingAutomatic(x.item)).map(x=>x.id);
  if(!ids.length)return;
  automaticPointSweepRunning=true;
  try{for(const id of ids)await approveActivityPoint(id,true)}
  catch(err){console.warn("Automatic Posuk point approval failed",err)}
  finally{automaticPointSweepRunning=false}
}
function waitingStoreCount(){return getRedemptions().filter(x=>x.item.status==="pending"||x.item.status==="ready").length+pendingRefundRequests().length}
function pendingCount(){return waitingStoreCount()+pendingActivityPointRequests().length}
// REFUND REQUESTS - 2026-10-08
// Students ask for points back on any purchase or class contribution; nothing
// moves until the owner approves. Stored at refundRequests/<studentId>/<itemKey>.
function pendingRefundRequests(){
  if(state.teacherMode)return [];
  const out=[];
  for(const [sid,rows] of Object.entries(state.root?.refundRequests||{}))for(const [key,item] of Object.entries(rows||{}))if(item&&(item.status==="pending"||item.status==="processing"))out.push({sid,key,item});
  return out.sort((a,b)=>timeMs(a.item.requestedAt)-timeMs(b.item.requestedAt));
}
function refundItemInfo(sid,key,kind){
  if(kind==="contribution"){
    const c=state.root?.classRewardContributionsByStudent?.[sid]?.[key]||null;
    return {record:c,amount:Math.abs(Number(c?.amount)||0),name:`${c?.rewardName||"Class reward"}${Array.isArray(c?.modeNames)&&c.modeNames.length?" — "+c.modeNames.join(", "):""}`,label:"Class contribution",classId:c?.classId||"",when:timeMs(c?.createdAt)};
  }
  const p=state.root?.redemptionsByStudent?.[sid]?.[key]||null;
  return {record:p,amount:Number(p?.cost)||0,name:state.root?.rewards?.[p?.rewardId]?.name||"Reward",label:`Personal reward · ${String(p?.status||"pending")}`,classId:"",when:timeMs(p?.requestedAt)};
}
function refundRequestRow(x){
  const s=state.root.students?.[x.sid]||{},info=refundItemInfo(x.sid,x.key,x.item.kind),when=timeMs(x.item.requestedAt),busy=x.item.status==="processing";
  return `<div class="activity-request"><em style="background:${esc(safeColor(s))}">${esc(s.initials||initials(s.name||"?"))}</em><span><strong>${esc(s.name||x.sid)}</strong><small>Refund request · ${esc(info.label)} · ${esc(info.name)}${info.classId?` · ${esc(pointClassName(info.classId))}`:""}${when?` · asked ${esc(new Date(when).toLocaleString())}`:""}</small>${x.item.reason?`<small>“${esc(x.item.reason)}”</small>`:""}${x.item.error?`<small style="color:#b42318">${esc(x.item.error)}</small>`:""}</span><b class="activity-amount">+${info.amount} ★</b>${busy?`<small>Working…</small>`:`<button class="deny" data-refund-decline="${esc(x.sid)}|${esc(x.key)}" title="Decline refund">×</button><button class="approve" data-refund-approve="${esc(x.sid)}|${esc(x.key)}" title="Approve refund">✓</button>`}</div>`;
}
async function removeContributionFromRound(sid,key,item){
  const amount=Math.abs(Number(item.amount)||0),created=timeMs(item.createdAt);
  if(!item.classId||!item.rewardId||!amount)return "no-round";
  const others=Object.entries(state.root?.classRewardContributionsByStudent?.[sid]||{}).filter(([k,c])=>k!==key&&c&&!c.refundedAt&&c.classId===item.classId&&c.rewardId===item.rewardId).map(([,c])=>c);
  let outcome="not-in-round";
  await db.ref(`${ROOT}/classRewardRounds/${item.classId}/${item.rewardId}`).transaction(round=>{
    outcome="not-in-round";
    if(!round)return null;
    const started=timeMs(round.startedAt);
    if(started&&created&&created<started)return; // round was reset after this contribution
    if(!round.modeVoting&&(String(round.status||"")==="completed"||String(round.status||"")==="cooldown"||Number(round.totalContributed||0)>=Number(round.goalPoints||Infinity)))return; // prize already earned
    round.byStudent=round.byStudent||{};
    round.byStudent[sid]=Math.max(0,(Number(round.byStudent[sid])||0)-amount);
    if(round.modeVoting){
      const w=round.lastWinner||null,wonAt=timeMs(w?.wonAt||w?.at||w?.completedAt||w?.createdAt);
      round.modeTotals=round.modeTotals||{};
      for(const [mode,alloc] of Object.entries(item.modeAllocations||{})){
        if(w&&String(w.id||"")===mode&&(!wonAt||wonAt>=created))continue; // that bar already won and reset
        round.modeTotals[mode]=Math.max(0,(Number(round.modeTotals[mode])||0)-Number(alloc||0));
        const stillVoting=others.some(c=>timeMs(c.createdAt)>=(started||0)&&Number(c.modeAllocations?.[mode]||0)>0);
        if(!stillVoting&&round.modeVoters?.[mode])round.modeVoters[mode][sid]=null;
      }
      round.totalContributed=Math.max(0,...Object.values(round.modeTotals).map(v=>Number(v)||0));
    }else{
      round.totalContributed=Math.max(0,(Number(round.totalContributed)||0)-amount);
    }
    round.updatedAt=Date.now();outcome="removed";
    return round;
  });
  return outcome;
}
async function decideRefund(sid,key,decision){
  if(state.teacherMode){toast("Only the administrator can approve refunds.","error");return}
  const reqPath=`${ROOT}/refundRequests/${sid}/${key}`,req=state.root?.refundRequests?.[sid]?.[key];
  if(!req||req.status!=="pending"){toast("That refund request was already handled or withdrawn.","error");return}
  const info=refundItemInfo(sid,key,req.kind),s=state.root.students?.[sid]||{};
  if(decision==="decline"){
    if(!confirm(`Decline ${s.name||"this student"}’s refund request for ${info.name}? No points will move.`))return;
    const t=await db.ref(`${reqPath}/status`).transaction(cur=>cur==="pending"?"declined":undefined);
    if(!t.committed){toast("That refund request was already handled or withdrawn.","error");return}
    await db.ref(reqPath).update({reviewedAt:now(),reviewedBy:state.user.email,error:null});
    toast("Refund declined");return;
  }
  if(!info.record){toast("Could not find the original purchase or contribution.","error");return}
  if(!confirm(`Return ${info.amount} ★ to ${s.name||"this student"} for ${info.name}?`))return;
  const claim=await db.ref(`${reqPath}/status`).transaction(cur=>cur==="pending"?"processing":undefined);
  if(!claim.committed){toast("That refund request was already handled or withdrawn.","error");return}
  let marked=false;
  try{
    const stamp=now();let amount=info.amount,roundNote="";
    if(req.kind==="contribution"){
      const t=await db.ref(`${ROOT}/classRewardContributionsByStudent/${sid}/${key}/refundedAt`).transaction(cur=>cur?undefined:stamp);
      if(!t.committed)throw new Error("This contribution was already refunded.");
      marked=true;
      await db.ref(`${ROOT}/classRewardContributionsByStudent/${sid}/${key}`).update({refundedBy:state.user.email,refundedAmount:amount});
      const outcome=await removeContributionFromRound(sid,key,info.record);
      roundNote=outcome==="removed"?" and removed from the class bar":" (class bar left as is — that round already finished)";
    }else{
      const t=await db.ref(`${ROOT}/redemptionsByStudent/${sid}/${key}/status`).transaction(cur=>["declined","canceled","refunded"].includes(String(cur||"pending"))?undefined:"refunded");
      if(!t.committed)throw new Error("This purchase was already returned.");
      marked=true;
      await db.ref(`${ROOT}/redemptionsByStudent/${sid}/${key}`).update({refundedAt:stamp,refundedBy:state.user.email,statusBeforeRefund:String(info.record.status||"pending")});
      await returnStock(info.record);
    }
    let balanceAfter=null;
    const bal=await changeBalance(sid,amount);
    if(!bal.committed)throw new Error("Could not update the balance.");
    balanceAfter=bal.balanceAfter;
    await db.ref(reqPath).update({status:"approved",amount,balanceAfter,reviewedAt:stamp,reviewedBy:state.user.email,error:null});
    toast(`${amount} ★ returned to ${s.name||"student"}${roundNote}`);
  }catch(err){
    console.error(err);
    // If the original record was never touched, put the request back in the queue.
    await db.ref(reqPath).update(marked?{error:`Partly done — check balance: ${err.message||err}`}:{status:"pending",error:err.message||String(err)}).catch(()=>{});
    toast(err.message||String(err),"error");
  }
}
function savedTodayIds(){return new Set(roster().filter(s=>state.root?.dailyAwards?.[s.id]?.[state.classId]?.[state.date]).map(s=>s.id))}
function classAverage(){const r=roster();return r.length?Math.round(r.reduce((a,s)=>a+scoreFor(s),0)/r.length):0}
function safeColor(s){return s?.color||"#6849df"}
function setHeader(){
  const c=cls(), r=roster(), u=state.user;
  $("#className").textContent=c?.name||"No class";$("#classCount").textContent=`${r.length} students`;$("#classBadge").textContent=(c?.name||"—").replace("Class ","").slice(0,4);
  $("#headerClass").textContent=c?.name||"";$("#profileName").textContent=u?.displayName||"Simcha Cohen";
  const ini=initials(u?.displayName||"Simcha Cohen");$("#profileInitials").textContent=ini;$("#headerInitials").textContent=ini;
  $("#topDate").value=state.date;$("#dateLabel").textContent=state.date===C.schoolDateString()?"TODAY":"EDITING DATE";
  $("#datePretty").textContent=new Date(`${state.date}T12:00:00`).toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}
function buildNav(){
  const badge=n=>{const c=n==="Today"?pendingActivityPointRequests().length:n==="Prize Store"?waitingStoreCount():0;return c?`<mark>${c}</mark>`:""};
  $("#nav").innerHTML=NAV.map(n=>`<button data-tab="${esc(n)}"><i>${ICONS[n]}</i><span>${esc(n)}</span>${badge(n)}</button>`).join("");
  $("#nav").onclick=e=>{const b=e.target.closest("[data-tab]");if(!b)return;if(b.dataset.tab==="Students"&&state.tab==="Students")state.studentOpen="";state.tab=b.dataset.tab;render();window.scrollTo(0,0)};
}
function renderClassSelect(){
  const el=$("#classSelect"), rows=activeClasses().slice();
  const cur=state.root?.classes?.[state.classId];if(cur&&!rows.some(c=>c.id===cur.id))rows.push(cur);
  el.innerHTML=rows.map(c=>`<option value="${esc(c.id)}" ${c.id===state.classId?"selected":""}>${esc(c.name)}</option>`).join("");
  el.onchange=()=>{state.classId=el.value;state.selectedId="";state.studentOpen="";prepareDraft();render()};
}
const OWNER_ROOT_PATHS=["classes","students","categories","rewards","classRewardCatalog","settings","dailyRatings","dailyAwards","dailyAttendance","commentsByStudent","redemptionsByStudent","enrollments","pointAdjustments","audit","pointRequests","classRewardContributionsByStudent","refundRequests","classRewardRounds","dailyAwardLog"];
async function loadRoot(){
  if(state.teacherMode){state.root=(await teacherApi("load")).root||{};}
  else{
    // Firebase cost (#51): this owner view re-reads all of these collections every 30 seconds.
    // A plain read downloads the whole collection again each time. Holding each path open
    // keeps a live copy in the page, so the database sends only what actually changed and the
    // 30-second reads below are answered from that copy. Same data on screen, same refresh.
    if(!state.ownerPathsHeld){state.ownerPathsHeld=true;const noSync=()=>{};for(const path of OWNER_ROOT_PATHS)db.ref(`${ROOT}/${path}`).on("value",noSync,noSync);}
    const adminRead=path=>db.ref(`${ROOT}/${path}`).once("value").then(s=>s.val());
    const paths=Object.fromEntries(OWNER_ROOT_PATHS.map(path=>[path,path]));
    const entries=await Promise.all(Object.entries(paths).map(async([key,path])=>[key,await adminRead(path)]));
    state.root=Object.fromEntries(entries.map(([key,value])=>[key,value||{}]));
  }
  normalizeClassNames(state.root);
  if(!state.classId||!state.root.classes?.[state.classId]?.active){
    const list=activeClasses(),names={};list.forEach(c=>{names[c.id]=c.name});
    const wanted=requestedClassId();
    state.classId=await B3ClassGate.choose({ids:list.map(c=>c.id),names,requested:wanted||"-"});
  }
  if(!state.draftDirty)prepareDraft();renderClassSelect();setHeader();buildNav();
  setTimeout(()=>{sweepAutomaticPosukPoints()},0);
}
async function ensureRewardModelV2(){
  if(state.root?.settings?.rewardModelV2Seeded===true)return false;
  const updates={}, norm=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const existingRewards=Object.entries(state.root?.rewards||{}), existingClass=Object.entries(state.root?.classRewardCatalog||{});
  const classNames=new Set(CLASS_REWARD_PRESETS.map(x=>norm(x.name)));
  for(const preset of CLASS_REWARD_PRESETS){
    const classMatch=existingClass.find(([,r])=>norm(r?.name)===norm(preset.name));
    const cid=classMatch?.[0]||`class-incentive-${preset.key}`, oldClass=classMatch?.[1]||{};
    const oldCost=Number(oldClass.cost||0), perStudent=Number(oldClass.costPerStudent||0)||((oldCost===1000||!oldCost)?100:Math.max(1,Math.round(oldCost/10)));
    updates[`${ROOT}/classRewardCatalog/${cid}`]={...oldClass,id:cid,name:preset.name,icon:preset.icon,costPerStudent:perStudent,active:true,available:oldClass.available!==false};
  }
  for(const [rid,reward] of existingRewards){
    if(classNames.has(norm(reward?.name))){
      updates[`${ROOT}/rewards/${rid}/active`]=false;
      updates[`${ROOT}/rewards/${rid}/rewardType`]="class-migrated";
    }else if(!reward?.rewardType){
      updates[`${ROOT}/rewards/${rid}/rewardType`]="personal";
    }
  }
  for(const [cid,item] of existingClass){
    if(norm(item?.name)==="chat in zoom")updates[`${ROOT}/classRewardCatalog/${cid}/active`]=false;
  }
  updates[`${ROOT}/settings/rewardModelV2Seeded`]=true;
  await db.ref().update(updates);
  return true;
}
function subscribe(){if(state.teacherMode){clearInterval(state.pollTimer);state.pollTimer=setInterval(async()=>{if(document.hidden||state.pollChecking)return;state.pollChecking=true;try{await loadRoot();if(state.tab!=="Today")render()}catch(e){console.warn(e)}finally{state.pollChecking=false}},30000);return}clearInterval(state.pollTimer);state.pollTimer=setInterval(async()=>{if(document.hidden||state.pollChecking)return;state.pollChecking=true;try{await loadRoot();if(state.tab!=="Today")render()}catch(e){console.warn(e)}finally{state.pollChecking=false}},30000)}
function prepareDraft(){
  if(!state.root||!state.classId)return;state.draftDirty=false;state.draft={};state.awardDraft={};state.absent=new Set();
  for(const s of roster()){
    const att=state.root.dailyAttendance?.[s.id]?.[state.classId]?.[state.date];if(att?.status==="absent")state.absent.add(s.id);
    const saved=state.root.dailyRatings?.[s.id]?.[state.classId]?.[state.date];
    const prior=C.latestRatings(state.root,s.id,state.classId,state.date);
    const source=saved||prior.ratings||{};
    for(const cat of categories()){const found=vals(source).find(r=>r.category===cat.name);state.draft[`${s.id}|${cat.name}`]=found?.rating||"Good"}
  }
}
function isSavedDay(){return roster().some(s=>state.root?.dailyAwards?.[s.id]?.[state.classId]?.[state.date])}
function render(){if(!state.root||!state.user)return;setHeader();buildNav();document.querySelectorAll("#nav [data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===state.tab));const p=$("#page");
  if(state.tab==="Today")p.innerHTML=todayPage();
  if(state.tab==="Students")p.innerHTML=studentsPage();
  if(state.tab==="Prize Store")p.innerHTML=prizeStorePage();
  if(state.tab==="Settings")p.innerHTML=settingsPage();
  bindPage();
}
function activityQueueHTML(){
  const pointReq=pendingActivityPointRequests();
  return pointReq.length?`<section class="activity-queue" id="activityQueue"><div class="activity-head"><div><h2>Points waiting for your OK</h2><p>Posuk Practice, Chazara and Rashi points. Nothing below has been added yet.</p></div><div class="activity-head-actions"><b>${pointReq.length}</b><button class="primary" id="approveAllActivity">Approve all</button></div></div>${pointReq.map(activityPointRow).join("")}</section>`:"";
}
function todayPage(){
  state.pointClassId=state.classId;
  const r=roster(),pts=pendingActivityPointRequests().length,store=waitingStoreCount(),saved=savedTodayIds().size,c=cls();
  const pretty=new Date(`${state.date}T12:00:00`).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});
  return `<section class="workspace today-page"><div class="workhead"><div><p class="eyebrow">${esc((c?.name||"CLASS").toUpperCase())} · ${esc(state.date===C.schoolDateString()?"TODAY":"EDITING "+state.date)}</p><h1>Today</h1><p>Give points to the class and score the day for <strong>${esc(c?.name||"your class")}</strong> — ${esc(pretty)}. Change the class or the date at the top.</p></div></div>
  <div class="today-strip"><button type="button" class="today-chip" data-go="Students"><b>${r.length}</b> students →</button><span class="today-chip ${saved?"ok":""}">${saved?`✓ Day saved for ${saved} of ${r.length}`:"Day not saved yet"}</span><button type="button" class="today-chip ${pts?"alert":""}" data-jump="activity"><b>${pts}</b> points waiting for your OK</button><button type="button" class="today-chip ${store?"alert":""}" data-go="Prize Store"><b>${store}</b> prize ${store===1?"request":"requests"} waiting →</button></div>
  ${quickAwardPanel()}
  ${activityQueueHTML()}
  ${daily()}</section>`;
}

function pointTime(value){
  if(typeof value==="number"&&Number.isFinite(value))return value;
  const n=Number(value);if(Number.isFinite(n)&&n>0)return n;
  const p=Date.parse(String(value||""));return Number.isFinite(p)?p:0;
}
function pointDateFromSchoolDate(date){const p=Date.parse(`${date}T12:00:00`);return Number.isFinite(p)?p:0}
function pointClassName(classId){return state.root?.classes?.[classId]?.name||classId||""}
function pointSourceGroup(source){
  const s=String(source||"");
  if(["reading100","translation100","understand100"].includes(s))return "posuk";
  if(["chazara","chazara-recording","chazara-remove","chazara-reject","shorashim-recording","shorashim-no-hints"].includes(s))return "chazara";
  if(s==="teacher-adjustment")return "teacher";
  return "activity";
}
function pointSourceLabel(source){
  const labels={reading100:"Posuk Practice · Reading 100%",translation100:"Posuk Practice · Translation 100%",understand100:"Posuk Practice · Understanding 100%",chazara:"Chazara",'chazara-recording':"Recorded Chazara",'chazara-remove':"Chazara removal",'chazara-reject':"Chazara approval reversed",'shorashim-recording':"Shorashim · Recorded Chazara",'shorashim-no-hints':"Shorashim · No Hints Challenge",'rashi-recording':"Rashi Letters · Recorded reading",'chayus-level':"Chayus Meter",'teacher-adjustment':"Teacher adjustment"};
  return labels[source]||String(source||"Activity points");
}
function allPointLedger(includeGaps=true){
  const r=pointsRoster(), rosterMap=new Map(r.map(s=>[s.id,s])), rows=[];
  const add=row=>{if(!row?.sid||!rosterMap.has(row.sid))return;const s=rosterMap.get(row.sid);rows.push({...row,studentName:row.studentName||s.name||row.sid,studentInitials:s.initials||initials(s.name),studentColor:safeColor(s)})};

  // Daily points. Read every class bucket for each current student so the ledger
  // can reconcile with the student's current point balance even after class moves.
  for(const s of r){
    for(const [cid,dates] of Object.entries(state.root?.dailyAwards?.[s.id]||{})){
      for(const [date,award] of Object.entries(dates||{})){
        const when=pointTime(award?.savedAt)||pointDateFromSchoolDate(date);
        for(const part of C.dailyAwardParts(award)){
          const label=part.category?`Daily Points · ${part.category}`:"Daily Points";
          add({id:`daily:${s.id}:${cid}:${date}${part.category?":"+C.categoryKey(part.category):""}`,sid:s.id,amount:part.points,when,source:"daily",sourceGroup:"daily",sourceLabel:label,reason:part.category?`${part.category} — ${part.rating} — ${C.formatDate(date)}`:`Daily Points — ${C.formatDate(date)}`,detail:pointClassName(cid),status:"posted",counts:true,classId:cid});
        }
      }
    }
  }

  // Posuk Practice, Chazara, and any other activity point requests.
  for(const [id,item0] of Object.entries(state.root?.pointRequests||{})){
    const item=item0||{}, sid=String(item.rewardStudentId||"");if(!rosterMap.has(sid))continue;
    const rawStatus=String(item.status||"pending"), approved=rawStatus==="approved", amount=Number(approved?(item.actualAmount??item.amount??0):(item.amount??0));
    const group=pointSourceGroup(item.source), when=pointTime(approved?(item.reviewedAt||item.createdAt):item.createdAt);
    const status=approved?"posted":rawStatus;
    add({id:`request:${id}`,sid,amount,when,source:item.source||"activity",sourceGroup:group,sourceLabel:pointSourceLabel(item.source),reason:item.reason||pointSourceLabel(item.source),detail:item.classId?pointClassName(item.classId):"",status,counts:approved,classId:item.classId||"",balanceAfter:approved?item.balanceAfter:null});
  }

  // Teacher-entered manual adjustments.
  for(const [id,item0] of Object.entries(state.root?.pointAdjustments||{})){
    const item=item0||{}, sid=String(item.studentId||"");if(!rosterMap.has(sid))continue;
    const amount=Number(item.amount||0);if(!amount)continue;
    add({id:`adjust:${id}`,sid,amount,when:pointTime(item.createdAt),source:"teacher-adjustment",sourceGroup:"teacher",sourceLabel:"Teacher adjustment",reason:item.reason||"Teacher adjustment",detail:item.classId?pointClassName(item.classId):"",status:"posted",counts:true,classId:item.classId||""});
  }

  // Prize Store purchases: points leave when the request is submitted. A declined
  // request creates a matching return so the visible ledger mirrors the real balance.
  for(const s of r){
    for(const [key,item0] of Object.entries(state.root?.redemptionsByStudent?.[s.id]||{})){
      const item=item0||{}, cost=Number(item.cost||0);if(!cost)continue;
      const rewardName=state.root?.rewards?.[item.rewardId]?.name||"Reward";
      const requested=pointTime(item.requestedAt);
      if(requested)add({id:`redeem:${s.id}:${key}:request`,sid:s.id,amount:-cost,when:requested,source:"reward-store",sourceGroup:"store",sourceLabel:"Prize Store",reason:`Reward requested — ${rewardName}`,detail:`${String(item.status||"requested")} · ${cost} ★`,status:"posted",counts:true});
      if(["declined","canceled","refunded"].includes(String(item.status||""))){
        const reviewed=pointTime(item.status==="refunded"?(item.refundedAt||item.reviewedAt):item.reviewedAt);
        if(reviewed)add({id:`redeem:${s.id}:${key}:return`,sid:s.id,amount:cost,when:reviewed,source:"reward-return",sourceGroup:"store",sourceLabel:"Prize Store",reason:`Points returned — ${rewardName}`,detail:item.status==="canceled"?"Canceled by student":item.status==="refunded"?"Refund approved by teacher":"Request declined",status:"posted",counts:true});
      }
    }
  }

  // Class reward contributions: points are spent immediately into a shared class goal.
  for(const s of r){
    for(const [key,item0] of Object.entries(state.root?.classRewardContributionsByStudent?.[s.id]||{})){
      const item=item0||{}, amount=Math.abs(Number(item.amount||0));if(!amount)continue;
      add({id:`class-contribution:${s.id}:${key}`,sid:s.id,amount:-amount,when:pointTime(item.createdAt),source:"class-reward-contribution",sourceGroup:"class",sourceLabel:"Class Reward",reason:`Class contribution — ${item.rewardName||"Class Reward"}`,detail:`${item.className||pointClassName(item.classId)} · ${amount} ★ contributed`,status:"posted",counts:true,classId:item.classId||"",balanceAfter:item.balanceAfter});
      if(item.refundedAt)add({id:`class-contribution:${s.id}:${key}:refund`,sid:s.id,amount:Math.abs(Number(item.refundedAmount??amount)),when:pointTime(item.refundedAt),source:"class-reward-refund",sourceGroup:"class",sourceLabel:"Class Reward",reason:`Points returned — ${item.rewardName||"Class Reward"}`,detail:"Refund approved by teacher",status:"posted",counts:true,classId:item.classId||""});
    }
  }

  // Older balances may predate the permanent history records. Show the difference
  // instead of hiding it so the teacher can immediately see why a balance does not reconcile.
  if(includeGaps){
    const sums={};for(const row of rows)if(row.counts)sums[row.sid]=(sums[row.sid]||0)+Number(row.amount||0);
    for(const s of r){
      const current=Number(s.rewardBalance||0), accounted=Number(sums[s.id]||0), gap=current-accounted;
      if(gap)add({id:`gap:${s.id}`,sid:s.id,amount:gap,when:0,source:"history-gap",sourceGroup:"gap",sourceLabel:"History gap",reason:"Balance not linked to a saved history record",detail:`Current balance ${current} ★ · saved ledger ${accounted} ★`,status:"needs-review",counts:true,isGap:true});
    }
  }
  decorateLedger(rows);
  // Calculate a running balance for each student. History gaps are treated as the
  // older opening balance, so the newest calculated balance lands on the live total.
  for(const s of r){
    let running=0;
    const posted=rows.filter(x=>x.sid===s.id&&x.counts).sort((a,b)=>(a.when||0)-(b.when||0)||String(a.id).localeCompare(String(b.id)));
    for(const row of posted){running+=Number(row.amount||0);row.runningBalance=running}
  }
  return rows.sort((a,b)=>(b.when||0)-(a.when||0)||String(a.studentName).localeCompare(String(b.studentName)));
}
// ---------- Undo (the history shows who did each change; Undo reverses it exactly and adds its own entry; nothing is deleted) ----------
// Adds "who", the undo choice and "undone" marks to the ledger rows, and one informational row for every Daily Points undo.
function decorateLedger(rows){
  const root=state.root||{};
  const byDay=new Map();
  for(const [sid,logs] of Object.entries(root.dailyAwardLog||{}))for(const log of Object.values(logs||{})){
    if(!log||!log.classId||!log.date)continue;
    const k=sid+"|"+log.classId+"|"+log.date;(byDay.get(k)||byDay.set(k,[]).get(k)).push(log);
  }
  for(const list of byDay.values())list.sort((a,b)=>String(a.savedAt).localeCompare(String(b.savedAt))||String(a.id).localeCompare(String(b.id)));
  const batchSize=(batchId,classId)=>{let n=0;for(const [sid,logs] of Object.entries(root.dailyAwardLog||{}))if(Object.values(logs||{}).some(l=>l&&l.batchId===batchId&&l.classId===classId&&l.kind==="save"&&!l.undoneAt))n++;return n};
  for(const row of rows){
    const id=String(row.id||"");
    if(id.startsWith("adjust:")){
      const key=id.slice(7),item=root.pointAdjustments?.[key]||{};
      row.by=item.teacherEmail||"";
      if(item.action==="undo"){row.sourceLabel="Undo";row.status="undo";row.sourceGroup="teacher"}
      else if(item.undoneBy){row.status="undone"}
      else if(Number(item.amount)){
        row.undo={kind:"adjust",id:key};
        if(item.batchId){const n=Object.values(root.pointAdjustments||{}).filter(x=>x&&x.batchId===item.batchId&&!x.undoneBy&&x.action!=="undo").length;if(n>1)row.batch={kind:"awardbatch",classId:item.classId,batchId:item.batchId,count:n}}
      }
    }else if(id.startsWith("request:")){
      const key=id.slice(8),item=root.pointRequests?.[key]||{};
      row.by=item.reviewedBy?(/^Automatic/i.test(item.reviewedBy)?"Automatic":item.reviewedBy):(item.status==="approved"?"Automatic":"");
      if(item.undoneBy)row.status="undone";
      else if(item.status==="approved"&&Number(item.actualAmount??item.amount))row.undo={kind:"request",id:key};
    }else if(id.startsWith("redeem:")){
      const [,sid,key,part]=id.split(":"),item=root.redemptionsByStudent?.[sid]?.[key]||{};
      row.prize=part==="return"?"refunded":({pending:"waiting",ready:"waiting",collected:"given",declined:"refunded",canceled:"refunded",refunded:"refunded"})[String(item.status||"pending")]||"waiting";
      if(part==="request"){
        row.by="Student";
        if(!["declined","canceled","refunded"].includes(String(item.status||"")))row.undo={kind:"purchase",studentId:sid,key};
      }else row.by=item.refundedBy||item.reviewedBy||"Student";
    }else if(id.startsWith("class-contribution:")){
      const parts=id.split(":"),csid=parts[1],ckey=parts[2],citem=root.classRewardContributionsByStudent?.[csid]?.[ckey]||{};
      if(parts[3]==="refund"){row.by=citem.refundedBy||"";row.prize="refunded"}
      else{row.by="Student";if(citem.refundedAt)row.prize="refunded";else if(!state.teacherMode)row.undo={kind:"contribution",studentId:csid,key:ckey};else row.undoHint="Ask the administrator to refund this"}
    }else if(id.startsWith("daily:")){
      const [,sid,cid,date]=id.split(":"),award=root.dailyAwards?.[sid]?.[cid]?.[date];
      row.by=award?.teacherEmail||"";
      const list=byDay.get(sid+"|"+cid+"|"+date)||[],latest=list[list.length-1];
      if(latest&&latest.kind==="save"&&!latest.undoneAt&&Number(award?.points||0)===Number(latest.after?.points||0)){
        row.undo={kind:"daily",classId:cid,studentId:sid,date};
        const n=latest.batchId?batchSize(latest.batchId,cid):0;
        if(n>1)row.batch={kind:"batch",classId:cid,batchId:latest.batchId,count:n};
      }else if(!list.length)row.undoHint="Saved before Undo existed: edit the day instead";
    }
  }
  // Every Daily Points undo is shown, so the history never hides that something was undone.
  const known=new Set(rows.map(r=>r.sid));
  for(const [sid,logs] of Object.entries(root.dailyAwardLog||{})){
    if(!known.has(sid))continue;
    for(const log of Object.values(logs||{})){
      if(!log||log.kind!=="undo")continue;
      const s=rows.find(r=>r.sid===sid);if(!s)continue;
      rows.push({id:`dailyundo:${sid}:${log.id}`,sid,amount:Number(log.appliedDelta)||0,when:pointTime(log.savedAt),source:"undo",sourceGroup:"daily",sourceLabel:"Undo",
        reason:`Undo — Daily Points ${C.formatDate(log.date)}`,detail:"The day was put back the way it was (already included in the Daily Points lines)",status:"logged",counts:false,classId:log.classId||"",by:log.teacherEmail||"",
        studentName:s.studentName,studentInitials:s.studentInitials,studentColor:s.studentColor});
    }
  }
}
function whoLabel(row){return row.isGap?"—":row.by||"—"}
function undoCell(row){
  if(row.status==="undone")return `<small class="points-undone">Undone</small>`;
  const out=[];
  if(row.undo&&row.undo.kind==="purchase")out.push(`<button type="button" class="points-undo refund" data-undo="${esc(JSON.stringify(row.undo))}" title="Give the points back for this purchase (and the stock). The refund is added to the history.">↩ Refund</button>`);
  else if(row.undo&&row.undo.kind==="contribution")out.push(`<button type="button" class="points-undo refund" data-refund-contribution="${esc(row.undo.studentId+"|"+row.undo.key)}" title="Give these points back to the boy. They come off the class bar if that round is still open, and the refund is added to the history.">↩ Refund</button>`);
  else if(row.undo)out.push(`<button type="button" class="points-undo" data-undo="${esc(JSON.stringify(row.undo))}" title="Reverse exactly this entry. The undo is added to the history.">↩ Undo</button>`);
  if(row.batch&&row.batch.kind==="awardbatch")out.push(`<button type="button" class="points-undo batch" data-undo="${esc(JSON.stringify({kind:"awardbatch",classId:row.batch.classId,batchId:row.batch.batchId}))}" title="Undo this whole award for ${row.batch.count} students">↩ Undo whole award (${row.batch.count})</button>`);
  else if(row.batch)out.push(`<button type="button" class="points-undo batch" data-undo="${esc(JSON.stringify({kind:"batch",classId:row.batch.classId,batchId:row.batch.batchId}))}" title="Undo this whole Daily Points save for ${row.batch.count} students">↩ Undo whole save (${row.batch.count})</button>`);
  if(!out.length&&row.undoHint)out.push(`<small class="points-undone">${esc(row.undoHint)}</small>`);
  return out.join(" ");
}
async function runUndo(spec){
  const whole=spec.kind==="batch"||spec.kind==="awardbatch",refund=spec.kind==="purchase";
  const question=spec.kind==="awardbatch"?"Undo this whole award? Every student in it who still has the points gets them taken back (anyone who already spent them is skipped and named). The undo is added to the history; nothing is deleted."
    :spec.kind==="batch"?"Undo this whole Daily Points save for the class? Each student's day goes back to how it was before. The undo is added to the history; nothing is deleted."
    :refund?"Refund this purchase? The points go back to the student, and the refund is added to the history. Nothing is deleted."
    :"Undo this entry? It is reversed exactly, and the undo is added to the history. Nothing is deleted.";
  if(!confirm(question))return;
  try{
    const result=await teacherApi("undo",spec);
    const skipped=(result.skipped||[]).map(x=>{const s=(state.root?.students||{})[x.studentId];return `${s?.name||x.studentId}: ${x.reason}`});
    toast(whole?`Undone for ${result.undone} student${result.undone===1?"":"s"}${skipped.length?` · skipped ${skipped.length}: ${skipped.join("; ")}`:""}`:refund?"Refunded. The history shows the refund.":"Undone. The history shows the undo.");
  }catch(err){toast(err.message,"error")}
  await loadRoot();render();
}
document.addEventListener("click",event=>{const button=event.target.closest&&event.target.closest("[data-undo]");if(!button)return;event.preventDefault();let spec=null;try{spec=JSON.parse(button.dataset.undo)}catch{}if(spec)runUndo(spec)});
function pointRangeStart(){
  if(state.pointRange==="all")return 0;
  const days=Math.max(1,Number(state.pointRange)||30), d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-(days-1));return d.getTime();
}
function filteredPointLedger(){
  const q=String(state.pointSearch||"").trim().toLowerCase(), start=pointRangeStart();
  return allPointLedger(true).filter(row=>{
    if(state.pointStudent!=="all"&&row.sid!==state.pointStudent)return false;
    if(state.pointType!=="all"&&row.sourceGroup!==state.pointType)return false;
    if(state.pointStatus!=="all"&&row.status!==state.pointStatus)return false;
    if(start&&row.when&&row.when<start&&!row.isGap)return false;
    if(q&&!`${row.studentName} ${row.reason} ${row.sourceLabel} ${row.detail||""} ${row.status}`.toLowerCase().includes(q))return false;
    return true;
  });
}
function formatPointWhen(row){
  if(row.isGap)return "Older / unknown";
  if(!row.when)return "Unknown";
  return new Date(row.when).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});
}
function redeemedPointsForStudent(studentId){
  let redeemed=0;
  for(const item0 of Object.values(state.root?.redemptionsByStudent?.[studentId]||{})){
    const item=item0||{}, cost=Number(item.cost||0), status=String(item.status||"requested").toLowerCase();
    if(cost>0&&status!=="declined"&&status!=="canceled"&&status!=="refunded")redeemed+=cost;
  }
  return redeemed;
}
// ---------- Quick award: the same points to several students (or the whole class) at once; the whole award can be undone in one click ----------
const QUICK_PRESETS=[1,5,10];
function quickState(){return state.quick||(state.quick={ids:new Set(),amount:5,custom:"",reason:"",whole:false})}
function quickInfo(){
  const q=quickState(),roster=pointsRoster(),c=String(q.custom||"").trim(),amount=c!==""?Number(c):q.amount;
  const count=q.whole?roster.length:roster.filter(s=>q.ids.has(s.id)).length;
  return {amount,count,roster,ok:state.pointClassId!=="all"&&Number.isInteger(amount)&&amount!==0&&Math.abs(amount)<=1000&&count>0};
}
function quickGoLabel(info){const q=quickState();return info.ok?`Give ${info.amount>0?"+":""}${info.amount} ★ to ${q.whole?"the whole class":info.count+" student"+(info.count===1?"":"s")}`:"Choose points and students"}
function quickAwardPanel(){
  if(state.pointClassId==="all")return `<section class="points-section quick-award"><div class="points-section-head"><div><h2>Quick award</h2><p>Choose a class above to give points to several students at once.</p></div></div></section>`;
  const q=quickState(),info=quickInfo();
  return `<section class="points-section quick-award"><div class="points-section-head"><div><h2>Quick award</h2><p>Give points to several students at once. It shows in the history below, and one click undoes the whole award.</p></div></div>
    <div class="qa-row"><span class="qa-label">Points</span>${QUICK_PRESETS.map(n=>`<button type="button" class="qa-preset ${!String(q.custom||"").trim()&&q.amount===n?"active":""}" data-qa-amount="${n}">+${n} ★</button>`).join("")}<input id="qaCustom" class="qa-input" type="number" step="1" placeholder="Other" value="${esc(q.custom)}" aria-label="Custom points"><input id="qaReason" class="qa-input qa-reason" type="text" maxlength="200" placeholder="Reason (e.g. Great davening)" value="${esc(q.reason)}" aria-label="Reason"></div>
    <div class="qa-row"><span class="qa-label">Who</span><button type="button" class="qa-preset ${q.whole?"active":""}" id="qaWhole">Whole class (${info.roster.length})</button><button type="button" class="qa-link" id="qaAll">Select all</button><button type="button" class="qa-link" id="qaNone">Clear</button></div>
    <div class="qa-students">${info.roster.map(s=>`<label class="qa-chip ${q.whole||q.ids.has(s.id)?"on":""}"><input type="checkbox" data-qa-student="${esc(s.id)}" ${q.whole||q.ids.has(s.id)?"checked":""} ${q.whole?"disabled":""}>${esc(s.name)}</label>`).join("")}</div>
    <div class="qa-row"><button type="button" class="primary" id="qaGo" ${info.ok?"":"disabled"}>${esc(quickGoLabel(info))}</button></div></section>`;
}
function refreshQuickAward(){
  const info=quickInfo(),go=document.querySelector("#qaGo");if(!go)return;
  go.disabled=!info.ok;go.textContent=quickGoLabel(info);
}
async function runQuickAward(){
  const q=quickState(),info=quickInfo();if(!info.ok)return;
  const who=q.whole?"the whole class":`${info.count} student${info.count===1?"":"s"}`,reason=q.reason.trim()||"Teacher award";
  if(!confirm(`Give ${info.amount>0?"+":""}${info.amount} ★ to ${who} for “${reason}”?\n\nYou can undo the whole award in one click from the history.`))return;
  try{
    const r=await teacherApi("awardBatch",{classId:state.pointClassId,amount:info.amount,reason,wholeClass:q.whole,studentIds:[...q.ids]});
    toast(`Gave ${info.amount>0?"+":""}${info.amount} ★ to ${r.awarded} student${r.awarded===1?"":"s"}${r.failed?.length?` · ${r.failed.length} could not be updated`:""}. Undo is in the history below.`);
    q.ids=new Set();q.whole=false;q.custom="";q.reason="";
  }catch(err){toast(err.message,"error")}
  await loadRoot();render();
}
function bindQuickAward(){
  const q=quickState(),$=s=>document.querySelector(s);
  document.querySelectorAll("[data-qa-amount]").forEach(b=>b.onclick=()=>{q.amount=Number(b.dataset.qaAmount);q.custom="";render()});
  if($("#qaCustom"))$("#qaCustom").oninput=e=>{q.custom=e.target.value;refreshQuickAward()};
  if($("#qaReason"))$("#qaReason").oninput=e=>{q.reason=e.target.value};
  if($("#qaWhole"))$("#qaWhole").onclick=()=>{q.whole=!q.whole;render()};
  if($("#qaAll"))$("#qaAll").onclick=()=>{q.whole=false;q.ids=new Set(pointsRoster().map(s=>s.id));render()};
  if($("#qaNone"))$("#qaNone").onclick=()=>{q.whole=false;q.ids=new Set();render()};
  document.querySelectorAll("[data-qa-student]").forEach(b=>b.onchange=()=>{b.checked?q.ids.add(b.dataset.qaStudent):q.ids.delete(b.dataset.qaStudent);b.closest(".qa-chip").classList.toggle("on",b.checked);refreshQuickAward()});
  if($("#qaGo"))$("#qaGo").onclick=runQuickAward;
}
function openStudent(id){state.studentOpen=id;state.pointClassId="all";state.pointStudent=id;state.pointRange="all";state.pointType="all";state.pointStatus="all";state.pointSearch="";state.tab="Students";render();window.scrollTo(0,0)}
function prizeState(status){const s=String(status||"pending");return ["declined","canceled","refunded"].includes(s)?"refunded":s==="collected"?"given":"waiting"}
function prizePill(kind){const label={waiting:"Waiting",given:"Given",refunded:"Refunded"}[kind]||kind;return `<span class="prize-pill ${esc(kind)}">${esc(label)}</span>`}
function studentsPage(){
  if(state.studentOpen&&state.root.students?.[state.studentOpen])return studentDetail(state.root.students[state.studentOpen]);
  state.studentOpen="";state.pointClassId=state.studentsAll?"all":state.classId;state.pointStudent="all";
  const r=pointsRoster(),ledger=allPointLedger(true),gaps=ledger.filter(x=>x.isGap),all=state.studentsAll;
  const latest={};for(const row of ledger)if(!row.isGap&&row.when&&!latest[row.sid])latest[row.sid]=row;
  const waiting={};for(const x of getRedemptions())if(x.item.status==="pending"||x.item.status==="ready")waiting[x.sid]=(waiting[x.sid]||0)+1;
  const total=r.reduce((a,s)=>a+Number(s.rewardBalance||0),0);
  return `<section class="workspace students-page"><div class="workhead"><div><p class="eyebrow">${esc(all?"ALL CLASSES":(cls()?.name||"CLASS").toUpperCase())}</p><h1>Students</h1><p>Every boy’s balance at a glance. Tap a boy to see where his points came from and where they went.</p></div><div class="workcontrols"><label class="pagepicker"><span>Show</span><select id="studentsScope"><option value="class" ${all?"":"selected"}>${esc(cls()?.name||"This class")}</option><option value="all" ${all?"selected":""}>All classes</option></select></label><div class="reportbuttons"><button id="pointsCsv">Export ALL points</button></div></div></div>
  ${gaps.length?`<div class="points-alert"><b>⚠ ${gaps.length} balance${gaps.length===1?"":"s"} contain older points without a saved reason.</b><span>Those show as “History gap” in the boy’s history.</span></div>`:""}
  <div class="students-bar"><input id="studentSearch" type="search" placeholder="Find a boy…" aria-label="Find a boy"><strong>${total} ★ across ${r.length} student${r.length===1?"":"s"}</strong></div>
  <div class="points-student-grid">${r.map(s=>{const bal=Number(s.rewardBalance)||0,last=latest[s.id],w=waiting[s.id]||0;return `<button class="points-student-card" data-student-card data-name="${esc(String(s.name||"").toLowerCase())}" data-open-student="${esc(s.id)}"><span class="points-student-top"><em style="background:${esc(safeColor(s))}">${esc(s.initials||initials(s.name))}</em><span><b>${esc(s.name)}</b><small>${all&&pointsStudentClassLabel(s.id)?`${esc(pointsStudentClassLabel(s.id))} · `:""}${last?`Latest: ${esc(last.reason)}`:"No saved activity yet"}</small></span></span><strong class="${bal<0?"neg":""}">${bal} ★</strong>${w?`<span class="chip-wait">${w} prize${w===1?"":"s"} waiting</span>`:""}</button>`}).join("")||`<div class="empty"><h3>No students in this class</h3><p>Add students under Settings → Classes.</p></div>`}</div>
  ${classSpendingOverviewHTML(r)}
  ${reportsSection()}</section>`;
}
function reportsSection(){
  const rows=reportRows();
  return `<details class="reports-box" ${state.studentsSection==="reports"?"open":""}><summary>Daily history report for ${esc(cls()?.name||"this class")} · ${rows.length} row${rows.length===1?"":"s"}</summary><div class="reportbuttons"><button id="csvBtn">Export CSV</button><button id="printBtn">Print / PDF</button></div><div class="historytable"><table><thead><tr><th>Student</th><th>Date</th><th>Attendance</th><th>Points</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.student)}</td><td>${esc(C.formatDate(r.date))}</td><td>${esc(r.status)}</td><td>${r.points} ★</td></tr>`).join("")}</tbody></table></div></details>`;
}
function studentPrizesHTML(s){
  const buys=Object.entries(state.root.redemptionsByStudent?.[s.id]||{}).map(([key,item])=>({key,item:item||{}})).sort((a,b)=>timeMs(b.item.requestedAt)-timeMs(a.item.requestedAt));
  const gives=Object.entries(state.root.classRewardContributionsByStudent?.[s.id]||{}).map(([key,item])=>({key,item:item||{}})).sort((a,b)=>timeMs(b.item.createdAt)-timeMs(a.item.createdAt));
  const buyRow=({key,item})=>{const kind=prizeState(item.status),name=state.root.rewards?.[item.rewardId]?.name||"Prize",cost=Number(item.cost)||0;
    return `<div class="stu-line"><span><b>${esc(name)}</b><small>${cost} ★ · ${item.requestedAt?esc(new Date(timeMs(item.requestedAt)).toLocaleDateString()):""}</small></span>${prizePill(kind)}${kind==="waiting"?`<button type="button" class="primary small" data-give="${esc(s.id)}|${esc(key)}">Give ✓</button>`:""}${kind!=="refunded"?`<button type="button" class="points-undo refund" data-undo="${esc(JSON.stringify({kind:"purchase",studentId:s.id,key}))}">↩ Refund</button>`:""}</div>`};
  const giveRow=({key,item})=>{const amount=Math.abs(Number(item.amount)||0),done=Boolean(item.refundedAt);
    return `<div class="stu-line"><span><b>${esc(item.rewardName||"Class reward")}${Array.isArray(item.modeNames)&&item.modeNames.length?" — "+esc(item.modeNames.join(", ")):""}</b><small>${amount} ★ to ${esc(item.className||pointClassName(item.classId))} · ${item.createdAt?esc(new Date(timeMs(item.createdAt)).toLocaleDateString()):""}</small></span>${done?prizePill("refunded"):""}${!done&&!state.teacherMode?`<button type="button" class="points-undo refund" data-refund-contribution="${esc(s.id)}|${esc(key)}">↩ Refund</button>`:""}</div>`};
  return `<section class="points-section"><div class="points-section-head"><div><h2>Prizes and class contributions</h2><p>What ${esc(s.name)} spent points on. Waiting = bought, not handed over yet.</p></div></div><div class="stu-lines">${buys.map(buyRow).join("")}${gives.map(giveRow).join("")}${buys.length||gives.length?"":`<div class="empty"><p>No prizes bought and nothing given to a class goal yet.</p></div>`}</div></section>`;
}
// ---------- Prize spending chart (one boy) and class overview (one row per boy) ----------
// Everything a boy ever spent in the Prize Store: purchases and class-prize contributions, with what was returned.
// Read-only: built from the records already loaded, nothing is written here.
function spendingEntries(sid){
  const out=[],R=state.root||{};
  for(const [key,item0] of Object.entries(R.redemptionsByStudent?.[sid]||{})){
    const item=item0||{},st=String(item.status||"pending"),points=Math.max(0,Number(item.cost)||0),returned=["declined","canceled","refunded"].includes(st);
    out.push({kind:"Bought",key,when:timeMs(item.requestedAt),name:R.rewards?.[item.rewardId]?.name||item.rewardName||"Prize",points,returned,refunded:returned?points:0,state:returned?"Refunded":st==="collected"?"Given":"Waiting"});
  }
  for(const [key,item0] of Object.entries(R.classRewardContributionsByStudent?.[sid]||{})){
    const item=item0||{},points=Math.abs(Number(item.amount)||0),returned=Boolean(item.refundedAt),won=Boolean(item.winner&&typeof item.winner==="object");
    out.push({kind:"Class prize",key,when:timeMs(item.createdAt),name:(item.rewardName||"Class prize")+(Array.isArray(item.modeNames)&&item.modeNames.length?" — "+item.modeNames.join(", "):""),points,returned,refunded:returned?Math.abs(Number(item.refundedAmount??points)||0):0,state:returned?"Refunded":won?"Won":"On the bar"});
  }
  return out.sort((a,b)=>a.when-b.when);
}
function spendingTotals(sid){
  const rows=spendingEntries(sid),spent=rows.reduce((a,r)=>a+r.points,0),refunded=rows.reduce((a,r)=>a+r.refunded,0);
  return {rows,spent,refunded,net:spent-refunded,buys:rows.filter(r=>r.kind==="Bought").length,gifts:rows.filter(r=>r.kind==="Class prize").length};
}
function spendingWhen(t){return t?new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"Unknown date"}
function studentSpendingHTML(s){
  const t=spendingTotals(s.id),bal=Number(s.rewardBalance)||0;
  const perItem=new Map();
  for(const r of t.rows){const k=r.kind+"|"+r.name,e=perItem.get(k)||{kind:r.kind,name:r.name,times:0,spent:0,refunded:0};e.times++;e.spent+=r.points;e.refunded+=r.refunded;perItem.set(k,e)}
  const items=[...perItem.values()].sort((a,b)=>b.spent-a.spent),top=Math.max(1,...items.map(i=>i.spent));
  const tile=(label,value,cls="")=>`<div class="spend-tile ${cls}"><small>${esc(label)}</small><b>${value} ★</b></div>`;
  return `<section class="points-section spend-chart"><div class="points-section-head"><div><h2>Prize Store spending</h2><p>Every purchase and class-prize contribution ${esc(s.name)} ever made. Refunds are shown, nothing is deleted.</p></div></div>
  <div class="spend-tiles">${tile("Total spent",t.spent)}${tile("Total refunded",t.refunded,"good")}${tile("Net spent",t.net)}${tile("Current balance",bal,bal<0?"bad":"")}</div>
  ${t.rows.length?`<h3 class="spend-sub">Totals per item</h3><div class="spend-bars">${items.map(i=>`<div class="spend-bar-row"><span class="spend-bar-name"><b>${esc(i.name)}</b><small>${esc(i.kind)} · ${i.times} time${i.times===1?"":"s"}</small></span><span class="spend-bar-track"><i style="width:${Math.max(2,Math.round(i.spent/top*100))}%"></i>${i.refunded?`<i class="back" style="width:${Math.round(i.refunded/top*100)}%"></i>`:""}</span><span class="spend-bar-num"><b>${i.spent} ★</b>${i.refunded?`<small>${i.refunded} ★ refunded</small>`:""}</span></div>`).join("")}</div>
  <h3 class="spend-sub">Every purchase and contribution</h3><div class="points-table"><table class="spend-table"><thead><tr><th>Date</th><th>Type</th><th>Item</th><th>Points</th><th>Status</th><th>Refunded</th></tr></thead><tbody>${t.rows.slice().reverse().map(r=>`<tr><td>${esc(spendingWhen(r.when))}</td><td>${esc(r.kind)}</td><td>${esc(r.name)}</td><td><b>${r.points} ★</b></td><td><span class="prize-pill ${r.returned?"refunded":r.state==="Given"||r.state==="Won"?"given":"waiting"}">${esc(r.state)}</span></td><td>${r.refunded?`+${r.refunded} ★`:"—"}</td></tr>`).join("")}</tbody><tfoot><tr><td colspan="3">Totals</td><td><b>${t.spent} ★</b></td><td></td><td><b>${t.refunded?"+"+t.refunded+" ★":"—"}</b></td></tr></tfoot></table></div>`:`<p class="muted">No purchases or contributions yet.</p>`}</section>`;
}
function classSpendingOverviewHTML(roster){
  const rows=roster.map(s=>({s,t:spendingTotals(s.id)})),sum=f=>rows.reduce((a,x)=>a+f(x),0);
  return `<section class="points-section spend-overview" id="spendOverview"><div class="points-section-head"><div><h2>Prize Store spending overview</h2><p>One row per boy: what he bought, gave to class prizes, and got back. Tap a boy for his full chart.</p></div></div>
  <div class="points-table"><table class="spend-table"><thead><tr><th>Boy</th><th>Bought</th><th>Class prize gifts</th><th>Total spent</th><th>Total refunded</th><th>Net spent</th><th>Balance now</th></tr></thead><tbody>${rows.map(({s,t})=>`<tr data-open-student="${esc(s.id)}" class="spend-click"><td><b>${esc(s.name)}</b></td><td>${t.buys}</td><td>${t.gifts}</td><td>${t.spent} ★</td><td>${t.refunded?`+${t.refunded} ★`:"—"}</td><td>${t.net} ★</td><td><b>${Number(s.rewardBalance)||0} ★</b></td></tr>`).join("")}</tbody><tfoot><tr><td>All ${rows.length} boys</td><td>${sum(x=>x.t.buys)}</td><td>${sum(x=>x.t.gifts)}</td><td>${sum(x=>x.t.spent)} ★</td><td>+${sum(x=>x.t.refunded)} ★</td><td>${sum(x=>x.t.net)} ★</td><td>${sum(x=>Number(x.s.rewardBalance)||0)} ★</td></tr></tfoot></table></div></section>`;
}
function studentDetail(s){
  state.pointClassId="all";state.pointStudent=s.id;
  const ledger=allPointLedger(true).filter(row=>row.sid===s.id&&row.counts);
  const groups=[{id:"daily",label:"Daily Points",icon:"✓"},{id:"posuk",label:"Posuk Practice",icon:"📖",hint:"Read & Translate (teacher grade)"},{id:"chazara",label:"Chazara",icon:"↻"},{id:"teacher",label:"Teacher adjustments",icon:"±"},{id:"store",label:"Prizes bought / returned",icon:"🎁"},{id:"class",label:"Class rewards",icon:"👥"},{id:"activity",label:"Other activity",icon:"★"},{id:"gap",label:"Older points",icon:"…"}].map(g=>{const rows=ledger.filter(row=>row.sourceGroup===g.id);return {...g,count:rows.length,amount:rows.reduce((a,row)=>a+Number(row.amount||0),0)}}).filter(g=>g.count||g.amount);
  const bal=Number(s.rewardBalance)||0,rows=C.allProgressRows(state.root,s.id,state.classId),g={};for(const x of rows){g[x.category]??={e:0,p:0};g[x.category].e+=Number(x.points)||0;g[x.category].p+=100}
  return `<section class="workspace student-detail"><button type="button" class="back-link" id="backToStudents">← All students</button>
  <div class="studenthero"><em class="huge" style="background:${esc(safeColor(s))}">${esc(s.initials)}</em><div><h2>${esc(s.name)}</h2><p>${esc(pointsStudentClassLabel(s.id)||"")}</p></div><button class="balance" id="adjustPoints"><span>CURRENT POINT BALANCE</span><b class="${bal<0?"neg":""}">${bal} ★</b><small>Click to adjust points</small></button></div>
  <section class="points-section"><div class="points-section-head"><div><h2>Where the points came from</h2><p>All-time, by reason. Tap a reason to filter the history below.</p></div></div><div class="points-reason-grid">${groups.map(x=>`<button class="points-reason-card ${state.pointType===x.id?"selected":""} ${x.amount<0?"negative":x.amount>0?"positive":"zero"}" data-points-source="${esc(x.id)}"><span class="points-reason-icon">${x.icon}</span><span class="points-reason-copy"><b>${esc(x.label)}</b>${x.hint?`<small>${esc(x.hint)}</small>`:""}<i>${x.count} ${x.count===1?"entry":"entries"}</i></span><strong>${x.amount>0?"+":""}${x.amount} ★</strong></button>`).join("")||`<div class="points-reason-empty">No saved point activity yet.</div>`}</div></section>
  ${studentSpendingHTML(s)}
  ${studentPrizesHTML(s)}
  ${studentPointsPanel(s)}
  <section class="panel" style="margin-top:18px"><div class="panelhead"><div><h2>Daily History</h2><p>Saved points and attendance</p></div></div><div class="historytable"><table><thead><tr><th>Date</th><th>Attendance</th><th>Points</th></tr></thead><tbody>${studentHistory(s).map(x=>`<tr><td>${esc(C.formatDate(x.date))}</td><td>${esc(x.status)}</td><td>${x.points} ★</td></tr>`).join("")||`<tr><td colspan="3">No saved days yet.</td></tr>`}</tbody></table></div></section></section>`;
}
// One student's own history, on the Students page: every change, who did it, prize status, Undo / Refund.
function studentPointsPanel(s){
  const visible=filteredPointLedger().filter(row=>row.sid===s.id);
  const typeOptions=[["all","All reasons"],["daily","Daily Points"],["posuk","Posuk Practice"],["chazara","Chazara"],["teacher","Teacher adjustments"],["store","Prizes"],["class","Class rewards"],["activity","Other activity"],["gap","History gaps"]];
  const body=visible.length?visible.map(row=>`<tr class="${row.isGap?"gap-row":""}"><td class="points-date">${esc(formatPointWhen(row))}</td><td><strong class="points-amount ${row.amount<0?"negative":row.amount>0?"positive":"zero"} ${row.counts?"":"not-posted"}">${row.amount>0?"+":""}${Number(row.amount)||0} ★</strong></td><td><b>${esc(row.reason)}</b>${row.detail?`<small>${esc(row.detail)}</small>`:""}</td><td>${row.prize?prizePill(row.prize):`<span class="status-pill ${esc(String(row.status).replace(/[^a-z0-9-]/gi,"-"))}">${esc(row.status==="posted"?"Posted":row.status==="needs-review"?"Needs review":row.status)}</span>`}</td><td><b class="points-running">${row.counts&&Number.isFinite(Number(row.runningBalance))?`${Number(row.runningBalance)} ★`:"—"}</b></td><td class="points-who">${esc(whoLabel(row))}</td><td class="points-actions">${undoCell(row)}</td></tr>`).join(""):`<tr><td colspan="7"><div class="empty"><p>No saved point activity for this view.</p></div></td></tr>`;
  return `<section class="points-section points-ledger"><div class="points-section-head"><div><h2>Full history</h2><p>Every change to ${esc(s.name)}’s points: who did it, prize status, and Undo / Refund (nothing is ever deleted).</p></div><strong class="points-result-count">${visible.length} row${visible.length===1?"":"s"}</strong></div>
  <div class="points-filters"><label><span>Time</span><select id="pointsRange"><option value="7" ${state.pointRange==="7"?"selected":""}>Last 7 days</option><option value="30" ${state.pointRange==="30"?"selected":""}>Last 30 days</option><option value="90" ${state.pointRange==="90"?"selected":""}>Last 90 days</option><option value="all" ${state.pointRange==="all"?"selected":""}>All time</option></select></label><label><span>Reason</span><select id="pointsType">${typeOptions.map(([v,l])=>`<option value="${v}" ${state.pointType===v?"selected":""}>${l}</option>`).join("")}</select></label><label class="points-search"><span>Search</span><input id="pointsSearch" value="${esc(state.pointSearch)}" placeholder="e.g. Chazara, Gimkit…"></label></div>
  <div class="points-table"><table><thead><tr><th>Date & time</th><th>Change</th><th>What it was for</th><th>Prize / status</th><th>Balance after</th><th>Who</th><th></th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}
function exportPointsCSV(){
  // Always export the complete ledger for every active student in every active class.
  // The on-screen student/date/source/status/search filters do not limit this file.
  const previousClassId=state.pointClassId;
  state.pointClassId="all";
  const rows=allPointLedger(true);
  const rosterById=new Map(pointsRoster().map(s=>[s.id,s]));
  state.pointClassId=previousClassId;

  const q=v=>`"${String(v??"").replaceAll('"','""')}"`;
  const header=["Date/Time","Student","Student ID","Amount","Reason","Details","Source","Source Group","Status","Counts in Balance","Class","Balance After","Current Balance"];
  const body=rows.map(r=>{
    const student=rosterById.get(r.sid)||{};
    return [
      r.isGap?"Older / unknown":r.when?new Date(r.when).toISOString():"",
      r.studentName,
      r.sid,
      Number(r.amount)||0,
      r.reason,
      r.detail||"",
      r.sourceLabel,
      r.sourceGroup,
      r.status,
      r.counts?"Yes":"No",
      r.classId?pointClassName(r.classId):"",
      r.counts&&Number.isFinite(Number(r.runningBalance))?Number(r.runningBalance):"",
      Number(student.rewardBalance)||0
    ];
  });
  const csv="\uFEFF"+[header,...body].map(row=>row.map(q).join(",")).join("\r\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.download=`brightpath-COMPLETE-points-history-${C.schoolDateString()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),0);
  toast(`Exported ${rows.length} point history row${rows.length===1?"":"s"} for all students.`);
}

function carryDate(s){return C.latestRatings(state.root,s.id,state.classId,state.date).date||""}
function daily(){
  const cats=categories(), r=roster(), saved=isSavedDay(), carried=!saved&&r.some(s=>carryDate(s));
  return `<div class="daily-block"><div class="workhead"><div><p class="eyebrow">${esc((cls()?.name||"CLASS").toUpperCase())} · EDITING ${esc(state.date)}</p><h2>Daily Points</h2><p>Entering or reviewing points for <strong>${new Date(`${state.date}T12:00:00`).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</strong>.</p></div><div class="workcontrols"><div class="savegroup">${saved?`<span class="savedday">✓ Already saved — changes will replace this day</span>`:`<span class="unsavedday">Draft only — no points awarded yet</span>`}<button id="saveDaily" class="primary">${saved?"Update saved day":"Save whole class"}</button></div></div></div>
  ${carried?`<div class="carrynotice"><b>↶ Ratings carried forward — not yet saved</b><span>Each student starts with their most recent previously saved ratings in this class. Review or change them, then save to award points for this date.</span></div>`:""}
  <div class="key"><span>● Excellent</span><span>● Good</span><span>● Fair</span><span>● Needs Improvement</span></div>
  <div class="table">
    <div class="row tablehead" style="grid-template-columns:minmax(170px,1.6fr) 110px repeat(${cats.length},minmax(125px,1fr)) 110px"><span>Student</span><span>Attendance</span>${cats.map(c=>`<span>${esc(c.name)}</span>`).join("")}<span>${saved?"Saved":"Unsaved Draft"}</span></div>
    ${r.map(s=>dailyRow(s,cats,saved)).join("")}
  </div></div>`;
}
function dailyRow(s,cats,saved){
  const absent=state.absent.has(s.id), ratings=cats.map(c=>state.draft[`${s.id}|${c.name}`]||"Good"), prog=absent?0:(C.dailyProgress(ratings)||0), award=absent?0:C.dailyAward(ratings), cdate=carryDate(s);
  return `<div class="row ${absent?"absentrow":""}" style="grid-template-columns:minmax(170px,1.6fr) 110px repeat(${cats.length},minmax(125px,1fr)) 110px">
    <div class="person"><em style="background:${esc(safeColor(s))}">${esc(s.initials)}</em><span><b>${esc(s.name)}</b>${!saved&&cdate?`<small class="carrysource">Started from ${new Date(`${cdate}T12:00:00`).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</small>`:""}</span></div>
    <div class="attendance-wrap"><button class="attendance ${absent?"absent":""}" data-att="${esc(s.id)}">${absent?"Absent":"Present"}</button></div>
    ${cats.map(c=>{const val=state.draft[`${s.id}|${c.name}`]||"Good";return `<div><select class="${ratingClass(val)}" data-rating="${esc(s.id)}" data-cat="${esc(c.name)}" ${absent?"disabled":""}>${["Excellent","Good","Fair","Needs Improvement"].map(x=>`<option value="${x}" ${x===val?"selected":""}>${x} (+${C.ratingPoints[x]})</option>`).join("")}</select></div>`}).join("")}
    <div class="today ${absent?"absentresult":""}"><strong>${absent?"Absent":`${prog}%`}</strong><small>${absent?"0 points":`${award} points if saved`}</small></div>
  </div>`;
}
function ratingClass(v){return String(v).toLowerCase().replace(/\s+/g,"-").replace("fair","average")}
async function saveDaily(){
  if(state.teacherMode){
    const cats=categories(), r=roster();
    const rows=r.map(s=>{const absent=state.absent.has(s.id),ratings={};if(!absent)for(const cat of cats)ratings[cat.name]=state.draft[`${s.id}|${cat.name}`]||"Good";return {studentId:s.id,absent,ratings}});
    try{await teacherApi("saveDaily",{classId:state.classId,date:state.date,rows});state.draftDirty=false;toast(`Saved ${r.length} students`)}catch(err){toast(err.message,"error")}
    await loadRoot();render();return;
  }
  const updates={}, cats=categories(), r=roster(), stamp=now(), balanceDeltas=[];
  for(const s of r){
    const absent=state.absent.has(s.id), ratings={};
    const byCategory={};let newAward=0;
    if(!absent)for(const cat of cats){const rating=state.draft[`${s.id}|${cat.name}`]||"Good",key=C.categoryKey(cat.name),pts=C.ratingPoints[rating]??C.ratingPoints.Good;ratings[key]={category:cat.name,rating,points:C.progressValue[rating]??100,teacherEmail:state.user.email,savedAt:stamp};byCategory[key]={category:cat.name,rating,points:pts};newAward+=pts}
    const oldAward=Number(state.root.dailyAwards?.[s.id]?.[state.classId]?.[state.date]?.points||0);
    updates[`${ROOT}/dailyRatings/${s.id}/${state.classId}/${state.date}`]=absent?null:ratings;
    updates[`${ROOT}/dailyAwards/${s.id}/${state.classId}/${state.date}`]={points:newAward,...(absent?{}:{byCategory}),teacherEmail:state.user.email,savedAt:stamp};
    updates[`${ROOT}/dailyAttendance/${s.id}/${state.classId}/${state.date}`]={status:absent?"absent":"present",teacherEmail:state.user.email,savedAt:stamp};
    balanceDeltas.push({id:s.id,delta:newAward-oldAward});
  }
  await db.ref().update(updates);
  // Use a transaction for the balance so Posuk Practice / Chazara points
  // earned at the same time can never be overwritten by a stale teacher page.
  await Promise.all(balanceDeltas.filter(x=>x.delta!==0).map(x=>changeBalance(x.id,x.delta,{clamp:true})));
  state.draftDirty=false;toast(`Saved ${r.length} students`);await loadRoot();render();
}
function studentHistory(s){const out=[];for(const [date,aw] of Object.entries(state.root.dailyAwards?.[s.id]?.[state.classId]||{})){const at=state.root.dailyAttendance?.[s.id]?.[state.classId]?.[date];out.push({date,points:Number(aw?.points||0),status:at?.status||"present"})}return out.sort((a,b)=>b.date.localeCompare(a.date))}
async function adjustPoints(s){
  s=s||currentStudent();if(!s)return;const raw=prompt(`Adjust ${s.name}'s points. Use a positive number to add or a negative number to deduct:`,"5");if(raw===null)return;const amount=Number(raw);if(!Number.isInteger(amount)||amount===0)return toast("Enter a whole number","error");
  const reason=prompt("Reason:","Teacher adjustment")||"Teacher adjustment";
  if(state.teacherMode){try{await teacherApi("adjust",{classId:state.classId,studentId:s.id,amount,reason});toast("Balance updated")}catch(err){toast(err.message,"error")}await loadRoot();render();return}
  const key=db.ref(`${ROOT}/pointAdjustments`).push().key;
  const r=await changeBalance(s.id,amount,{clamp:true});
  if(!r.committed){toast("Could not update the balance","error");return}
  await db.ref(`${ROOT}/pointAdjustments/${key}`).set({id:key,studentId:s.id,classId:state.classId,amount:r.applied,action:"teacher",reason,teacherEmail:state.user.email,createdAt:now(),balanceAfter:r.balanceAfter});
  toast("Balance updated");await loadRoot();render();
}
// Refund a class contribution right from the student's history (the owner; students can also ask).
async function refundContributionNow(sid,key){
  if(state.teacherMode){toast("Only the administrator can refund class contributions.","error");return}
  const info=refundItemInfo(sid,key,"contribution"),s=state.root.students?.[sid]||{};
  if(!info.record){toast("Could not find that contribution.","error");return}
  if(info.record.refundedAt){toast("This contribution was already refunded.","error");return}
  if(!confirm(`Return ${info.amount} ★ to ${s.name||"this student"} for ${info.name}?\n\nIt is taken off the class bar if that round is still open, and the refund is added to his history.`))return;
  const stamp=now(),reqPath=`${ROOT}/refundRequests/${sid}/${key}`;
  const t=await db.ref(`${ROOT}/classRewardContributionsByStudent/${sid}/${key}/refundedAt`).transaction(cur=>cur?undefined:stamp);
  if(!t.committed){toast("This contribution was already refunded.","error");return}
  try{
    await db.ref(`${ROOT}/classRewardContributionsByStudent/${sid}/${key}`).update({refundedBy:state.user.email,refundedAmount:info.amount});
    const outcome=await removeContributionFromRound(sid,key,info.record);
    const bal=await changeBalance(sid,info.amount);
    if(!bal.committed)throw new Error("Could not update the balance.");
    await db.ref(reqPath).update({itemKey:key,kind:"contribution",status:"approved",amount:info.amount,balanceAfter:bal.balanceAfter,requestedAt:Date.now(),reviewedAt:stamp,reviewedBy:state.user.email,by:"teacher",error:null});
    toast(`${info.amount} ★ returned to ${s.name||"student"}${outcome==="removed"?" and removed from the class bar":" (class bar left as is — that round already finished)"}`);
  }catch(err){
    console.error(err);toast(`Partly done — check ${s.name||"the"} balance: ${err.message||err}`,"error");
  }
  await loadRoot();render();
}
// "Give" on a prize waiting for the owner: approve it and mark it handed over in one tap.
async function givePrize(sid,key){
  let st=String(state.root.redemptionsByStudent?.[sid]?.[key]?.status||"pending");
  if(st==="pending"){if(!await review(sid,key,"approve",{quiet:true}))return;st="ready"}
  if(st==="ready"&&!await review(sid,key,"collect",{quiet:true}))return;
  toast("Marked as given");await loadRoot();render();
}
function categoriesSection(){
  const cats=categories();
  return `<div class="workhead" style="margin-top:6px"><div><h2>Categories</h2><p>These are the areas scored on the Today page.</p></div>${state.teacherMode?"":`<button class="primary" id="addCategory">+ Add category</button>`}</div><div class="category-grid">${cats.map((c,i)=>`<article class="category-card"><div class="catdot">${i+1}</div><h3>${esc(c.name)}</h3><p>Active · order ${Number(c.sortOrder||0)+1}</p>${state.teacherMode?"":`<button data-catdelete="${esc(c.id)}">Remove</button>`}</article>`).join("")}</div>`;
}
async function addCategory(){if(state.teacherMode){toast("Only the administrator can change this.","error");return}const name=prompt("Category name:");if(!name)return;const id=`cat-${crypto.randomUUID?crypto.randomUUID():Date.now()}`;await db.ref(`${ROOT}/categories/${id}`).set({id,teacherEmail:state.user.email,name:name.trim(),points:1,sortOrder:categories().length,active:true});toast("Category added")}
async function removeCategory(id){if(state.teacherMode){toast("Only the administrator can change this.","error");return}if(!confirm("Remove this category from future Daily Points screens? Old history will remain."))return;await db.ref(`${ROOT}/categories/${id}/active`).set(false);toast("Category removed")}
function commentsSection(){
  const s=currentStudent(), r=roster();if(s&&!state.selectedId)state.selectedId=s.id;const comments=s?vals(state.root.commentsByStudent?.[s.id]||{}).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))):[];
  return `<div class="workhead" style="margin-top:6px"><div><h2>Comments</h2><p>Write a private note or share encouragement with the student.</p></div><select id="commentPicker" class="picker">${r.map(x=>`<option value="${esc(x.id)}" ${s&&x.id===s.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div>${s?`<div class="admincolumns"><section><h2>${esc(s.name)}’s comments</h2><div class="commentlist">${comments.map(c=>`<article><p>${esc(c.body)}</p><small>${c.visibleToStudent===false?"Private teacher note":"Visible to student"} · ${c.createdAt?new Date(c.createdAt).toLocaleDateString():""}</small></article>`).join("")||`<div class="empty"><h3>No comments yet</h3><p>Add the first note for this student.</p></div>`}</div></section><section><h2>Add a comment</h2><form id="commentForm" class="adminform"><label>Comment<textarea id="commentText" required rows="5"></textarea></label><label class="check"><input id="commentVisible" type="checkbox" checked> Show this comment to the student</label><button class="primary">Save comment</button></form></section></div>`:`<div class="empty">No student selected.</div>`}`;
}
async function addComment(e){e.preventDefault();const s=currentStudent(), body=$("#commentText").value.trim();if(!s||!body)return;if(state.teacherMode){try{await teacherApi("comment",{classId:state.classId,studentId:s.id,body,visibleToStudent:$("#commentVisible").checked});toast("Comment saved")}catch(err){toast(err.message,"error")}await loadRoot();render();return}const key=db.ref(`${ROOT}/commentsByStudent/${s.id}`).push().key;await db.ref(`${ROOT}/commentsByStudent/${s.id}/${key}`).set({id:key,studentId:s.id,body,visibleToStudent:$("#commentVisible").checked,teacherEmail:state.user.email,createdAt:now()});toast("Comment saved")}
function classRewardSnapshot(item,classId=state.classId){
  const count=Math.max(1,C.classRoster(state.root||{},classId).length),rawLive=state.root?.classRewardRounds?.[classId]?.[item.id]||null,raw=rawLive||{},cooldownDays=cooldownDaysValue(item?.cooldownDays);
  const perStudent=Math.max(1,Number(raw.perStudentCost)||Number(item.costPerStudent||100)),goal=Math.max(1,Number(raw.goalPoints)||perStudent*count),cap=Number(raw.maxPerStudent)||Math.min(goal,Math.ceil((goal/count)*2));
  if(isGimkitClassReward(item)){
    const modes=gimkitModesForItem(item).map(m=>{const total=Math.max(0,Number(raw.modeTotals?.[m.id])||0),voters=Object.values(raw.modeVoters?.[m.id]||{}).filter(Boolean).length;return {...m,total,voters,pct:Math.max(0,Math.min(100,Math.round(total/goal*100)))}}),leader=Math.max(0,...modes.map(m=>m.total)),cooldownUntil=timeMs(raw.cooldownUntil)||(cooldownDays>0&&timeMs(raw.completedAt)?timeMs(raw.completedAt)+cooldownDays*DAY_MS:0),cooling=cooldownDays>0&&cooldownUntil>Date.now(),pct=Math.max(0,Math.min(100,Math.round(leader/goal*100))),contributors=Object.keys(raw.byStudent||{}).filter(k=>Number(raw.byStudent[k])>0).length,status=cooling?"cooldown":(leader>0||raw.startedAt?"active":"not-started");
    return {count,perStudent,live:rawLive,goal,total:leader,cap,pct,contributors,status,cooldownDays,cooldownUntil,cooling,expired:false,modeVoting:true,modes,lastWinner:raw.lastWinner||null};
  }
  const rawTotal=Math.max(0,Number(raw.totalContributed)||0),completedAt=timeMs(raw.completedAt),cooldownUntil=cooldownDays>0&&completedAt?completedAt+cooldownDays*DAY_MS:0,cooling=rawTotal>=goal&&cooldownUntil>Date.now(),expired=rawTotal>=goal&&cooldownDays>0&&cooldownUntil>0&&cooldownUntil<=Date.now(),live=expired?null:rawLive,total=expired?0:rawTotal,byStudent=expired?{}:(raw.byStudent||{}),pct=Math.max(0,Math.min(100,Math.round(total/Math.max(1,goal)*100))),contributors=Object.keys(byStudent).filter(k=>Number(byStudent[k])>0).length,status=cooling?"cooldown":expired?"not-started":(total>=goal?"completed":String(raw.status||"not-started"));
  return {count,perStudent,live,goal,total,cap,pct,contributors,status,cooldownDays,cooldownUntil,cooling,expired,modeVoting:false};
}
function waitingBuyRow(x){
  const s=state.root.students?.[x.sid]||{},r=state.root.rewards?.[x.item.rewardId],status=x.item.status||"pending",when=timeMs(x.item.requestedAt);
  return `<div class="request waiting-row"><em style="background:${esc(safeColor(s))}">${esc(s.initials||"?")}</em><span><strong>${esc(s.name||x.sid)}</strong><small>${esc(r?.name||"Prize")} · ${Number(x.item.cost)||0} ★ · ${status==="ready"?"approved, not handed over yet":"just bought"}${when?` · ${esc(new Date(when).toLocaleString())}`:""}</small></span><button type="button" class="primary small" data-give="${esc(x.sid)}|${esc(x.key)}">Give ✓</button><button type="button" class="points-undo refund" data-undo="${esc(JSON.stringify({kind:"purchase",studentId:x.sid,key:x.key}))}">↩ Refund</button></div>`;
}
function waitingStoreHTML(){
  const rows=[];
  for(const x of getRedemptions())if(x.item.status==="pending"||x.item.status==="ready")rows.push({when:timeMs(x.item.requestedAt),html:waitingBuyRow(x)});
  for(const x of pendingRefundRequests())rows.push({when:timeMs(x.item.requestedAt),html:refundRequestRow(x)});
  rows.sort((a,b)=>a.when-b.when);
  const handled=getRedemptions().filter(x=>!(x.item.status==="pending"||x.item.status==="ready")).slice(0,12);
  return `<section class="teacher-reward-section waiting-store"><div class="teacher-reward-heading"><span>📬</span><div><h2>Waiting for you</h2><p>Prizes boys bought that you still need to hand over, and refund requests. “Give” marks the prize as given; “Refund” returns the points.</p></div><b class="queue-count">${rows.length}</b></div><div class="approvals-inline">${rows.map(r=>r.html).join("")||`<div class="empty"><h3>All caught up</h3><p>Nothing is waiting for you.</p></div>`}</div>${handled.length?`<details class="reports-box"><summary>Recently handled (${handled.length})</summary><div class="approvals-inline">${handled.map(x=>{const s=state.root.students?.[x.sid]||{},r=state.root.rewards?.[x.item.rewardId];return `<div class="request"><em style="background:${esc(safeColor(s))}">${esc(s.initials||"?")}</em><span><strong>${esc(s.name||x.sid)}</strong><small>${esc(r?.name||"Prize")} · ${Number(x.item.cost)||0} ★</small></span>${prizePill(prizeState(x.item.status))}</div>`}).join("")}</div></details>`:""}</section>`;
}
function prizeStorePage(){
  const rewards=vals(state.root.rewards||{}).filter(r=>itemInStore(r)&&r.active!==false&&String(r.rewardType||"personal")!=="class"&&String(r.rewardType||"personal")!=="class-migrated").sort((a,b)=>(a.cost||0)-(b.cost||0)), req=getRedemptions(), classRewards=vals(state.root.classRewardCatalog||{}).filter(x=>itemInStore(x)&&x.active!==false).sort((a,b)=>(a.costPerStudent||0)-(b.costPerStudent||0)||(a.name||"").localeCompare(b.name||""));
  const storeOpen=classStoreOpen();
  return `<section class="workspace"><div class="workhead"><div><p class="eyebrow">PRIZE STORE${isTeacherStore(state.classId)?" · "+esc((cls()?.name||"").toUpperCase())+" STORE":""}</p><h1>Prize Store</h1><p>The prizes, and everything waiting for you. Personal prizes are bought by one boy; class prizes are shared goals funded by contributions.</p></div><a class="primary linkbutton" href="student.html">Open student portal</a></div>
  <div class="storecontrol ${storeOpen?"open":"closed"}"><div><strong>Prize Store purchasing is ${storeOpen?"OPEN":"CLOSED"}</strong><small>${storeOpen?"Students can buy personal rewards and contribute to class goals.":"Students can browse, but cannot spend points."} Open or close it under Settings → Prize Store.</small></div><button type="button" class="primary" data-settings-go="store">Change in Settings</button></div>
  ${waitingStoreHTML()}

  <div class="reward-type-stack">
    <section class="teacher-reward-section personal-rewards"><div class="teacher-reward-heading"><span>👤</span><div><h2>Personal Rewards</h2><p>One boy spends his points and receives this reward himself. Each reward can also have its own time cooldown.</p></div><button class="primary" id="addReward">+ Add personal reward</button></div><div class="rewardgrid">${rewards.length?rewards.map(r=>{const available=r.available!==false,cd=personalCooldownInfo(r);return `<article class="${available?"reward-open":"reward-closed"}"><div class="reward-availability ${available?"open":"closed"}">${available?"OPEN":"CLOSED"}</div><div class="rewardicon" style="background:${esc(r.color||"#ede9fe")}">${esc(r.icon||"🎁")}</div><h3>${esc(r.name)}</h3><p>${Number(r.cost)||0} ★ · ${Number(r.quantity)<0?"unlimited":`${r.quantity} left`}</p><p><strong>${esc(cd.label)}</strong></p><div class="rewardactions"><button class="reward-toggle ${available?"close":"open"}" data-toggle-reward="${esc(r.id)}">${available?"Close":"Open"}</button><button data-editreward="${esc(r.id)}">Edit</button><button class="rewarddelete" data-deletereward="${esc(r.id)}">Delete</button></div></article>`}).join(""):`<div class="empty"><h3>No personal rewards</h3></div>`}</div></section>
    <section class="teacher-reward-section class-rewards"><div class="teacher-reward-heading"><span>👥</span><div><h2>Class Rewards — ${esc(cls()?.name||"Class")}</h2><p>Prices are set per student, so ET and WT goals scale automatically. You can set a cooldown (for example 14 days) after the class earns each prize.</p></div><button class="primary" id="addClassReward">+ Add class reward</button></div><div class="teacher-class-goal-grid">${classRewards.length?classRewards.map(x=>{const g=classRewardSnapshot(x),available=x.available!==false,cdLabel=g.cooling?`Available again in ${cooldownText(g.cooldownUntil)}`:(g.cooldownDays?`Cooldown: ${g.cooldownDays} day${g.cooldownDays===1?"":"s"}`:"No cooldown");return `<article class="teacher-class-goal ${g.status==="completed"||g.status==="cooldown"?"complete":""} ${available?"reward-open":"reward-closed"}"><div class="reward-availability ${available?"open":"closed"}">${available?"OPEN":"CLOSED"}</div><div class="teacher-class-goal-top"><span>${esc(x.icon||"⭐")}</span><div><h3>${esc(x.name)}</h3><p>${g.perStudent} ★ per student · ${g.count} students · goal ${g.goal} ★</p><p><strong>${esc(cdLabel)}</strong></p></div><strong>${g.total} / ${g.goal} ★</strong></div><div class="teacher-class-progress"><i style="width:${g.pct}%"></i></div>${gimkitTeacherModesHTML(g)}<div class="teacher-class-meta"><span>${g.contributors} contributor${g.contributors===1?"":"s"}</span><span>${g.status==="cooldown"?`⏳ ${esc(cdLabel)}`:g.status==="completed"?"✓ Goal reached":`${Math.max(0,g.goal-g.total)} ★ still needed`}</span></div><div class="rewardactions"><button class="reward-toggle ${available?"close":"open"}" data-toggle-class-reward="${esc(x.id)}">${available?"Close":"Open"}</button><button data-editclassreward="${esc(x.id)}">Edit</button>${g.live?`<button data-resetclassreward="${esc(x.id)}">${isGimkitClassReward(x)?(g.cooling?"End cooldown":"Reset all mode bars"):(g.cooling?"End cooldown / start new goal":"Reset goal")}</button>`:""}<button class="rewarddelete" data-deleteclassreward="${esc(x.id)}">Delete</button></div></article>`}).join(""):`<div class="empty"><h3>No class rewards</h3></div>`}</div></section>
  </div></section>`;
}
function activityPointRow(x){
  const item=x.item||{}, s=state.root.students?.[item.rewardStudentId]||{}, amount=Number(item.amount||0), sign=amount>0?"+":"";
  const when=item.createdAt?new Date(Number(item.createdAt)).toLocaleString():"";
  return `<div class="activity-request"><em style="background:${esc(safeColor(s))}">${esc(s.initials||initials(item.studentName||"?"))}</em><span><strong>${esc(item.studentName||s.name||item.rewardStudentId||"Student")}</strong><small>${esc(item.reason||item.source||"Activity points")}${when?` · ${esc(when)}`:""}</small></span><b class="activity-amount ${amount<0?"deduct":""}">${sign}${amount} ★</b><button class="deny" data-point-reject="${esc(x.id)}" title="Reject">×</button><button class="approve" data-point-approve="${esc(x.id)}" title="Approve">✓</button></div>`;
}
function requestRow(x){const s=state.root.students?.[x.sid],r=state.root.rewards?.[x.item.rewardId],status=x.item.status||"pending";return `<div class="request"><em style="background:${esc(safeColor(s))}">${esc(s?.initials||"?")}</em><span><strong>${esc(s?.name||x.sid)}</strong><small>${esc(r?.name||"Reward")} · ${Number(x.item.cost)||0} ★ · ${esc(status)}</small></span>${status==="pending"?`<button class="deny" data-decline="${esc(x.sid)}|${esc(x.key)}">×</button><button class="approve" data-approve="${esc(x.sid)}|${esc(x.key)}">✓</button>`:""}${status==="ready"?`<button class="approve" data-collect="${esc(x.sid)}|${esc(x.key)}">Given</button>`:""}</div>`}
async function setChazaraPointStatus(item,status){
  if(!item?.eventId||!item?.practiceStudentId)return;
  // Shorashim recordings mirror their status on the Shorashim recording event,
  // which is what the homepage and Shorashim page count.
  if(["shorashim-recording","shorashim-no-hints"].includes(String(item.source||""))){
    try{await db.ref(`posukPractice/shorashimLearning/recordingEvents/${item.practiceStudentId}/${item.eventId}/pointRequestStatus`).set(status)}catch(e){console.warn('Could not mirror Shorashim point status',e)}
    return;
  }
  const path=`posukPractice/chazara/events/${item.practiceStudentId}/${item.eventId}`;
  const field=Number(item.amount||0)<0?"removalPointRequestStatus":"pointRequestStatus";
  try{await db.ref(path+'/'+field).set(status)}catch(e){console.warn('Could not mirror Chazara point status',e)}
}
async function approveActivityPoint(id,quiet=false){
  if(state.teacherMode){try{const r=await teacherApi("approve",{requestId:id});if(!quiet)toast(`${r.actualAmount>=0?"+":""}${r.actualAmount} points approved`);if(!quiet){await loadRoot();render()}return true}catch(err){if(!quiet)toast(err.message,"error");return false}}
  const live=(await db.ref(`${ROOT}/pointRequests/${id}`).once("value")).val();
  if(!live||live.status!=="pending")return false;
  const reqRef=db.ref(`${ROOT}/pointRequests/${id}`), stamp=now();
  const lock=await reqRef.transaction(cur=>cur&&cur.status==="pending"?{...cur,status:"processing",reviewedBy:state.user.email,reviewStartedAt:stamp}:undefined);
  if(!lock.committed)return false;
  const item=lock.snapshot.val()||live, sid=item.rewardStudentId, amount=Number(item.amount||0);
  let applied=0,balanceAfter=0;
  try{
    const bal=await changeBalance(sid,amount,{clamp:true});
    if(!bal.committed)throw new Error('Balance update did not commit');
    applied=bal.applied;balanceAfter=bal.balanceAfter;
    await reqRef.update({status:"approved",actualAmount:applied,balanceAfter,balanceBefore:bal.before,reviewedBy:state.user.email,reviewedAt:now()});
    await setChazaraPointStatus(item,"approved");
    if(!quiet)toast(`${item.studentName||"Student"}: ${applied>=0?"+":""}${applied} points approved`);
    return true;
  }catch(err){
    console.error(err);
    await reqRef.update({status:"pending",lastError:String(err?.message||err),reviewStartedAt:null}).catch(()=>{});
    if(!quiet)toast("Could not approve points","error");
    return false;
  }
}
async function rejectActivityPoint(id,quiet=false){
  if(state.teacherMode){try{await teacherApi("reject",{requestId:id});if(!quiet){toast("Point request rejected");await loadRoot();render()}return true}catch(err){if(!quiet)toast(err.message,"error");return false}}
  const snap=await db.ref(`${ROOT}/pointRequests/${id}`).once("value"), item=snap.val();
  if(!item||item.status!=="pending")return false;
  await db.ref(`${ROOT}/pointRequests/${id}`).update({status:"rejected",reviewedBy:state.user.email,reviewedAt:now()});
  await setChazaraPointStatus(item,"rejected");
  if(!quiet)toast("Point request rejected");
  return true;
}
async function approveAllActivityPoints(){
  const ids=pendingActivityPointRequests().map(x=>x.id);
  if(!ids.length)return;
  if(!confirm(`Approve all ${ids.length} pending activity point request${ids.length===1?"":"s"} for ${cls()?.name||"this class"}?`))return;
  let done=0;for(const id of ids)if(await approveActivityPoint(id,true))done++;
  toast(`${done} activity point request${done===1?"":"s"} approved`);
  if(state.teacherMode){await loadRoot();render()}
}
function closeRewardEditor(){const overlay=document.querySelector(".reward-editor-backdrop");if(!overlay)return;if(overlay._rewardEditorKeyHandler)document.removeEventListener("keydown",overlay._rewardEditorKeyHandler);overlay.remove()}
function rewardEditorBackdrop(title,subtitle,bodyHtml){
  closeRewardEditor();
  const overlay=document.createElement("div");
  overlay.className="reward-editor-backdrop";
  overlay.innerHTML=`<section class="reward-editor-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="reward-editor-head"><div><p class="eyebrow">REWARD STORE</p><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div><button type="button" class="reward-editor-x" aria-label="Close">×</button></div>${bodyHtml}</section>`;
  document.body.appendChild(overlay);
  overlay.querySelector(".reward-editor-x").onclick=closeRewardEditor;
  overlay.onclick=e=>{if(e.target===overlay)closeRewardEditor()};
  const onKey=e=>{if(e.key==="Escape"){document.removeEventListener("keydown",onKey);closeRewardEditor()}};
  overlay._rewardEditorKeyHandler=onKey;
  document.addEventListener("keydown",onKey);
  return overlay;
}
function editReward(id=""){
  const old=id?state.root.rewards?.[id]:null;
  const quantity=Number(old?.quantity??-1), unlimited=quantity<0, color=/^#[0-9a-f]{6}$/i.test(String(old?.color||""))?old.color:"#ede9fe";
  const overlay=rewardEditorBackdrop(id?"Edit personal reward":"Add personal reward","Change every reward setting here, then save once.",`
    <form class="reward-editor-form" id="personalRewardEditor">
      <label class="wide">Reward name<input id="rewardEditName" required value="${esc(old?.name||"")}" placeholder="Virtual Background"></label>
      <label>Point cost<input id="rewardEditCost" required type="number" min="0" step="1" value="${Number(old?.cost??25)}"></label>
      <label>Emoji / icon<input id="rewardEditIcon" value="${esc(old?.icon||"🎁")}" maxlength="12"></label>
      <label>Cooldown after purchase (days)<input id="rewardEditCooldown" required type="number" min="0" step="0.25" value="${cooldownDaysValue(old?.cooldownDays)}"><small>Use 0 for no cooldown.</small></label>
      <label>Card color<input id="rewardEditColor" type="color" value="${esc(color)}"></label>
      <label>Quantity<input id="rewardEditQuantity" type="number" min="0" step="1" value="${unlimited?1:Math.max(0,quantity)}" ${unlimited?"disabled":""}><small>How many are available.</small></label>
      <label class="reward-editor-check"><input id="rewardEditUnlimited" type="checkbox" ${unlimited?"checked":""}> Unlimited quantity</label>
      <label class="reward-editor-check"><input id="rewardEditAvailable" type="checkbox" ${old?.available!==false?"checked":""}> Reward is open for students</label>
      <div class="reward-editor-actions wide"><button type="button" class="reward-editor-cancel">Cancel</button><button class="primary" type="submit">${id?"Save changes":"Add reward"}</button></div>
      <p class="reward-editor-error wide" aria-live="polite"></p>
    </form>`);
  const form=overlay.querySelector("#personalRewardEditor"), unlimitedBox=overlay.querySelector("#rewardEditUnlimited"), quantityInput=overlay.querySelector("#rewardEditQuantity");
  unlimitedBox.onchange=()=>{quantityInput.disabled=unlimitedBox.checked};
  overlay.querySelector(".reward-editor-cancel").onclick=closeRewardEditor;
  form.onsubmit=async e=>{
    e.preventDefault();
    const error=overlay.querySelector(".reward-editor-error"), save=form.querySelector("button[type=submit]");
    const name=overlay.querySelector("#rewardEditName").value.trim();
    const cost=Number(overlay.querySelector("#rewardEditCost").value);
    const cooldownDays=Number(overlay.querySelector("#rewardEditCooldown").value);
    const icon=overlay.querySelector("#rewardEditIcon").value.trim()||"🎁";
    const selectedColor=overlay.querySelector("#rewardEditColor").value||"#ede9fe";
    const quantityValue=unlimitedBox.checked?-1:Number(quantityInput.value);
    const available=overlay.querySelector("#rewardEditAvailable").checked;
    if(!name){error.textContent="Enter a reward name.";return}
    if(!Number.isFinite(cost)||cost<0){error.textContent="Point cost must be 0 or more.";return}
    if(!Number.isFinite(cooldownDays)||cooldownDays<0){error.textContent="Cooldown must be 0 or more.";return}
    if(!unlimitedBox.checked&&(!Number.isFinite(quantityValue)||quantityValue<0)){error.textContent="Quantity must be 0 or more, or choose Unlimited.";return}
    save.disabled=true;error.textContent="";
    try{
      const rid=id||`reward-${crypto.randomUUID?crypto.randomUUID():Date.now()}`,lastRedeemedAt=timeMs(old?.lastRedeemedAt);
      const cooldownUntil=cooldownDays>0&&lastRedeemedAt?lastRedeemedAt+cooldownDays*DAY_MS:null;
      await sdb().ref(`${ROOT}/rewards/${rid}`).set({...(isTeacherStore(state.classId)?{ownerClassId:old?.ownerClassId||state.classId}:{}),id:rid,name,cost:Math.round(cost),icon,color:selectedColor,active:true,available,quantity:unlimitedBox.checked?-1:Math.round(quantityValue),rewardType:"personal",cooldownDays,lastRedeemedAt:lastRedeemedAt||null,cooldownUntil});
      closeRewardEditor();toast(id?"Personal reward updated":"Personal reward added");
    }catch(err){console.error(err);save.disabled=false;error.textContent="Could not save this reward. Please try again."}
  };
  requestAnimationFrame(()=>overlay.querySelector("#rewardEditName")?.focus());
}
function editClassReward(id=""){
  const old=id?state.root.classRewardCatalog?.[id]:null,isGimkit=isGimkitClassReward(old)||(!id&&false),startingModes=gimkitModesForItem(old||{id,name:"Gimkit"});
  const modeSection=isGimkit?`<div class="gimkit-mode-editor wide"><div class="gimkit-mode-editor-head"><div><b>Gimkit mode choices</b><small>Boys can choose one or several modes. Their contribution is split among the modes they check. Losing bars carry over to the next Gimkit.</small></div><button type="button" id="addGimkitMode">+ Add mode</button></div><div id="gimkitModeRows"></div></div>`:"";
  const overlay=rewardEditorBackdrop(id?"Edit class reward":"Add class reward","Change every class reward setting here, then save once.",`
    <form class="reward-editor-form" id="classRewardEditor">
      <label class="wide">Class reward name<input id="classRewardEditName" required value="${esc(old?.name||"")}"></label>
      <label>Points needed per student<input id="classRewardEditCost" required type="number" min="1" step="1" value="${Number(old?.costPerStudent??100)}"></label>
      <label>Emoji / icon<input id="classRewardEditIcon" value="${esc(old?.icon||"⭐")}" maxlength="12"></label>
      <label class="wide">Cooldown after class earns it (days)<input id="classRewardEditCooldown" required type="number" min="0" step="0.25" value="${cooldownDaysValue(old?.cooldownDays)}"><small>Use 0 to keep the manual-reset behavior.</small></label>
      ${modeSection}
      <label class="reward-editor-check wide"><input id="classRewardEditAvailable" type="checkbox" ${old?.available!==false?"checked":""}> Reward is open for students</label>
      <div class="reward-editor-actions wide"><button type="button" class="reward-editor-cancel">Cancel</button><button class="primary" type="submit">${id?"Save changes":"Add reward"}</button></div>
      <p class="reward-editor-error wide" aria-live="polite"></p>
    </form>`);
  const form=overlay.querySelector("#classRewardEditor");
  const modeRows=overlay.querySelector("#gimkitModeRows");
  const modeDraft=startingModes.map(m=>({...m}));
  const drawModes=()=>{if(!modeRows)return;modeRows.innerHTML=modeDraft.map((m,i)=>`<div class="gimkit-mode-edit-row"><input data-gimkit-mode-name="${i}" value="${esc(m.name)}" aria-label="Gimkit mode name"><label><input type="checkbox" data-gimkit-mode-active="${i}" ${m.active!==false?"checked":""}> Active</label><button type="button" data-remove-gimkit-mode="${i}">×</button></div>`).join("");modeRows.querySelectorAll("[data-gimkit-mode-name]").forEach(inp=>inp.oninput=()=>{modeDraft[Number(inp.dataset.gimkitModeName)].name=inp.value});modeRows.querySelectorAll("[data-gimkit-mode-active]").forEach(inp=>inp.onchange=()=>{modeDraft[Number(inp.dataset.gimkitModeActive)].active=inp.checked});modeRows.querySelectorAll("[data-remove-gimkit-mode]").forEach(btn=>btn.onclick=()=>{modeDraft.splice(Number(btn.dataset.removeGimkitMode),1);drawModes()})};
  drawModes();
  if(overlay.querySelector("#addGimkitMode"))overlay.querySelector("#addGimkitMode").onclick=()=>{modeDraft.push({id:`mode-${Date.now()}-${modeDraft.length}`,name:"New mode",active:true});drawModes();requestAnimationFrame(()=>modeRows?.querySelector("[data-gimkit-mode-name]:last-of-type")?.focus())};
  overlay.querySelector(".reward-editor-cancel").onclick=closeRewardEditor;
  form.onsubmit=async e=>{
    e.preventDefault();
    const error=overlay.querySelector(".reward-editor-error"),save=form.querySelector("button[type=submit]");
    const name=overlay.querySelector("#classRewardEditName").value.trim(),cost=Number(overlay.querySelector("#classRewardEditCost").value),cooldownDays=Number(overlay.querySelector("#classRewardEditCooldown").value),icon=overlay.querySelector("#classRewardEditIcon").value.trim()||"⭐",available=overlay.querySelector("#classRewardEditAvailable").checked;
    if(!name){error.textContent="Enter a reward name.";return}
    if(!Number.isFinite(cost)||cost<1){error.textContent="Points per student must be at least 1.";return}
    if(!Number.isFinite(cooldownDays)||cooldownDays<0){error.textContent="Cooldown must be 0 or more.";return}
    const savingGimkit=isGimkitClassReward({...old,id:id||"",name});
    const cleanedModes=modeDraft.map(m=>({id:String(m.id||gimkitModeId(m.name)),name:String(m.name||"").trim(),active:m.active!==false})).filter(m=>m.name);
    if(savingGimkit&&!cleanedModes.some(m=>m.active!==false)){error.textContent="Keep at least one Gimkit mode active.";return}
    save.disabled=true;error.textContent="";
    try{
      const rid=id||`class-reward-${crypto.randomUUID?crypto.randomUUID():Date.now()}`;
      const record={...(isTeacherStore(state.classId)?{ownerClassId:old?.ownerClassId||state.classId}:{}),id:rid,name,costPerStudent:Math.round(cost),icon,active:true,available,cooldownDays};
      if(savingGimkit){record.modeVotingEnabled=true;record.modes=Object.fromEntries(cleanedModes.map(m=>[m.id,m]))}
      const updates={[`${ROOT}/classRewardCatalog/${rid}`]:record};
      if(!id)updates[`${ROOT}/settings/classRewardAvailability/${rid}`]=available;
      await sdb().ref().update(updates);closeRewardEditor();toast(id?"Class reward updated":"Class reward added");
    }catch(err){console.error(err);save.disabled=false;error.textContent="Could not save this reward. Please try again."}
  };
  requestAnimationFrame(()=>overlay.querySelector("#classRewardEditName")?.focus());
}
async function toggleRewardAvailability(id){const r=state.root.rewards?.[id];if(!r)return;const next=r.available===false;await sdb().ref(`${ROOT}/rewards/${id}/available`).set(next);toast(`${r.name||"Reward"} ${next?"opened":"closed"}`)}
async function toggleClassRewardAvailability(id){const r=state.root.classRewardCatalog?.[id];if(!r)return;const next=r.available===false;await sdb().ref().update({[`${ROOT}/classRewardCatalog/${id}/available`]:next,[`${ROOT}/settings/classRewardAvailability/${id}`]:next});toast(`${r.name||"Class reward"} ${next?"opened":"closed"}`)}
async function deleteClassReward(id){const r=state.root.classRewardCatalog?.[id];if(!r||!confirm(`Delete “${r.name}” from Class Rewards? Existing contribution history will be kept.`))return;await sdb().ref(`${ROOT}/classRewardCatalog/${id}/active`).set(false);toast("Class reward deleted")}
async function resetClassReward(id){
  const r=state.root.classRewardCatalog?.[id];if(!r)return;
  const round=state.root?.classRewardRounds?.[state.classId]?.[id]||null,g=classRewardSnapshot(r);
  if(isGimkitClassReward(r)&&round&&g.cooling){
    if(!confirm(`End the Gimkit cooldown now? The losing mode bars will keep all of their points.`))return;
    await sdb().ref(`${ROOT}/classRewardRounds/${state.classId}/${id}`).update({status:"active",cooldownUntil:null,byStudent:{},updatedAt:Date.now()});toast("Gimkit cooldown ended");return;
  }
  const msg=isGimkitClassReward(r)?`Reset every Gimkit mode bar for ${cls()?.name||"this class"}? This clears the carried-over mode totals.`:`Start a fresh “${r.name}” class goal for ${cls()?.name||"this class"}? Previous contributions will stay in point history.`;
  if(!confirm(msg))return;
  await sdb().ref(`${ROOT}/classRewardRounds/${state.classId}/${id}`).remove();toast(isGimkitClassReward(r)?"Gimkit mode bars reset":"Class goal reset");
}

async function deleteReward(id){const r=state.root.rewards?.[id];if(!r||!confirm(`Delete “${r.name}” from the Prize Store? Past request history will be kept.`))return;await sdb().ref(`${ROOT}/rewards/${id}/active`).set(false);toast("Reward deleted")}
async function toggleRewardStore(){const open=classStoreOpen(),next=!open;
  if(state.teacherMode){try{await teacherApi("setStore",{classId:state.classId,open:next})}catch(err){toast(err.message,"error");return}await loadRoot();render();toast(open?"Prize Store purchasing closed":"Prize Store purchasing opened");return}
  if(isTeacherStore(state.classId)){await db.ref(`${ROOT}/settings/classStoreEnabled/${state.classId}`).set(next);state.root.settings=state.root.settings||{};(state.root.settings.classStoreEnabled??={})[state.classId]=next;render();toast(open?"Prize Store purchasing closed":"Prize Store purchasing opened");return}
  await db.ref(`${ROOT}/settings/rewardStoreEnabled`).set(next);state.root.settings=state.root.settings||{};state.root.settings.rewardStoreEnabled=next;render();toast(open?"Prize Store purchasing closed":"Prize Store purchasing opened")}
// Puts the stock a purchase reserved back (the same rule as a student cancelling and the server's Decline/Refund).
async function returnStock(item){
  const q=state.root.rewards?.[item.rewardId]?.quantity;
  const reserved=item.quantityReserved===true||(item.quantityReserved===undefined&&q!=null&&Number.isFinite(Number(q))&&Number(q)>=0);
  if(reserved)await sdb().ref(`${ROOT}/rewards/${item.rewardId}/quantity`).transaction(cur=>{const n=Number(cur);return Number.isFinite(n)&&n>=0?n+1:undefined}).catch(()=>{});
}
async function review(sid,key,decision,{quiet=false}={}){
  if(state.teacherMode){try{const r=await teacherApi("review",{studentId:sid,key,decision});if(!quiet)toast(`Request ${r.status}`);return true}catch(err){toast(err.message,"error");return false}}
  const item=state.root.redemptionsByStudent?.[sid]?.[key];if(!item)return;
  const updates={}, stamp=now(),status=decision==="approve"?"ready":decision==="collect"?"collected":"declined";
  const expected=decision==="collect"?"ready":"pending";
  const claim=await sdb().ref(`${ROOT}/redemptionsByStudent/${sid}/${key}/status`).transaction(cur=>String(cur||"pending")===expected?status:undefined);
  if(!claim.committed){toast("The student already canceled or this request was already handled.","error");return false}
  updates[`${ROOT}/redemptionsByStudent/${sid}/${key}/reviewedBy`]=state.user.email;
  updates[`${ROOT}/redemptionsByStudent/${sid}/${key}/reviewedAt`]=stamp;
  if(decision==="decline"){
    await changeBalance(sid,Number(item.cost||0));
    await returnStock(item);
    const r=state.root.rewards?.[item.rewardId],requestMs=timeMs(item.requestedAt),lastMs=timeMs(r?.lastRedeemedAt);
    if(r&&requestMs&&lastMs&&Math.abs(requestMs-lastMs)<5000){
      updates[`${ROOT}/rewards/${item.rewardId}/lastRedeemedAt`]=null;
      updates[`${ROOT}/rewards/${item.rewardId}/cooldownUntil`]=null;
    }
  }
  await sdb().ref().update(updates);if(!quiet)toast(`Request ${status}`);return true
}
function reportRows(){const out=[];for(const s of roster()){const dates=new Set([...Object.keys(state.root.dailyAwards?.[s.id]?.[state.classId]||{}),...Object.keys(state.root.dailyAttendance?.[s.id]?.[state.classId]||{})]);for(const date of dates){const a=state.root.dailyAttendance?.[s.id]?.[state.classId]?.[date],aw=state.root.dailyAwards?.[s.id]?.[state.classId]?.[date];out.push({student:s.name,date,status:a?.status||"present",points:Number(aw?.points||0)})}}return out.sort((a,b)=>b.date.localeCompare(a.date)||a.student.localeCompare(b.student))}
function exportCSV(){const q=v=>`"${String(v).replaceAll('"','""')}"`;const csv=[["Student","Date","Attendance","Points"],...reportRows().map(r=>[r.student,r.date,r.status,r.points])].map(row=>row.map(q).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`brightpath-${state.classId}-${C.schoolDateString()}.csv`;a.click();URL.revokeObjectURL(a.href)}
async function addStudent(e){if(state.teacherMode){toast("Only the administrator can change this.","error");return}e.preventDefault();const name=$("#newStudentName").value.trim();if(!name)return;const id=`student-${crypto.randomUUID?crypto.randomUUID():Date.now()}`,ini=initials(name),colors=["#7c3aed","#2563eb","#0891b2","#059669","#d97706","#dc2626","#9333ea","#4f46e5"],color=colors[Math.floor(Math.random()*colors.length)];await db.ref().update({[`${ROOT}/students/${id}`]:{id,classId:state.classId,name,initials:ini,color,rewardBalance:0,active:true},[`${ROOT}/enrollments/${state.classId}/${id}`]:true});toast("Student added")}
async function addClass(e){if(state.teacherMode){toast("Only the administrator can change this.","error");return}e.preventDefault();const name=$("#newClassName").value.trim();if(!name)return;const id=`class-${crypto.randomUUID?crypto.randomUUID():Date.now()}`;await db.ref(`${ROOT}/classes/${id}`).set({id,name,schoolYear:state.root.settings?.schoolYear||"2026–27",active:true});toast("Class added")}
function schoolSection(){const enabled=String(state.root.settings?.studentWebsiteEnabled)!=="false";return `<div class="settings"><article><h2>School</h2><label>Display name <input id="displayName" value="${esc(state.root.settings?.displayName||"BrightPath")}"></label><label>Active school year <input id="schoolYear" value="${esc(state.root.settings?.schoolYear||"2026–27")}"></label></article><article><h2>Student website access</h2><label>Current status <b>${enabled?"Enabled":"Blocked"}</b></label><button class="primary" id="settingsAccess">${enabled?"Block student website":"Enable student website"}</button></article><article><h2>Daily rating scale</h2><label>Excellent <b>110%</b></label><label>Good (default) <b>100%</b></label><label>Fair <b>80%</b></label><label>Needs Improvement <b>50%</b></label></article><button class="primary" id="saveSettings">Save settings</button></div>`}
function storeSection(){
  const open=classStoreOpen();
  return `<div class="settings"><article><h2>Prize Store open / closed — ${esc(cls()?.name||"class")}</h2><label>Right now <b>${open?"OPEN":"CLOSED"}</b></label><p style="font-size:13px;color:#788398;margin:0">${open?"Students can buy personal rewards and contribute to class goals.":"Students can browse rewards and progress, but cannot spend points."}</p><button class="primary" id="storeToggle">${open?"Close Prize Store":"Open Prize Store"}</button></article></div>`;
}
function classesSection(){
  const classes=allActiveClasses();
  return `<div class="people-grid">${classes.map(c=>{const count=C.classRoster(state.root,c.id).length;return `<article class="people-card"><h3>${esc(c.name)}</h3><p>${count} active student${count===1?"":"s"}${count?"":" · hidden from pickers while empty"} · ${esc(c.schoolYear||"")}</p><button data-openclass="${esc(c.id)}">${c.id===state.classId?"Selected":"Open class"}</button></article>`}).join("")}</div><div class="admincolumns" style="margin-top:20px"><section><h2>${esc(cls()?.name||"Class")} roster</h2><div class="teacherlist">${roster().map(s=>`<div><em>${esc(s.initials)}</em><span><b>${esc(s.name)}</b><small>${Number(s.rewardBalance)||0} reward points</small></span></div>`).join("")}</div></section><section><h2>Add a student to ${esc(cls()?.name||"class")}</h2><form id="addStudentForm" class="adminform"><label>Student full name<input id="newStudentName" required></label><p style="font-size:11px;color:#788398">The student must also be on the main Fun Torah Tools approved-student list to use the shared B3 login.</p><button class="primary">Create student</button></form><h2 style="margin-top:22px">Add a class</h2><form id="addClassForm" class="inlineform"><input id="newClassName" required placeholder="Class name"><button>Add class</button></form></section></div>`;
}
function settingsPage(){
  const sections=state.teacherMode?[["store","Prize Store"],["comments","Comments"],["categories","Categories"]]:[["school","School & access"],["store","Prize Store"],["categories","Categories"],["comments","Comments"],["classes","Classes & roster"]];
  if(!sections.some(x=>x[0]===state.settingsSection))state.settingsSection=sections[0][0];
  const body={school:schoolSection,store:storeSection,categories:categoriesSection,comments:commentsSection,classes:classesSection}[state.settingsSection]();
  return `<section class="workspace settings-page"><div class="workhead"><div><p class="eyebrow">SETTINGS</p><h1>Settings</h1><p>Categories, comments, classes, the Prize Store switch and everything else that is not a daily task.</p></div></div><div class="settings-tabs">${sections.map(([id,label])=>`<button type="button" class="${state.settingsSection===id?"active":""}" data-settings-section="${id}">${esc(label)}</button>`).join("")}</div>${body}</section>`;
}
async function toggleAccess(){if(state.teacherMode){toast("Only the administrator can change this.","error");return}const enabled=String(state.root.settings?.studentWebsiteEnabled)!=="false";await db.ref(`${ROOT}/settings/studentWebsiteEnabled`).set(enabled?"false":"true");toast(enabled?"Student website blocked":"Student website enabled")}
async function saveSettings(){if(state.teacherMode){toast("Only the administrator can change this.","error");return}await db.ref(`${ROOT}/settings`).update({displayName:$("#displayName").value.trim()||"BrightPath",schoolYear:$("#schoolYear").value.trim()||"2026–27"});toast("Settings saved")}
function bindActivity(){
  if($("#approveAllActivity"))$("#approveAllActivity").onclick=approveAllActivityPoints;
  document.querySelectorAll("[data-point-approve]").forEach(b=>b.onclick=()=>approveActivityPoint(b.dataset.pointApprove).then(()=>{if(!state.teacherMode)loadRoot().then(render)}));
  document.querySelectorAll("[data-point-reject]").forEach(b=>b.onclick=()=>rejectActivityPoint(b.dataset.pointReject).then(()=>{if(!state.teacherMode)loadRoot().then(render)}));
}
function bindPage(){
  document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.go;if(state.tab==="Students")state.studentOpen="";render();window.scrollTo(0,0)});
  document.querySelectorAll("[data-settings-go]").forEach(b=>b.onclick=()=>{state.tab="Settings";state.settingsSection=b.dataset.settingsGo;render();window.scrollTo(0,0)});
  document.querySelectorAll("[data-open-student]").forEach(b=>b.onclick=()=>openStudent(b.dataset.openStudent));
  document.querySelectorAll("[data-jump]").forEach(b=>b.onclick=()=>document.getElementById("activityQueue")?.scrollIntoView({behavior:"smooth"}));
  document.querySelectorAll("[data-give]").forEach(b=>b.onclick=()=>{const [s,k]=b.dataset.give.split("|");givePrize(s,k)});
  document.querySelectorAll("[data-refund-contribution]").forEach(b=>b.onclick=()=>{const [s,k]=b.dataset.refundContribution.split("|");refundContributionNow(s,k)});
  document.querySelectorAll("[data-refund-approve]").forEach(b=>b.onclick=()=>{const [s,k]=b.dataset.refundApprove.split("|");decideRefund(s,k,"approve").then(()=>loadRoot().then(render))});
  document.querySelectorAll("[data-refund-decline]").forEach(b=>b.onclick=()=>{const [s,k]=b.dataset.refundDecline.split("|");decideRefund(s,k,"decline").then(()=>loadRoot().then(render))});
  if(state.tab==="Today"){
    bindQuickAward();bindActivity();
    $("#saveDaily").onclick=saveDaily;document.querySelectorAll("[data-att]").forEach(b=>b.onclick=()=>{const id=b.dataset.att;state.draftDirty=true;state.absent.has(id)?state.absent.delete(id):state.absent.add(id);render()});
    document.querySelectorAll("[data-rating]").forEach(s=>s.onchange=()=>{state.draftDirty=true;state.draft[`${s.dataset.rating}|${s.dataset.cat}`]=s.value;render()});
  }
  if(state.tab==="Students"){
    if($("#studentsScope"))$("#studentsScope").onchange=e=>{state.studentsAll=e.target.value==="all";render()};
    if($("#studentSearch"))$("#studentSearch").oninput=e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll("[data-student-card]").forEach(c=>{c.hidden=Boolean(q)&&!c.dataset.name.includes(q)})};
    if($("#pointsCsv"))$("#pointsCsv").onclick=exportPointsCSV;
    if($("#csvBtn"))$("#csvBtn").onclick=exportCSV;if($("#printBtn"))$("#printBtn").onclick=()=>window.print();
    if($("#backToStudents"))$("#backToStudents").onclick=()=>{state.studentOpen="";render();window.scrollTo(0,0)};
    if($("#adjustPoints"))$("#adjustPoints").onclick=()=>adjustPoints(state.root.students?.[state.studentOpen]);
    if($("#pointsRange"))$("#pointsRange").onchange=e=>{state.pointRange=e.target.value;render()};
    if($("#pointsType"))$("#pointsType").onchange=e=>{state.pointType=e.target.value;render()};
    if($("#pointsSearch")){$("#pointsSearch").oninput=e=>{state.pointSearch=e.target.value;const pos=e.target.selectionStart;render();requestAnimationFrame(()=>{const n=$("#pointsSearch");if(n){n.focus();n.setSelectionRange(pos,pos)}})}}
    document.querySelectorAll("[data-points-source]").forEach(b=>b.onclick=()=>{state.pointType=b.dataset.pointsSource;state.pointRange="all";state.pointStatus=state.pointType==="gap"?"all":"posted";state.pointSearch="";render();requestAnimationFrame(()=>document.querySelector(".points-ledger")?.scrollIntoView({behavior:"smooth",block:"start"}))});
  }
  if(state.tab==="Prize Store"){
    $("#addReward").onclick=()=>editReward();if($("#addClassReward"))$("#addClassReward").onclick=()=>editClassReward();
    document.querySelectorAll("[data-toggle-reward]").forEach(b=>b.onclick=()=>toggleRewardAvailability(b.dataset.toggleReward));document.querySelectorAll("[data-editreward]").forEach(b=>b.onclick=()=>editReward(b.dataset.editreward));document.querySelectorAll("[data-deletereward]").forEach(b=>b.onclick=()=>deleteReward(b.dataset.deletereward));
    document.querySelectorAll("[data-toggle-class-reward]").forEach(b=>b.onclick=()=>toggleClassRewardAvailability(b.dataset.toggleClassReward));document.querySelectorAll("[data-editclassreward]").forEach(b=>b.onclick=()=>editClassReward(b.dataset.editclassreward));document.querySelectorAll("[data-deleteclassreward]").forEach(b=>b.onclick=()=>deleteClassReward(b.dataset.deleteclassreward));document.querySelectorAll("[data-resetclassreward]").forEach(b=>b.onclick=()=>resetClassReward(b.dataset.resetclassreward));
  }
  if(state.tab==="Settings"){
    document.querySelectorAll("[data-settings-section]").forEach(b=>b.onclick=()=>{state.settingsSection=b.dataset.settingsSection;render()});
    if($("#settingsAccess"))$("#settingsAccess").onclick=toggleAccess;if($("#saveSettings"))$("#saveSettings").onclick=saveSettings;
    if($("#storeToggle"))$("#storeToggle").onclick=toggleRewardStore;
    if($("#addCategory"))$("#addCategory").onclick=addCategory;document.querySelectorAll("[data-catdelete]").forEach(b=>b.onclick=()=>removeCategory(b.dataset.catdelete));
    if($("#commentPicker"))$("#commentPicker").onchange=e=>{state.selectedId=e.target.value;render()};if($("#commentForm"))$("#commentForm").onsubmit=addComment;
    document.querySelectorAll("[data-openclass]").forEach(b=>b.onclick=()=>{state.classId=b.dataset.openclass;renderClassSelect();prepareDraft();render()});
    if($("#addStudentForm"))$("#addStudentForm").onsubmit=addStudent;if($("#addClassForm"))$("#addClassForm").onsubmit=addClass;
  }
}
function shiftDate(n){const d=new Date(`${state.date}T12:00:00`);d.setDate(d.getDate()+n);state.date=d.toISOString().slice(0,10);prepareDraft();render()}
$("#prevDate").onclick=()=>shiftDate(-1);$("#nextDate").onclick=()=>shiftDate(1);$("#topDate").onchange=e=>{state.date=e.target.value;prepareDraft();render()};
$("#googleBtn").onclick=async()=>{try{await B3TeacherSignIn()}catch(err){$("#loginError").textContent=err.message||String(err)}};
$("#signOutBtn").onclick=()=>auth.signOut();
auth.onAuthStateChanged(async user=>{
  if(!user){state.user=null;$("#loginView").classList.remove("hidden");$("#appView").classList.add("hidden");return}
  state.teacherMode=!user.email||user.email.toLowerCase()!==ADMIN.toLowerCase();
  NAV=state.teacherMode?TEACHER_NAV:OWNER_NAV;if(!NAV.includes(state.tab))state.tab="Today";
  state.user=user;
  try{await loadRoot()}catch(err){state.user=null;$("#loginView").classList.remove("hidden");$("#appView").classList.add("hidden");$("#loginError").textContent="Could not open Student Rewards: "+(err.message||String(err))+" Refresh the page to try again.";return}
  $("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden");
  if(!state.teacherMode){const seeded=await ensureRewardModelV2();if(seeded)await loadRoot();}
  if(REQUESTED_STUDENT&&state.root.students?.[REQUESTED_STUDENT]){state.tab="Students";state.studentOpen=REQUESTED_STUDENT;state.pointClassId="all";state.pointStudent=REQUESTED_STUDENT;state.pointRange="all"}
  subscribe();render();
});
})();
