/* Shorashim teacher enhancements — load AFTER teacher.js */
(() => {
  'use strict';

  const COMMONNESS_EXACT = {
    'אמר':10,'היה':10,'עשה':10,'הלך':10,'בא':10,'ראה':10,'נתן':10,'לקח':10,'יצא':10,
    'ישב':9,'שמע':9,'ידע':9,'קום':9,'שוב':9,'קרא':9,'מצא':9,'שלח':9,'אכל':9,'שתה':9,
    'בן':10,'בת':9,'אב':9,'אח':8,'איש':10,'יום':10,'לילה':8,'ארץ':10,'עיר':8,'בית':10,
    'יד':9,'עין':8,'מים':9,'לחם':8,'אש':8,'שמים':9,'אדמה':8,'הר':8,'בקר':8,'ערב':8,
    'אחד':10,'שנים':9,'שלש':8,'ארבע':7,'עשר':8,'גדול':8,'קטן':8,'טוב':9,'רע':8,
    'מות':9,'חיה':8,'עלה':9,'ירד':8,'עמד':8,'שכב':7,'סגר':6,'פתח':7,'זכר':8,
    'חזק':7,'נפש':8,'חסד':7,'זרע':8,'מלך':9,'מלאך':8,'זקן':7,'נער':7,'אשה':9
  };

  function hk(v){
    return String(v||'').normalize('NFD')
      .replace(/[\u0591-\u05C7]/g,'')
      .replace(/[^א-ת]/g,'');
  }
  function clamp(n){ n=Number(n); return Number.isFinite(n)?Math.max(1,Math.min(10,Math.round(n))):null; }
  function commonnessLabel(n){
    n=clamp(n);
    if(n>=9)return 'Very common';
    if(n>=7)return 'Common';
    if(n>=5)return 'Moderate';
    if(n>=3)return 'Uncommon';
    return 'Rare';
  }
  function estimate(i){
    const k=hk(i.front);
    if(COMMONNESS_EXACT[k]) return COMMONNESS_EXACT[k];
    const e=String(i.english||'').toLowerCase();
    const rules=[
      [/\b(say|said|speak|go|went|come|came|see|saw|give|gave|take|took|make|made)\b/,9],
      [/\b(man|person|house|land|day|son|father|mother|water|hand|one)\b/,9],
      [/\b(eat|hear|stand|sit|return|rise|brother|daughter|city|morning|night|fire)\b/,8],
      [/\b(old|elder|small|great|good|evil|mountain|ground|seed|remember)\b/,7],
      [/\b(door|gate|street|shade|escape|kindness|close|break|bake|dust)\b/,6],
      [/\b(furnace|sulfur|roof beam|blindness|linger|ashes)\b/,3]
    ];
    for(const [r,n] of rules) if(r.test(e)) return n;
    return 5;
  }

  const DIRECT = [
    [/\bbrother\b|sibling/,['👦','👦','👥','🤝']],
    [/\bold\b|elder/,['🦯','🧓','👴','⌛','🕰️']],
    [/\bstand\b|stood/,['🧍','⬆️','📍']],
    [/\brun\b|ran|hurry/,['🏃','💨','👟']],
    [/\bwalk\b|went|go\b/,['🚶','👣','🛣️']],
    [/\bbow\b|prostrate/,['🙇','🧎','⬇️']],
    [/\bfather\b/,['👨','🏠','👔']],
    [/\bson\b|boy\b/,['👦','🧢','🎒']],
    [/\bpeople\b|men\b|person\b/,['👥','🧍','🗣️']]
  ];
  function localMore(i){
    const t=String(i.english||'').toLowerCase(), a=[];
    for(const [r,x] of DIRECT) if(r.test(t)) x.forEach(v=>{if(!a.includes(v))a.push(v)});
    return a;
  }
  function uniq(a){return [...new Set((a||[]).map(String).map(x=>x.trim()).filter(Boolean))];}
  function hardUnsafe(v){
    return ['💏','💑','💋','💌','🔫','🗡️','🔪','💣','✝️','⛪'].includes(String(v));
  }

  const css=document.createElement('style');
  css.textContent=`
    .commonness-box{display:inline-flex;align-items:center;gap:6px;margin:6px 0 2px;padding:4px 8px;
      background:#f2f4ff;border:1px solid #d9defb;border-radius:9px;font-size:12px}
    .commonness-box select{padding:3px 5px;border-radius:6px;border:1px solid #cbd2ef;background:#fff}
    .pending-art{margin-top:7px;padding:7px 9px;border:1px dashed #d2a83c;background:#fffaf0;border-radius:9px}
    .pending-art b{font-size:12px}
    .pending-chip{font-size:25px;padding:5px 8px;margin:4px 4px 0 0;border:1px solid #ddd;border-radius:8px;background:#fff}
    .pending-chip.approve{border-color:#7bbd83}.pending-chip.reject{font-size:12px}
  `;
  document.head.appendChild(css);

  async function saveItemCommonness(id,n){
    const i=(state.catalog.shorashim||[]).find(x=>x.id===id); if(!i)return;
    i.commonness=clamp(n); i.commonnessEstimated=false;
    await db.ref(`${ROOT}/catalog/shorashim`).set(state.catalog.shorashim);
  }
  async function approve(id,v){
    const i=(state.catalog.shorashim||[]).find(x=>x.id===id); if(!i)return;
    i.art=uniq([...(i.art||[]),v]).filter(x=>!hardUnsafe(x)).slice(0,8);
    i.pendingArtReview=uniq(i.pendingArtReview).filter(x=>x!==v);
    renderCatalog(); await saveCatalog();
  }
  async function reject(id,v){
    const i=(state.catalog.shorashim||[]).find(x=>x.id===id); if(!i)return;
    i.pendingArtReview=uniq(i.pendingArtReview).filter(x=>x!==v);
    i.rejectedArt=uniq([...(i.rejectedArt||[]),v]);
    renderCatalog(); await saveCatalog();
  }

  const oldGenerate = window.generateAiArtForItems || generateAiArtForItems;
  generateAiArtForItems = async function(items){
    const clean=(items||[]).filter(Boolean).map(i=>({
      id:String(i.id||''), front:String(i.front||''), english:String(i.english||''),
      avoid:uniq([...(i.art||[]),...(i.pendingArtReview||[]),...(i.rejectedArt||[])])
    })).filter(i=>i.id&&i.english);
    const out=new Map();
    for(let n=0;n<clean.length;n+=40){
      const batch=clean.slice(n,n+40);
      try{
        const res=await fetch(GENERATE_SHORASHIM_ART_URL,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({items:batch,enhanced:true})});
        if(!res.ok)throw new Error(String(res.status));
        const data=await res.json();
        for(const row of (data.items||[])){
          const item=(items||[]).find(x=>String(x.id)===String(row.id));
          if(!item)continue;
          if(clamp(row.commonness) && item.commonness==null){
            item.commonness=clamp(row.commonness); item.commonnessEstimated=true;
          }
          const review=uniq(row.review||[]);
          let art=uniq(row.art||[]).filter(x=>!hardUnsafe(x));
          const approved=art.filter(x=>!review.includes(x));
          const pending=art.filter(x=>review.includes(x));
          item.pendingArtReview=uniq([...(item.pendingArtReview||[]),...pending]);
          if(approved.length)out.set(String(row.id),approved);
        }
      }catch(e){ console.warn('Enhanced picture request failed',e); }
    }
    return out;
  };

  fillArtForShorashim = async function(items,{force=false}={}){
    const targets=(items||[]).filter(i=>force||hasBadAutoArt(i));
    if(!targets.length)return 0;
    const ai=await generateAiArtForItems(targets);
    let changed=0;
    for(const i of targets){
      const existing=uniq(i.art).filter(x=>!hardUnsafe(x));
      let more=uniq([...(ai.get(String(i.id))||[]),...localMore(i)])
        .filter(x=>!hardUnsafe(x) && !uniq(i.rejectedArt).includes(x));
      i.art=uniq([...existing,...more]).slice(0,8);
      if(i.commonness==null){i.commonness=estimate(i);i.commonnessEstimated=true;}
      i.autoArt=false;i.aiArtGenerated=true;i.aiArtGeneratedAt=Date.now();changed++;
    }
    return changed;
  };

  regeneratePictures = async function(id){
    const i=(state.catalog.shorashim||[]).find(x=>x.id===id);if(!i)return;
    status('☁️ Finding more pictures…','syncing');
    await fillArtForShorashim([i],{force:true});
    renderCatalog();await saveCatalog();
  };

  const baseRender=renderCatalog;
  renderCatalog=function(){
    baseRender();
    if(currentTrack!=='shorashim')return;
    document.querySelectorAll('#teacherCatalog .catalog-teacher-row').forEach(row=>{
      const id=row.dataset.id, i=(state.catalog.shorashim||[]).find(x=>x.id===id);if(!i)return;
      if(i.commonness==null){i.commonness=estimate(i);i.commonnessEstimated=true;}
      const content=row.children[2];
      if(content && !content.querySelector('.commonness-box')){
        const box=document.createElement('div');box.className='commonness-box';
        box.innerHTML=`<b>Commonness</b><select>${[10,9,8,7,6,5,4,3,2,1].map(n=>`<option value="${n}" ${n===clamp(i.commonness)?'selected':''}>${n}</option>`).join('')}</select><span>${commonnessLabel(i.commonness)}</span>`;
        const note=content.querySelector('.mini-note'); content.insertBefore(box,note||content.firstChild?.nextSibling||null);
        box.querySelector('select').onchange=e=>{box.querySelector('span').textContent=commonnessLabel(e.target.value);saveItemCommonness(id,e.target.value)};
      }
      const regen=row.querySelector('[data-a=regen]');if(regen)regen.textContent='↻ Find More Pictures';
      const pending=uniq(i.pendingArtReview);
      if(pending.length && content && !content.querySelector('.pending-art')){
        const p=document.createElement('div');p.className='pending-art';
        p.innerHTML=`<b>Needs your approval:</b><div>${pending.map(v=>`<span><button class="pending-chip approve" data-v="${v}" title="Approve">${v}</button><button class="pending-chip reject" data-v="${v}" title="Reject">✕</button></span>`).join('')}</div>`;
        content.appendChild(p);
        p.querySelectorAll('.approve').forEach(b=>b.onclick=()=>approve(id,b.dataset.v));
        p.querySelectorAll('.reject').forEach(b=>b.onclick=()=>reject(id,b.dataset.v));
      }
    });
  };

  const oldLoad=loadAll;
  loadAll=async function(){
    await oldLoad();
    let changed=false;
    for(const i of (state.catalog.shorashim||[])){
      if(i.commonness==null){i.commonness=estimate(i);i.commonnessEstimated=true;changed=true;}
    }
    if(changed)await db.ref(`${ROOT}/catalog/shorashim`).set(state.catalog.shorashim);
    renderCatalog();
  };
})();