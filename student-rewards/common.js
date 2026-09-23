(function(){
  'use strict';
  const ROOT='studentRewards';
  const ADMIN_EMAIL='simcha5770@gmail.com';
  const FUNCTIONS_BASE='https://us-central1-b3-games.cloudfunctions.net';
  const LOGIN_URL=`${FUNCTIONS_BASE}/studentRewardsLogin`;
  const REDEEM_URL=`${FUNCTIONS_BASE}/studentRewardsRedeem`;

  function ensureFirebase(options={}){
    if(!window.firebase) throw new Error('Firebase libraries did not load.');
    if(!window.B3_FIREBASE_CONFIG) throw new Error('B3 Firebase config did not load.');
    if(options.student===true){
      const appName='StudentRewardsStudent';
      let app;
      try{ app=firebase.app(appName); }
      catch{ app=firebase.initializeApp(window.B3_FIREBASE_CONFIG,appName); }
      return {db:app.database(),auth:app.auth()};
    }
    if(!firebase.apps.length) firebase.initializeApp(window.B3_FIREBASE_CONFIG);
    return {db:firebase.database(),auth:firebase.auth()};
  }
  function schoolDateString(date=new Date()){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const val=t=>parts.find(p=>p.type===t)?.value||'';
    return `${val('year')}-${val('month')}-${val('day')}`;
  }
  const progressValue={Excellent:110,Good:100,Fair:80,'Needs Improvement':50,Average:80,Poor:50};
  function dailyProgress(values){
    if(!values.length) return null;
    return Math.round(values.reduce((s,v)=>s+(typeof v==='number'?v:(progressValue[v]??100)),0)/values.length);
  }
  function dailyAward(ratings){
    if(!ratings.length) return 0;
    const allGE=ratings.every(r=>r==='Good'||r==='Excellent');
    // Daily classroom points are now based on 10 for an all-Good day.
    // Excellent keeps the same 20% bonus relationship as before: 12.
    if(allGE) return ratings.includes('Excellent')?12:10;
    const avg=ratings.reduce((s,r)=>s+(progressValue[r]??0),0)/ratings.length;
    return Math.max(0,Math.min(10,Math.round(10*avg/100)));
  }
  function cumulativeProgress(dateRows){
    const days={};
    dateRows.forEach(r=>{(days[r.scoreDate]??=[]).push(Number(r.points)||0)});
    const scores=Object.values(days).map(dailyProgress).filter(v=>v!==null);
    return scores.length?Math.min(100,Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)):null;
  }
  function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function ratingClass(s){return String(s||'').toLowerCase().replace(/\s+/g,'-');}
  function categoryKey(name){return String(name||'category').replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'')||'category';}
  async function sha256(value){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(buf)).map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  function objectValues(obj){return obj&&typeof obj==='object'?Object.values(obj):[]}
  function activeClasses(root){return objectValues(root.classes).filter(c=>c.active).sort((a,b)=>a.name.localeCompare(b.name));}
  function classRoster(root,classId){
    const e=(root.enrollments||{})[classId]||{};
    return Object.keys(e).filter(sid=>e[sid]===true&&root.students?.[sid]?.active).map(sid=>root.students[sid]).sort((a,b)=>a.name.localeCompare(b.name));
  }
  function activeCategories(root){
    const rows=objectValues(root.categories).filter(c=>c.active && c.teacherEmail===ADMIN_EMAIL);
    const fallback=objectValues(root.categories).filter(c=>c.active);
    const use=rows.length?rows:fallback;
    const byName={};
    use.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0)).forEach(c=>{if(!byName[c.name])byName[c.name]=c});
    return Object.values(byName);
  }
  function latestRatings(root,studentId,classId,targetDate){
    const byDate=root.dailyRatings?.[studentId]?.[classId]||{};
    const dates=Object.keys(byDate).filter(d=>d<targetDate).sort();
    const date=dates[dates.length-1];
    return {date:date||'',ratings:date?byDate[date]:{}};
  }
  function allProgressRows(root,studentId,classId){
    const byDate=root.dailyRatings?.[studentId]?.[classId]||{};
    const rows=[];
    Object.entries(byDate).forEach(([scoreDate,cats])=>objectValues(cats).forEach(r=>rows.push({scoreDate,points:Number(r.points)||0,rating:r.rating,category:r.category})));
    return rows;
  }
  function toast(message,type='ok'){
    let el=document.getElementById('globalToast');
    if(!el){el=document.createElement('div');el.id='globalToast';document.body.appendChild(el)}
    el.className=`toast show ${type}`;el.textContent=message;clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove('show'),2800);
  }
  function formatDate(iso){try{return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}catch{return iso}}
  window.StudentRewardsCommon={ROOT,ADMIN_EMAIL,LOGIN_URL,REDEEM_URL,ensureFirebase,schoolDateString,progressValue,dailyProgress,dailyAward,cumulativeProgress,escapeHtml,ratingClass,categoryKey,sha256,objectValues,activeClasses,classRoster,activeCategories,latestRatings,allProgressRows,toast,formatDate};
})();
