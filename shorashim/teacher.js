const FIREBASE_CONFIG={apiKey:"AIzaSyDaheO5K2qL8qe3rHIZY4nTd0wuEUG_DEs",authDomain:"b3-games.firebaseapp.com",databaseURL:"https://b3-games-default-rtdb.firebaseio.com",projectId:"b3-games",storageBucket:"b3-games.firebasestorage.app",messagingSenderId:"568530046190",appId:"1:568530046190:web:fd765fdd27e55a3c73f7ff"};
if(!firebase.apps.length)firebase.initializeApp(FIREBASE_CONFIG);const db=firebase.database();const ROOT='posukPractice/shorashimLearning';
// Same teacher passcode used by the existing Posuk Practice teacher dashboard.
const TEACHER_PASSCODE="vayeira5786";
// AI picture-choice helper. Deploy the matching generateShorashimArt Cloud Function.
const GENERATE_SHORASHIM_ART_URL="https://us-central1-b3-games.cloudfunctions.net/generateShorashimArt";
let state={catalog:{shorashim:[],prefix:[],suffix:[]},settings:{minReviewMs:500,studentSiteOpen:true},students:{},leaderboards:{}};let currentTrack='shorashim';
const $=id=>document.getElementById(id);const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ===== Meaning-aware picture choices =====
   The old Bulk Add path assigned the exact same three generic choices
   (✨ ⭐ 🖍️) to every imported item.  New imports now receive picture
   choices based on the English meaning.  Existing bulk/custom Shorashim
   items that still have only those generic choices are repaired once when
   the teacher dashboard loads.  Original hand-curated art is left alone. */
