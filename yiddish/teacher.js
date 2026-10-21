const C=YIDDISH_CONTENT,$=id=>document.getElementById(id);let config,roster={},students={},user=null,dirty=false;
const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n};
async function call(action,data={}){return YiddishAPI.call(action,{...data,classId:new URLSearchParams(location.search).get('class')||'',idToken:await user.getIdToken()})}
function notice(t){$('notice').textContent=t}
async function load(){const r=await call('teacherLoad');if(r.storyGranted===false){$('dashboard').hidden=true;notice('The admin has not given this class a Yiddish story yet.');return}config=r.config;roster=r.roster;students=r.students;dirty=false;editors();table();notice('Progress loaded.');$('dashboard').hidden=false}
function storySummary(data){
  const sd=data.storyDetective||{},g=Number(sd.lastGroup),sec=sd.sections?.[g];
  if(!Number.isInteger(g)||!sec||!sec.answers)return 'Not started';
  const pct=Math.round((Number(sec.firstTryCorrect||0)/Number(sec.answers||1))*100);
  return `S${g+1}: ${Number(sec.lastPosition||0)}/${Number(sec.lastTotal||0)||'?'} · ${pct}% first try`;
}
function table(){const t=document.createElement('table'),h=document.createElement('tr');['Student','Track','Learned','Practicing','Story Detective','Last active'].forEach(s=>h.append(node('th',s)));t.append(h);Object.entries(roster).filter(([,v])=>!!v.classId&&($('track').value==='all'||$('track').value===v.classId)).sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0])).forEach(([id,v])=>{const data=students[id]||{},p=data.words||{},learned=C.words.filter(w=>p[w.id]?.credits>=2).length,practicing=C.words.filter(w=>p[w.id]&&p[w.id].credits<2).length,tr=node('tr',''),name=node('button',v.name||id);name.className='student-name';name.onclick=()=>detail(id,v);const td=node('td','');td.append(name);tr.append(td);[v.classId.toUpperCase(),learned,practicing,storySummary(data),data.lastActive?new Date(data.lastActive).toLocaleString():'Not started'].forEach(x=>tr.append(node('td',x)));t.append(tr)});$('roster').replaceChildren(t)}
function storyDetail(sd){
  const wrap=node('section','');wrap.className='story-teacher-detail';wrap.append(node('h3','Story Detective'));
  for(let g=0;g<4;g++){
    const sec=sd?.sections?.[g]||{},card=node('div','');card.className='story-teacher-card';card.append(node('h4','Section '+(g+1)));
    if(!sec.answers){card.append(node('p','Not started'));wrap.append(card);continue}
    const answers=Number(sec.answers||0),first=Number(sec.firstTryCorrect||0),misses=Number(sec.misses||0),pct=answers?Math.round(first/answers*100):0;
    card.append(node('p',`${answers} paragraph answer${answers===1?'':'s'} · ${pct}% first try · ${misses} miss${misses===1?'':'es'}`));
    card.append(node('p',`Last run position: ${Number(sec.lastPosition||0)}/${Number(sec.lastTotal||0)||'?'} · Completed rounds: ${Number(sec.completedRounds||0)}`));
    const paras=node('div','');paras.className='story-paragraph-stats';
    Object.entries(sec.paragraphs||{}).sort((a,b)=>Number(a[0])-Number(b[0])).forEach(([p,x])=>{const a=Number(x.answers||0),m=Number(x.misses||0),f=Number(x.firstTryCorrect||0);paras.append(node('span',`¶${p}: ${a}×, ${f} first-try, ${m} miss${m===1?'':'es'}`))});
    if(paras.childNodes.length)card.append(paras);wrap.append(card);
  }
  return wrap;
}
function detail(id,v){const data=students[id]||{},p=data.words||{};$('detail').replaceChildren(node('h2',v.name||id),storyDetail(data.storyDetective||{}));const grid=node('div','');grid.className='grid';for(const w of C.words){const card=node('div','');card.className='word';const yi=node('div',w.yi);yi.className='yi';yi.lang='yi';card.append(yi,node('p',w.en),node('span',!p[w.id]?'New':p[w.id].credits>=2?'Learned':'Practicing'));grid.append(card)}$('detail').append(grid)}
const stepsIn=s=>Math.max(1,Math.ceil((s.words||[]).length/4));
function stepRange(i){let a=1;for(let k=0;k<i;k++)a+=stepsIn(config.sections[k]);const b=a+stepsIn(config.sections[i])-1;return a===b?'Step '+a:'Steps '+a+'–'+b}
function stepsOpen(t,c=config){const n=c.unlockedSteps&&c.unlockedSteps[t];if(Number.isInteger(n))return n;let s=0;for(let k=0;k<Math.min(c.unlocked?.[t]||0,c.sections.length);k++)s+=stepsIn(c.sections[k]);return s}
function sectionsFor(steps){let s=0,k=0;while(k<config.sections.length&&s<steps){s+=stepsIn(config.sections[k]);k++}return k}
function editors(){const ids=Object.keys(config.unlocked||{});const generic=!ids.every(id=>['et','wt'].includes(id));$('wt').closest('label').hidden=generic;$('et').closest('label').firstChild.textContent=generic?'Class steps open ':'ET steps open ';$('wt').closest('label').firstChild.textContent='WT steps open ';$('track').replaceChildren(node('option','All assigned students'),...ids.map(id=>{const o=node('option',id.toUpperCase());o.value=id;return o;}));$('track').firstChild.value='all';for(const track of ['et','wt']){$(track).replaceChildren();const total=config.sections.reduce((n,s)=>n+stepsIn(s),0);for(let i=0;i<=total;i++){const o=node('option',i===0?'All closed':i===1?'Step 1':'Steps 1–'+i);o.value=i;$(track).append(o)}$(track).value=stepsOpen(generic?ids[0]:track)}$('editors').replaceChildren();config.sections.forEach((s,i)=>{const box=node('section','');box.className='section-editor';box.append(node('h3','Section '+(i+1)+' · '+stepRange(i)));for(const [key,title] of [['start','Start second'],['end','End second'],['first','First paragraph'],['last','Last paragraph']]){const label=node('label',title),input=node('input','');input.type='number';input.step=key==='start'||key==='end'?'0.1':'1';input.min='0';input.value=(key==='start'||key==='end')?Math.max(0,Number(s[key])-44):s[key];input.dataset.field=key;label.append(input);box.append(label)}const check=node('label','I checked this audio section and its words'),cb=node('input','');cb.type='checkbox';cb.checked=s.verified;cb.dataset.field='verified';check.prepend(cb);box.append(check);const list=node('div','');list.className='word-checks';C.words.forEach(w=>{const label=node('label',w.yi+' — '+w.en),input=node('input','');input.type='checkbox';input.value=w.id;input.checked=s.words.includes(w.id);input.dataset.word='1';label.prepend(input);list.append(label)});box.append(list);$('editors').append(box)})}
// ---- Saving ----------------------------------------------------------------
// `config` always holds the last settings confirmed by the server. Edits are
// queued and saved in the background:
//  * ET / WT step selectors -> teacherSetUnlock, one track at a time, so a
//    change to one track can never overwrite the other track.
//  * audio sections / words  -> teacherSave (lesson content only, with a
//    version check so two sessions cannot silently overwrite each other).
// The "Saved" confirmation is shown only after the server has committed the
// change and returned it.
const stepLabel=n=>n===0?'All closed':n===1?'Step 1':'Steps 1–'+n;
function trackIds(){return Object.keys(config.unlocked||{})}
function isGeneric(){return !trackIds().every(id=>['et','wt'].includes(id))}
function trackForSelect(id){return isGeneric()?trackIds()[0]:id}
function selectForTrack(track){return isGeneric()?'et':track}
function trackName(track){return isGeneric()?'Class':track.toUpperCase()}
function applyLessonInputs(draft){
  document.querySelectorAll('.section-editor').forEach((box,i)=>{
    for(const input of box.querySelectorAll('[data-field]')){
      const f=input.dataset.field;
      draft.sections[i][f]=input.type==='checkbox'?input.checked:
        ((f==='start'||f==='end')?Math.round((Number(input.value)+44)*10)/10:Number(input.value));
    }
    draft.sections[i].words=[...box.querySelectorAll('[data-word]:checked')].map(x=>x.value);
  });
  if(draft.sections[0])draft.sections[0].start=0;
  return draft;
}
function lessonDraft(){return applyLessonInputs({version:config.version,sections:structuredClone(config.sections)})}
function lessonChanged(){return !!config&&JSON.stringify(lessonDraft().sections)!==JSON.stringify(config.sections)}
let autoTimer=null,saving=false,pendingLesson=false,lessonBlocked=false;const pendingUnlocks={};
function hasPending(){return pendingLesson||Object.keys(pendingUnlocks).length>0}
function refreshDirty(){dirty=hasPending()||lessonBlocked}
function showTrackValues(){for(const track of trackIds()){if(Object.hasOwn(pendingUnlocks,track))continue;const sel=$(selectForTrack(track));if(sel)sel.value=String(stepsOpen(track))}}
function scheduleSave(){
  refreshDirty();
  clearTimeout(autoTimer);
  notice('Saving changes…');
  autoTimer=setTimeout(()=>void saveChanges(),650);
}
async function saveChanges(){
  if(!user||!config)return;
  if(saving){clearTimeout(autoTimer);autoTimer=setTimeout(()=>void saveChanges(),650);return}
  clearTimeout(autoTimer);
  saving=true;$('save').disabled=true;
  const saved=[],problems=[];let lessonSaved=false;
  try{
    while(hasPending()){
      if(pendingLesson){
        pendingLesson=false;
        if(lessonChanged()){
          try{
            const r=await call('teacherSave',{config:lessonDraft()});
            config=r.config;lessonSaved=true;lessonBlocked=false;saved.push('lesson settings');
          }catch(e){lessonBlocked=true;problems.push(e.message||'Lesson settings could not be saved.')}
        }
      }
      for(const track of Object.keys(pendingUnlocks)){
        const steps=pendingUnlocks[track];delete pendingUnlocks[track];
        if(stepsOpen(track)===steps)continue;
        try{
          const r=await call('teacherSetUnlock',{track,steps,expectedSteps:stepsOpen(track)});
          config=r.config;
          if(stepsOpen(track)!==steps)throw Error('The server did not confirm the change. Please try again.');
          saved.push(trackName(track)+': '+stepLabel(steps));
        }catch(e){
          if(e.status===409&&e.details&&Number.isInteger(e.details.current)){
            // Someone else changed this track meanwhile. Show their value and
            // let the teacher decide; never overwrite it automatically.
            try{const fresh=await call('teacherLoad');if(fresh.config)config=fresh.config}catch(_){}
            problems.push(trackName(track)+' was changed to '+stepLabel(e.details.current)+' in another session, so '+stepLabel(steps)+' was not saved. Choose again if you still want to change it.');
          }else problems.push(trackName(track)+' steps: '+(e.message||'could not be saved.'));
        }
      }
    }
  }finally{
    saving=false;$('save').disabled=false;
    refreshDirty();
    if(lessonSaved&&!pendingLesson&&!lessonChanged())editors();else showTrackValues();
    const time=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    if(problems.length)notice('Not saved: '+problems.join(' ')+(saved.length?' (Saved: '+saved.join(', ')+'.)':''));
    else if(saved.length)notice('✓ Saved and confirmed by the server at '+time+': '+saved.join(', ')+'.');
    else if(!hasPending())notice('No changes to save.');
    if(problems.length)window.scrollTo({top:0,behavior:'smooth'});
  }
}
$('save').onclick=()=>{pendingLesson=true;void saveChanges()};
$('dashboard').addEventListener('change',event=>{
  const t=event.target;
  // The track filter is not a lesson setting and must not trigger a write.
  if(t.closest('#track'))return;
  if(t.id==='et'||t.id==='wt'){pendingUnlocks[trackForSelect(t.id)]=Number(t.value);scheduleSave();return}
  if(t.closest('#editors')){pendingLesson=true;scheduleSave()}
});
$('track').onchange=table;$('reload').onclick=async()=>{if(dirty&&!confirm('Reload and discard unsaved lesson edits?'))return;try{clearTimeout(autoTimer);pendingLesson=false;lessonBlocked=false;for(const k of Object.keys(pendingUnlocks))delete pendingUnlocks[k];await load()}catch(e){notice(e.message)}};$('signIn').onclick=()=>B3SiteSettings.signInWithGoogle().catch(e=>notice(e.message));$('signOut').onclick=()=>B3SiteSettings.signOut();
C.paras.forEach((p,i)=>{if(!p.trim())return;const row=node('p',i+' · '+p);row.dir=i<2?'ltr':'rtl';row.style.fontSize='24px';$('transcript').append(row)});$('audio').src='audio.mp3';
B3SiteSettings.onAuthStateChanged(async(u,ok)=>{user=ok?u:null;$('signIn').hidden=!!user;$('dashboard').hidden=!user;if(user)try{await load()}catch(e){notice(e.message)}else{roster={};students={};$('roster').replaceChildren();$('detail').replaceChildren();notice('Sign in with your teacher Google account.')}});
