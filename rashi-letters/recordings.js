/* Rashi Letters: "Record Reading" activity (2026-10-23).
   At the end of each word section the student reads that section's Rashi words
   aloud, sends the recording, and earns exactly 2 Student Rewards points only
   after a teacher approves it. All saving happens on the server
   (studentRewardsAutoAward): the page never writes points or approval state. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.RashiRecordings=api;
})(typeof self!=='undefined'?self:this,function(root){
  'use strict';
  const STAGING=()=>root.B3_STAGING_FIREBASE_CONFIG?.projectId==='fun-torah-tools-staging';
  const API_URL='https://us-central1-b3-games.cloudfunctions.net/studentRewardsAutoAward';
  const POINTS=2;
  const MAX_MS=5*60*1000;       // generous: eight words never need this long
  const MIN_MS=2000;            // only to avoid accidental taps
  const STATUS_CACHE_MS=30*1000;
  const MIMES=['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'];

  const BANNERS={
    none:{icon:'📖',text:'Read all the words out loud, slowly and clearly.',cls:'rr-none'},
    pending:{icon:'⏳',text:'Waiting for Teacher Approval',cls:'rr-pending'},
    approved:{icon:'✅',text:'Approved! +'+POINTS+' Points',cls:'rr-approved'},
    rejected:{icon:'🔄',text:'Your teacher asked you to try again. Record a new reading!',cls:'rr-rejected'}
  };
  // A student may record when nothing is waiting or approved yet.
  const canRecord=status=>status==='none'||status==='rejected'||!status;
  const bannerFor=status=>BANNERS[status]||BANNERS.none;
  const formatTime=ms=>{const s=Math.floor(Math.max(0,ms)/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
  const pickMime=()=>MIMES.find(m=>root.MediaRecorder&&root.MediaRecorder.isTypeSupported&&root.MediaRecorder.isTypeSupported(m))||'';

  let cfg={isPreview:()=>false,onBack:()=>{},hideOthers:()=>{}};
  let statusMap=null,statusAt=0,statusPromise=null;
  let ui=null;                       // screen elements
  let session=null;                  // the section currently on screen

  async function idToken(){
    if(root.B3GameGateAuthReady)await root.B3GameGateAuthReady;
    const user=root.firebase&&root.firebase.auth&&root.firebase.auth().currentUser;
    if(!user)throw new Error('Please sign in again on Fun Torah Tools.');
    return user.getIdToken();
  }
  async function loadStatus(force){
    if(STAGING())return {};
    if(cfg.isPreview())return {};
    if(!force&&statusMap&&Date.now()-statusAt<STATUS_CACHE_MS)return statusMap;
    if(statusPromise)return statusPromise;
    statusPromise=(async()=>{
      try{
        const res=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+await idToken()},body:JSON.stringify({action:'rashi-student-status'})});
        const data=await res.json().catch(()=>({}));
        if(!res.ok)throw new Error(data.error||'Could not check your recordings.');
        statusMap=data.sections||{};statusAt=Date.now();
      }catch(err){console.warn('Rashi recording status unavailable',err);if(!statusMap)statusMap={};statusAt=0;}
      finally{statusPromise=null;}
      return statusMap;
    })();
    return statusPromise;
  }
  const statusOf=id=>(statusMap&&statusMap[id]&&statusMap[id].status)||'none';

  async function sendRecording(sectionId,words,blob,durationMs){
    if(STAGING())throw new Error('Recording rewards are disabled on staging.');
    const qs='rashi=submit&section='+encodeURIComponent(sectionId)+'&durationMs='+Math.round(durationMs)+'&words='+encodeURIComponent((words||[]).join('|'));
    const res=await fetch(API_URL+'?'+qs,{method:'POST',headers:{'Content-Type':(blob.type||'audio/webm').split(';')[0],'Authorization':'Bearer '+await idToken()},body:blob});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'Could not send the recording.');
    return data;
  }

  /* ---------- screen ---------- */
  const CSS='#recordScreen{text-align:center}#recordScreen h2{margin:0 0 4px}.rr-sub{color:#475675;font-weight:700;margin:0 0 12px}'
    +'.rr-words{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;direction:rtl;margin:12px 0 16px}'
    +".rr-word{font-family:'Mekorot Rashi',serif;font-size:42px;line-height:1.2;background:#fff;border:2px solid #c9bff5;border-radius:16px;padding:8px 16px;color:#342773}"
    +'.rr-banner{border-radius:16px;padding:12px 14px;font-weight:800;font-size:19px;margin:10px 0}'
    +'.rr-none{background:#eef1ff;color:#2d266f}.rr-pending{background:#fff4d6;color:#7a5200}.rr-approved{background:#dcf5e5;color:#176447}.rr-rejected{background:#ffe8d9;color:#8a3b00}'
    +'.rr-big{font-size:24px!important;padding:16px 28px!important;min-width:min(100%,320px)}.rr-rec{background:#d93b3b!important}'
    +'.rr-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:10px 0}.rr-timer{font-size:30px;font-weight:900;color:#d93b3b}'
    +'.rr-msg{min-height:1.4em;font-weight:700;margin:6px 0}.rr-err{color:#a12b2b}.rr-note{color:#536180;font-size:14px;font-weight:700}'
    +'.rr-pulse{animation:rrpulse 1s infinite}@keyframes rrpulse{50%{opacity:.55}}'
    +'.rr-chip{display:inline-block;border-radius:999px;padding:2px 10px;font-size:13px;font-weight:800}'
    +'.rr-menu-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;background:#fff;border:2px solid #e1dcfb;border-radius:14px;padding:8px 12px;margin:8px 0}';
  function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function ensureScreen(){
    if(ui)return ui;
    const style=document.createElement('style');style.textContent=CSS;document.head.appendChild(style);
    const card=el('div','card');card.id='recordScreen';card.style.display='none';
    ui={card,title:el('h2',null,'🎤 Read Your Words!'),sub:el('p','rr-sub'),words:el('div','rr-words'),banner:el('div','rr-banner'),
      timer:el('div','rr-timer hidden'),controls:el('div','rr-row'),msg:el('div','rr-msg'),audio:null,
      note:el('p','rr-note','Worth '+POINTS+' points after your teacher listens and approves.'),footer:el('div','rr-row')};
    ui.words.setAttribute('dir','rtl');ui.words.setAttribute('lang','he');ui.msg.setAttribute('role','status');ui.msg.setAttribute('aria-live','polite');
    card.append(ui.title,ui.sub,ui.words,ui.banner,ui.timer,ui.controls,ui.msg,ui.note,ui.footer);
    const anchor=document.getElementById('closedScreen');
    (anchor&&anchor.parentNode?anchor.parentNode:document.body).insertBefore(card,anchor||null);
    return ui;
  }
  function button(label,cls,onclick){const b=el('button','btn '+(cls||''),label);b.type='button';b.onclick=onclick;return b;}
  function stopTracks(){if(session&&session.stream){session.stream.getTracks().forEach(t=>t.stop());session.stream=null;}}
  function clearTimer(){if(session&&session.tick){clearInterval(session.tick);session.tick=null;}}
  function dropAudio(){if(session){if(session.player){session.player.pause();session.player=null;}if(session.url){URL.revokeObjectURL(session.url);session.url=null;}}}
  function hasUnsent(){return !!(session&&session.blob&&canRecord(statusOf(session.id)));}

  function render(){
    const u=ensureScreen(),s=session;if(!s)return;
    const status=statusOf(s.id),b=bannerFor(status);
    u.sub.textContent=s.label||'';
    u.words.replaceChildren(...s.words.map(w=>el('span','rr-word',w)));
    u.banner.className='rr-banner '+b.cls;u.banner.textContent=b.icon+' '+b.text;
    u.controls.replaceChildren();u.footer.replaceChildren();
    u.timer.classList.toggle('hidden',s.state!=='recording');
    u.note.classList.toggle('hidden',status==='approved');
    if(cfg.isPreview()){
      u.controls.append(el('p','rr-note','Preview only — students record here. Nothing is saved.'));
    }else if(!canRecord(status)){
      // pending or approved: nothing more to do for this section
    }else if(s.state==='recording'){
      u.controls.append(button('⏹ Stop','rr-big rr-rec',stopRecording));
    }else if(s.blob){
      u.controls.append(button(s.playing?'⏸ Pause':'▶ Play','',togglePlay),button('🔁 Rerecord','gold',rerecord),
        button(s.sending?'Sending…':'📤 Submit','rr-big',submit));
      if(s.sending)u.controls.querySelectorAll('button').forEach(x=>x.disabled=true);
    }else{
      u.controls.append(button('🎤 Record Reading','rr-big rr-rec',startRecording));
    }
    const done=status==='pending'||status==='approved'||cfg.isPreview();
    if(s.onDone)u.footer.append(button(done?'Continue →':'Skip for now →','gold',()=>leave(s.onDone)));
    u.footer.append(button(s.back?'⬅ All readings':'⬅ Menu','gold',()=>leave(s.back||cfg.onBack)));
  }
  function setMsg(text,isErr){const u=ensureScreen();u.msg.textContent=text||'';u.msg.className='rr-msg'+(isErr?' rr-err':'');}

  async function startRecording(){
    const s=session;if(!s||s.state==='recording')return;
    setMsg('');
    if(!(root.navigator&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)||!root.MediaRecorder){setMsg('This device cannot record. Ask your teacher for help.',true);return;}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(session!==s){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=pickMime(),rec=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:48000}:undefined);
      const chunks=[];s.stream=stream;s.rec=rec;s.startedAt=Date.now();s.state='recording';
      rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
      rec.onstop=()=>{
        stopTracks();clearTimer();
        const ms=Date.now()-s.startedAt;
        if(session!==s)return;
        s.state='idle';
        if(ms<MIN_MS){setMsg('That was very short. Tap Record and read all the words.',true);render();return;}
        s.blob=new Blob(chunks,{type:rec.mimeType||mime||'audio/webm'});s.durationMs=ms;
        dropAudio();s.url=URL.createObjectURL(s.blob);
        setMsg('Listen to your reading, then tap Submit.');render();
      };
      rec.start(1000);
      s.tick=setInterval(()=>{const ms=Date.now()-s.startedAt;ensureScreen().timer.textContent='● '+formatTime(ms);if(ms>=MAX_MS)stopRecording();},250);
      ensureScreen().timer.textContent='● 0:00';
      setMsg('Recording… read the words, then tap Stop.');render();
    }catch(err){console.warn(err);setMsg('Please allow the microphone so you can record.',true);}
  }
  function stopRecording(){const s=session;if(s&&s.rec&&s.state==='recording'){try{s.rec.stop();}catch(_){}}}
  function togglePlay(){
    const s=session;if(!s||!s.url)return;
    if(!s.player){s.player=new Audio(s.url);s.player.onended=()=>{s.playing=false;render();};}
    if(s.playing){s.player.pause();s.playing=false;}else{s.player.play().catch(()=>setMsg('Could not play the recording.',true));s.playing=true;}
    render();
  }
  function rerecord(){
    const s=session;if(!s||s.sending)return;
    dropAudio();s.blob=null;s.playing=false;s.state='idle';setMsg('');render();
  }
  async function submit(){
    const s=session;if(!s||!s.blob||s.sending)return;       // one send at a time (no double-click)
    s.sending=true;setMsg('Sending your recording…');render();
    try{
      const out=await sendRecording(s.id,s.words,s.blob,s.durationMs);
      statusMap=statusMap||{};statusMap[s.id]={status:out.status||'pending'};statusAt=Date.now();
      s.blob=null;dropAudio();s.playing=false;
      setMsg(out.alreadySubmitted?'This reading was already sent.':'Sent! Now your teacher will listen.');
    }catch(err){
      // keep the recording so he can simply press Submit again
      setMsg((err&&err.message?err.message:'Could not send.')+' Your recording is still saved here — tap Submit to try again.',true);
    }finally{s.sending=false;if(session===s)render();}
  }
  function leave(next){
    if(hasUnsent()&&!root.confirm('Your recording has not been sent yet. Leave without sending it?'))return;
    stopTracks();clearTimer();dropAudio();session=null;
    if(ui)ui.card.style.display='none';
    if(next)next();
  }

  /* ---------- public ---------- */
  async function open(section,onDone,back){
    const u=ensureScreen();
    cfg.hideOthers();
    if(hub)hub.style.display='none';
    if(session)leave();
    session={id:section.id,label:section.label,words:(section.words||[]).slice(),onDone,back,state:'idle',blob:null};
    u.card.style.display='block';render();setMsg('Checking…');
    await loadStatus(false);
    if(session&&session.id===section.id){setMsg('');render();}
  }
  // After finishing a section: show the recording screen unless it is already sent.
  async function offer(section,onDone){
    if(cfg.isPreview()||(root.B3Guest&&root.B3Guest.isGuest&&root.B3Guest.isGuest())){onDone&&onDone();return;}
    await loadStatus(false);
    if(!canRecord(statusOf(section.id))){onDone&&onDone();return;}
    return open(section,onDone);
  }
  // "Reading with Mic" page: every section is a choice, each with its status.
  let hub=null;
  async function openHub(sections){
    if(root.B3Guest&&root.B3Guest.isGuest&&root.B3Guest.isGuest()){if(root.B3Guest.unlock)root.B3Guest.unlock('Sign in to unlock','Sign in to record your reading and earn points.');return;}
    ensureScreen();
    if(session)leave();
    cfg.hideOthers();
    if(!hub){hub=el('div','card');hub.id='recordHub';hub.style.textAlign='center';ui.card.parentNode.insertBefore(hub,ui.card);}
    hub.style.display='block';
    hub.replaceChildren(el('h2',null,'🎤 Reading with Mic'),el('p','rr-sub','Pick a set of Rashi words, read them out loud, and send it to your teacher. Each approved reading earns '+POINTS+' points.'));
    const list=el('div'),rows=sections.map(sec=>{
      const row=el('div','rr-menu-row'),name=el('strong',null,sec.label),chip=el('span','rr-chip','…'),go=button('🎤 Record','',()=>open(sec,()=>openHub(sections),()=>openHub(sections)));
      row.append(name,chip,go);list.append(row);return {sec,chip,go};});
    hub.append(list,button('⬅ Menu','gold',()=>{hub.style.display='none';cfg.onBack();}));
    const map=cfg.isPreview()?{}:await loadStatus(false);
    rows.forEach(r=>{const st=(map[r.sec.id]&&map[r.sec.id].status)||'none',b=bannerFor(st);
      r.chip.textContent=st==='none'?'Not recorded yet':b.icon+' '+b.text;r.chip.className='rr-chip '+b.cls;
      if(st==='pending'||st==='approved')r.go.textContent='View';});
  }
  function hideHub(){if(hub)hub.style.display='none';}
  function init(options){cfg=Object.assign(cfg,options||{});}
  function reset(){statusMap=null;statusAt=0;}
  return {init,open,offer,openHub,hideHub,loadStatus,reset,canRecord,bannerFor,formatTime,POINTS,MAX_MS,MIN_MS};
});