const GENERIC_ART_CHOICES=new Set(['✨','⭐','🖍️']);
const SMART_ART_RULES=[
  [/entrance|opening|door/,['🚪','🏠','⛺','↔️']],
  [/\btent\b|ohel/,['⛺','🏕️','🏠','🌵']],
  [/\bsee\b|\bsaw\b|\bseen\b|\blook\b|\bappea?r/,['👀','👁️','🔎','✨']],
  [/behold|look!|notice/,['👀','❗','✨','🔎']],
  [/grove|tree|wood/,['🌳','🌲','🌿','🪵']],
  [/\bsit\b|\bsat\b|sitting/,['🪑','🧎','🛋️','🏕️']],
  [/\bheat\b|\bhot\b|warm/,['☀️','🔥','🌡️','🥵']],
  [/\bday\b|daytime/,['☀️','🌤️','📅','🌅']],
  [/\blift\b|\blifted\b|\bcarry\b|\bcarried\b|\braise\b/,['⬆️','🙌','📦','💪']],
  [/\beye\b|\beyes\b/,['👁️','👀','🙂','🔎']],
  [/\bthree\b|\b3\b/,['3️⃣','🔺','👨‍👨‍👦','✨']],
  [/\bman\b|\bmen\b|\bperson\b|\bpeople\b/,['👨','🧍','👥','🙂']],
  [/\bstand\b|\bstood\b|standing|firm/,['🧍','📍','⬆️','🚶']],
  [/\brun\b|\bran\b|running|hurr(y|ied)|quick/,['🏃','💨','👟','⚡']],
  [/\bcall\b|\bcalled\b|\bsay\b|\bsaid\b|\bspeak\b|\bspoke\b/,['🗣️','💬','📣','👄']],
  [/greet|meet|toward|towards/,['🤝','👋','👥','➡️']],
  [/\bbow\b|bowed|prostrate/,['🙇','🙏','🧎','⬇️']],
  [/\bland\b|\bearth\b|ground/,['🌍','🏞️','🌱','🗺️']],
  [/\bfind\b|\bfound\b/,['🔎','💡','✅','🎯']],
  [/grace|favor|favour|kindness/,['❤️','✨','🤲','😊']],
  [/cross|passed|pass over|across/,['➡️','🌉','🚶','🛣️']],
  [/serve|served|work|worked|labor/,['🛠️','🤲','💼','⚙️']],
  [/\btake\b|\btook\b|\btaken\b/,['✋','🤲','📦','⬅️']],
  [/\blittle\b|\bfew\b|small amount|morsel/,['🤏','1️⃣','🔹','🐜']],
  [/\bwater\b/,['💧','🚰','🌊','🫗']],
  [/\bwash\b|washed|washing/,['🧼','💦','🫧','🚿']],
  [/\bfoot\b|\bfeet\b|\bleg\b|\blegs\b/,['🦶','👣','🧦','👟']],
  [/lean|support|supported|sustain|sustained/,['🌳','🪑','💪','🤲']],
  [/\bbread\b|\bloaf\b/,['🍞','🥖','🥯','🌾']],
  [/\bheart\b|\bhearts\b/,['❤️','💗','🫶','💓']],
  [/\bmake\b|\bmade\b|\bdo\b|\bdid\b/,['🛠️','✅','🧱','🔧']],
  [/\bflour\b/,['🌾','🥣','🍞','✨']],
  [/knead|kneaded/,['🤲','🍞','🥣','👨‍🍳']],
  [/\bcake\b|\bcakes\b/,['🍰','🧁','🥮','🎂']],
  [/cattle|cow|ox|bull/,['🐄','🐂','🐮','🌾']],
  [/\bson\b|\bboy\b|\byouth\b|\blad\b/,['👦','🧒','👨‍👦','🏃']],
  [/soft|tender/,['🧸','☁️','🪶','🤲']],
  [/\bgood\b|fine|excellent/,['👍','⭐','😊','✅']],
  [/\bgive\b|\bgave\b|\bgiven\b/,['🎁','🤲','➡️','💝']],
  [/\bbutter\b/,['🧈','🥛','🍞','🐄']],
  [/\bmilk\b/,['🥛','🐄','🍼','🤍']],
  [/\bface\b|\bbefore\b/,['🙂','👤','👀','➡️']],
  [/\beat\b|\bate\b|\beaten\b|food|meal/,['🍽️','🥘','😋','🍴']],
  [/return|returned|back again/,['↩️','🔙','🏠','🔄']],
  [/\btime\b/,['⏰','⌛','🕰️','📅']],
  [/\blive\b|\blived\b|\blife\b/,['❤️','🌱','🙂','🌿']],
  [/\bhear\b|\bheard\b|\blisten\b/,['👂','🔊','🎧','🎶']],
  [/\bafter\b|\bbehind\b/,['⬅️','👣','🚶','🔙']],
  [/\bfire\b|burn/,['🔥','🪵','☀️','🚒']],
  [/\bhouse\b|\bhome\b/,['🏠','🏡','🚪','🛏️']],
  [/\bmaster\b|\blord\b|\bking\b/,['👑','🏛️','⭐','🫅']],
  [/\bhand\b|\bhands\b/,['✋','🤲','🖐️','👋']],
  [/\bhead\b/,['👤','🧠','🎩','🙂']],
  [/\bmouth\b/,['👄','🗣️','💬','😮']],
  [/\bchild\b|\bchildren\b/,['🧒','👦','🧸','🏠']],
  [/\bmother\b|\bwoman\b|\bwomen\b/,['👩','👩‍👦','🏠','❤️']],
  [/\bfather\b/,['👨','👨‍👦','🏠','❤️']],
  [/\bwalk\b|\bgo\b|\bwent\b/,['🚶','👣','➡️','🛣️']],
  [/\bcome\b|\bcame\b/,['➡️','🚶','👋','🏠']],
  [/\bup\b|\babove\b/,['⬆️','🪜','☝️','🚀']],
  [/\bdown\b|\bbelow\b/,['⬇️','👇','🪜','📉']],
  [/\bbig\b|\bgreat\b|\blarge\b/,['🐘','⬆️','🔷','💪']],
  [/\bsmall\b|\blittle\b/,['🐜','🤏','🔹','🐭']],
  [/\bold\b|elder/,['👴','🕰️','📜','⌛']],
  [/\bnew\b/,['✨','🆕','🌱','🎁']],
  [/\bnight\b/,['🌙','⭐','🌌','🛏️']],
  [/\bmorning\b/,['🌅','☀️','⏰','☕']],
  [/\blight\b|bright/,['💡','☀️','🔦','✨']],
  [/\bdark\b|darkness/,['🌑','🌙','🌌','🕶️']],
  [/\bbuy\b|\bbought\b/,['🛒','💰','🧾','🛍️']],
  [/\bsell\b|\bsold\b/,['💵','🏷️','🤝','🛍️']],
  [/\bmoney\b|silver|gold/,['💰','💵','🪙','🏦']],
  [/\bcity\b|town/,['🏙️','🏘️','🛣️','🏢']],
  [/\bfield\b/,['🌾','🌱','🚜','🏞️']],
  [/\bmountain\b|\bhill\b/,['⛰️','🏔️','🥾','🌄']],
  [/\briver\b/,['🌊','🏞️','💧','🚣']],
  [/\bwell\b|\bspring\b/,['🪣','💧','🌊','🏞️']],
  [/\banimal\b|\bbeast\b/,['🐄','🐑','🐐','🐎']],
  [/\bsheep\b|\blamb\b/,['🐑','🌾','🐏','🧶']],
  [/\bdonkey\b/,['🫏','🐴','🛤️','📦']],
  [/\bhorse\b/,['🐎','🏇','🌾','🛣️']],
  [/\bbird\b/,['🐦','🪶','🪺','🌳']],
  [/\bseed\b|plant/,['🌱','🌾','🫘','🌻']],
  [/\bhim\b|\bhis\b|\bhe\b/,['👦','👉','👀','🙂']],
  [/\bthem\b|\bthey\b/,['👥','👉','➡️','🤝']],
  [/\byou\b|\byour\b/,['👉','🙂','🏠','💬']],
  [/\bto\b|\btoward\b|\btowards\b/,['➡️','👉','🛣️','🏠']],
  [/\bon\b|\bupon\b/,['⬆️','📍','🔝','🧱']]
];
const SMART_ART_FALLBACK=['🎯','💡','📖','🧩','🔎','🌟','📌','🧠','🎨','✅','➡️','👀'];

