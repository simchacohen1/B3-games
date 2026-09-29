'use strict';
const C=window.YIDDISH_CONTENT,$=id=>document.getElementById(id),API=YiddishAPI;
let group=0,round=null,showAll=false,progress={},config=null,student=null,busy=false,pending=null,advanceTimer=null,flash=null;
const word=id=>C.words.find(w=>w.id===id),node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
const status=p=>!p?'New':p.credits>=2?'Learned':'Practicing';
function message(s){$('notice').textContent=s}
function clearAdvance(){if(advanceTimer){clearTimeout(advanceTimer);advanceTimer=null}}
function focusPractice(){requestAnimationFrame(()=>$('practice')?.scrollIntoView({behavior:'smooth',block:'start'}))}
function block(s){clearAdvance();$('lesson').hidden=true;$('practice').hidden=true;document.querySelectorAll('audio').forEach(a=>a.pause());message(s)}
function open(g){return config&&g<config.unlocked[student.classId]&&config.sections[g].verified}
function render(){
  if(!student||!config)return;
  if(!round&&!flash){$('words').hidden=false;$('toolbar').hidden=false;}
  $('login').hidden=true;$('lesson').hidden=false;$('who').textContent=student.name+' · '+student.classId.toUpperCase();
  const ids=[...new Set(config.sections.flatMap(s=>s.words))];
  $('stats').textContent=`${ids.filter(id=>status(progress[id])==='Learned').length} learned · ${ids.filter(id=>status(progress[id])==='Practicing').length} practicing`;
  $('segments').replaceChildren();
  config.sections.forEach((s,i)=>{const b=node('button',`${open(i)?'':'🔒 '}Section ${i+1}`,i===group?'active':'');b.type='button';b.disabled=!open(i);b.onclick=()=>{if(busy||pending)return;clearAdvance();group=i;showAll=false;round=null;flash=null;$('practice').hidden=true;$('flashcards').hidden=true;render()};$('segments').append(b)});
  $('words').replaceChildren();$('start').disabled=!open(group);$('flashStart').disabled=!open(group);$('readStory').hidden=!open(group);$('readStory').href='story.html?section='+group;
  $('title').textContent=showAll?'My vocabulary':`Section ${group+1} words`;
  const visible=showAll?config.sections.flatMap((s,i)=>open(i)?s.words:[]):open(group)?config.sections[group].words:[];
  for(const id of visible){const w=word(id);if(!w)continue;const card=node('article','','word'),st=status(progress[id]);card.append(node('span',st,'status '+st.toLowerCase()));const yi=node('div',w.yi,'yi');yi.lang='yi';card.append(yi,node('div',w.en));$('words').append(card)}
  if(!visible.length)$('words').append(node('p','Your teacher will open your next section soon.'));
  if(round&&open(round.group))question();
  if(flash&&open(flash.group))flashRender();else if(flash){flash=null}
}
async function refresh(){const s=await API.call('status');student=s.student;config=s.config;progress=s.progress;if(!open(group))group=Math.max(0,config.unlocked[student.classId]-1);round=(s.round&&open(s.round.group))?s.round:null;if(round)group=round.group;render()}
async function login(id,pin){const s=await API.call('login',{studentId:id,pin:pin.trim()});sessionStorage.setItem('yiddishSession',s.token);await refresh();message('Progress connected ✓')}
$('loginForm').onsubmit=async e=>{e.preventDefault();$('signIn').disabled=true;try{await login($('name').value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''),$('pin').value);$('pin').value=''}catch(e){message(e.message)}finally{$('signIn').disabled=false}};
$('all').onclick=()=>{if(busy||pending)return;clearAdvance();showAll=!showAll;round=null;flash=null;$('practice').hidden=true;$('flashcards').hidden=true;render()};
function shuffleClient(a){const b=a.slice();for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b}
function focusFlash(){requestAnimationFrame(()=>$('flashcards')?.scrollIntoView({behavior:'smooth',block:'start'}))}
$('flashStart').onclick=()=>{
  if(busy||pending||!open(group))return;
  clearAdvance();round=null;$('practice').hidden=true;
  flash={group,ids:shuffleClient(config.sections[group].words),idx:0,flipped:false};
  flashRender();focusFlash();
};
function flashRender(){
  const box=$('flashcards');box.hidden=false;box.replaceChildren();$('words').hidden=true;$('toolbar').hidden=true;
  if(flash.idx>=flash.ids.length){
    box.append(node('div','✓','round-check'),node('h2','Nice work!'),node('p',`You went through all ${flash.ids.length} flashcards in this section.`));
    const again=node('button','Go again');again.type='button';again.onclick=()=>{flash={group,ids:shuffleClient(config.sections[group].words),idx:0,flipped:false};flashRender();focusFlash()};
    const back=node('button','Back to my words');back.type='button';back.style.marginLeft='10px';back.onclick=()=>{flash=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;window.scrollTo({top:0,behavior:'smooth'})};
    box.append(again,back);focusFlash();return;
  }
  const id=flash.ids[flash.idx],w=word(id);
  box.append(node('div',`Card ${flash.idx+1} of ${flash.ids.length}`,'practice-progress'));
  const card=node('article','','word flash-card');
  const face=node('div',flash.flipped?w.en:w.yi,'yi flash-face');
  if(!flash.flipped)face.lang='yi';
  card.append(face);
  card.onclick=()=>{flash.flipped=!flash.flipped;flashRender()};
  box.append(card,node('p',flash.flipped?'Tap to see the word again':'Tap the card to see what it means','note'));
  const actions=node('div','','toolbar');
  const dontKnow=node('button','Still learning');dontKnow.type='button';dontKnow.className='flash-not-yet';
  const know=node('button','I knew it ✓');know.type='button';
  dontKnow.onclick=()=>{flash.idx++;flash.flipped=false;flashRender();focusFlash()};
  know.onclick=()=>{flash.idx++;flash.flipped=false;flashRender();focusFlash()};
  actions.append(dontKnow,know);
  box.append(actions);
}
$('start').onclick=async()=>{if(busy)return;clearAdvance();busy=true;$('start').disabled=true;try{message('');const s=await API.call('start',{group,forceNew:true});round=s.round;pending=null;$('practice').hidden=false;question();focusPractice()}catch(e){message(e.message)}finally{busy=false;$('start').disabled=!open(group)}};
function question(){
  clearAdvance();
  const box=$('practice');box.hidden=false;box.replaceChildren();$('words').hidden=true;$('toolbar').hidden=true;
  if(round.finished){
    box.append(node('div','✓','round-check'),node('h2','Round complete!'),node('p',`You practiced all ${round.total} words in this section.`),node('p','Your progress is saved. A word becomes “Learned” after two first-try correct rounds.'));
    const again=node('button','Practice this section again');again.type='button';again.onclick=async()=>{if(busy)return;busy=true;again.disabled=true;try{round=null;message('');const s=await API.call('start',{group,forceNew:true});round=s.round;pending=null;question();focusPractice()}catch(e){message(e.message)}finally{busy=false}};
    const back=node('button','Back to my words');back.type='button';back.style.marginLeft='10px';back.onclick=async()=>{round=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;try{await refresh()}catch(e){message(e.message)}window.scrollTo({top:0,behavior:'smooth'})};
    box.append(again,back);focusPractice();return;
  }
  const q=round.question,w=word(q.wordId);
  const progressText=node('div',`Word ${round.index+1} of ${round.total}`,'practice-progress');
  const bar=node('div','','practice-bar');const fill=node('div','','practice-bar-fill');fill.style.width=`${Math.max(4,((round.index)/round.total)*100)}%`;bar.append(fill);
  box.append(progressText,bar,node('h2','What does this word mean?'));
  const yi=node('div',w.yi,'yi');yi.lang='yi';box.append(yi);
  const answers=node('div','');answers.id='answers';const feedback=node('p','');feedback.id='feedback';feedback.setAttribute('role','status');
  q.choices.forEach(id=>{const b=node('button',word(id).en);b.type='button';b.dataset.answer=id;b.onclick=()=>submit(id,answers,feedback);answers.append(b)});
  box.append(answers,feedback);
  if(pending){answers.querySelectorAll('button').forEach(b=>b.disabled=true);retry(box,answers,feedback)}
  focusPractice();
}
function retry(box,answers,feedback){const b=node('button','Retry saving answer');b.type='button';b.onclick=()=>{b.remove();submit(pending.answer,answers,feedback)};box.append(b)}
async function submit(answer,answers,feedback){
  if(busy)return;busy=true;answers.querySelectorAll('button').forEach(b=>b.disabled=true);
  pending=pending||{roundId:round.id,index:round.index,answer,requestId:crypto.randomUUID()};
  try{
    const r=await API.call('answer',pending);pending=null;progress=r.progress;message('');
    if(!r.correct){
      feedback.textContent='Not that one — try again.';feedback.className='feedback-wrong';
      answers.querySelectorAll('button').forEach(b=>{b.disabled=b.dataset.answer===answer});return;
    }
    feedback.textContent=r.firstTry?'✓ Correct! Next word…':'✓ You found it! Next word…';feedback.className='feedback-correct';
    round=r.round;
    answers.querySelectorAll('button').forEach(b=>b.disabled=true);
    advanceTimer=setTimeout(()=>{advanceTimer=null;question()},650);
  }catch(e){
    feedback.textContent=e.message;
    if(e.status===401||e.status===403){block(e.message);$('login').hidden=false}
    else if(e.status===409){
      pending=null;round=null;
      try{
        await refresh();
        message(round?'Your teacher updated this lesson — picked up your practice where it left off.':e.message);
      }catch(err){block(err.message);$('login').hidden=false}
    }
    else retry($('practice'),answers,feedback)
  }finally{busy=false}
}
(async()=>{try{if(sessionStorage.getItem('yiddishSession')){await refresh();message('Progress connected ✓')}else{const id=localStorage.getItem('b3Games_studentId'),pin=localStorage.getItem('b3Games_classPin');if(id&&pin)await login(id,pin)}}catch(e){block(e.message);$('login').hidden=false}setInterval(async()=>{if(!student||busy||pending)return;try{const s=await API.call('status');config=s.config;student=s.student;if(round&&!open(round.group)){round=null;block('Your teacher closed this section.')}else if(!round){progress=s.progress;render()}}catch(e){block(e.message)}},15000)})();
