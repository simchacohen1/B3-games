(function(){
'use strict';
const C=window.StudentRewardsCommon;
const {db,auth}=C.ensureFirebase({student:true});
const ROOT=C.ROOT;
let state={studentId:'',student:null,tab:'Progress',root:null,busy:false,activityPointHistory:[],classGoals:[],classGoalTimer:null,storeOpen:null,serverRewardBalance:null};
const $=s=>document.querySelector(s);
const e=C.escapeHtml;
const POINTS_API='https://us-central1-b3-games.cloudfunctions.net/studentRewardsAutoAward';
const DAY_MS=24*60*60*1000;
function timeMs(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  const n=Number(value);if(Number.isFinite(n)&&n>0)return n;
  const p=Date.parse(String(value||''));return Number.isFinite(p)?p:0;
}
function cooldownText(until){
  const ms=Math.max(0,timeMs(until)-Date.now()),mins=Math.max(1,Math.ceil(ms/60000)),days=Math.floor(mins/1440),hours=Math.floor((mins%1440)/60);
  if(days>=7){const weeks=Math.floor(days/7),rem=days%7;return `${weeks} week${weeks===1?'':'s'}${rem?`, ${rem} day${rem===1?'':'s'}`:''}`}
  if(days>=1)return `${days} day${days===1?'':'s'}${hours?`, ${hours} hour${hours===1?'':'s'}`:''}`;
  if(hours>=1){const rem=mins%60;return `${hours} hour${hours===1?'':'s'}${rem?`, ${rem} min`:''}`}
  return `${mins} min`;
}
function personalCooldown(r){const until=timeMs(r?.cooldownUntil),active=until>Date.now();return {until,active,label:active?`Available again in ${cooldownText(until)}`:''}}

function slugify(name){return String(name||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')}
async function websiteEnabled(){const r=await fetch(window.B3_FIREBASE_CONFIG.databaseURL+'/'+ROOT+'/settings/studentWebsiteEnabled.json',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Could not check Student Rewards access.');return String(await r.json())!=='false'}
function own(path){return db.ref(`${ROOT}/${path}/${state.studentId}`)}
async function loadActivityPointHistory(){
  const user=auth.currentUser;
  if(!user)return [];
  const token=await user.getIdToken();
  const r=await fetch(POINTS_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action:'student-point-history'})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||'Could not load point history');
  return Array.isArray(j.history)?j.history:[];
}
async function classRewardsApi(action,payload={}){
  const user=auth.currentUser;
  if(!user)throw new Error('Please sign in again.');
  const token=await user.getIdToken();
  const r=await fetch(POINTS_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action,...payload})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j.error||'Could not update the class reward.');
  return j;
}
async function loadClassRewardStatus(){
  const j=await classRewardsApi('class-reward-status');
  // The server says which class store this student shops in.
  state.storeClassId=String(j.classId||'');state.teacherStore=j.teacherStore===true;
  if(Number.isFinite(Number(j.balance)))state.serverRewardBalance=Math.max(0,Number(j.balance));
  return {goals:Array.isArray(j.goals)?j.goals:[],storeOpen:j.storeOpen===true||String(j.storeOpen)==='true',balance:state.serverRewardBalance};
}
function isStoreOpen(){
  if(state.storeOpen!==null)return state.storeOpen===true;
  const v=state.root?.settings?.rewardStoreEnabled;
  return v===true||String(v)==='true';
}
function startClassGoalPolling(){
  if(state.classGoalTimer)return;
  state.classGoalTimer=setInterval(async()=>{
    if(!auth.currentUser||document.hidden)return;
    try{const status=await loadClassRewardStatus();state.classGoals=status.goals;state.storeOpen=status.storeOpen;render()}catch(err){console.warn('Could not refresh class reward goals',err)}
  },5000);
}
function nav(){const tabs=['Progress','Rewards','Comments'];$('#studentNav').innerHTML=tabs.map(t=>`<button data-tab="${t}" class="${state.tab===t?'active':''}">${t}</button>`).join('');$('#studentNav').onclick=ev=>{const b=ev.target.closest('[data-tab]');if(!b)return;state.tab=b.dataset.tab;render()}}

async function signInB3(name,pin,idHint=''){
  if(!await websiteEnabled()){showBlocked();return}
  const studentName=String(name||'').trim();
  const b3StudentId=String(idHint||'');
  const classPin=String(pin||'').trim();
  if(!studentName||!classPin) throw new Error('Enter your full name and passcode.');
  const r=await fetch(C.LOGIN_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    signal:AbortSignal.timeout(15000),
    body:JSON.stringify({b3StudentId,name:studentName,pin:classPin,classId:sessionStorage.getItem('b3Games_studentClass')||''})
  });
  const j=await r.json();
  if(!r.ok) throw new Error(j.error||'Could not sign in');
  await auth.signInWithCustomToken(j.customToken);

  const finalId=j.b3StudentId||b3StudentId;
  const finalName=j.b3StudentName||studentName;
  sessionStorage.setItem('b3Games_studentId',finalId);
  sessionStorage.setItem('b3Games_studentName',finalName);
  sessionStorage.setItem('b3Games_classPin',classPin);
  sessionStorage.setItem('posukPractice_studentId',finalId);
  sessionStorage.setItem('posukPractice_studentName',finalName);
  if(j.classId){
    sessionStorage.setItem('b3Games_studentClass',j.classId);
    sessionStorage.setItem('weeklyQuiz_classId',j.classId);
  }
}

async function login(ev){
  ev.preventDefault();
  $('#loginError').textContent='';
  $('#loginBtn').disabled=true;
  try{await signInB3($('#studentName').value,$('#pin').value)}
  catch(err){$('#loginError').textContent=err.message||String(err)}
  finally{$('#loginBtn').disabled=false}
}

async function trySharedB3Login(){
  const id=sessionStorage.getItem('b3Games_studentId')||sessionStorage.getItem('posukPractice_studentId')||'';
  const name=sessionStorage.getItem('b3Games_studentName')||sessionStorage.getItem('posukPractice_studentName')||'';
  const pin=sessionStorage.getItem('b3Games_classPin')||'';
  // Students sign in only on the Fun Torah Tools homepage; this page reuses that login.
  const note=$('#homeSignInNote'),link=$('#homeSignInLink');
  const needHome=msg=>{if(note)note.textContent=msg;if(link)link.style.display='';};
  if(!(id&&name&&pin))return needHome('Please sign in on Fun Torah Tools first.');
  if(note)note.textContent='Signing you in with your Fun Torah Tools login…';
  try{await signInB3(name,pin,id);if(note)note.textContent=''}
  catch(err){needHome((err.message||String(err))+' Please sign in again on Fun Torah Tools.')}
}

async function load(){
  if(!state.studentId)return;
  const [studentSnap,ratingsSnap,attendanceSnap,awardsSnap,commentsSnap,rewardsSnap,redemptionsSnap,categoriesSnap,settingsSnap,activityPointHistory,classRewardStatus]=await Promise.all([
    db.ref(`${ROOT}/students/${state.studentId}`).once('value'),
    own('dailyRatings').once('value'),
    own('dailyAttendance').once('value'),
    own('dailyAwards').once('value'),
    own('commentsByStudent').once('value'),
    db.ref(`${ROOT}/rewards`).once('value'),
    own('redemptionsByStudent').once('value'),
    db.ref(`${ROOT}/categories`).once('value'),
    db.ref(`${ROOT}/settings/rewardStoreEnabled`).once('value').catch(()=>({val:()=>null})),
    loadActivityPointHistory().catch(err=>{console.warn('Could not load activity point history',err);return []}),
    loadClassRewardStatus().catch(err=>{console.warn('Could not load class reward goals',err);return {goals:[],storeOpen:null}})
  ]);
  state.activityPointHistory=activityPointHistory;
  state.classGoals=classRewardStatus.goals||[];
  if(classRewardStatus.storeOpen!==null)state.storeOpen=classRewardStatus.storeOpen;
  state.root={student:studentSnap.val(),ratings:ratingsSnap.val()||{},attendance:attendanceSnap.val()||{},awards:awardsSnap.val()||{},comments:commentsSnap.val()||{},rewards:rewardsSnap.val()||{},redemptions:redemptionsSnap.val()||{},categories:categoriesSnap.val()||{},settings:{rewardStoreEnabled:settingsSnap.val()}};
  state.student=state.root.student;
  render();
  subscribe();
  startClassGoalPolling();
}
function subscribe(){
  let lastBalance=Number(state.student?.rewardBalance||0);
  db.ref(`${ROOT}/students/${state.studentId}`).on('value',async s=>{
    if(!state.root)return;
    const next=s.val(),nextBalance=Number(next?.rewardBalance||0),balanceChanged=nextBalance!==lastBalance;
    state.root.student=next;state.student=next;lastBalance=nextBalance;state.serverRewardBalance=Math.max(0,nextBalance);
    if(balanceChanged){
      try{state.activityPointHistory=await loadActivityPointHistory()}catch(err){console.warn('Could not refresh point history',err)}
    }
    render();
  });
  db.ref(`${ROOT}/redemptionsByStudent/${state.studentId}`).on('value',s=>{if(state.root){state.root.redemptions=s.val()||{};render()}});
  db.ref(`${ROOT}/rewards`).on('value',s=>{if(state.root){state.root.rewards=s.val()||{};render()}},()=>{});
  db.ref(`${ROOT}/settings/rewardStoreEnabled`).on('value',s=>{if(state.root){state.root.settings.rewardStoreEnabled=s.val();if(!state.teacherStore)state.storeOpen=s.val()===true||String(s.val())==='true';render()}},()=>{});
}
function allRatingRows(){
  const out=[];
  for(const [cid,dates] of Object.entries(state.root.ratings||{}))
    for(const [date,cats] of Object.entries(dates||{}))
      for(const r of Object.values(cats||{}))
        out.push({scoreDate:date,points:Number(r.points)||0,category:r.category,rating:r.rating,classId:cid});
  return out;
}
function grouped(){
  const g={};
  for(const r of allRatingRows()){
    g[r.category]??={earned:0,possible:0};
    g[r.category].earned+=Number(r.points)||0;
    g[r.category].possible+=100;
  }
  return g;
}
function history(){
  const keys=new Set();
  for(const [cid,dates] of Object.entries(state.root.ratings||{}))Object.keys(dates||{}).forEach(d=>keys.add(`${cid}|${d}`));
  for(const [cid,dates] of Object.entries(state.root.attendance||{}))Object.keys(dates||{}).forEach(d=>keys.add(`${cid}|${d}`));
  for(const [cid,dates] of Object.entries(state.root.awards||{}))Object.keys(dates||{}).forEach(d=>keys.add(`${cid}|${d}`));
  return [...keys].map(k=>{
    const [cid,date]=k.split('|'),att=state.root.attendance?.[cid]?.[date],ratings=state.root.ratings?.[cid]?.[date]||{},award=state.root.awards?.[cid]?.[date];
    return {cid,date,status:att?.status||'present',points:Number(award?.points||0),ratings:Object.fromEntries(Object.values(ratings).map(r=>[r.category,r.rating]))};
  }).sort((a,b)=>b.date.localeCompare(a.date));
}
function redeemedPoints(){
  let redeemed=0;
  for(const item0 of Object.values(state.root?.redemptions||{})){
    const item=item0||{}, cost=Number(item.cost||0), status=String(item.status||'requested').toLowerCase();
    if(cost>0&&status!=='declined')redeemed+=cost;
  }
  for(const item of state.activityPointHistory||[]){
    if(String(item?.source||'')==='class-reward-contribution')redeemed+=Math.abs(Number(item.actualAmount??item.amount??0));
  }
  return redeemed;
}
function pointAccountTotals(){
  const currentBalance=spendableRewardBalance(), redeemed=redeemedPoints();
  return {totalPoints:currentBalance+redeemed,redeemed,currentBalance};
}
function spendableRewardBalance(){
  return Math.max(0,Number(state.serverRewardBalance!==null?state.serverRewardBalance:state.student?.rewardBalance)||0);
}
function classGoalProgress(g){
  const goal=Math.max(1,Number(g.goalPoints||1));
  const total=g?.modeVoting?Math.max(0,...(g.modes||[]).map(m=>Number(m.total)||0)):Number(g.totalContributed||0);
  return Math.max(0,Math.min(100,Math.round(total/goal*100)));
}
function modePoints(n){const x=Number(n)||0;return Number.isInteger(x)?String(x):x.toFixed(1).replace(/\.0$/,'')}
function classGoalCard(g,{compact=false}={}){
  const balance=state.serverRewardBalance!==null?Number(state.serverRewardBalance):Number(state.student?.rewardBalance||0),goal=Number(g.goalPoints||0),total=Number(g.totalContributed||0),remaining=Math.max(0,Number(g.remainingGoal??(goal-total))),mine=Number(g.studentContributed||0),cap=Number(g.studentCap||0),mineLeft=Math.max(0,Number(g.remainingStudentCap??(cap-mine))),maxGive=Math.max(0,Math.min(balance,mineLeft,g.modeVoting?Number.MAX_SAFE_INTEGER:remaining)),pct=classGoalProgress(g),cooling=String(g.status||'')==='cooldown'||timeMs(g.cooldownUntil)>Date.now(),complete=!g.modeVoting&&!cooling&&(String(g.status||'')==='completed'||remaining<=0),storeOpen=isStoreOpen(),rewardOpen=g.available!==false;
  const inputId=`classGive-${String(g.rewardId||'').replace(/[^A-Za-z0-9_-]/g,'-')}-${compact?'top':'store'}`;
  const disabled=!storeOpen||!rewardOpen||cooling||maxGive<1;
  const buttonText=!storeOpen?'Store closed':!rewardOpen?'Closed':cooling?`Available in ${cooldownText(g.cooldownUntil)}`:maxGive<1?'No points available':'Contribute';
  const cooldownLine=cooling?`<div class="class-goal-complete">⏳ Available again in ${e(cooldownText(g.cooldownUntil))}</div>`:'';
  const modeRace=g.modeVoting?`<div class="gimkit-mode-race student"><div class="gimkit-mode-race-head"><b>Choose your Gimkit mode${compact?'s':''}</b><span>First bar to ${goal} ★ wins</span></div>${(g.modes||[]).map(m=>`<label class="gimkit-mode-choice"><input type="checkbox" data-gimkit-mode="${e(m.id)}" ${disabled?'disabled':''}><span class="gimkit-mode-choice-main"><span><strong>${e(m.name)}</strong><small>${m.voters} voter${m.voters===1?'':'s'}</small></span><span class="gimkit-mode-bar"><i style="width:${Math.max(0,Math.min(100,Number(m.pct)||0))}%"></i></span></span><b>${modePoints(m.total)} / ${goal} ★</b></label>`).join('')}<p class="gimkit-mode-note">Choose one or more. Your contribution is split between the modes you check. When one wins, only that bar resets; the others keep their points for next time.</p>${g.lastWinner?`<p class="gimkit-last-winner">Last winner: <strong>${e(g.lastWinner.name||g.lastWinner.id||'Gimkit mode')}</strong></p>`:''}</div>`:'';
  return `<article class="class-goal-card ${complete||cooling?'complete':''} ${compact?'compact':''} ${rewardOpen?'reward-open':'reward-closed'} ${g.modeVoting?'gimkit-voting-card':''}"><div class="class-goal-top"><div class="class-goal-icon">${e(g.icon||'⭐')}</div><div><small>${g.modeVoting?'GIMKIT MODE RACE':'CLASS REWARD'}${rewardOpen?'':' · CLOSED'}</small><h3>${e(g.name||'Class Reward')}</h3>${Number(g.cooldownDays)>0?`<small>Cooldown: ${Number(g.cooldownDays)} day${Number(g.cooldownDays)===1?'':'s'}</small>`:''}</div><strong>${g.modeVoting?`${modePoints(Math.max(0,...(g.modes||[]).map(m=>Number(m.total)||0)))} / ${goal} ★`:`${total} / ${goal} ★`}</strong></div><div class="class-goal-progress"><i style="width:${pct}%"></i></div>${modeRace}<div class="class-goal-numbers"><span>You gave <b>${mine}</b> this round</span><span>Your limit left <b>${mineLeft}</b></span><span>You can give now <b>${maxGive}</b></span>${g.modeVoting?'<span>Losing bars carry over</span>':`<span><b>${remaining}</b> still needed</span>`}</div>${cooldownLine||(complete?`<div class="class-goal-complete">✓ Goal reached!</div>`:`<div class="class-contribute"><input id="${e(inputId)}" type="number" inputmode="numeric" min="1" max="${maxGive}" placeholder="Points" ${disabled?'disabled':''}><button class="primary" data-class-contribute="${e(g.rewardId)}" data-input="${e(inputId)}" ${g.modeVoting?'data-mode-voting="1"':''} ${state.busy||disabled?'disabled':''}>${buttonText}</button></div>`)}</article>`;
}
function activeClassGoalsHTML(){
  const active=(state.classGoals||[]).filter(g=>g.modeVoting?(g.modes||[]).some(m=>Number(m.total||0)>0)||String(g.status||'')==='cooldown':Number(g.totalContributed||0)>0||String(g.status||'')==='completed'||String(g.status||'')==='cooldown');
  if(!active.length)return '';
  return `<section class="active-class-goals"><div class="active-class-goals-head"><div><p class="eyebrow">YOUR CLASS IS WORKING TOWARD</p><h2>Class Reward Goals</h2><p>Add some of your points if you want to help the class reach a goal.</p></div><button class="secondary" id="openClassRewards">See all class rewards →</button></div><div class="active-class-goal-grid">${active.map(g=>classGoalCard(g,{compact:true})).join('')}</div></section>`;
}
function captureContributionForms(){
  return [...document.querySelectorAll('[data-class-contribute]')].map(button=>{
    const input=document.getElementById(button.dataset.input),card=button.closest('.class-goal-card');
    return {inputId:button.dataset.input,value:input?.value||'',focused:document.activeElement===input,
      modes:[...(card?.querySelectorAll('[data-gimkit-mode]:checked')||[])].map(box=>box.dataset.gimkitMode),
      focusedMode:document.activeElement?.closest('.class-goal-card')===card?document.activeElement?.dataset.gimkitMode:null};
  });
}
function restoreContributionForms(forms){
  for(const draft of forms){
    const input=document.getElementById(draft.inputId);
    if(!input)continue;
    input.value=draft.value;
    if(draft.focused&&!input.disabled)input.focus({preventScroll:true});
    const card=input.closest('.class-goal-card');
    card?.querySelectorAll('[data-gimkit-mode]').forEach(box=>{
      box.checked=draft.modes.includes(box.dataset.gimkitMode);
      if(draft.focusedMode===box.dataset.gimkitMode&&!box.disabled)box.focus({preventScroll:true});
    });
  }
}
function clearContributionForms(rewardId){
  document.querySelectorAll('[data-class-contribute]').forEach(button=>{
    if(button.dataset.classContribute!==rewardId)return;
    const input=document.getElementById(button.dataset.input);
    if(input)input.value='';
    button.closest('.class-goal-card')?.querySelectorAll('[data-gimkit-mode]').forEach(box=>{box.checked=false});
  });
}
function render(){
  if(!state.student||!state.root)return;
  const contributionForms=captureContributionForms();
  $('#loginView').classList.add('hidden');
  $('#blockedView').classList.add('hidden');
  $('#portalView').classList.remove('hidden');
  nav();
  const s=state.student,main=$('#studentMain'),acct=pointAccountTotals();
  main.innerHTML=`<div class="studentwelcome"><em class="avatar" style="background:${e(s.color)}">${e(s.initials)}</em><div><p class="eyebrow">HELLO</p><h1>${e(s.name)}</h1><p>Keep up the great work!</p></div><button class="studentbalance studentbalance-breakdown" id="openRewards"><span class="student-point-metrics"><span><small>TOTAL POINTS</small><strong>${acct.totalPoints}</strong></span><span><small>REDEEMED / CONTRIBUTED</small><strong>${acct.redeemed}</strong></span><span class="current"><small>CURRENT BALANCE</small><strong>${acct.currentBalance}</strong></span></span><b>★ REWARD POINTS</b><small class="student-balance-link">Tap to see what you can choose →</small></button></div>${activeClassGoalsHTML()}<div id="studentTab"></div>`;
  $('#openRewards').onclick=()=>{state.tab='Rewards';render()};
  if($('#openClassRewards'))$('#openClassRewards').onclick=()=>{state.tab='Rewards';render()};
  bindClassContributionButtons();
  renderTab();
  restoreContributionForms(contributionForms);
}
function renderTab(){
  const box=$('#studentTab');
  if(state.tab==='Progress')box.innerHTML=progressHTML();
  if(state.tab==='Rewards')box.innerHTML=rewardsHTML();
  if(state.tab==='Comments')box.innerHTML=commentsHTML();
  bindTab();
}
function historyTime(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  const n=Number(value);if(Number.isFinite(n)&&n>0)return n;
  const p=Date.parse(String(value||''));return Number.isFinite(p)?p:0;
}
function pointHistoryRows(){
  const rows=[];
  for(const item of state.activityPointHistory||[]){
    const amount=Number(item.actualAmount??item.amount??0);
    if(!amount)continue;
    const labels={reading100:'Posuk Practice · Reading 100%',translation100:'Posuk Practice · Translation 100%',understand100:'Posuk Practice · Understanding 100%',chazara:'Chazara approved','chazara-recording':'Recorded Chazara approved','chazara-remove':'Chazara adjustment','teacher-adjustment':'Teacher adjustment','class-reward-contribution':'Class reward contribution'};
    rows.push({amount,title:item.reason||'Activity points',detail:labels[item.source]||item.source||'',when:historyTime(item.reviewedAt||item.createdAt)});
  }
  for(const [cid,dates] of Object.entries(state.root.awards||{})){
    for(const [date,award] of Object.entries(dates||{})){
      const amount=Number(award?.points||0);if(!amount)continue;
      rows.push({amount,title:'Daily class points',detail:'Saved school day',when:new Date(`${date}T12:00:00`).getTime()});
    }
  }
  for(const p of Object.values(state.root.redemptions||{})){
    const cost=Number(p?.cost||0);if(!cost)continue;
    const rewardName=state.root.rewards?.[p.rewardId]?.name||'Reward';
    const requested=typeof p.requestedAt==='number'?p.requestedAt:(Date.parse(p.requestedAt||'')||0);
    if(requested)rows.push({amount:-cost,title:`Reward requested — ${rewardName}`,detail:p.status||'requested',when:requested});
    if(p.status==='declined'){
      const reviewed=typeof p.reviewedAt==='number'?p.reviewedAt:(Date.parse(p.reviewedAt||'')||0);
      if(reviewed)rows.push({amount:cost,title:`Points returned — ${rewardName}`,detail:'Request declined',when:reviewed});
    }
  }
  return rows.sort((a,b)=>b.when-a.when);
}
function pointHistoryHTML(){
  const rows=pointHistoryRows(),acct=pointAccountTotals();
  return `<section class="panel points-history-panel"><div class="points-history-head"><div><h2>⭐ Points History</h2><p>Total Points ${acct.totalPoints} ★ · Redeemed ${acct.redeemed} ★ · Current Balance ${acct.currentBalance} ★</p></div><strong>${acct.currentBalance} ★</strong></div>${rows.length?`<div class="points-history-list">${rows.map(r=>`<article class="points-history-row"><div><b>${e(r.title)}</b>${r.detail?`<small>${e(r.detail)}</small>`:''}<small>${r.when?e(new Date(r.when).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})):''}</small></div><strong class="points-history-amount ${r.amount<0?'negative':'positive'}">${r.amount>0?'+':''}${r.amount} ★</strong></article>`).join('')}</div>`:'<p>No point activity yet.</p>'}</section>`;
}
function progressHTML(){
  const rows=allRatingRows(),pct=C.cumulativeProgress(rows)??0,g=grouped(),hist=history(),cats=['Davening','Learning','Participation'];
  return `<div class="student-score"><strong>${pct}%</strong><span>Your overall progress</span></div><div class="categories">${Object.entries(g).map(([name,x])=>{const p=x.possible?Math.round(x.earned/x.possible*100):0;return `<article><span>${e(name)}</span><b>${p}%</b><u><i style="width:${Math.min(110,p)}%;background:${e(state.student.color)}"></i></u><small>${x.earned} of ${x.possible} progress points</small></article>`}).join('')}</div>${pointHistoryHTML()}<section class="panel"><h2>Daily History</h2>${hist.length?`<div class="historytable"><div class="historyrow historyhead"><span>Date</span>${cats.map(c=>`<span>${c}</span>`).join('')}<span>Points earned</span></div>${hist.map(d=>`<div class="historyrow ${d.status==='absent'?'absentrow':''}"><strong>${e(C.formatDate(d.date))}</strong>${d.status==='absent'?`<span>Absent</span><span>—</span><span>—</span><span>0 ★</span>`:cats.map(c=>{const r=d.ratings[c]||'—';return `<span><b class="ratingpill ${C.ratingClass(r)}">${e(r)}</b></span>`}).join('')+`<span class="points-pill">${d.points} ★</span>`}</div>`).join('')}</div>`:'<p>No saved school days yet.</p>'}</section>`;
}
function rewardsHTML(){
  const balance=state.serverRewardBalance!==null?Number(state.serverRewardBalance):(Number(state.student.rewardBalance)||0),
        storeOpen=isStoreOpen(),
        personalRewards=Object.values(state.root.rewards||{}).filter(r=>(state.teacherStore?r.ownerClassId===state.storeClassId:!r.ownerClassId)&&r.active!==false&&String(r.rewardType||'personal')!=='class'&&String(r.rewardType||'personal')!=='class-migrated').sort((a,b)=>(a.cost||0)-(b.cost||0)),
        goals=(state.classGoals||[]).filter(g=>g.active!==false).sort((a,b)=>(a.perStudentCost||0)-(b.perStudentCost||0)||(a.name||'').localeCompare(b.name||'')),
        byCost={};
  personalRewards.forEach(r=>(byCost[r.cost]??=[]).push(r));
  const personalCards=Object.entries(byCost).map(([cost,list])=>`<h3 class="level-title">${cost}-Point Choices</h3>${list.map(r=>{const rewardOpen=r.available!==false,canAfford=balance>=Number(r.cost||0),cd=personalCooldown(r),disabled=state.busy||!storeOpen||!rewardOpen||cd.active||!canAfford||r.quantity===0,buttonText=!storeOpen?'Store closed':!rewardOpen?'Closed':cd.active?cd.label:r.quantity===0?'Unavailable':canAfford?'Request this':'Not enough points',message=!rewardOpen?'Not available right now':cd.active?cd.label:canAfford?'You can choose this now':'Keep earning points';return `<article class="reward-card ${rewardOpen&&!cd.active?'reward-open':'reward-closed'}"><div class="icon" style="background:${e(r.color||'#f3f1ff')}">${e(r.icon||'🎁')}</div><h3>${e(r.name)}</h3><div class="cost">${Number(r.cost)||0} ★</div><p>${e(message)}</p>${Number(r.cooldownDays)>0?`<small>Can be bought once every ${Number(r.cooldownDays)} day${Number(r.cooldownDays)===1?'':'s'}</small>`:''}<button class="primary" data-redeem="${e(r.id)}" ${disabled?'disabled':''}>${e(buttonText)}</button></article>`}).join('')}`).join('');
  const classCards=goals.length?goals.map(g=>classGoalCard(g)).join(''):'<div class="class-goals-empty">No class rewards are available yet.</div>';
  const purchases=Object.values(state.root.redemptions||{}).sort((a,b)=>String(b.requestedAt||'').localeCompare(String(a.requestedAt||'')));
  return `<section class="panel rewards-intro"><div><p class="eyebrow">PRIZE STORE</p><h2>You have ${balance} points to use</h2><p>Personal rewards are just for you. Class rewards are shared goals that everyone can help reach.</p></div></section>
  <section class="reward-store-section personal-store"><div class="reward-store-heading"><span class="store-kind-icon">👤</span><div><p class="eyebrow">JUST FOR YOU</p><h2>Personal Rewards</h2><p>Spend your own points on something for yourself.</p></div></div><div class="rewardgrid studentrewards">${personalCards||'<p>No personal rewards are available right now.</p>'}</div></section>
  <section class="reward-store-section class-store"><div class="reward-store-heading"><span class="store-kind-icon">👥</span><div><p class="eyebrow">WORK TOGETHER</p><h2>Class Rewards</h2><p>Give any amount you choose, up to your personal contribution limit. No one student can fund a class prize by himself.</p></div></div><div class="class-goal-store-grid">${classCards}</div></section>
  <section class="panel"><h2>My personal reward requests</h2><div class="purchasehistory">${purchases.length?purchases.map(p=>`<article><b>${e(state.root.rewards?.[p.rewardId]?.name||'Reward')}</b><span>${Number(p.cost)||0} ★</span><mark class="badge ${e(p.status)}">${e(p.status)}</mark></article>`).join(''):'<p>No personal reward requests yet.</p>'}</div></section>`;
}
function commentsHTML(){
  const rows=Object.values(state.root.comments||{}).filter(c=>c.visibleToStudent!==false).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  return `<section class="panel"><h2>Teacher comments</h2><div class="commentlist">${rows.length?rows.map(c=>`<article><p>${e(c.body)}</p><small>${e(C.formatDate((c.createdAt||'').slice(0,10)))}</small></article>`).join(''):'<p>No comments yet.</p>'}</div></section>`;
}
function bindClassContributionButtons(){
  document.querySelectorAll('[data-class-contribute]').forEach(b=>b.onclick=()=>contributeClassReward(b.dataset.classContribute,b.dataset.input,b));
}
function bindTab(){if(state.tab==='Rewards'){document.querySelectorAll('[data-redeem]').forEach(b=>b.onclick=()=>redeem(b.dataset.redeem));bindClassContributionButtons()}}
async function contributeClassReward(rewardId,inputId,buttonEl){
  if(state.busy)return;
  const storeOpen=isStoreOpen();
  if(!storeOpen){C.toast('The Prize Store is closed right now.','error');return}
  const goal=(state.classGoals||[]).find(g=>g.rewardId===rewardId);
  if(goal?.available===false){C.toast('That class reward is closed right now.','error');return}
  if(String(goal?.status||'')==='cooldown'||timeMs(goal?.cooldownUntil)>Date.now()){C.toast(`Gimkit is available again in ${cooldownText(goal.cooldownUntil)}.`,'error');return}
  const input=document.getElementById(inputId),amount=Math.floor(Number(input?.value||0));
  if(!Number.isFinite(amount)||amount<1){C.toast('Enter how many points you want to contribute.','error');return}
  const allowed=Math.max(0,Math.min(spendableRewardBalance(),Number(goal?.remainingStudentCap||0),goal?.modeVoting?Number.MAX_SAFE_INTEGER:Number(goal?.remainingGoal||0)));
  if(amount>allowed){C.toast(`You can contribute up to ${allowed} points to this goal right now.`,'error');return}
  let modeIds=[];
  if(goal?.modeVoting){
    const card=buttonEl?.closest('.class-goal-card');
    modeIds=[...(card?.querySelectorAll('[data-gimkit-mode]:checked')||[])].map(x=>x.dataset.gimkitMode);
    if(!modeIds.length){C.toast('Choose at least one Gimkit mode first.','error');return}
  }
  state.busy=true;render();
  try{
    const j=await classRewardsApi('contribute-class-reward',{classRewardId:rewardId,amount,modeIds});
    clearContributionForms(rewardId);
    if(j.goal)state.classGoals=(state.classGoals||[]).map(g=>g.rewardId===rewardId?j.goal:g);
    else {const status=await loadClassRewardStatus();state.classGoals=status.goals;state.storeOpen=status.storeOpen;}
    if(Number.isFinite(Number(j.balance))){state.serverRewardBalance=Math.max(0,Number(j.balance));state.student.rewardBalance=Number(j.balance);if(state.root?.student)state.root.student.rewardBalance=Number(j.balance)}
    state.activityPointHistory=await loadActivityPointHistory().catch(()=>state.activityPointHistory);
    if(j.winner)C.toast(`🎉 ${j.winner.name||'A Gimkit mode'} won! The other mode bars will carry over.`);
    else C.toast(goal?.modeVoting?`${amount} points added to your Gimkit choices!`:`${amount} points added to ${goal?.name||'the class goal'}!`);
  }catch(err){C.toast(err.message||String(err),'error')}
  finally{state.busy=false;render()}
}
async function redeem(rewardId){
  const storeOpen=isStoreOpen();
  if(!storeOpen){C.toast('The Prize Store is closed for purchases right now.','error');return}
  const reward=state.root?.rewards?.[rewardId];
  if(reward?.available===false){C.toast('That reward is closed right now.','error');return}
  const cd=personalCooldown(reward);
  if(cd.active){C.toast(cd.label,'error');return}
  if(state.busy)return;
  state.busy=true;renderTab();
  try{
    const user=auth.currentUser;
    if(!user)throw new Error('Please sign in again.');
    const token=await user.getIdToken();
    const r=await fetch(C.REDEEM_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({rewardId})});
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'Could not request reward');
    C.toast('Reward requested!');
    await load();
  }catch(err){C.toast(err.message||String(err),'error')}
  finally{state.busy=false;renderTab()}
}
function showBlocked(){$('#blockedView').classList.remove('hidden');$('#loginView').classList.add('hidden');$('#portalView').classList.add('hidden')}