function hasOnlyGenericArt(art){
  return !Array.isArray(art)||!art.length||art.every(x=>GENERIC_ART_CHOICES.has(x));
}
function smartArtFor(english='',front=''){
  const text=`${english} ${front}`.toLowerCase();
  const found=[];
  const add=v=>{if(v&&!found.includes(v))found.push(v)};
  SMART_ART_RULES.forEach(([re,choices])=>{if(re.test(text))choices.forEach(add)});
  // Offline fallback must never pad with unrelated brain/lightbulb/arrow icons.
  return found.slice(0,4);
}
function hasBadAutoArt(item){
  const art=Array.isArray(item?.art)?item.art:[];
  // Anything created by our recent auto-art versions should be regenerated by AI.
  if(item?.autoArt===true) return true;
  // Old bulk imports used only these generic placeholders.
  if(!art.length || art.every(x=>GENERIC_ART_CHOICES.has(x))) return true;
  return false;
}

async function generateAiArtForItems(items){
  const clean=(items||[]).filter(Boolean).map(i=>({
    id:String(i.id||''),
    front:String(i.front||''),
    english:String(i.english||'')
  })).filter(i=>i.id&&i.english);
  if(!clean.length) return new Map();
  if(!GENERATE_SHORASHIM_ART_URL) return new Map();

  const out=new Map();
  // Batch requests so a large weekly upload does not create one AI call per word.
  for(let n=0;n<clean.length;n+=40){
    const batch=clean.slice(n,n+40);
    try{
      const res=await fetch(GENERATE_SHORASHIM_ART_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({items:batch})
      });
      if(!res.ok) throw new Error(`AI art request failed (${res.status})`);
      const data=await res.json();
      for(const row of (data.items||[])){
        const art=Array.isArray(row.art)?row.art.filter(Boolean).slice(0,4):[];
        if(row.id&&art.length) out.set(String(row.id),art);
      }
    }catch(err){
      console.warn('generateShorashimArt failed; using local fallback for this batch',err);
    }
  }
  return out;
}

