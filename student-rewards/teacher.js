// CLASS 1000-POINT REWARDS UPDATE - 2026-09-23
(function(){
'use strict';
const C=window.StudentRewardsCommon;
const {db,auth}=C.ensureFirebase();
const ROOT=C.ROOT, ADMIN=C.ADMIN_EMAIL;
const NAV=["Overview","Daily Points","Students","Categories","Comments","Rewards","Reports","People & Classes","Settings"];
const ICONS={"Overview":"⌂","Daily Points":"✓","Students":"♙","Categories":"☷","Comments":"✎","Rewards":"◇","Reports":"▤","People & Classes":"♧","Settings":"⚙"};
const CLASS_1000_REWARDS=[
  {key:"gimkit",name:"Gimkit",icon:"🎯"},
  {key:"kahoot",name:"Kahoot",icon:"❓"},
  {key:"video",name:"Video",icon:"🎬"},
  {key:"create-new-game",name:"Create a New Game",icon:"🎮"},
  {key:"extra-class-game-time",name:"Extra Class Time for a Game",icon:"⏰"},
  {key:"extra-recess",name:"Extra Recess",icon:"🏃"},
  {key:"chat-in-zoom",name:"Chat in Zoom",icon:"💬"}
];
let state={root:null,user:null,tab:"Overview",classId:"",date:C.schoolDateString(),draft:{},awardDraft:{},absent:new Set(),selectedId:""};
const $=s=>document.querySelector(s), esc=C.escapeHtml;
function vals(o){return o&&typeof o==="object"?Object.values(o):[]}
function activeClasses(){return C.activeClasses(state.root||{})}
function roster(){return C.classRoster(state.root||{},state.classId)}
function categories(){return C.activeCategories(state.root||{})}
function cls(){return state.root?.classes?.[state.classId]||null}
function initials(name){return String(name||"SC").trim().split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()}
function toast(msg,type="ok"){C.toast(msg,type)}
function now(){return new Date().toISOString()}
function scoreFor(s){return C.cumulativeProgress(C.allProgressRows(state.root,s.id,state.classId))??100}
function currentStudent(){const r=roster();return r.find(s=>s.id===state.selectedId)||r[0]||null}
function getRedemptions(){const out=[];for(const [sid,rows] of Object.entries(state.root?.redemptionsByStudent||{}))for(const [key,item] of Object.entries(rows||{}))out.push({sid,key,item});return out.sort((a,b)=>String(b.item.requestedAt||"").localeCompare(String(a.item.requestedAt||"")))}
function getActivityPointRequests(){
  return Object.entries(state.root?.pointRequests||{})
    .map(([id,item])=>({id,item:item||{}}))
    .filter(x=>!state.classId || !x.item.classId || x.item.classId===state.classId)
    .sort((a,b)=>(Number(b.item.createdAt)||0)-(Number(a.item.createdAt)||0));
}
function pendingActivityPointRequests(){return getActivityPointRequests().filter(x=>x.item.status==="pending")}
function pendingCount(){return getRedemptions().filter(x=>x.item.status==="pending"||x.item.status==="ready").length+pendingActivityPointRequests().length}
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
  $("#nav").innerHTML=NAV.map(n=>`<button data-tab="${esc(n)}"><i>${ICONS[n]}</i><span>${esc(n)}</span>${n==="Rewards"&&pendingCount()?`<mark>${pendingCount()}</mark>`:""}</button>`).join("");
  $("#nav").onclick=e=>{const b=e.target.closest("[data-tab]");if(!b)return;state.tab=b.dataset.tab;render()};
}
function renderClassSelect(){
  const el=$("#classSelect"), rows=activeClasses();
  el.innerHTML=rows.map(c=>`<option value="${esc(c.id)}" ${c.id===state.classId?"selected":""}>${esc(c.name)}</option>`).join("");
  el.onchange=()=>{state.classId=el.value;state.selectedId="";prepareDraft();render()};
}
async function loadRoot(){
  const snap=await db.ref(ROOT).once("value");state.root=snap.val()||{};
  if(!state.classId||!state.root.classes?.[state.classId]?.active)state.classId=activeClasses()[0]?.id||"";
  prepareDraft();renderClassSelect();setHeader();buildNav();
}
async function ensureClass1000Rewards(){
  if(state.root?.settings?.class1000RewardsSeededV1===true)return false;
  const updates={};
  const norm=v=>String(v||"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const existingRewards=Object.entries(state.root?.rewards||{});
  const existingClass=Object.entries(state.root?.classRewardCatalog||{});
  for(const preset of CLASS_1000_REWARDS){
    const rewardMatch=existingRewards.find(([,r])=>norm(r?.name)===norm(preset.name));
    const rid=rewardMatch?.[0]||`class-1000-${preset.key}`;
    const oldReward=rewardMatch?.[1]||{};
    updates[`${ROOT}/rewards/${rid}`]={...oldReward,id:rid,name:preset.name,cost:1000,icon:preset.icon,color:oldReward.color||"#ede9fe",active:true,quantity:oldReward.quantity??-1};

    const classMatch=existingClass.find(([,r])=>norm(r?.name)===norm(preset.name));
    const cid=classMatch?.[0]||`class-incentive-${preset.key}`;
    const oldClass=classMatch?.[1]||{};
    updates[`${ROOT}/classRewardCatalog/${cid}`]={...oldClass,id:cid,name:preset.name,icon:preset.icon,cost:1000,active:true};
  }
  updates[`${ROOT}/settings/class1000RewardsSeededV1`]=true;
  await db.ref().update(updates);
  return true;
}
function subscribe(){db.ref(ROOT).on("value",snap=>{state.root=snap.val()||{};if(!state.classId||!state.root.classes?.[state.classId]?.active)state.classId=activeClasses()[0]?.id||"";renderClassSelect();if(state.tab!=="Daily Points"){setHeader();buildNav();render()}})}
function prepareDraft(){
  if(!state.root||!state.classId)return;state.draft={};state.awardDraft={};state.absent=new Set();
  for(const s of roster()){
    const att=state.root.dailyAttendance?.[s.id]?.[state.classId]?.[state.date];if(att?.status==="absent")state.absent.add(s.id);
    const saved=state.root.dailyRatings?.[s.id]?.[state.classId]?.[state.date];
    const savedAward=state.root.dailyAwards?.[s.id]?.[state.classId]?.[state.date];
    state.awardDraft[s.id]=savedAward&&Number.isFinite(Number(savedAward.points))?Number(savedAward.points):10;
    const prior=C.latestRatings(state.root,s.id,state.classId,state.date);
    const source=saved||prior.ratings||{};
    for(const cat of categories()){const found=vals(source).find(r=>r.category===cat.name);state.draft[`${s.id}|${cat.name}`]=found?.rating||"Good"}
  }
}
function isSavedDay(){return roster().some(s=>state.root?.dailyAwards?.[s.id]?.[state.classId]?.[state.date])}
function render(){if(!state.root||!state.user)return;setHeader();buildNav();document.querySelectorAll("#nav [data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===state.tab));const p=$("#page");
  if(state.tab==="Overview")p.innerHTML=overview();
  if(state.tab==="Daily Points")p.innerHTML=daily();
  if(state.tab==="Students")p.innerHTML=students();
  if(state.tab==="Categories")p.innerHTML=categoriesPage();
  if(state.tab==="Comments")p.innerHTML=commentsPage();
  if(state.tab==="Rewards")p.innerHTML=rewardsPage();
  if(state.tab==="Reports")p.innerHTML=reportsPage();
  if(state.tab==="People & Classes")p.innerHTML=peoplePage();
  if(state.tab==="Settings")p.innerHTML=settingsPage();
  bindPage();
}
function overview(){
  const r=roster(), avg=classAverage(), scored=savedTodayIds().size, pending=pendingCount(), enabled=String(state.root.settings?.studentWebsiteEnabled)!=="false";
  return `<div class="welcome"><div><p class="eyebrow">SIGNED IN AS ADMIN</p><h1>Good afternoon, ${esc(state.user.displayName||"Simcha Cohen")}</h1><p>Here’s how ${esc(cls()?.name||"your class")} is doing today.</p></div><button class="primary" data-go="Daily Points">+ Give today’s points</button></div>
  <div class="stats">
    <article class="stat purple"><i>↗</i><div><span>Class average</span><strong>${avg}%</strong><small class="up">Based on saved ratings</small></div><div class="bars"><b></b><b></b><b></b><b></b><b></b><b></b></div></article>
    <article class="stat gold"><i>★</i><div><span>Students scored today</span><strong>${scored}</strong><small>of ${r.length} students</small></div><div class="ring" style="background:conic-gradient(#e7ae34 ${r.length?Math.round(scored/r.length*100):0}%,#f1f2f6 0)"><b>${r.length?Math.round(scored/r.length*100):0}%</b></div></article>
    <article class="stat green click" data-go="Rewards"><i>◇</i><div><span>Reward requests</span><strong>${pending}</strong><small>${pending?"awaiting approval":"All caught up"}</small></div><button>→</button></article>
  </div>
  <div class="dash">
    <section class="panel"><div class="panelhead"><div><h2>Student performance</h2><p>Today’s saved score</p></div><button data-go="Students">View all →</button></div><div class="list">${r.slice(0,6).map(s=>`<button class="studentrow" data-student="${esc(s.id)}"><em style="background:${esc(safeColor(s))}">${esc(s.initials)}</em><span><strong>${esc(s.name)}</strong><small>${Number(s.rewardBalance)||0} reward points</small></span><u><i style="width:${Math.min(100,scoreFor(s))}%;background:${esc(safeColor(s))}"></i></u><b>${scoreFor(s)}%</b></button>`).join("")}</div></section>
    <section class="panel"><div class="panelhead"><div><h2>Quick actions</h2><p>Common classroom tasks</p></div></div><div class="quick">
      <button class="access-toggle ${enabled?"enabled":"blocked"}" id="accessToggle"><i>${enabled?"✓":"×"}</i><b>${enabled?"Student Website Enabled":"Student Website Blocked"}</b><small>${enabled?"Click to block student access":"Click to reopen student access"}</small></button>
      <button data-go="Daily Points"><i class="q-purple">✓</i><b>Daily points</b><small>Score the whole class</small></button>
      <button data-go="Rewards"><i class="q-gold">◇</i><b>Approve rewards</b><small>${pending} requests waiting</small></button>
      <button data-go="Students"><i class="q-blue">±</i><b>Adjust points</b><small>Does not affect averages</small></button>
      <button data-go="People & Classes"><i class="q-green">♧</i><b>Manage students</b><small>Classes and enrollment</small></button>
    </div></section>
  </div>`;
}
function carryDate(s){return C.latestRatings(state.root,s.id,state.classId,state.date).date||""}
function daily(){
  const cats=categories(), r=roster(), saved=isSavedDay(), carried=!saved&&r.some(s=>carryDate(s));
  return `<section class="workspace"><div class="workhead"><div><p class="eyebrow">${esc((cls()?.name||"CLASS").toUpperCase())} · EDITING ${esc(state.date)}</p><h1>Daily Points</h1><p>Entering or reviewing points for <strong>${new Date(`${state.date}T12:00:00`).toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</strong>.</p></div><div class="workcontrols"><label class="pagepicker"><span>Class</span><select id="dailyClass">${activeClasses().map(c=>`<option value="${esc(c.id)}" ${c.id===state.classId?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label><div class="savegroup">${saved?`<span class="savedday">✓ Already saved — changes will replace this day</span>`:`<span class="unsavedday">Draft only — no points awarded yet</span>`}<button id="saveDaily" class="primary">${saved?"Update saved day":"Save whole class"}</button></div></div></div>
  ${carried?`<div class="carrynotice"><b>↶ Ratings carried forward — not yet saved</b><span>Each student starts with their most recent previously saved ratings in this class. Review or change them, then save to award points for this date.</span></div>`:""}
  <div class="key"><span>● Excellent</span><span>● Good</span><span>● Fair</span><span>● Needs Improvement</span></div>
  <div class="table">
    <div class="row tablehead" style="grid-template-columns:minmax(170px,1.6fr) 110px repeat(${cats.length},minmax(125px,1fr)) 110px"><span>Student</span><span>Attendance</span>${cats.map(c=>`<span>${esc(c.name)}</span>`).join("")}<span>${saved?"Saved":"Unsaved Draft"}</span></div>
    ${r.map(s=>dailyRow(s,cats,saved)).join("")}
  </div></section>`;
}
function dailyRow(s,cats,saved){
  const absent=state.absent.has(s.id), ratings=cats.map(c=>state.draft[`${s.id}|${c.name}`]||"Good"), prog=absent?0:(C.dailyProgress(ratings)||0), award=absent?0:Number(state.awardDraft[s.id]??10), cdate=carryDate(s);
  return `<div class="row ${absent?"absentrow":""}" style="grid-template-columns:minmax(170px,1.6fr) 110px repeat(${cats.length},minmax(125px,1fr)) 110px">
    <div class="person"><em style="background:${esc(safeColor(s))}">${esc(s.initials)}</em><span><b>${esc(s.name)}</b>${!saved&&cdate?`<small class="carrysource">Started from ${new Date(`${cdate}T12:00:00`).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</small>`:""}</span></div>
    <div class="attendance-wrap"><button class="attendance ${absent?"absent":""}" data-att="${esc(s.id)}">${absent?"Absent":"Present"}</button></div>
    ${cats.map(c=>{const val=state.draft[`${s.id}|${c.name}`]||"Good";return `<div><select class="${ratingClass(val)}" data-rating="${esc(s.id)}" data-cat="${esc(c.name)}" ${absent?"disabled":""}>${["Excellent","Good","Fair","Needs Improvement"].map(x=>`<option ${x===val?"selected":""}>${x}</option>`).join("")}</select></div>`}).join("")}
    <div class="today ${absent?"absentresult":""}"><strong>${absent?"Absent":`${prog}%`}</strong><small>${absent?"0 points":`<input class="daily-award-input" data-award="${esc(s.id)}" type="number" min="0" step="1" value="${award}" aria-label="Reward points for ${esc(s.name)}"> points if saved`}</small></div>
  </div>`;
}
function ratingClass(v){return String(v).toLowerCase().replace(/\s+/g,"-").replace("fair","average")}
async function saveDaily(){
  const updates={}, cats=categories(), r=roster(), stamp=now(), balanceDeltas=[];
  for(const s of r){
    const absent=state.absent.has(s.id), ratings={};
    if(!absent)for(const cat of cats){const rating=state.draft[`${s.id}|${cat.name}`]||"Good";ratings[C.categoryKey(cat.name)]={category:cat.name,rating,points:C.progressValue[rating]??100,teacherEmail:state.user.email,savedAt:stamp}}
    const newAward=absent?0:Math.max(0,Math.round(Number(state.awardDraft[s.id]??10)||0));
    const oldAward=Number(state.root.dailyAwards?.[s.id]?.[state.classId]?.[state.date]?.points||0);
    updates[`${ROOT}/dailyRatings/${s.id}/${state.classId}/${state.date}`]=absent?null:ratings;
    updates[`${ROOT}/dailyAwards/${s.id}/${state.classId}/${state.date}`]={points:newAward,teacherEmail:state.user.email,savedAt:stamp};
    updates[`${ROOT}/dailyAttendance/${s.id}/${state.classId}/${state.date}`]={status:absent?"absent":"present",teacherEmail:state.user.email,savedAt:stamp};
    balanceDeltas.push({id:s.id,delta:newAward-oldAward});
  }
  await db.ref().update(updates);
  // Use a transaction for the balance so Posuk Practice / Chazara points
  // earned at the same time can never be overwritten by a stale teacher page.
  await Promise.all(balanceDeltas.filter(x=>x.delta!==0).map(x=>db.ref(`${ROOT}/students/${x.id}/rewardBalance`).transaction(cur=>Math.max(0,Number(cur||0)+x.delta))));
  toast(`Saved ${r.length} students`);await loadRoot();render();
}
function studentHistory(s){const out=[];for(const [date,aw] of Object.entries(state.root.dailyAwards?.[s.id]?.[state.classId]||{})){const at=state.root.dailyAttendance?.[s.id]?.[state.classId]?.[date];out.push({date,points:Number(aw?.points||0),status:at?.status||"present"})}return out.sort((a,b)=>b.date.localeCompare(a.date))}
function students(){
  const r=roster(), s=currentStudent();if(s&&!state.selectedId)state.selectedId=s.id;
  if(!s)return `<section class="workspace"><div class="empty"><h3>No students in this class</h3><p>Use People & Classes to add students.</p></div></section>`;
  const rows=C.allProgressRows(state.root,s.id,state.classId), g={};for(const x of rows){g[x.category]??={e:0,p:0};g[x.category].e+=Number(x.points)||0;g[x.category].p+=100}
  return `<section class="workspace"><div class="workhead"><div><p class="eyebrow">STUDENT PROGRESS</p><h1>Students</h1><p>Review growth, balances, and daily history.</p></div><select id="studentPicker" class="picker">${r.map(x=>`<option value="${esc(x.id)}" ${x.id===s.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div>
    <div class="studenthero"><em class="huge" style="background:${esc(safeColor(s))}">${esc(s.initials)}</em><div><h2>${esc(s.name)}</h2><p>${scoreFor(s)}% overall progress</p></div><button class="balance" id="adjustPoints"><span>CURRENT POINT BALANCE</span><b>${Number(s.rewardBalance)||0} ★</b><small>Click to adjust points</small></button></div>
    <div class="categories">${Object.entries(g).map(([name,x])=>{const pct=x.p?Math.round(x.e/x.p*100):0;return `<article><span>${esc(name)}</span><b>${pct}%</b><u><i style="width:${Math.min(110,pct)}%;background:${esc(safeColor(s))}"></i></u><small>${x.e} of ${x.p} progress points</small></article>`}).join("")||`<article><span>Progress</span><b>—</b><small>No saved ratings yet</small></article>`}</div>
    <section class="panel" style="margin-top:18px"><div class="panelhead"><div><h2>Daily History</h2><p>Saved points and attendance</p></div></div><div class="historytable"><table><thead><tr><th>Date</th><th>Attendance</th><th>Points</th></tr></thead><tbody>${studentHistory(s).map(x=>`<tr><td>${esc(C.formatDate(x.date))}</td><td>${esc(x.status)}</td><td>${x.points} ★</td></tr>`).join("")||`<tr><td colspan="3">No saved days yet.</td></tr>`}</tbody></table></div></section>
  </section>`;
}
async function adjustPoints(){
  const s=currentStudent();if(!s)return;const raw=prompt(`Adjust ${s.name}'s points. Use a positive number to add or a negative number to deduct:`,"5");if(raw===null)return;const amount=Number(raw);if(!Number.isInteger(amount)||amount===0)return toast("Enter a whole number","error");
  const reason=prompt("Reason:","Teacher adjustment")||"Teacher adjustment", key=db.ref(`${ROOT}/pointAdjustments`).push().key;
  let applied=0;
  await db.ref(`${ROOT}/students/${s.id}/rewardBalance`).transaction(cur=>{const old=Number(cur||0),next=Math.max(0,old+amount);applied=next-old;return next});
  await db.ref(`${ROOT}/pointAdjustments/${key}`).set({id:key,studentId:s.id,classId:state.classId,amount:applied,action:"teacher",reason,teacherEmail:state.user.email,createdAt:now()});
  toast("Balance updated");
}
function categoriesPage(){
  const cats=categories();
  return `<section class="workspace"><div class="workhead"><div><p class="eyebrow">DAILY SCORING</p><h1>Categories</h1><p>These are the areas scored on the Daily Points page.</p></div><button class="primary" id="addCategory">+ Add category</button></div><div class="category-grid">${cats.map((c,i)=>`<article class="category-card"><div class="catdot">${i+1}</div><h3>${esc(c.name)}</h3><p>Active · order ${Number(c.sortOrder||0)+1}</p><button data-catdelete="${esc(c.id)}">Remove</button></article>`).join("")}</div></section>`;
}
async function addCategory(){const name=prompt("Category name:");if(!name)return;const id=`cat-${crypto.randomUUID?crypto.randomUUID():Date.now()}`;await db.ref(`${ROOT}/categories/${id}`).set({id,teacherEmail:state.user.email,name:name.trim(),points:1,sortOrder:categories().length,active:true});toast("Category added")}
async function removeCategory(id){if(!confirm("Remove this category from future Daily Points screens? Old history will remain."))return;await db.ref(`${ROOT}/categories/${id}/active`).set(false);toast("Category removed")}
function commentsPage(){
  const s=currentStudent(), r=roster();if(s&&!state.selectedId)state.selectedId=s.id;const comments=s?vals(state.root.commentsByStudent?.[s.id]||{}).sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||""))):[];
  return `<section class="workspace"><div class="workhead"><div><p class="eyebrow">TEACHER NOTES</p><h1>Comments</h1><p>Write a private note or share encouragement with the student.</p></div><select id="commentPicker" class="picker">${r.map(x=>`<option value="${esc(x.id)}" ${s&&x.id===s.id?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div>${s?`<div class="admincolumns"><section><h2>${esc(s.name)}’s comments</h2><div class="commentlist">${comments.map(c=>`<article><p>${esc(c.body)}</p><small>${c.visibleToStudent===false?"Private teacher note":"Visible to student"} · ${c.createdAt?new Date(c.createdAt).toLocaleDateString():""}</small></article>`).join("")||`<div class="empty"><h3>No comments yet</h3><p>Add the first note for this student.</p></div>`}</div></section><section><h2>Add a comment</h2><form id="commentForm" class="adminform"><label>Comment<textarea id="commentText" required rows="5"></textarea></label><label class="check"><input id="commentVisible" type="checkbox" checked> Show this comment to the student</label><button class="primary">Save comment</button></form></section></div>`:`<div class="empty">No student selected.</div>`}</section>`;
}
async function addComment(e){e.preventDefault();const s=currentStudent(), body=$("#commentText").value.trim();if(!s||!body)return;const key=db.ref(`${ROOT}/commentsByStudent/${s.id}`).push().key;await db.ref(`${ROOT}/commentsByStudent/${s.id}/${key}`).set({id:key,studentId:s.id,body,visibleToStudent:$("#commentVisible").checked,teacherEmail:state.user.email,createdAt:now()});toast("Comment saved")}
function rewardsPage(){
  const rewards=vals(state.root.rewards||{}).filter(r=>r.active!==false).sort((a,b)=>(a.cost||0)-(b.cost||0)), req=getRedemptions(), classRewards=vals(state.root.classRewardCatalog||{}).filter(x=>x.active!==false), pointReq=pendingActivityPointRequests();
  const storeOpen=state.root.settings?.rewardStoreEnabled===true||String(state.root.settings?.rewardStoreEnabled)==="true";
  return `<section class="workspace"><div class="workhead"><div><p class="eyebrow">${esc((cls()?.name||"CLASS").toUpperCase())}</p><h1>Rewards & Requests</h1><p>Activity points wait for your approval before changing a student's balance.</p></div><a class="primary linkbutton" href="student.html">Open student portal</a></div>
  <section class="activity-queue"><div class="activity-head"><div><h2>Activity points awaiting approval</h2><p>Posuk Practice and Chazara requests. Nothing below has been added yet.</p></div><div class="activity-head-actions"><b>${pointReq.length}</b>${pointReq.length?`<button class="primary" id="approveAllActivity">Approve all</button>`:""}</div></div>${pointReq.length?pointReq.map(activityPointRow).join(""):`<div class="empty"><h3>No activity points waiting</h3><p>New 100% scores and Chazara points will appear here.</p></div>`}</section>
  <div class="storecontrol ${storeOpen?"open":"closed"}"><div><strong>Prize Store Purchasing: ${storeOpen?"OPEN":"CLOSED"}</strong><small>${storeOpen?"Students can submit reward requests.":"Students can browse prizes, but cannot buy anything."}</small></div><button class="primary" id="storeToggle">${storeOpen?"Close Prize Store":"Open Prize Store"}</button></div><div class="rewardlayout"><div><h2>Available rewards</h2><div class="rewardgrid">${rewards.map(r=>`<article><div class="rewardicon" style="background:${esc(r.color||"#ede9fe")}">${esc(r.icon||"🎁")}</div><h3>${esc(r.name)}</h3><p>${Number(r.cost)||0} ★ · ${Number(r.quantity)<0?"unlimited":`${r.quantity} left`}</p><div class="rewardactions"><button data-editreward="${esc(r.id)}">Edit</button><button class="rewarddelete" data-deletereward="${esc(r.id)}">Delete</button></div></article>`).join("")}</div><button class="primary" id="addReward" style="margin-top:14px">+ Add a reward</button><div class="rewardclass"><h2>Class incentives</h2><div class="classchips">${classRewards.map(x=>`<span>${esc(x.icon||"⭐")} ${esc(x.name)}${Number.isFinite(Number(x.cost))?` · ${Number(x.cost)} ★`:""}</span>`).join("")}</div></div></div><aside class="approvals"><div class="approvalhead"><span><h2>Prize request queue</h2><p>Pending, ready to collect, and completed history</p></span><b>${getRedemptions().filter(x=>x.item.status==="pending"||x.item.status==="ready").length}</b></div>${req.length?req.map(requestRow).join(""):`<div class="empty"><h3>No prize requests yet</h3><p>Student purchases will appear here immediately.</p></div>`}</aside></div></section>`;
}
function activityPointRow(x){
  const item=x.item||{}, s=state.root.students?.[item.rewardStudentId]||{}, amount=Number(item.amount||0), sign=amount>0?"+":"";
  const when=item.createdAt?new Date(Number(item.createdAt)).toLocaleString():"";
  return `<div class="activity-request"><em style="background:${esc(safeColor(s))}">${esc(s.initials||initials(item.studentName||"?"))}</em><span><strong>${esc(item.studentName||s.name||item.rewardStudentId||"Student")}</strong><small>${esc(item.reason||item.source||"Activity points")}${when?` · ${esc(when)}`:""}</small></span><b class="activity-amount ${amount<0?"deduct":""}">${sign}${amount} ★</b><button class="deny" data-point-reject="${esc(x.id)}" title="Reject">×</button><button class="approve" data-point-approve="${esc(x.id)}" title="Approve">✓</button></div>`;
}
function requestRow(x){const s=state.root.students?.[x.sid],r=state.root.rewards?.[x.item.rewardId],status=x.item.status||"pending";return `<div class="request"><em style="background:${esc(safeColor(s))}">${esc(s?.initials||"?")}</em><span><strong>${esc(s?.name||x.sid)}</strong><small>${esc(r?.name||"Reward")} · ${Number(x.item.cost)||0} ★ · ${esc(status)}</small></span>${status==="pending"?`<button class="deny" data-decline="${esc(x.sid)}|${esc(x.key)}">×</button><button class="approve" data-approve="${esc(x.sid)}|${esc(x.key)}">✓</button>`:""}${status==="ready"?`<button class="approve" data-collect="${esc(x.sid)}|${esc(x.key)}">Given</button>`:""}</div>`}
async function setChazaraPointStatus(item,status){
  if(!item?.eventId||!item?.practiceStudentId)return;
  const path=`posukPractice/chazara/events/${item.practiceStudentId}/${item.eventId}`;
  const field=Number(item.amount||0)<0?"removalPointRequestStatus":"pointRequestStatus";
  try{await db.ref(path+'/'+field).set(status)}catch(e){console.warn('Could not mirror Chazara point status',e)}
}
async function approveActivityPoint(id,quiet=false){
  const live=(await db.ref(`${ROOT}/pointRequests/${id}`).once("value")).val();
  if(!live||live.status!=="pending")return false;
  const reqRef=db.ref(`${ROOT}/pointRequests/${id}`), stamp=now();
  const lock=await reqRef.transaction(cur=>cur&&cur.status==="pending"?{...cur,status:"processing",reviewedBy:state.user.email,reviewStartedAt:stamp}:undefined);
  if(!lock.committed)return false;
  const item=lock.snapshot.val()||live, sid=item.rewardStudentId, amount=Number(item.amount||0);
  let applied=0,balanceAfter=0;
  try{
    const bal=await db.ref(`${ROOT}/students/${sid}/rewardBalance`).transaction(cur=>{const old=Number(cur||0),next=Math.max(0,old+amount);applied=next-old;return next});
    if(!bal.committed)throw new Error('Balance update did not commit');
    balanceAfter=Number(bal.snapshot.val()||0);
    await reqRef.update({status:"approved",actualAmount:applied,balanceAfter,reviewedBy:state.user.email,reviewedAt:now()});
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
}
async function editReward(id=""){const old=id?state.root.rewards[id]:null,name=prompt("Reward name:",old?.name||"");if(!name)return;const cost=Number(prompt("Point cost:",String(old?.cost??25)));if(!Number.isFinite(cost)||cost<0)return;const icon=prompt("Emoji/icon:",old?.icon||"🎁")||"🎁",rid=id||`reward-${crypto.randomUUID?crypto.randomUUID():Date.now()}`;await db.ref(`${ROOT}/rewards/${rid}`).set({id:rid,name:name.trim(),cost:Math.round(cost),icon,color:old?.color||"#ede9fe",active:true,quantity:old?.quantity??-1});toast(id?"Reward updated":"Reward added")}
async function deleteReward(id){const r=state.root.rewards?.[id];if(!r||!confirm(`Delete “${r.name}” from the Prize Store? Past request history will be kept.`))return;await db.ref(`${ROOT}/rewards/${id}/active`).set(false);toast("Reward deleted")}
async function toggleRewardStore(){const open=state.root.settings?.rewardStoreEnabled===true||String(state.root.settings?.rewardStoreEnabled)==="true";await db.ref(`${ROOT}/settings/rewardStoreEnabled`).set(!open);toast(open?"Prize Store purchasing closed":"Prize Store purchasing opened")}
async function review(sid,key,decision){const item=state.root.redemptionsByStudent?.[sid]?.[key];if(!item)return;const updates={}, stamp=now();const status=decision==="approve"?"ready":decision==="collect"?"collected":"declined";updates[`${ROOT}/redemptionsByStudent/${sid}/${key}/status`]=status;updates[`${ROOT}/redemptionsByStudent/${sid}/${key}/reviewedBy`]=state.user.email;updates[`${ROOT}/redemptionsByStudent/${sid}/${key}/reviewedAt`]=stamp;if(decision==="decline")updates[`${ROOT}/students/${sid}/rewardBalance`]=Number(state.root.students[sid].rewardBalance||0)+Number(item.cost||0);await db.ref().update(updates);toast(`Request ${status}`)}
function reportRows(){const out=[];for(const s of roster()){const dates=new Set([...Object.keys(state.root.dailyAwards?.[s.id]?.[state.classId]||{}),...Object.keys(state.root.dailyAttendance?.[s.id]?.[state.classId]||{})]);for(const date of dates){const a=state.root.dailyAttendance?.[s.id]?.[state.classId]?.[date],aw=state.root.dailyAwards?.[s.id]?.[state.classId]?.[date];out.push({student:s.name,date,status:a?.status||"present",points:Number(aw?.points||0)})}}return out.sort((a,b)=>b.date.localeCompare(a.date)||a.student.localeCompare(b.student))}
function reportsPage(){const rows=reportRows();return `<section class="workspace"><div class="workhead"><div><p class="eyebrow">REPORTS</p><h1>Daily point history</h1><p>Review or export the saved class history.</p></div><div class="reportbuttons"><button id="csvBtn">Export CSV</button><button id="printBtn">Print / PDF</button></div></div><div class="historytable"><table><thead><tr><th>Student</th><th>Date</th><th>Attendance</th><th>Points</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.student)}</td><td>${esc(C.formatDate(r.date))}</td><td>${esc(r.status)}</td><td>${r.points} ★</td></tr>`).join("")}</tbody></table></div></section>`}
function exportCSV(){const q=v=>`"${String(v).replaceAll('"','""')}"`;const csv=[["Student","Date","Attendance","Points"],...reportRows().map(r=>[r.student,r.date,r.status,r.points])].map(row=>row.map(q).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`brightpath-${state.classId}-${C.schoolDateString()}.csv`;a.click();URL.revokeObjectURL(a.href)}
function peoplePage(){
  const classes=activeClasses(), allStudents=vals(state.root.students||{}).filter(s=>s.active!==false);
  return `<section class="workspace"><div class="workhead"><div><p class="eyebrow">SCHOOL ROSTER TOOLS</p><h1>People & Classes</h1><p>Manage the active classes and Student Rewards roster.</p></div></div><div class="people-grid">${classes.map(c=>{const count=C.classRoster(state.root,c.id).length;return `<article class="people-card"><h3>${esc(c.name)}</h3><p>${count} active students · ${esc(c.schoolYear||"")}</p><button data-openclass="${esc(c.id)}">Open class</button></article>`}).join("")}</div><div class="admincolumns" style="margin-top:20px"><section><h2>Current class roster</h2><div class="teacherlist">${roster().map(s=>`<div><em>${esc(s.initials)}</em><span><b>${esc(s.name)}</b><small>${Number(s.rewardBalance)||0} reward points</small></span></div>`).join("")}</div></section><section><h2>Add a student to ${esc(cls()?.name||"class")}</h2><form id="addStudentForm" class="adminform"><label>Student full name<input id="newStudentName" required></label><p style="font-size:11px;color:#788398">The student must also be on the main B3 Games approved-student list to use the shared B3 login.</p><button class="primary">Create student</button></form><h2 style="margin-top:22px">Add a class</h2><form id="addClassForm" class="inlineform"><input id="newClassName" required placeholder="Class name"><button>Add class</button></form></section></div></section>`;
}
async function addStudent(e){e.preventDefault();const name=$("#newStudentName").value.trim();if(!name)return;const id=`student-${crypto.randomUUID?crypto.randomUUID():Date.now()}`,ini=initials(name),colors=["#7c3aed","#2563eb","#0891b2","#059669","#d97706","#dc2626","#9333ea","#4f46e5"],color=colors[Math.floor(Math.random()*colors.length)];await db.ref().update({[`${ROOT}/students/${id}`]:{id,classId:state.classId,name,initials:ini,color,rewardBalance:0,active:true},[`${ROOT}/enrollments/${state.classId}/${id}`]:true});toast("Student added")}
async function addClass(e){e.preventDefault();const name=$("#newClassName").value.trim();if(!name)return;const id=`class-${crypto.randomUUID?crypto.randomUUID():Date.now()}`;await db.ref(`${ROOT}/classes/${id}`).set({id,name,schoolYear:state.root.settings?.schoolYear||"2026–27",active:true});toast("Class added")}
function settingsPage(){const enabled=String(state.root.settings?.studentWebsiteEnabled)!=="false";return `<section class="workspace settings"><div class="workhead"><div><p class="eyebrow">SCHOOL SETUP</p><h1>Settings</h1><p>BrightPath display and access settings.</p></div></div><article><h2>School</h2><label>Display name <input id="displayName" value="${esc(state.root.settings?.displayName||"BrightPath")}"></label><label>Active school year <input id="schoolYear" value="${esc(state.root.settings?.schoolYear||"2026–27")}"></label></article><article><h2>Student website access</h2><label>Current status <b>${enabled?"Enabled":"Blocked"}</b></label><button class="primary" id="settingsAccess">${enabled?"Block student website":"Enable student website"}</button></article><article><h2>Daily rating scale</h2><label>Excellent <b>110%</b></label><label>Good (default) <b>100%</b></label><label>Fair <b>80%</b></label><label>Needs Improvement <b>50%</b></label></article><button class="primary" id="saveSettings">Save settings</button></section>`}
async function toggleAccess(){const enabled=String(state.root.settings?.studentWebsiteEnabled)!=="false";await db.ref(`${ROOT}/settings/studentWebsiteEnabled`).set(enabled?"false":"true");toast(enabled?"Student website blocked":"Student website enabled")}
async function saveSettings(){await db.ref(`${ROOT}/settings`).update({displayName:$("#displayName").value.trim()||"BrightPath",schoolYear:$("#schoolYear").value.trim()||"2026–27"});toast("Settings saved")}
function bindPage(){
  document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>{state.tab=b.dataset.go;render()});
  document.querySelectorAll("[data-student]").forEach(b=>b.onclick=()=>{state.selectedId=b.dataset.student;state.tab="Students";render()});
  if($("#accessToggle"))$("#accessToggle").onclick=toggleAccess;
  if(state.tab==="Daily Points"){
    $("#dailyClass").onchange=e=>{state.classId=e.target.value;state.selectedId="";prepareDraft();renderClassSelect();render()};
    $("#saveDaily").onclick=saveDaily;document.querySelectorAll("[data-att]").forEach(b=>b.onclick=()=>{const id=b.dataset.att;state.absent.has(id)?state.absent.delete(id):state.absent.add(id);render()});
    document.querySelectorAll("[data-rating]").forEach(s=>s.onchange=()=>{state.draft[`${s.dataset.rating}|${s.dataset.cat}`]=s.value;render()});
    document.querySelectorAll("[data-award]").forEach(inp=>inp.onchange=()=>{state.awardDraft[inp.dataset.award]=Math.max(0,Math.round(Number(inp.value)||0));inp.value=state.awardDraft[inp.dataset.award]});
  }
  if(state.tab==="Students"){$("#studentPicker").onchange=e=>{state.selectedId=e.target.value;render()};$("#adjustPoints").onclick=adjustPoints}
  if(state.tab==="Categories"){$("#addCategory").onclick=addCategory;document.querySelectorAll("[data-catdelete]").forEach(b=>b.onclick=()=>removeCategory(b.dataset.catdelete))}
  if(state.tab==="Comments"){if($("#commentPicker"))$("#commentPicker").onchange=e=>{state.selectedId=e.target.value;render()};if($("#commentForm"))$("#commentForm").onsubmit=addComment}
  if(state.tab==="Rewards"){$("#addReward").onclick=()=>editReward();$("#storeToggle").onclick=toggleRewardStore;if($("#approveAllActivity"))$("#approveAllActivity").onclick=approveAllActivityPoints;document.querySelectorAll("[data-point-approve]").forEach(b=>b.onclick=()=>approveActivityPoint(b.dataset.pointApprove));document.querySelectorAll("[data-point-reject]").forEach(b=>b.onclick=()=>rejectActivityPoint(b.dataset.pointReject));document.querySelectorAll("[data-editreward]").forEach(b=>b.onclick=()=>editReward(b.dataset.editreward));document.querySelectorAll("[data-deletereward]").forEach(b=>b.onclick=()=>deleteReward(b.dataset.deletereward));document.querySelectorAll("[data-approve]").forEach(b=>b.onclick=()=>{const [s,k]=b.dataset.approve.split("|");review(s,k,"approve")});document.querySelectorAll("[data-decline]").forEach(b=>b.onclick=()=>{const [s,k]=b.dataset.decline.split("|");review(s,k,"decline")});document.querySelectorAll("[data-collect]").forEach(b=>b.onclick=()=>{const [s,k]=b.dataset.collect.split("|");review(s,k,"collect")})}
  if(state.tab==="Reports"){$("#csvBtn").onclick=exportCSV;$("#printBtn").onclick=()=>window.print()}
  if(state.tab==="People & Classes"){document.querySelectorAll("[data-openclass]").forEach(b=>b.onclick=()=>{state.classId=b.dataset.openclass;renderClassSelect();prepareDraft();render()});$("#addStudentForm").onsubmit=addStudent;$("#addClassForm").onsubmit=addClass}
  if(state.tab==="Settings"){$("#settingsAccess").onclick=toggleAccess;$("#saveSettings").onclick=saveSettings}
}
function shiftDate(n){const d=new Date(`${state.date}T12:00:00`);d.setDate(d.getDate()+n);state.date=d.toISOString().slice(0,10);prepareDraft();render()}
$("#prevDate").onclick=()=>shiftDate(-1);$("#nextDate").onclick=()=>shiftDate(1);$("#topDate").onchange=e=>{state.date=e.target.value;prepareDraft();render()};
$("#googleBtn").onclick=async()=>{try{const p=new firebase.auth.GoogleAuthProvider();p.setCustomParameters({prompt:"select_account"});await auth.signInWithPopup(p)}catch(err){$("#loginError").textContent=err.message||String(err)}};
$("#signOutBtn").onclick=()=>auth.signOut();
auth.onAuthStateChanged(async user=>{
  if(!user){state.user=null;$("#loginView").classList.remove("hidden");$("#appView").classList.add("hidden");return}
  if(!user.email||user.email.toLowerCase()!==ADMIN.toLowerCase()){await auth.signOut();$("#loginError").textContent=`This page is only authorized for ${ADMIN}.`;return}
  state.user=user;$("#loginView").classList.add("hidden");$("#appView").classList.remove("hidden");await loadRoot();const seeded=await ensureClass1000Rewards();if(seeded)await loadRoot();subscribe();render();
});
})();