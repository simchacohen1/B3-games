'use strict';
// A poll lives only in this classroom's teacher tab. No results or names go to Reports/storage.
(function(){
  const B=window.ClassPointerBridge,C=window.ClassPointerPollCore;if(!B||!C)return;
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('poll.css?v=1',document.currentScript.src).href;document.head.append(css);
  const dialog=document.createElement('dialog');dialog.className='cp-poll';dialog.setAttribute('aria-label','Class poll');
  (B.embedded?document.body:(document.getElementById('stage')||document.body)).append(dialog);
  for(const type of ['pointerdown','pointerup','pointermove','click','wheel'])dialog.addEventListener(type,e=>e.stopPropagation());
  let poll=null,roster=[],lastFocus=null,authorized=true,epoch=0,dismissed=null;
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;return n};
  function button(text,fn){const b=el('button',text);b.type='button';b.onclick=fn;return b}
  function show(){if(!dialog.open){lastFocus=document.activeElement;dialog.showModal()}}
  function close(){if(!B.isTeacher&&!poll?.open)dismissed=poll?.id;dialog.close();lastFocus?.focus?.()}
  function connections(){return [...(B.members?.().values()||[]),...(B.presence?.().values()||[])].filter(m=>m.admitted)}
  const identity=m=>m.studentId||m.id;
  function send(m){if(poll)B.send(m.connection,C.view(poll,identity(m)))}
  function broadcast(){connections().forEach(send)}
  function chart(p,counts){const box=el('div');box.className='cp-poll-chart';const total=counts.reduce((a,b)=>a+b,0);p.answers.forEach((answer,i)=>{const row=el('div');row.append(el('span',answer+' — '+counts[i]));const bar=el('progress');bar.max=Math.max(1,total);bar.value=counts[i];bar.setAttribute('aria-label',answer+': '+counts[i]+' votes');row.append(bar);box.append(row)});return box}
  function teacherResults(){
    dialog.replaceChildren(el('h2','📊 Live poll'));if(poll.question)dialog.append(el('p',poll.question));dialog.append(chart(poll,C.counts(poll)));
    const people=new Map(roster.map(s=>[s.id,s.name]));connections().forEach(m=>people.set(identity(m),m.name));
    const answered=[],waiting=[];people.forEach((name,id)=>{const choice=poll.votes[id];(choice==null?waiting:answered).push(name+(choice==null?'':' — '+poll.answers[choice]))});
    dialog.append(el('p','Answered ('+answered.length+'): '+(answered.join(', ')||'Nobody yet')),el('p',"Hasn’t answered ("+waiting.length+'): '+(waiting.join(', ')||'Nobody')));
    const label=el('label'),toggle=el('input');toggle.type='checkbox';toggle.checked=poll.show;toggle.onchange=()=>{poll.show=toggle.checked;broadcast()};label.append(toggle,document.createTextNode(' Show results to class'));dialog.append(label);
    dialog.append(button(poll.open?'End poll':'New poll',()=>{if(poll.open){poll.open=false;broadcast();teacherResults()}else compose()}),button('Close',close));
  }
  function compose(){
    dialog.replaceChildren(el('h2','📊 Ask your class'));const q=el('input');q.placeholder='Question (optional — you can ask out loud)';q.maxLength=240;q.setAttribute('aria-label','Question (optional)');
    const types=el('div');types.className='cp-poll-types';let selected='thumbs';const custom=el('div');custom.hidden=true;const fields=[];
    for(let i=0;i<4;i++){const input=el('input');input.maxLength=80;input.placeholder='Answer '+(i+1)+(i>1?' (optional)':'');input.setAttribute('aria-label',input.placeholder);fields.push(input);custom.append(input)}
    [['thumbs','👍 / 👎'],['numbers','1 · 2 · 3'],['letters','A · B · C'],['custom','Custom']].forEach(([type,title])=>{const b=button(title,()=>{selected=type;custom.hidden=type!=='custom';for(const other of types.children)other.setAttribute('aria-pressed',String(other===b))});b.setAttribute('aria-pressed',String(type===selected));types.append(b)});
    const error=el('p');error.setAttribute('role','alert');const sendButton=button('Send',async()=>{
      if(!authorized||!B.started?.()){error.textContent='Open your classroom before sending a poll.';return}
      let next;try{next=C.create(selected,q.value,fields.map(f=>f.value).filter(a=>a.trim()),crypto.randomUUID())}catch(e){error.textContent=e.message;return}
      const sendingEpoch=epoch;sendButton.disabled=true;try{roster=await (window.ClassPointerDashboard?.students?.()||Promise.resolve([]))}catch{error.textContent='Could not load the class roster. Please try again.';sendButton.disabled=false;return}
      if(!authorized||sendingEpoch!==epoch||!B.started?.()){error.textContent='The classroom has ended or your sign-in changed.';sendButton.disabled=false;return}
      poll=next;broadcast();teacherResults();
    });dialog.append(q,types,custom,error,sendButton,button('Cancel',close));show();
  }
  function studentResults(){
    const focused=document.activeElement?.dataset?.choice;
    dialog.replaceChildren(el('h2',poll.open?'📊 Your turn!':'📊 Poll ended'));if(poll.question)dialog.append(el('p',poll.question));
    const choices=el('div');choices.className='cp-poll-answers';poll.answers.forEach((answer,i)=>{const b=button(answer,()=>B.sendTeacher({type:'poll-vote',id:poll.id,choice:i}));b.dataset.choice=i;b.disabled=!poll.open;b.setAttribute('aria-pressed',String(poll.choice===i));choices.append(b)});dialog.append(choices);
    const status=el('p',poll.open?(poll.choice==null?'Tap an answer.':'Answer received! You can change it until the poll ends.'):'Voting is closed.');status.setAttribute('role','status');dialog.append(status);
    if(poll.show)dialog.append(chart(poll,poll.counts));if(!poll.open)dialog.append(button('Close',close));show();if(focused!=null)dialog.querySelector('[data-choice="'+focused+'"]')?.focus();
  }
  window.ClassPointerPoll={
    open(){if(!B.isTeacher)return;if(poll){teacherResults();show()}else compose()},
    fromStudent(member,message){if(!B.isTeacher||!authorized||!member.admitted||!poll||message.id!==poll.id||!connections().includes(member))return;if(C.vote(poll,identity(member),message.choice)){broadcast();if(dialog.open)teacherResults()}},
    fromTeacher(message){if(B.isTeacher||message?.type!=='poll-state')return false;
      if(typeof message.id!=='string'||typeof message.question!=='string'||message.question.length>240||!Array.isArray(message.answers)||message.answers.length<2||message.answers.length>4||message.answers.some(a=>typeof a!=='string'||!a||a.length>80)||typeof message.open!=='boolean'||typeof message.show!=='boolean'||(message.choice!==null&&(!Number.isInteger(message.choice)||message.choice<0||message.choice>=message.answers.length))||message.show&&(!Array.isArray(message.counts)||message.counts.length!==message.answers.length||message.counts.some(n=>!Number.isInteger(n)||n<0)))return true;
      poll=message;if(poll.open||dismissed!==poll.id)studentResults();return true;
    },
    reset(){epoch++;poll=null;dismissed=null;roster=[];if(dialog.open)close()}
  };
  dialog.addEventListener('cancel',e=>{if(!B.isTeacher&&poll?.open)e.preventDefault();else if(!B.isTeacher)dismissed=poll?.id});
  if(B.isTeacher){
    document.addEventListener('class-pointer-teacher-signed-out',()=>{authorized=false;if(poll){poll.open=false;broadcast()}window.ClassPointerPoll.reset()});
    document.addEventListener('class-pointer-teacher-restored',()=>{authorized=true});
  }
  if(B.isTeacher)document.addEventListener('classpointer:roster',()=>{if(!B.started?.()){window.ClassPointerPoll.reset();return}broadcast();if(poll&&dialog.open)teacherResults()});
})();