async function fillArtForShorashim(items,{force=false}={}){
  const targets=(items||[]).filter(i=>force||hasBadAutoArt(i));
  if(!targets.length) return 0;
  const ai=await generateAiArtForItems(targets);
  let changed=0;
  for(const item of targets){
    let art=ai.get(String(item.id));
    // Offline/service fallback: use the local semantic rules rather than leaving a blank card.
    if(!art||!art.length) art=smartArtFor(item.english,item.front);
    if(art&&art.length){
      item.art=art.slice(0,4);
      item.autoArt=false;       // finished AI/fallback result; do not regenerate every login
      item.aiArtGenerated=true;
      item.aiArtGeneratedAt=Date.now();
      changed++;
    }else{
      // Keep it eligible for a future retry if both AI and local fallback fail.
      item.art=[];
      item.autoArt=true;
    }
  }
  return changed;
}

function splitKey(k){const i=k.indexOf(':');return[k.slice(0,i),k.slice(i+1)]}function itemFor(key){const[t,id]=splitKey(key);return(state.catalog[t]||[]).find(x=>x.id===id)||null}function fmtSec(sec){sec=Math.round(sec||0);const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60);return h?`${h}h ${m}m`:m?`${m}m`:`${sec}s`}function dateLabel(ts){if(!ts)return'Never';return new Date(ts).toLocaleString()}function today(){const d=new Date();return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function learned(s,type){return Object.values(s.cards||{}).filter(c=>c.learnedAt&&(!type||c.itemType===type)&&itemFor(c.itemKey)&&!itemFor(c.itemKey).hidden)}function reviewDone(s){const r=s.dailyReview||{};const total=learned(s).length;const seen=r.date===today()?Object.keys(r.seen||{}).length:0;return{total,seen,complete:!!total&&r.date===today()&&seen>=total}}
function status(t,k=''){const e=$('teacherCloudStatus');e.textContent=t;e.className='cloud-status '+k}
async function loadAll(){
  status('☁️ Loading…','syncing');
  const[a,b,c,d]=await Promise.all([db.ref(`${ROOT}/catalog`).once('value'),db.ref(`${ROOT}/settings`).once('value'),db.ref(`${ROOT}/students`).once('value'),db.ref(`${ROOT}/leaderboards`).once('value')]);
  state.catalog=a.val()||state.catalog;
  state.settings={minReviewMs:500,studentSiteOpen:true,...(b.val()||{})};
  state.students=c.val()||{};
  state.leaderboards=d.val()||{};
  const needsArt=(state.catalog.shorashim||[]).filter(hasBadAutoArt);
  let repaired=0;
  if(needsArt.length){
    status(`☁️ Creating picture choices for ${needsArt.length} word${needsArt.length===1?'':'s'}…`,'syncing');
    repaired=await fillArtForShorashim(needsArt);
    if(repaired) await db.ref(`${ROOT}/catalog`).set(state.catalog);
  }
  $('teacherMinReview').value=String(state.settings.minReviewMs||500);
  renderStudentSiteControl();
  renderAll();
  status(repaired?`☁️ Connected • ${repaired} picture set${repaired===1?'':'s'} created`:'☁️ Connected');
}
function renderAll(){renderDashboard();renderCatalog();renderLeaderboard()}
function renderDashboard(){const arr=Object.entries(state.students),total=arr.reduce((n,[,s])=>n+learned(s).length,0),done=arr.filter(([,s])=>reviewDone(s).complete).length,time=arr.reduce((n,[,s])=>n+(s.totalActiveSeconds||0),0);$('teacherStats').innerHTML=[['Students',arr.length],['Learned cards',total],['Class study time',fmtSec(time)],['Review complete today',`${done}/${arr.length}`]].map(([a,b])=>`<div class="tstat"><span>${a}</span><b>${b}</b></div>`).join('');const body=$('teacherStudentsBody');body.innerHTML='';arr.sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0])).forEach(([id,s])=>{const r=reviewDone(s),tr=document.createElement('tr');tr.innerHTML=`<td><b>${esc(s.name||id)}</b></td><td>${learned(s,'shorashim').length}</td><td>${learned(s,'prefix').length+learned(s,'suffix').length}</td><td>${fmtSec(s.totalActiveSeconds)}</td><td>${r.total?`${r.seen}/${r.total}${r.complete?' ✓':''}`:'—'}</td><td>${dateLabel(s.lastActive)}</td>`;tr.onclick=()=>openStudent(id);body.appendChild(tr)})}
function openStudent(id){const s=state.students[id];if(!s)return;const cards=learned(s);$('studentDetail').classList.remove('hidden');$('studentDetail').innerHTML=`<div class="student-detail-head"><div><div class="eyebrow">Student details</div><h2>${esc(s.name||id)}</h2></div><button id="closeStudentCloud" class="ghost">Close</button></div><div class="teacher-grid">${[['Shorashim',learned(s,'shorashim').length],['Affixes',learned(s,'prefix').length+learned(s,'suffix').length],['Study time',fmtSec(s.totalActiveSeconds)],['Sessions',(s.sessions||[]).length+(s.activeSession?1:0)]].map(([a,b])=>`<div class="tstat"><span>${a}</span><b>${b}</b></div>`).join('')}</div><h3>Learning history</h3><div>${cards.slice().sort((a,b)=>b.learnedAt-a.learnedAt).map(c=>{const i=itemFor(c.itemKey);return`<div class="history-row-cloud"><b dir="rtl">${esc(i?.front||c.itemId)}</b><span>${esc(i?.english||'')}</span><span>${esc(c.itemType)}</span><span>${dateLabel(c.learnedAt)}</span></div>`}).join('')||'<p>No learned cards yet.</p>'}</div><h3>Card gallery</h3><div class="teacher-gallery">${cards.map(cardHTML).join('')}</div>`;$('closeStudentCloud').onclick=()=>$('studentDetail').classList.add('hidden');$('studentDetail').scrollIntoView({behavior:'smooth'})}
function cardHTML(c){const i=itemFor(c.itemKey);if(!i)return'';const d=c.design||{},arts=(d.arts||[]).map(a=>a.kind==='illustration'?`<div class="art" style="left:${a.left||50}%;top:${a.top||66}%;width:${(a.size||84)*.55}px;height:${(a.size||84)*.4}px"><img src="${esc(a.value)}"></div>`:`<div class="art" style="left:${a.left||50}%;top:${a.top||66}%;font-size:${(a.size||84)*.55}px">${a.value||''}</div>`).join('');return`<div class="teacher-card-mini"><div class="teacher-card-face" style="background:${d.backgroundColor||'#fff9e8'}"><div class="term" style="left:${d.hebrewPos?.left||50}%;top:${d.hebrewPos?.top||28}%;font-size:${Math.min(34,(d.hebrewSize||58)*.55)}px;color:${d.hebrewColor||'#222'}">${esc(i.front)}</div>${arts}${d.drawing?`<img class="drawing" src="${esc(d.drawing)}">`:''}</div><div class="teacher-card-meta">${esc(i.english)} • ${dateLabel(c.learnedAt)}</div></div>`}
function listNameOf(i){return i.listName||'Main List'}
function namedLists(){
  state.settings.namedLists=state.settings.namedLists||{};
  const saved=Array.isArray(state.settings.namedLists[currentTrack])?state.settings.namedLists[currentTrack]:[];
  const fromItems=(state.catalog[currentTrack]||[]).map(listNameOf);
  return [...new Set(['Main List',...saved,...fromItems])].sort((a,b)=>a.localeCompare(b));
}
function refreshNamedLists(prefer){const sel=$('teacherListName');if(!sel)return;const names=namedLists();const wanted=prefer||sel.value||'Main List';sel.innerHTML=names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('');sel.value=names.includes(wanted)?wanted:'Main List'}
function renderCatalog(){currentTrack=$('teacherTrack').value;refreshNamedLists();const chosen=$('teacherListName')?.value||'Main List',all=state.catalog[currentTrack]||[],list=all.filter(i=>listNameOf(i)===chosen);$('teacherCatalog').innerHTML=list.map((i,idx)=>`<div class="catalog-teacher-row${i.hidden?' hidden-item':''}" data-id="${esc(i.id)}"><div class="mini-actions"><button data-a="up" ${idx===0?'disabled':''}>▲</button><button data-a="down" ${idx===list.length-1?'disabled':''}>▼</button></div><div class="hebrew">${esc(i.front)}</div><div><b>${esc(i.english)}</b><div class="mini-note">${i.pasuk?`Pasuk ${esc(i.pasuk)} • `:''}${i.hidden?'Hidden from future learning':'Active'} • ${esc(chosen)}</div></div><div class="mini-actions"><button data-a="edit" class="ghost">Edit</button><button data-a="hide" class="${i.hidden?'primary':'ghost'}">${i.hidden?'Restore':'Hide'}</button><button data-a="delete" class="danger catalog-remove-btn">🗑 Delete</button></div></div>`).join('')||'<p class="mini-note">This list is empty.\nAdd an item or use Bulk Add.</p>';[...$('teacherCatalog').querySelectorAll('.catalog-teacher-row')].forEach(row=>{const id=row.dataset.id;row.querySelector('[data-a=up]').onclick=()=>moveNamed(id,-1);row.querySelector('[data-a=down]').onclick=()=>moveNamed(id,1);row.querySelector('[data-a=edit]').onclick=()=>openEdit(id);row.querySelector('[data-a=hide]').onclick=()=>toggleHide(id);row.querySelector('[data-a=delete]').onclick=()=>deleteCatalogItem(id)})}
async function moveNamed(id,dir){const all=state.catalog[currentTrack],chosen=$('teacherListName').value,list=all.filter(i=>listNameOf(i)===chosen),i=list.findIndex(x=>x.id===id),j=i+dir;if(i<0||j<0||j>=list.length)return;const ai=all.indexOf(list[i]),aj=all.indexOf(list[j]);[all[ai],all[aj]]=[all[aj],all[ai]];renderCatalog();await saveCatalog()}
async function saveCatalog(){status('☁️ Saving…','syncing');await db.ref(`${ROOT}/catalog`).set(state.catalog);status('☁️ Saved')}
async function move(id,dir){const l=state.catalog[currentTrack],i=l.findIndex(x=>x.id===id),j=i+dir;if(i<0||j<0||j>=l.length)return;[l[i],l[j]]=[l[j],l[i]];renderCatalog();await saveCatalog()}
async function toggleHide(id){const i=(state.catalog[currentTrack]||[]).find(x=>x.id===id);if(!i)return;if(!i.hidden&&!confirm(`Remove “${i.front}” from the student learning list?\n\nIt will no longer appear in future learning or review. Any existing student history will be kept, and you can Restore the item later.`))return;i.hidden=!i.hidden;renderCatalog();await saveCatalog()}
async function deleteCatalogItem(id){
  const list=state.catalog[currentTrack]||[],i=list.find(x=>x.id===id);
  if(!i)return;
  if(!confirm(`Permanently delete “${i.front}”?\n\nThis removes the word from the learning list completely. This cannot be undone.`))return;
  state.catalog[currentTrack]=list.filter(x=>x.id!==id);
  renderCatalog();
  await saveCatalog();
}
function openEdit(id=null){const i=id?(state.catalog[currentTrack]||[]).find(x=>x.id===id):null;$('tDialogTitle').textContent=i?'Edit Item':'Add Item';$('tEditId').value=i?.id||'';$('tListName').value=i?listNameOf(i):($('teacherListName')?.value||'Main List');$('tFront').value=i?.front||'';$('tEnglish').value=i?.english||'';$('tPasuk').value=i?.pasuk||'';$('tWord').value=i?.hebrew||'';$('tExamples').value=(i?.examples||[]).map(x=>`${x.hebrew} | ${x.english}`).join('\n');$('tWordWrap').classList.toggle('hidden',currentTrack!=='shorashim');$('tExamplesWrap').classList.toggle('hidden',currentTrack==='shorashim');$('teacherCatalogDialog').showModal()}
async function saveEdit(e){
  e.preventDefault();
  const l=state.catalog[currentTrack],id=$('tEditId').value;
  let i=id?l.find(x=>x.id===id):null;
  if(!i){
    i={id:`custom-${currentTrack}-${Date.now()}`,art:[],autoArt:currentTrack==='shorashim',hidden:false};
    l.push(i);
  }
  i.listName=$('tListName').value.trim()||'Main List';
  i.front=$('tFront').value.trim();
  i.english=$('tEnglish').value.trim();
  i.pasuk=$('tPasuk').value.trim();
  if(currentTrack==='shorashim'){
    i.hebrew=$('tWord').value.trim();
    // New words and edited meanings get fresh AI-selected picture choices.
    i.autoArt=true;
    status('☁️ Creating picture choices…','syncing');
    await fillArtForShorashim([i],{force:true});
  }else{
    if(!Array.isArray(i.art)||!i.art.length)i.art=['✨','⭐','🖍️'];
    i.examples=$('tExamples').value.split('\n').map(x=>x.trim()).filter(Boolean).map(line=>{const[a,...b]=line.split('|');return{hebrew:a.trim(),english:b.join('|').trim()}});
  }
  $('teacherCatalogDialog').close();
  renderCatalog();
  await saveCatalog();
}
function renderStudentSiteControl(){
  const btn=$('toggleStudentSite'), text=$('studentSiteStatusText');
  if(!btn||!text)return;
  const open=state.settings.studentSiteOpen!==false;
  text.textContent=open?'OPEN — students can use Shorashim right now.':'CLOSED — students cannot use Shorashim right now.';
  btn.textContent=open?'🔒 Close Student Website':'🔓 Open Student Website';
  btn.className=open?'danger':'primary';
  const wrap=btn.closest('.site-access-control');if(wrap)wrap.classList.toggle('closed',!open);
}
async function toggleStudentSite(){
  const currentlyOpen=state.settings.studentSiteOpen!==false;
  if(currentlyOpen&&!confirm('Close the Shorashim student website now? Students who are already using it will also be shown the closed screen.'))return;
  state.settings.studentSiteOpen=!currentlyOpen;
  renderStudentSiteControl();
  status('☁️ Saving…','syncing');
  await db.ref(`${ROOT}/settings/studentSiteOpen`).set(state.settings.studentSiteOpen);
  status('☁️ Saved');
}
async function loadAccess(){const[p,a]=await Promise.all([db.ref('posukPractice/settings/classPin').once('value'),db.ref('posukPractice/allowedStudents').once('value')]);$('accessPin').value=p.val()||'';renderRoster(a.val()||{})}
function renderRoster(v){const rows=Object.entries(v).map(([id,x])=>({id,name:x?.name||id})).sort((a,b)=>a.name.localeCompare(b.name));$('rosterList').innerHTML=rows.map(r=>`<div class="roster-row"><span>${esc(r.name)}</span><button class="danger small" data-remove="${esc(r.id)}">Remove</button></div>`).join('')||'<p>No approved students yet.</p>';[...$('rosterList').querySelectorAll('[data-remove]')].forEach(b=>b.onclick=async()=>{if(!confirm('Remove this student from approved access?'))return;await db.ref('posukPractice/allowedStudents/'+b.dataset.remove).remove();loadAccess()})}
function slug(n){return n.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')}
function renderLeaderboard(){const match=state.leaderboards.match||{};$('leaderboardTeacher').innerHTML=Object.keys(match).sort((a,b)=>Number(a)-Number(b)).map(k=>{const rows=Object.entries(match[k]||{}).map(([id,x])=>({id,...x})).filter(x=>Number.isFinite(Number(x.time))).sort((a,b)=>a.time-b.time);return`<h3>${esc(k)}-pair Match</h3>${rows.length?`<table class="teacher-table"><thead><tr><th>#</th><th>Student</th><th>Time</th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name||r.id)}</td><td>${(r.time/1000).toFixed(2)}s</td></tr>`).join('')}</tbody></table>`:'<p class="mini-note">No scores yet.</p>'}`}).join('')||'<p>No leaderboard scores yet.</p>'}
function bindTabs(){document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.teacher-tab').forEach(x=>x.classList.add('hidden'));$('tab-'+b.dataset.tab).classList.remove('hidden');if(b.dataset.tab==='access'){loadAccess();renderStudentSiteControl()}})}

$('teacherEnter').onclick=()=>{if($('teacherPasscode').value!==TEACHER_PASSCODE){$('teacherGateMsg').textContent='Incorrect passcode.';return}$('teacherGate').classList.add('hidden');$('teacherApp').classList.remove('hidden');sessionStorage.setItem('shorashimTeacher','1');loadAll()};
$('teacherPasscode').addEventListener('keydown',e=>{if(e.key==='Enter')$('teacherEnter').click()});
$('teacherLogout').onclick=()=>{sessionStorage.removeItem('shorashimTeacher');location.reload()};
$('teacherTrack').onchange=()=>{refreshNamedLists();renderCatalog()};
$('teacherListName').onchange=renderCatalog;
$('teacherNewList').onclick=async()=>{
  const n=prompt('Name the new learning list:');if(!n?.trim())return;
  const name=n.trim();state.settings.namedLists=state.settings.namedLists||{};
  const lists=Array.isArray(state.settings.namedLists[currentTrack])?state.settings.namedLists[currentTrack]:[];
  if(namedLists().some(x=>x.toLowerCase()===name.toLowerCase())){alert('A list with that name already exists.');refreshNamedLists(name);return}
  state.settings.namedLists[currentTrack]=[...lists,name];
  status('☁️ Saving…','syncing');await db.ref(`${ROOT}/settings`).set(state.settings);status('☁️ Saved');
  refreshNamedLists(name);renderCatalog();$('teacherListName').value=name;renderCatalog()
};
$('teacherBulkAdd').onclick=()=>{$('bulkListLabel').textContent=$('teacherListName').value||'Main List';$('bulkItems').value='';$('teacherBulkDialog').showModal()};
$('saveBulkItems').onclick=async e=>{
  e.preventDefault();
  const name=$('teacherListName').value||'Main List',
        lines=$('bulkItems').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
        l=state.catalog[currentTrack],
        added=[];
  for(const line of lines){
    const parts=line.split('|').map(x=>x.trim());
    if(parts.length<2||!parts[0]||!parts[1])continue;
    const isShoreshim=currentTrack==='shorashim';
    const item={
      id:`bulk-${currentTrack}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      listName:name,
      front:parts[0],
      english:parts[1],
      art:isShoreshim?[]:['✨','⭐','🖍️'],
      autoArt:isShoreshim,
      hidden:false
    };
    if(isShoreshim){
      item.hebrew=parts[2]||parts[0];
      item.pasuk=parts[3]||'';
    }
    l.push(item);
    if(isShoreshim)added.push(item);
  }
  $('teacherBulkDialog').close();
  renderCatalog();
  if(added.length){
    status(`☁️ Creating pictures for ${added.length} new word${added.length===1?'':'s'}…`,'syncing');
    await fillArtForShorashim(added,{force:true});
  }
  await saveCatalog();
};
$('toggleStudentSite').onclick=toggleStudentSite;
$('teacherMinReview').onchange=async()=>{state.settings.minReviewMs=+$('teacherMinReview').value;await db.ref(`${ROOT}/settings`).set(state.settings)};
$('teacherAddItem').onclick=()=>openEdit();
$('tCancelItem').onclick=()=>$('teacherCatalogDialog').close();
$('cancelBulkItems').onclick=()=>$('teacherBulkDialog').close();
$('tSaveItem').onclick=saveEdit;
$('saveAccessPin').onclick=async()=>{await db.ref('posukPractice/settings/classPin').set($('accessPin').value.trim());$('accessPinMsg').textContent='Saved ✓'};
$('addAccessName').onclick=async()=>{const name=$('newAccessName').value.trim(),id=slug(name);if(!id)return;await db.ref('posukPractice/allowedStudents/'+id).set({name});$('newAccessName').value='';$('accessNameMsg').textContent='Added ✓';loadAccess()};
bindTabs();
if(sessionStorage.getItem('shorashimTeacher')==='1'){$('teacherGate').classList.add('hidden');$('teacherApp').classList.remove('hidden');loadAll()}

db.ref(ROOT).on('value',snap=>{
  if($('teacherApp').classList.contains('hidden'))return;
  const v=snap.val()||{};
  if(v.catalog)state.catalog=v.catalog;
  if(v.settings){state.settings={minReviewMs:500,studentSiteOpen:true,...v.settings};renderStudentSiteControl();}
  if(v.students)state.students=v.students;
  if(v.leaderboards)state.leaderboards=v.leaderboards;
  renderAll()
});