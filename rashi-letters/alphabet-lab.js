/* Rashi Quest: full Alef-Beis lab, 2026-10-19.
   Classic script loaded after student.html's existing lesson and login code. */
(function () {
  'use strict';
  const LETTERS = Array.from('אבגדהוזחטיכךלמםנןסעפףצץקרשת');
  const MIXUPS = [
    {letters:['ל','צ'], note:'Lamed and Tzadik'},
    {letters:['ס','ם'], note:'Samech and final Mem'},
    {letters:['צ','ז'], note:'Tzadik and Zayin'},
    {letters:['א','צ'], note:'Alef and Tzadik'},
    {letters:['ג','נ'], note:'Gimel and Nun'},
    {letters:['ד','ר'], note:'Daled and Reish'},
    {letters:['ה','ח'], note:'Hey and Ches'},
    {letters:['ו','ז','ן'], note:'Vav, Zayin and final Nun'}
  ];
  const STYLES = [
    {id:'print', label:'Regular Hebrew', font:'lab-print'},
    {id:'rashi', label:'Rashi letters', font:'lab-rashi'},
    {id:'script', label:'Handwriting', font:'lab-script'}
  ];
  const root = document.querySelector('.wrap');
  const gate = document.getElementById('modeGate');
  if (!root || !gate || !document.getElementById('similarScreen')) return;

  const css = document.createElement('style');
  css.textContent = [
    '.lab-screen{display:none;margin-top:18px}',
    '.lab-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
    '.lab-top h2{font-size:29px;margin:0;color:#31257a}',
    '.lab-small{color:#59617c;font-size:16px;font-weight:700;line-height:1.5}',
    '.lab-actions{display:flex;flex-wrap:wrap;gap:10px;margin:15px 0 18px}',
    '.lab-actions button{flex:1 1 155px;border:2px solid #d5dcef;border-radius:16px;padding:14px 11px;background:#f7f8ff;color:#392e85;font:800 16px Quicksand,Arial,sans-serif;cursor:pointer}',
    '.lab-actions button.active{background:#e9e4ff;border-color:#6553d6}',
    '.lab-progress{height:13px;background:#e1e5f1;border-radius:20px;overflow:hidden;margin:12px 0}',
    '.lab-progress>div{height:100%;background:linear-gradient(90deg,#6553d6,#26b692);transition:width .2s}',
    '.lab-stat{font-size:16px;font-weight:800;color:#423591}',
    '.lab-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:16px 0}',
    '.lab-tile{border:2px solid #dbe2f1;background:#fff;border-radius:16px;padding:10px 2px;min-height:115px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px}',
    '.lab-tile.known{border-color:#22a876;background:#eafff3}',
    '.lab-glyph{font-size:55px;line-height:1.1;direction:rtl}',
    '.lab-rashi{font-family:"Mekorot Rashi",serif}',
    '.lab-print{font-family:"Frank Ruhl Libre",serif}',
    '.lab-script{font-family:"Gveret Levin","Frank Ruhl Libre",serif;font-weight:400}',
    '.lab-caption{font:800 12px Quicksand,Arial,sans-serif;color:#59617c}',
    '.lab-detail{background:#f5f5ff;padding:16px;border-radius:18px;margin-top:10px}',
    '.lab-comparison{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}',
    '.lab-compare-box{border:2px solid #d9d9f2;border-radius:15px;background:#fff;min-height:150px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px}',
    '.lab-compare-box .lab-glyph{font-size:76px}',
    '.lab-target{text-align:center;font-size:104px;line-height:1.25;color:#342773;background:#edeaff;border-radius:22px;margin:14px auto;padding:14px 8px}',
    '.lab-choices{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;margin:18px 0}',
    '.lab-option{font-size:65px;border:3px solid #dbe2f1;border-bottom-width:6px;border-radius:18px;background:#fff;min-height:105px;cursor:pointer;color:#2f285a}',
    '.lab-option.correct{background:#d8f9e6;border-color:#168355}',
    '.lab-option.incorrect{background:#fff0e7;border-color:#c66a35}',
    '.lab-feedback{min-height:46px;color:#3e327e;text-align:center;font-size:19px;font-weight:800}',
    '.lab-gate-btn{width:100%;text-align:left;background:#e6f7ee;color:#164e38;border:2px solid #81cba8;border-radius:17px;padding:20px;font:800 19px Quicksand,Arial,sans-serif;cursor:pointer}',
    '.lab-gate-btn small{display:block;font-size:13px;margin-top:5px;color:#346b53}',
    '.lab-warning{font-size:13px;color:#745a19;min-height:18px}',
    '@media(max-width:650px){.lab-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.lab-glyph{font-size:43px}.lab-comparison{gap:5px}.lab-compare-box .lab-glyph{font-size:58px}.lab-option{font-size:52px}.lab-screen{padding:17px}.lab-tile{min-height:90px}}',
    '@media(prefers-reduced-motion:reduce){.lab-progress>div{transition:none}}'
  ].join('\n');
  document.head.appendChild(css);

  const entry = document.createElement('section');
  entry.className = 'mode-gate-section';
  entry.innerHTML = '<button type="button" class="lab-gate-btn" id="labLaunch">🔎 Full Alef-Beis Lab <small>See all 27 letters, compare Rashi / regular / handwriting, and practice tricky pairs.</small></button>';
  gate.insertBefore(entry, gate.children[1] || null);

  const screen = document.createElement('section');
  screen.className = 'card lab-screen';
  screen.id = 'alphabetLabScreen';
  screen.innerHTML =
    '<div class="lab-top"><h2>🔎 Alef-Beis Detective Lab</h2><button class="menu-link" id="labBack">← Menu</button></div>' +
    '<p class="lab-small">Learn every letter shape, then master the letter challenges. All five final letters are included.</p>' +
    '<div class="lab-actions" id="labTabs">' +
      '<button data-tab="explore">👀 Learn letters</button><button data-tab="mastery">⭐ Master all 27</button>' +
      '<button data-tab="mixups">🕵️ Tricky pairs</button></div>' +
    '<div id="labContents"></div><p class="lab-warning" id="labSaveStatus" role="status"></p>';
  root.appendChild(screen);

  let state = {mastered:{}, stats:{}};
  let activeTab = 'explore', currentRound = null, currentHint = false, answerLocked = false;
  let lastAnswered = null;

  function E(tag, className, content) {
    const item = document.createElement(tag);
    if(className) item.className = className;
    if(content !== undefined) item.textContent = content;
    return item;
  }
  function getProgress() { return LETTERS.filter(letter => state.mastered[letter] === true).length; }
  function progressHeader() {
    const wrap=E('div');
    const top=E('div','lab-stat',getProgress()+' / '+LETTERS.length+' letters mastered');
    const bar=E('div','lab-progress'), fill=E('div');
    fill.style.width=Math.round(getProgress()/LETTERS.length*100)+'%';
    bar.appendChild(fill); wrap.append(top,bar); return wrap;
  }
  function styleOf(ch, font, extraClass) {
    const n=E('span','lab-glyph lab-'+font+(extraClass?' '+extraClass:''),ch);
    n.setAttribute('lang','he'); n.setAttribute('dir','rtl'); return n;
  }
  function compareBox(ch, s) {
    const box=E('div','lab-compare-box');
    box.append(styleOf(ch,s.id),E('span','lab-caption',s.label));
    return box;
  }
  function note(text) { return E('p','lab-small',text); }
  function btn(text, handler, className) {
    const b=E('button',className||'btn',text); b.type='button'; b.addEventListener('click',handler); return b;
  }

  async function load() {
    state={mastered:{},stats:{}};
    if(!studentId || teacherPreview) return;
    try {
      const s=await db.ref('rashiLetters/progress/'+studentId+'/alphabetLab').once('value');
      const r=s.val()||{};
      state.mastered=r.mastered||{};
      state.stats=r.stats||{};
    } catch(e) {
      document.getElementById('labSaveStatus').textContent='Your saved letter progress could not load. Try opening the lab again.';
      throw e;
    }
  }
  async function save() {
    if(!studentId || teacherPreview) return true;
    try {
      await db.ref('rashiLetters/progress/'+studentId+'/alphabetLab').set({
        mastered:state.mastered,
        stats:state.stats,
        updatedAt:firebase.database.ServerValue.TIMESTAMP
      });
      await db.ref('rashiLetters/progress/'+studentId+'/lastActive').set(firebase.database.ServerValue.TIMESTAMP);
      document.getElementById('labSaveStatus').textContent='';
      return true;
    } catch(e) {
      document.getElementById('labSaveStatus').textContent='Progress could not save. Please check your connection before leaving.';
      return false;
    }
  }
  function renderExplore() {
    const area=document.getElementById('labContents');area.replaceChildren(progressHeader());
    area.appendChild(note('Tap any of the 27 letters. Green tiles have already been mastered.'));
    const grid=E('div','lab-grid');
    LETTERS.forEach(ch=>{
      const b=E('button','lab-tile'+(state.mastered[ch]?' known':''));
      b.type='button'; b.append(styleOf(ch,'rashi'),E('small','lab-caption',ch));
      b.setAttribute('aria-label','Study the letter '+ch); b.onclick=()=>renderLetter(ch);
      grid.appendChild(b);
    });
    area.append(grid,note('Handwriting uses the Gveret Levin script font. It may need an internet connection the first time.'));
  }
  function renderLetter(ch){
    const area=document.getElementById('labContents'); area.replaceChildren();
    area.append(btn('← All 27 letters',renderExplore,'menu-link'));
    area.append(E('h3',null,'The same letter in three styles'));
    const compare=E('div','lab-comparison');
    STYLES.forEach(s=>compare.appendChild(compareBox(ch,s)));
    area.append(compare,note('Look at the shapes closely. All three show the same Hebrew letter.'));
    const nav=E('div','lab-actions');
    const index=LETTERS.indexOf(ch);
    nav.append(btn('← Previous',()=>renderLetter(LETTERS[Math.max(0,index-1)]),'helper'));
    nav.append(btn('Next →',()=>renderLetter(LETTERS[Math.min(LETTERS.length-1,index+1)]),'helper'));
    area.appendChild(nav);
  }
  function candidates(target, special) {
    const group = special && special.letters ? special.letters : (MIXUPS.find(m=>m.letters.includes(target))||{}).letters;
    let others=(group||[]).filter(ch=>ch!==target);
    others=others.concat(shuffle(LETTERS.filter(ch=>ch!==target&&!others.includes(ch))));
    return shuffle([target].concat(others.slice(0,3)));
  }
  function beginMastery() {
    const remain=shuffle(LETTERS.filter(ch=>!state.mastered[ch]));
    remain.sort((a,b)=>((state.stats[a]||{}).attempts||0)-((state.stats[b]||{}).attempts||0));
    if(remain.length===0){finishAll();return;}
    currentRound={kind:'mastery',items:remain.slice(0,9).map((ch,i)=>({ch,style:STYLES[i%3].id})),idx:0,right:0};
    showQuestion();
  }
  function beginMixups() {
    currentRound={kind:'mixups',items:shuffle(MIXUPS).map((m,i)=>({
      ch:m.letters[i % m.letters.length],style:STYLES[i%3].id,group:m
    })),idx:0,right:0};
    showQuestion();
  }
  function showQuestion() {
    answerLocked=false; currentHint=false;
    const r=currentRound;
    if(!r || r.idx>=r.items.length){finishRound();return;}
    const q=r.items[r.idx], area=document.getElementById('labContents'); area.replaceChildren(progressHeader());
    const type=STYLES.find(s=>s.id===q.style);
    area.append(E('div','lab-stat',(r.kind==='mastery'?'Letter mastery':'Tricky pairs')+' · '+(r.idx+1)+' / '+r.items.length));
    if(q.group)area.append(note('Watch out: '+q.group.note+'.'));
    area.append(styleOf(q.ch,'rashi','lab-target'));
    area.append(note('Which '+type.label.toLowerCase()+' letter matches the Rashi letter above?'));
    const row=E('div','lab-choices'),feedback=E('div','lab-feedback');
    const questionIndex=r.idx;
    const advance=()=>{if(currentRound!==r || r.idx!==questionIndex)return; r.idx++;showQuestion();};
    const next=btn('Next question →',advance,'btn');
    next.style.display='none';
    candidates(q.ch,q.group).forEach(opt=>{
      const b=E('button','lab-option');b.type='button'; b.setAttribute('aria-label','Letter '+opt);
      b.appendChild(styleOf(opt,q.style));
      b.addEventListener('click',async()=>{
        if(answerLocked) return;
        answerLocked=true;
        const good=opt===q.ch, unassisted=good&&!currentHint;
        if(good) {
          b.classList.add('correct');r.right++;
          starsThisVisit++; coinsThisVisit++; updateRewardHud(); rewardBurst(b);
          feedback.textContent=currentHint?'Good learning! Try it without help next time.':'⭐ Correct! You found its match.';
          beep('correct');
        } else {
          b.classList.add('incorrect');
          feedback.textContent='Look closely at the green answer. You can practice this letter again.';
          beep('wrong');
        }
        row.querySelectorAll('button').forEach(child=>{
          child.disabled=true;
          if(child.getAttribute('aria-label')==='Letter '+q.ch) child.classList.add('correct');
        });
        if(r.kind==='mastery') {
          const st=state.stats[q.ch]||{attempts:0,correct:0};
          st.attempts++;if(unassisted) st.correct++;
          state.stats[q.ch]=st;
          if(unassisted) state.mastered[q.ch]=true;
          await save();
        } else if(studentId && !teacherPreview) {
          // This is practice; existing alphabet mastery is never reduced by mistakes.
          await logAttempt('similar','letter',good).catch(()=>{});
        }
        if(good) {
          // Advance automatically; no extra click required after a correct answer.
          setTimeout(advance,900);
        } else {
          next.style.display='inline-block';
        }
      });
      row.appendChild(b);
    });
    const hint=btn('🔎 Show me how',()=>{
      if(answerLocked)return;
      currentHint=true;
      const panel=E('div','lab-detail'),comp=E('div','lab-comparison');
      STYLES.forEach(s=>comp.appendChild(compareBox(q.ch,s)));
      panel.append(note('One Hebrew letter, three writing styles.'),comp);
      hint.replaceWith(panel);
    },'helper');
    const helpers=E('div','help-row');helpers.appendChild(hint);
    area.append(row,helpers,feedback,next);
  }
  function finishRound() {
    const r=currentRound,area=document.getElementById('labContents');area.replaceChildren(progressHeader());
    const card=E('div','lab-detail');
    card.append(E('h3',null,'🎉 Challenge complete!'),note('You got '+r.right+' out of '+r.items.length+' correct.'));
    if(r.kind==='mixups') {
      const passed=r.right>=7;
      card.append(note(passed?'You passed the tricky-letter challenge!':'Get at least 7 of 8 to master these confusing shapes.'));
      if(passed) {
        if(typeof markMastered==='function')markMastered('confusionDone');
        card.append(btn('Next step →',()=>{if(typeof goNextStep==='function')goNextStep();}));
      }
      card.append(btn('Try tricky pairs again',beginMixups,'helper'));
    } else if(getProgress()===LETTERS.length) {
      area.append(card);finishAll();return;
    } else {
      card.append(note('Every letter you recognized without help stays mastered. Continue with the remaining letters.'));
      card.append(btn('Continue mastering letters →',beginMastery));
    }
    card.append(btn('Back to lab',()=>selectTab('explore'),'helper'));
    area.appendChild(card);
  }
  function finishAll(){
    if(typeof markMastered==='function')markMastered('alphabetDone');
    const area=document.getElementById('labContents');
    area.replaceChildren(progressHeader());
    const msg=E('div','lab-detail');
    msg.append(E('h3',null,'🏆 All 27 Rashi letters mastered!'),note('You can recognize all the Alef-Beis letters, including final forms.'));
    msg.append(btn('Next mission →',()=>{if(typeof goNextStep==='function')goNextStep();}));
    msg.append(btn('Explore letters again',()=>selectTab('explore'),'helper'));
    area.appendChild(msg);
    if(typeof rewardBurst==='function')rewardBurst(msg,true);
  }
  function selectTab(tab){
    activeTab=tab;
    document.querySelectorAll('#labTabs button').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
    if(tab==='explore')renderExplore();
    if(tab==='mastery')beginMastery();
    if(tab==='mixups')beginMixups();
  }
  async function open(tab) {
    if(typeof leaveRoom==='function')leaveRoom();
    if(typeof clearTimeout==='function')clearTimeout(questionTimer);
    ['modeGate','similarScreen','app','practiceCompleteScreen','nameGate'].forEach(id=>document.getElementById(id).style.display='none');
    document.getElementById('completeScreen').classList.remove('show');
    const saveStatus=document.getElementById('labSaveStatus');saveStatus.textContent='Loading your letters…';
    screen.style.display='block';
    try {
      await load();
      saveStatus.textContent=studentId&&!teacherPreview?'':'Preview mode: progress is not saved.';
      selectTab(tab==='confusion'?'mixups':tab==='alphabet'?'mastery':(tab||'explore'));
    } catch(e) {
      document.getElementById('labContents').replaceChildren(
        note('Cannot load your saved progress right now. Return to the menu and try again.')
      );
    }
  }
  document.getElementById('labLaunch').onclick=()=>open('explore');
  document.getElementById('labBack').onclick=()=>showModeGate();
  window.openRashiAlphabetLab=open;
  window.RashiAlphabetLab={letters:LETTERS.slice(),mixups:MIXUPS.map(m=>m.letters.slice())};
})();