'use strict';
// A poll lives only in this classroom's teacher tab. No results or names go to Reports/storage.
(function(){
  const B=window.ClassPointerBridge,C=window.ClassPointerPollCore;if(!B||!C)return;
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('poll.css?v=3',document.currentScript.src).href;document.head.append(css);
  const dialog=document.createElement('dialog');dialog.className='cp-poll';dialog.setAttribute('aria-label','Class poll');
  (B.embedded?document.body:(document.getElementById('stage')||document.body)).append(dialog);
  for(const type of ['pointerdown','pointerup','pointermove','click','wheel'])dialog.addEventListener(type,e=>e.stopPropagation());
  let poll=null,roster=[],lastFocus=null,authorized=true,epoch=0,dismissed=null;
  // Timers. Teacher: pollTimer ends the poll, tickTimer redraws the countdown. Student: deadline is the local close time, stuTick redraws it, expanded = answer buttons reopened, hideTimer removes the ended notice.
  let pollTimer=null,tickTimer=null,deadline=null,stuTick=null,expanded=false,hideTimer=null;
  const mmss=n=>Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
  const stopTimers=()=>{clearTimeout(pollTimer);clearInterval(tickTimer);clearInterval(stuTick);clearTimeout(hideTimer);pollTimer=tickTimer=stuTick=hideTimer=null};
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n};
  function button(text,fn){const b=el('button',text);b.type='button';b.onclick=fn;return b}
  function show(){if(!dialog.open){lastFocus=document.activeElement;dialog.showModal()}}
  function close(){clearTimeout(hideTimer);hideTimer=null;if(!B.isTeacher&&!poll?.open)dismissed=poll?.id;dialog.close();dialog.classList.remove('cp-poll-mini');delete dialog.dataset.mode;lastFocus?.focus?.()}
  // Students: a poll that still needs an answer is a centred dialog; once answered (or ended) it shrinks to a small corner card that never blocks the lesson.
  function place(mode){
    dialog.classList.toggle('cp-poll-mini',mode==='mini');
    if(dialog.open&&dialog.dataset.mode!==mode)dialog.close();
    if(!dialog.open){if(mode==='modal'){lastFocus=document.activeElement;dialog.showModal()}else dialog.show()}
    dialog.dataset.mode=mode;
  }
  function endPoll(){if(!poll?.open)return;poll.open=false;clearTimeout(pollTimer);pollTimer=null;broadcast();if(dialog.open&&B.isTeacher)teacherResults()}
  function connections(){return [...(B.members?.().values()||[]),...(B.presence?.().values()||[])].filter(m=>m.admitted)}
  const identity=m=>m.studentId||m.id;
  function send(m){if(poll)B.send(m.connection,C.view(poll,identity(m)))}
  function broadcast(){connections().forEach(send)}
  // Thumbs polls (exactly 👍 then 👎) get a clearer green-Yes / red-No look. Same data, same behaviour.
  const isThumbs=p=>p.answers.length===2&&p.answers[0]==='👍'&&p.answers[1]==='👎';
  const YESNO=[['👍','Yes','up'],['👎','No','down']];
  function thumbsChart(p,counts){
    const box=el('div');box.className='cp-poll-thumbs';const total=counts.reduce((a,b)=>a+b,0);
    YESNO.forEach(([icon,word,kind],i)=>{
      const pct=total?Math.round(counts[i]*100/total):0;
      const card=el('div');card.className='cp-thumb-card cp-'+kind;
      const head=el('div');head.className='cp-thumb-head';head.append(el('span',icon),el('span',word));
      const num=el('div',String(counts[i]));num.className='cp-thumb-num';
      const pctEl=el('div',pct+'%');pctEl.className='cp-thumb-pct';
      const bar=el('progress');bar.max=Math.max(1,total);bar.value=counts[i];bar.setAttribute('aria-label',word+': '+counts[i]+' votes, '+pct+' percent');
      card.append(head,num,pctEl,bar);box.append(card);
    });
    return box;
  }
  function chart(p,counts){if(isThumbs(p))return thumbsChart(p,counts);const box=el('div');box.className='cp-poll-chart';const total=counts.reduce((a,b)=>a+b,0);p.answers.forEach((answer,i)=>{const row=el('div');row.append(el('span',answer+' — '+counts[i]));const bar=el('progress');bar.max=Math.max(1,total);bar.value=counts[i];bar.setAttribute('aria-label',answer+': '+counts[i]+' votes');row.append(bar);box.append(row)});return box}
  function teacherResults(){
    clearInterval(tickTimer);tickTimer=null;
    dialog.replaceChildren(el('h2','📊 Live poll'));if(poll.question)dialog.append(el('p',poll.question));
    if(poll.open&&poll.endsAt!=null){const t=el('p');t.className='cp-poll-timer';t.setAttribute('role','timer');const draw=()=>{t.textContent='⏱ Closes automatically in '+mmss(C.remaining(poll)??0)};draw();dialog.append(t);tickTimer=setInterval(()=>{if(!dialog.open||!poll?.open){clearInterval(tickTimer);tickTimer=null;return}draw()},1000)}
    else if(poll.open)dialog.append(el('p','No timer: stays open until you end it.'));
    const people=new Map(roster.map(s=>[s.id,s.name]));connections().forEach(m=>people.set(identity(m),m.name));
    const answered=[],waiting=[];people.forEach((name,id)=>{const choice=poll.votes[id];(choice==null?waiting:answered).push(name+(choice==null?'':' — '+poll.answers[choice]))});
    dialog.classList.toggle('cp-poll-wide',isThumbs(poll));
    if(isThumbs(poll)){
      const layout=el('div');layout.className='cp-poll-split';
      layout.append(thumbsChart(poll,C.counts(poll)));
      const side=el('div');side.className='cp-poll-roster';side.append(el('h3','Students ('+answered.length+' of '+people.size+' answered)'));
      const list=el('ul');
      [...people].sort((a,b)=>String(a[1]).localeCompare(String(b[1]))).forEach(([id,name])=>{
        const choice=poll.votes[id],li=el('li'),badge=el('span',choice===0?'👍 Yes':choice===1?'👎 No':'⏳ waiting');
        badge.className='cp-vote '+(choice===0?'cp-up':choice===1?'cp-down':'cp-wait');
        li.append(el('span',name),badge);list.append(li);
      });
      if(!people.size)list.append(el('li','No students yet'));
      side.append(list);layout.append(side);dialog.append(layout);
    }else{
      dialog.append(chart(poll,C.counts(poll)));
      dialog.append(el('p','Answered ('+answered.length+'): '+(answered.join(', ')||'Nobody yet')),el('p',"Hasn’t answered ("+waiting.length+'): '+(waiting.join(', ')||'Nobody')));
    }
    const label=el('label'),toggle=el('input');toggle.type='checkbox';toggle.checked=poll.show;toggle.onchange=()=>{poll.show=toggle.checked;broadcast()};label.append(toggle,document.createTextNode(' Show results to class'));dialog.append(label);
    dialog.append(button(poll.open?'End poll':'New poll',()=>{if(poll.open)endPoll();else compose()}),button('Close',close));
  }
  function compose(){
    dialog.classList.remove('cp-poll-wide');dialog.replaceChildren(el('h2','📊 Ask your class'));const q=el('input');q.placeholder='Question (optional — you can ask out loud)';q.maxLength=240;q.setAttribute('aria-label','Question (optional)');
    const types=el('div');types.className='cp-poll-types';let selected='thumbs';const custom=el('div');custom.hidden=true;const fields=[];
    for(let i=0;i<4;i++){const input=el('input');input.maxLength=80;input.placeholder='Answer '+(i+1)+(i>1?' (optional)':'');input.setAttribute('aria-label',input.placeholder);fields.push(input);custom.append(input)}
    [['thumbs','👍 / 👎'],['numbers','1 · 2 · 3'],['letters','A · B · C'],['custom','Custom']].forEach(([type,title])=>{const b=button(title,()=>{selected=type;custom.hidden=type!=='custom';for(const other of types.children)other.setAttribute('aria-pressed',String(other===b))});b.setAttribute('aria-pressed',String(type===selected));types.append(b)});
    const timerLabel=el('label','Auto-close: '),timerSelect=el('select');timerSelect.setAttribute('aria-label','Auto-close timer');[['30','30 seconds'],['60','1 minute'],['120','2 minutes'],['0','No timer']].forEach(([v,t])=>{const o=el('option',t);o.value=v;timerSelect.append(o)});timerSelect.value='60';timerLabel.append(timerSelect);
    const error=el('p');error.setAttribute('role','alert');const sendButton=button('Send',async()=>{
      if(!authorized||!B.started?.()){error.textContent='Open your classroom before sending a poll.';return}
      let next;try{next=C.create(selected,q.value,fields.map(f=>f.value).filter(a=>a.trim()),crypto.randomUUID(),Number(timerSelect.value))}catch(e){error.textContent=e.message;return}
      const sendingEpoch=epoch;sendButton.disabled=true;try{roster=await (window.ClassPointerDashboard?.students?.()||Promise.resolve([]))}catch{error.textContent='Could not load the class roster. Please try again.';sendButton.disabled=false;return}
      if(!authorized||sendingEpoch!==epoch||!B.started?.()){error.textContent='The classroom has ended or your sign-in changed.';sendButton.disabled=false;return}
      stopTimers();poll=next;if(poll.seconds){poll.endsAt=Date.now()+poll.seconds*1000;pollTimer=setTimeout(endPoll,poll.seconds*1000)}broadcast();teacherResults();
    });dialog.append(q,types,custom,timerLabel,error,sendButton,button('Cancel',close));show();
  }
  function studentResults(){
    const focused=document.activeElement?.dataset?.choice;
    clearTimeout(hideTimer);hideTimer=null;
    const answered=poll.choice!=null;
    const mode=poll.open&&(!answered||expanded)?'modal':'mini';
    dialog.replaceChildren(el('h2',poll.open?(answered&&mode==='mini'?'📊 Poll':'📊 Your turn!'):'📊 Poll ended'));if(poll.question)dialog.append(el('p',poll.question));
    const timerLine=()=>{const t=el('p');t.className='cp-poll-timer';t.setAttribute('role','timer');const n=deadline==null?null:Math.max(0,Math.ceil((deadline-Date.now())/1000));t.textContent=n==null?'':'⏱ '+mmss(n)+' left';t.hidden=n==null;return t};
    if(mode==='mini'&&poll.open){
      const picked=el('p','✅ Answer received: '+poll.answers[poll.choice]);
      if(isThumbs(poll)){picked.textContent='✅ You picked: ';const yn=YESNO[poll.choice];const chip=el('span',yn[0]+' '+yn[1]);chip.className='cp-vote cp-'+yn[2];picked.append(chip)}
      dialog.append(picked);dialog.append(timerLine());
      dialog.append(button('Change answer',()=>{expanded=true;studentResults()}));
    }else{
      if(poll.open)dialog.append(timerLine());
      const thumbs=isThumbs(poll);
      const choices=el('div');choices.className='cp-poll-answers'+(thumbs?' cp-poll-yesno':'');poll.answers.forEach((answer,i)=>{const b=button(thumbs?YESNO[i][0]+' '+YESNO[i][1]:answer,()=>{poll.choice=i;expanded=false;B.sendTeacher({type:'poll-vote',id:poll.id,choice:i});studentResults()});if(thumbs)b.classList.add('cp-'+YESNO[i][2]);b.dataset.choice=i;b.disabled=!poll.open;b.setAttribute('aria-pressed',String(poll.choice===i));choices.append(b)});dialog.append(choices);
      const status=el('p',poll.open?(poll.choice==null?'Tap an answer.':(thumbs?'✅ You picked '+YESNO[poll.choice][0]+' '+YESNO[poll.choice][1]+'. ':'')+'Answer received! You can change it until the poll ends.'):'Voting is closed.');status.setAttribute('role','status');dialog.append(status);
    }
    if(poll.show)dialog.append(chart(poll,poll.counts));
    if(!poll.open){dialog.append(button('Close',close));const id=poll.id;hideTimer=setTimeout(()=>{if(poll?.id===id&&!poll.open){dismissed=id;close()}},poll.show?20000:8000)}
    place(mode);if(focused!=null)dialog.querySelector('[data-choice="'+focused+'"]')?.focus();
    clearInterval(stuTick);stuTick=null;
    if(poll.open&&deadline!=null)stuTick=setInterval(()=>{
      if(!poll?.open||deadline==null){clearInterval(stuTick);stuTick=null;return}
      const n=Math.max(0,Math.ceil((deadline-Date.now())/1000));
      dialog.querySelectorAll('.cp-poll-timer').forEach(t=>{t.textContent='⏱ '+mmss(n)+' left'});
      // The teacher's page may be gone: the poll still closes on time here.
      if(n<=0){clearInterval(stuTick);stuTick=null;poll.open=false;deadline=null;studentResults()}
    },1000);
  }
  window.ClassPointerPoll={
    open(){if(!B.isTeacher)return;if(poll){teacherResults();show()}else compose()},
    fromStudent(member,message){if(!B.isTeacher||!authorized||!member.admitted||!poll||message.id!==poll.id||!connections().includes(member))return;if(C.vote(poll,identity(member),message.choice)){broadcast();if(dialog.open)teacherResults()}},
    fromTeacher(message){if(B.isTeacher||message?.type!=='poll-state')return false;
      if(typeof message.id!=='string'||typeof message.question!=='string'||message.question.length>240||!Array.isArray(message.answers)||message.answers.length<2||message.answers.length>4||message.answers.some(a=>typeof a!=='string'||!a||a.length>80)||typeof message.open!=='boolean'||typeof message.show!=='boolean'||(message.secondsLeft!=null&&(!Number.isInteger(message.secondsLeft)||message.secondsLeft<0||message.secondsLeft>3600))||(message.choice!==null&&(!Number.isInteger(message.choice)||message.choice<0||message.choice>=message.answers.length))||message.show&&(!Array.isArray(message.counts)||message.counts.length!==message.answers.length||message.counts.some(n=>!Number.isInteger(n)||n<0)))return true;
      if(poll?.id!==message.id)expanded=false;
      poll=message;deadline=poll.open&&poll.secondsLeft!=null?Date.now()+poll.secondsLeft*1000:null;
      if(poll.open||dismissed!==poll.id)studentResults();return true;
    },
    reset(){epoch++;stopTimers();poll=null;dismissed=null;deadline=null;expanded=false;roster=[];if(dialog.open)close()}
  };
  dialog.addEventListener('cancel',e=>{if(!B.isTeacher&&poll?.open)e.preventDefault();else if(!B.isTeacher)dismissed=poll?.id});
  if(B.isTeacher){
    document.addEventListener('class-pointer-teacher-signed-out',()=>{authorized=false;if(poll){poll.open=false;broadcast()}window.ClassPointerPoll.reset()});
    document.addEventListener('class-pointer-teacher-restored',()=>{authorized=true});
  }
  // The teacher closing or leaving the page ends any open poll for the class at once.
  if(B.isTeacher)window.addEventListener('pagehide',()=>{if(poll?.open){poll.open=false;broadcast()}});
  if(B.isTeacher)document.addEventListener('classpointer:roster',()=>{if(!B.started?.()){window.ClassPointerPoll.reset();return}broadcast();if(poll&&dialog.open)teacherResults()});
})();
