'use strict';
const crypto=require('node:crypto');
const words=require('./words.json');
const vm=require('node:vm'),fs=require('node:fs');
const sandbox={window:{},Intl,Date,console};vm.runInNewContext(fs.readFileSync(__dirname+'/site-policy.js','utf8'),sandbox);const policy=sandbox.window.B3SiteSettings;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const random=()=>crypto.randomBytes(24).toString('hex');
const defaults=()=>({version:0,unlocked:{et:0,wt:0},sections:[0,1,2,3].map((g)=>({start:g*300,end:g===3?1194:(g+1)*300,first:[0,10,17,26][g],last:[9,16,25,35][g],verified:false,words:words.filter(w=>w.group===g).map(w=>w.id)}))});
const WORKSPACE='b3-2026';
const validKey=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);

function validateConfig(c){if(!c||!Number.isInteger(c.version)||c.version<0||!Array.isArray(c.sections)||c.sections.length!==4)fail(400,'Invalid lesson settings.');for(const t of Object.keys(c.unlocked||{}))if(!Number.isInteger(c.unlocked?.[t])||c.unlocked[t]<0||c.unlocked[t]>4)fail(400,'Choose 0–4 open sections.');let end=0,last=-1;const ids=new Set();c.sections.forEach((s,i)=>{if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start!==end||s.end<=s.start||s.end>1194||!Number.isInteger(s.first)||!Number.isInteger(s.last)||s.first!==last+1||s.last<s.first||s.last>35||typeof s.verified!=='boolean'||!Array.isArray(s.words)||s.words.length<1||s.words.length>12)fail(400,'Sections must be continuous, with valid audio times, paragraphs, and 1–12 words.');s.words.forEach(id=>{if(!words.some(w=>w.id===id)||ids.has(id))fail(400,'Each word may be assigned only once.');ids.add(id)});if(Object.values(c.unlocked||{}).some(n=>n>i)&&!s.verified)fail(400,'Check the audio and words before unlocking this section.');end=s.end;last=s.last});if(end!==1194||last!==35)fail(400,'Sections must include the complete recording and transcript.');const totalSteps=c.sections.reduce((n,s)=>n+Math.max(1,Math.ceil(s.words.length/4)),0);for(const t of Object.keys(c.unlockedSteps||{}))if(!Number.isInteger(c.unlockedSteps[t])||c.unlockedSteps[t]<0||c.unlockedSteps[t]>totalSteps)fail(400,'Choose a valid number of open steps.');return c}
function publicRound(r){if(!r)return null;return {id:r.id,group:r.group,part:Number.isInteger(r.part)?r.part:null,index:r.index,total:r.items.length,finished:r.index===r.items.length,question:r.items[r.index]||null}}
function makeService(store,verifyTeacher,now=Date.now){
const get=async p=>(await store.get(p));
const legacy=c=>['et','wt'].includes(c);
const configPath=c=>!c||legacy(c)?'yiddishPrivate/config':'yiddishPrivate/classes/'+WORKSPACE+'/'+c+'/config';
const studentPath=(c,id)=>legacy(c)?'yiddishPrivate/students/'+id:'yiddishPrivate/classes/'+WORKSPACE+'/'+c+'/students/'+id;
// Migration bridge: ET/WT students who have no central passcode yet may use the
// individual passcode from the private legacy list (never the shared 5770 default).
async function passcodeFor(id,profile,classId){const priv=String((await get('b3Private/passcodes/'+id))?.passcode||'').trim();if(priv)return priv;const central=String(profile?.passcode||'').trim();if(central)return central;if(!legacy(classId))return '';const old=await get('posukPractice/allowedStudents/'+id);const p=String(old?.passcode||'').trim();return old&&old.active!==false&&p&&p!=='5770'?p:''}
// B3's own classes always have the Wine Merchant story. Any other class gets it only
// when the admin grants it (Owner Admin > Class Content), stored where teachers cannot write.
const STORY_GRANT='yiddishWineMerchant';
// Paragraph start/end times for the Wine Merchant story audio, edited by the owner in yiddish/sync.html.
const TIMES_PATH='yiddishPrivate/storyTimes/wineMerchant';
const storyTimes=async()=>{const v=await get(TIMES_PATH);return v&&v.starts?{starts:v.starts,ends:v.ends||{},updatedAt:v.updatedAt||0}:null};
function validateTimes(starts,ends){
 const ok=o=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length<=60&&Object.entries(o).every(([k,v])=>/^\d{1,2}$/.test(k)&&Number(k)<=60&&typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1300);
 if(!ok(starts)||!ok(ends||{}))fail(400,'Invalid story times.');
 const ks=Object.keys(starts).map(Number).sort((a,b)=>a-b);
 for(let i=1;i<ks.length;i++)if(starts[ks[i]]<=starts[ks[i-1]])fail(400,'Paragraph '+ks[i]+' starts before paragraph '+ks[i-1]+'.');
 for(const [k,v] of Object.entries(ends||{}))if(starts[k]!==undefined&&v<=starts[k])fail(400,'Paragraph '+k+' ends before it starts.');
 const r=o=>Object.fromEntries(Object.entries(o||{}).map(([k,v])=>[k,Math.round(v*10)/10]));
 return {starts:r(starts),ends:r(ends)};
}
const storyGranted=async c=>legacy(c)||(validKey(c)&&(await get('b3Games/workspaces/'+WORKSPACE+'/contentGrants/'+c+'/'+STORY_GRANT))===true);
const cfg=async c=>{const saved=await get(configPath(c));if(saved)return saved;const d=defaults();if(c&&!legacy(c))d.unlocked={[c]:0};return d};
async function teacher(token,classId){
 const t=await verifyTeacher(token).catch(()=>null);
 if(!t||t.email_verified!==true)fail(403,'Teacher sign-in required.');
 if(classId&&!validKey(classId))fail(400,'Choose a valid class.');
 if(t.email==='simcha5770@gmail.com')return {owner:true,classId:classId||'et'};
 const row=await get('b3Games/workspaces/'+WORKSPACE+'/teachers/'+t.uid);
 if(!validKey(classId)||!row||row.active===false||row.classIds?.[classId]!==true)fail(403,'This class is not assigned to your teacher account.');
 const c=await get('b3Games/workspaces/'+WORKSPACE+'/classes/'+classId);
 if(!c||c.active===false||c.toolGrants?.yiddish!==true)fail(403,'Yiddish is not enabled for this class.');
 return {owner:false,classId};
}
async function studentRecord(id,classId){
 const profile=await get('b3Games/students/'+id+'/profile');
 const memberships=await get('b3Games/students/'+id+'/memberships')||{};
 if(profile?.active===false)fail(403,'Your access is turned off. Ask your teacher.');
 const active=Object.values(memberships).filter(m=>m&&m.active!==false&&m.workspaceId===WORKSPACE&&validKey(m.classId));
 const selected=active.find(m=>m.classId===classId)||(!classId&&active.length===1?active[0]:null);
 if(!selected)fail(403,'Choose an active class on Fun Torah Tools before opening Yiddish.');
 const c=await get('b3Games/workspaces/'+WORKSPACE+'/classes/'+selected.classId);
 if(!c||c.active===false||!c.members?.[id]||c.members[id].active===false)fail(403,'Your class membership is inactive. Ask your teacher.');
 return {profile,classId:selected.classId,classRecord:c};
}
async function identity(body){
 const t=String(body.token||'');if(!/^[a-f0-9]{48}$/.test(t))fail(401,'Please sign in again.');
 const session=await get('yiddishPrivate/sessions/'+hash(t));if(!session||session.expires<now())fail(401,'Please sign in again.');
 const row=await studentRecord(session.studentId,session.classId),classId=row.classId;
 if(row.profile&&session.passcodeHash!==hash(await passcodeFor(session.studentId,row.profile,classId)))fail(401,'Your passcode changed. Sign in again.');
 if(legacy(classId)){
  const settings=await get('b3Games/siteSettings')||{};
  if(!policy.isGameEnabledForClass(settings,classId,'yiddish')||!(policy.isClassOpen(settings,classId,new Date(now()))||policy.studentHasGameOverride(settings,session.studentId,'yiddish')))fail(403,'Yiddish is closed for your class right now.');
 }else if(row.classRecord.toolGrants?.yiddish!==true||row.classRecord.siteEnabled===false||row.classRecord.access?.mode==='locked')fail(403,'Yiddish is closed for your class right now.');
 return {id:session.studentId,name:row.profile?.name||row.classRecord.members[session.studentId].name||session.studentId,classId};
}

function allowed(c,who,g){if(!Number.isInteger(g)||g<0||g>3||g>=c.unlocked[who.classId]||!c.sections[g].verified)fail(403,'This section is not open yet.')}
return async function handle(b,ip='unknown'){
 if(!b||typeof b.action!=='string')fail(400,'Choose an action.');
 if(b.action.startsWith('teacher')){
  const access=await teacher(b.idToken,b.classId),classId=access.classId;
  if(legacy(classId)&&!access.owner)fail(403,'Legacy B3 lesson editing is available to the owner during migration.');
  if(b.action==='teacherLoad'){
   const [c,classRow]=await Promise.all([cfg(classId),get('b3Games/workspaces/'+WORKSPACE+'/classes/'+classId)]);
   const members=legacy(classId)&&access.owner?await get('posukPractice/allowedStudents'):classRow?.members;
   const roster={},students={};
   for(const [id,v] of Object.entries(members||{})){
    if(v.active===false)continue;
    const memberships=legacy(classId)?await get('b3Games/students/'+id+'/memberships'):null;
    const studentClass=legacy(classId)?(v.classId||Object.values(memberships||{}).find(m=>m.active!==false&&m.workspaceId===WORKSPACE&&legacy(m.classId))?.classId):classId;
    if(!studentClass)continue;
    roster[id]={name:v.name||id,classId:studentClass};
    students[id]=await get(studentPath(classId,id))||{};
   }
   return {config:c,roster,students,classId,storyGranted:await storyGranted(classId),storyTimes:await storyTimes(),owner:access.owner};
  }
  if(b.action==='teacherSaveTimes'){
   if(!access.owner)fail(403,'Only the owner account can change the story times.');
   const v=validateTimes(b.starts,b.ends);
   await store.set(TIMES_PATH,{...v,updatedAt:now()});
   return {ok:true,storyTimes:await storyTimes()};
  }
  if(b.action==='teacherSave'){
   if(!await storyGranted(classId))fail(403,'The admin has not given this class a Yiddish story yet.');
   const c=validateConfig(b.config);
   if(!legacy(classId)&&(Object.keys(c.unlocked).length!==1||!Object.hasOwn(c.unlocked,classId)))fail(400,'Settings must belong to the selected class.');
   let conflict=false;await store.tx(configPath(classId),old=>{conflict=false;old=old||{...defaults(),unlocked:legacy(classId)?defaults().unlocked:{[classId]:0}};if(old.version!==c.version){conflict=true;return undefined}return {...c,version:c.version+1}});
   if(conflict)fail(409,'Settings changed elsewhere. Reload before saving.');return {config:await cfg(classId)};
  }
  fail(400,'Unknown teacher action.');
 }

 if(b.action==='login'){
  const bucket='yiddishPrivate/loginLimits/'+hash(ip);let blocked=false;
  await store.tx(bucket,p=>{blocked=false;if(!p||p.until<now())p={count:0,until:now()+600000};if(p.count>=30){blocked=true;return undefined}return {...p,count:p.count+1}});
  if(blocked)fail(429,'Too many sign-in attempts. Try again in 10 minutes.');
  const id=String(b.studentId||'');if(!validKey(id))fail(401,'Check your name and individual passcode.');
  const row=await studentRecord(id,b.classId),person=row.profile,code=person?await passcodeFor(id,person,row.classId):'';
  if(!person||!code||!crypto.timingSafeEqual(Buffer.from(hash(String(b.pin||'').trim())),Buffer.from(hash(code))))fail(401,'Check your name and individual passcode.');
  const token=random();await store.set('yiddishPrivate/sessions/'+hash(token),{studentId:id,classId:row.classId,passcodeHash:hash(code),expires:now()+12*3600000});return {token};
 }
 const who=await identity(b),c=await cfg(who.classId),path=studentPath(who.classId,who.id);
 if(!await storyGranted(who.classId)){
  // Nothing is open and no progress is shown until the admin gives this class a story.
  if(b.action==='status')return {student:who,config:{...c,unlocked:{[who.classId]:0},unlockedSteps:{[who.classId]:0}},progress:{},round:null,noStory:true};
  fail(403,'Your class does not have a Yiddish story yet.');
 }

 if(b.action==='status'){const p=await get(path)||{};return {student:who,config:c,progress:p.words||{},round:publicRound(p.round),storyTimes:await storyTimes()}}
 if(b.action==='start'){allowed(c,who,b.group);const shuffle=a=>a.map(v=>({v,n:crypto.randomInt(1000000)})).sort((a,b)=>a.n-b.n).map(x=>x.v);const secWords=c.sections[b.group].words;let selected=secWords,part=null;if(b.part!==undefined&&b.part!==null){part=Number(b.part);const parts=Math.max(1,Math.ceil(secWords.length/4));if(!Number.isInteger(part)||part<0||part>=parts)fail(400,'Choose a valid step.');const openSteps=c.unlockedSteps&&c.unlockedSteps[who.classId];const stepNo=c.sections.slice(0,b.group).reduce((n,s)=>n+Math.max(1,Math.ceil(s.words.length/4)),0)+part+1;if(Number.isInteger(openSteps)&&stepNo>openSteps)fail(403,'This step is not open yet.');const fresh=secWords.slice(part*4,part*4+4);const earlier=[...c.sections.slice(0,b.group).flatMap(s=>s.words),...secWords.slice(0,part*4)];const prog=(await get(path))?.words||{};const review=shuffle(earlier).sort((x,y)=>(prog[x]?.credits||0)-(prog[y]?.credits||0)).slice(0,4);selected=[...fresh,...review]}const round={id:random(),group:b.group,part,version:c.version,index:0,started:now(),items:shuffle(selected).map(id=>({wordId:id,choices:shuffle([id,...shuffle(words.filter(w=>w.id!==id).map(w=>w.id)).slice(0,3)])})),results:{},responses:{}};await store.tx(path,p=>{p=p||{};p.rounds=p.rounds||{};p.rounds[round.id]=round;p.round=round;const ids=Object.keys(p.rounds).sort((a,b)=>(p.rounds[b]?.started||0)-(p.rounds[a]?.started||0));for(const id of ids.slice(6))delete p.rounds[id];return p});return {round:publicRound(round)}}
 if(b.action==='storyAnswer'){allowed(c,who,b.group);const sec=c.sections[b.group],paragraph=Number(b.paragraph),position=Number(b.position),total=Number(b.total),wrongCount=Number(b.wrongCount),requestId=String(b.requestId||'');if(!Number.isInteger(paragraph)||paragraph<sec.first||paragraph>sec.last||!Number.isInteger(position)||position<1||!Number.isInteger(total)||total<1||position>total||!Number.isInteger(wrongCount)||wrongCount<0||wrongCount>20||!/^[a-f0-9-]{20,64}$/.test(requestId))fail(400,'Invalid Story Detective result.');await store.tx(path,p=>{p=p||{};p.storyDetective=p.storyDetective||{sections:{},responses:{}};const sd=p.storyDetective;sd.sections=sd.sections||{};sd.responses=sd.responses||{};if(sd.responses[requestId])return p;const key=String(b.group),ss=sd.sections[key]||{answers:0,firstTryCorrect:0,misses:0,completedRounds:0,paragraphs:{}};ss.answers=Number(ss.answers||0)+1;ss.firstTryCorrect=Number(ss.firstTryCorrect||0)+(wrongCount===0?1:0);ss.misses=Number(ss.misses||0)+wrongCount;ss.lastPosition=position;ss.lastTotal=total;ss.lastParagraph=paragraph;ss.lastActive=now();if(position===total)ss.completedRounds=Number(ss.completedRounds||0)+1;ss.paragraphs=ss.paragraphs||{};const pk=String(paragraph),ps=ss.paragraphs[pk]||{answers:0,firstTryCorrect:0,misses:0};ps.answers=Number(ps.answers||0)+1;ps.firstTryCorrect=Number(ps.firstTryCorrect||0)+(wrongCount===0?1:0);ps.misses=Number(ps.misses||0)+wrongCount;ps.lastActive=now();ss.paragraphs[pk]=ps;sd.sections[key]=ss;sd.lastGroup=b.group;sd.lastActive=now();sd.responses[requestId]=now();const responseIds=Object.keys(sd.responses).sort((a,b)=>Number(sd.responses[b]||0)-Number(sd.responses[a]||0));for(const id of responseIds.slice(200))delete sd.responses[id];p.storyDetective=sd;p.lastActive=now();return p});return {ok:true}}
 if(b.action==='answer'){let result,error;await store.tx(path,p=>{error=null;result=null;p=p||{};p.rounds=p.rounds||{};const r=(p.round&&p.round.id===b.roundId)?p.round:p.rounds[b.roundId];if(!r){error='This practice round could not be found. Press Practice this section to start again.';return p}if(r.responses?.[b.requestId]){result={...r.responses[b.requestId],progress:r.responses[b.requestId].progress||{}};return p}try{allowed(c,who,r.group)}catch(e){error=e.message;return p}if(r.version!==c.version){error='Your teacher changed this lesson. Start a new round.';return p}const q=r.items[r.index];if(!q||b.index!==r.index||!q.choices.includes(b.answer)||!/^[a-f0-9-]{20,64}$/.test(b.requestId||'')){error='This answer is no longer current.';return p}r.results=r.results||{};r.responses=r.responses||{};const correct=b.answer===q.wordId;r.results[q.wordId]=r.results[q.wordId]||{wrong:[],firstTry:true};const a=r.results[q.wordId];a.wrong=a.wrong||[];if(!correct){if(!a.wrong.includes(b.answer))a.wrong.push(b.answer);a.firstTry=false}else{r.index++;if(r.index===r.items.length){p.words=p.words||{};for(const item of r.items){const id=item.wordId,v=p.words[id]||{credits:0,rounds:0};v.rounds++;if(r.results[id]?.firstTry)v.credits=Math.min(2,v.credits+1);v.lastSeen=now();p.words[id]=v}p.lastActive=now()}}result={correct,firstTry:a.firstTry,round:publicRound(r),progress:p.words||{}};r.responses[b.requestId]=result;p.rounds[r.id]=r;if(p.round&&p.round.id===r.id)p.round=r;if(r.index===r.items.length){for(const id of Object.keys(p.rounds)){if(id!==r.id&&p.rounds[id]?.index===p.rounds[id]?.items?.length)delete p.rounds[id]}}return p});if(error)fail(409,error);return result}
 fail(400,'Unknown action.');
}}
module.exports={makeService,defaults,validateConfig,hash,publicRound};