$('#loginForm').addEventListener('submit',login);
$('#logoutBtn').onclick=async()=>{
  // Leave Student Rewards only; the Fun Torah Tools login stays active.
  await auth.signOut();
  location.href='../index.html';
};

auth.onAuthStateChanged(async user=>{
  try{
  if(!await websiteEnabled()){showBlocked();if(user)await auth.signOut();return}
  if(!user){
    state.studentId='';state.student=null;
    $('#portalView').classList.add('hidden');
    $('#blockedView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
    return;
  }
  const token=await user.getIdTokenResult();
  const sharedId=sessionStorage.getItem('b3Games_studentId');
  if(sharedId&&token.claims.b3StudentId!==sharedId){$('#portalView').classList.add('hidden');return;}
  const sid=token.claims.studentRewardsStudentId;
  if(!sid){await auth.signOut();return}
  state.studentId=String(sid);
  await load();
  }catch(error){$('#loginView').classList.remove('hidden');$('#homeSignInNote').textContent=error.message||'Could not load Student Rewards. Refresh and try again.';$('#homeSignInLink').style.display='';}
});
setTimeout(trySharedB3Login,0);
setInterval(async()=>{try{if(!await websiteEnabled())showBlocked()}catch(error){console.warn('Rewards access check failed',error)}},15000);
setInterval(()=>{if(state.tab==='Rewards'&&state.root&&!state.busy)renderTab()},60000);
})();
