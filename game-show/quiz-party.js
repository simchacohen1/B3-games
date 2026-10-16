/* Quiz Party: a separate, timed, all-student alternative to buzzer mode. */
(function(root){
"use strict";
const teacher=/teacher\.html$/i.test(location.pathname);
const ref=gameRef.child("quizParty"), audio=root.GameShowPartyAudio;
const palette=[["Red","#b6283c","#fff"],["Blue","#2157b6","#fff"],["Green","#176b4b","#fff"],["Yellow","#f4d34e","#14213a"]];
const $=id=>document.getElementById(id);
const now=()=>serverNow();
const safeId=x=>String(x||"").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,100);
const valid=q=>!!(q&&Array.isArray(q.choices)&&q.choices.length===4&&q.choices.every(x=>typeof x==="string"&&x.trim())&&
  new Set(q.choices.map(x=>x.trim().toLowerCase())).size===4&&Number.isInteger(q.correctIndex)&&q.correctIndex>=0&&q.correctIndex<4);
const ranking=scores=>Object.entries(scores||{}).map(([name,score])=>({name,score:Number(score)||0}))
  .sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name));
function answer(state,id,name,choice,time,roundId){
 if(!state||state.phase!=="answering"||state.roundId!==roundId||time<state.openedAt||time>=state.closesAt||
  !id||!name||!Number.isInteger(choice)||choice<0||choice>3||state.answers?.[id])return;
 return {...state,answers:{...(state.answers||{}),[id]:{name,choice,at:time}}};
}
function grade(state,correctIndex,time,force=false){
 if(!state||state.phase!=="answering"||time<state.closesAt&&!force)return;
 const next={...state,scores:{...(state.scores||{})},streaks:{...(state.streaks||{})}};
 let right=0,answered=0;
 for(const row of Object.values(state.answers||{})){
  if(!row||!row.name||!Number.isInteger(row.choice)||row.choice<0||row.choice>3)continue;
  answered++;
  if(row.choice===correctIndex){
   right++;
   const streak=(next.streaks[row.name]||0)+1;
   const speed=Math.max(0,Math.min(1,(state.closesAt-row.at)/(state.closesAt-state.openedAt||1)));
   next.scores[row.name]=(next.scores[row.name]||0)+500+Math.round(500*speed)+Math.min(200,(streak-1)*50);
   next.streaks[row.name]=streak;
  }else{next.streaks[row.name]=0;next.scores[row.name]=next.scores[row.name]||0;}
 }
 next.phase="reveal";next.correctCount=right;next.answerCount=answered;next.revealedAt=time;
 return next;
}
root.QuizPartyLogic=Object.freeze({answer,grade,ranking,valid});
const style=document.createElement("style");
style.textContent=".quiz-party-mode #tabPlay .console,.quiz-party-mode #tabPlay .score-panel,.quiz-party-mode #gameArea>.panel:not(#qpStudent):not(.scoreboard){display:none!important}"+
"#qpHost[hidden],#qpStudent[hidden],[hidden]{display:none!important}#qpHost,#qpStudent{padding:18px;background:linear-gradient(130deg,#132657,#1a4780);border:2px solid #7ad3fa;border-radius:20px;color:#fff;margin:14px 0;box-shadow:0 15px 45px #0005}"+
".qp-title{font-weight:1000;text-align:center;font-size:clamp(24px,4vw,48px)}.qp-question{font-size:clamp(19px,3vw,36px);white-space:pre-line;text-align:center;font-weight:800;margin:16px 0}.qp-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.qp-choice{min-height:82px;border:2px solid #fffa;border-radius:16px;font-size:clamp(16px,2vw,24px);font-weight:800;overflow-wrap:anywhere;padding:12px}.qp-choice:disabled{opacity:.75}.qp-choice.selected{outline:4px solid white;outline-offset:1px}.qp-controls{display:flex;gap:9px;flex-wrap:wrap;margin:14px 0}.qp-leaders{display:flex;gap:8px;flex-wrap:wrap}.qp-leaders span{background:#ffffff28;border-radius:9px;padding:9px;font-weight:800}";
document.head.appendChild(style);
function words(id,text){if($(id))$(id).textContent=String(text==null?"":text);}
function choices(container,question,active,selected,click){
 container.replaceChildren();
 if(!valid(question))return;
 question.choices.forEach((value,i)=>{
  const el=document.createElement("button");el.type="button";el.className="qp-choice"+(selected===i?" selected":"");
  el.textContent=palette[i][0]+": "+value;el.style.background=palette[i][1];el.style.color=palette[i][2];
  el.disabled=!active;if(click)el.addEventListener("click",()=>click(i));container.appendChild(el);
 });
}
function leaders(container,scores){
 container.replaceChildren();
 ranking(scores).slice(0,5).forEach((r,i)=>{
  const e=document.createElement("span");e.textContent=(["🥇","🥈","🥉"][i]||"#"+(i+1))+" "+r.name+": "+r.score;
  container.appendChild(e);
 });
}
let qp=null;
if(teacher){
 const settings=document.createElement("section");settings.className="card wide";
 settings.innerHTML='<h3>🎉 Quiz Party (Kahoot-style)</h3><p class="hint">All boys answer every question. Use existing 4-choice questions; buzzer and team modes stay separate.</p>'+
 '<label class="setting"><span class="label"><b>Quiz Party mode</b></span><span class="ctrl"><input id="qpEnable" type="checkbox" class="switch"></span></label>'+
 '<label class="setting"><span class="label"><b>Answer time</b></span><span class="ctrl"><select id="qpSeconds" class="select"><option>10</option><option selected>20</option><option>30</option><option>45</option><option>60</option></select> seconds</span></label>'+
 '<label class="setting"><span class="label"><b>Game-show announcer</b></span><span class="ctrl"><input id="qpVoice" type="checkbox" checked class="switch"></span></label>'+
 '<label class="setting"><span class="label"><b>Looping background jingle</b></span><span class="ctrl"><input id="qpMusic" type="checkbox" checked class="switch"></span></label>'+
 '<label class="setting"><span class="label"><b>Music volume</b></span><span class="ctrl"><input id="qpVolume" type="range" min="0" max="30" value="12"></span></label>'+
 '<p class="hint">Quiz Party scores are separate from regular Game Show points.</p>';
 document.querySelector("#tabSetup .setup-grid").appendChild(settings);
 const host=document.createElement("section");host.id="qpHost";host.hidden=true;
 host.innerHTML='<div class="qp-title">🎉 QUIZ PARTY</div><div class="qp-title" id="qpHostClock"></div>'+
 '<div class="qp-question" id="qpHostQuestion"></div><div class="qp-options" id="qpHostChoices"></div>'+
 '<div class="qp-controls"><button class="btn btn-good" id="qpStart">Start Quiz Party</button>'+
 '<button class="btn" id="qpOpen" hidden>Open answers</button>'+
 '<button class="btn btn-primary" id="qpReveal" hidden>Show results</button>'+
 '<button class="btn btn-good" id="qpNext" hidden>Next question</button>'+
 '<button class="btn btn-bad" id="qpFinish" hidden>Finish game</button></div>'+
 '<p id="qpHostMessage" aria-live="polite"></p><div class="qp-leaders" id="qpHostLeaders"></div>';
 document.querySelector("#tabPlay").insertBefore(host,document.querySelector("#tabPlay .console"));
 audio?.setVolume(.12);
 let busy=false;
 async function open(roundId){
  await ref.transaction(s=>{
   if(!s||s.roundId!==roundId||s.phase!=="intro")return;
   s.phase="answering";s.openedAt=now();s.closesAt=s.openedAt+(Number(s.seconds)||20)*1000;return s;
  });
 }
 async function start(index,previous){
  if(busy)return;
  const q=questions[index];
  if(!valid(q)){words("qpHostMessage","Question "+(index+1)+" needs exactly four different answers and a correct choice. Edit it first.");return;}
  busy=true;
  try{
   const id=now()+"-"+index+"-"+Math.round(Math.random()*1e6),scores={...(previous?.scores||{})},streaks={...(previous?.streaks||{})};
   Object.keys(lastGameData?.scores||{}).forEach(n=>{if(!(n in scores))scores[n]=0;if(!(n in streaks))streaks[n]=0;});
   await ref.set({enabled:true,phase:"intro",questionIndex:index,roundId:id,
    seconds:Number($("qpSeconds").value)||20,answers:{},scores,streaks,
    music:$("qpMusic").checked,voice:$("qpVoice").checked,openedAt:0,closesAt:0});
   if($("qpVoice").checked&&audio){
    const statement="Here we go, contestants! Question "+(index+1)+". "+q.q+". "+
     q.choices.map((x,i)=>palette[i][0]+": "+x).join(". ")+". Go!";
    await Promise.race([audio.speak(statement),new Promise(resolve=>setTimeout(resolve,35000))]);
   }
   await open(id);
  }catch(e){words("qpHostMessage","Could not start: "+e.message);}
  finally{busy=false;}
 }
 let scoring=false;
 async function reveal(force){
  if(scoring||qp?.phase!=="answering")return;
  const q=questions[qp.questionIndex];if(!valid(q))return;
  scoring=true;
  try{await ref.transaction(s=>s&&s.roundId===qp.roundId?grade(s,q.correctIndex,now(),force):undefined);}
  catch(e){words("qpHostMessage","Could not score: "+e.message);}
  finally{scoring=false;}
 }
 $("qpEnable").addEventListener("change",()=>{
  const yes=$("qpEnable").checked;
  ref.update({enabled:yes,phase:yes?"lobby":"off"}).catch(e=>words("qpHostMessage",e.message));
  if(!yes){audio?.stopSpeech();audio?.music(false);}
 });
 $("qpVoice").addEventListener("change",()=>ref.child("voice").set($("qpVoice").checked).catch(()=>{}));
 $("qpMusic").addEventListener("change",()=>ref.child("music").set($("qpMusic").checked).catch(()=>{}));
 $("qpVolume").addEventListener("input",()=>audio?.setVolume(Number($("qpVolume").value)/100));
 $("qpStart").addEventListener("click",()=>start(0,null));
 $("qpOpen").addEventListener("click",()=>{audio?.stopSpeech();if(qp?.roundId)open(qp.roundId);});
 $("qpReveal").addEventListener("click",()=>reveal(true));
 $("qpNext").addEventListener("click",()=>{if(qp?.phase==="reveal")start(qp.questionIndex+1,qp);});
 $("qpFinish").addEventListener("click",()=>{
  if(qp?.phase==="answering"){reveal(true);return;}
  audio?.stopSpeech();audio?.music(false);
  ref.transaction(s=>{if(!s||s.phase==="finished")return;s.phase="finished";return s;});
 });
 function render(){
  document.body.classList.toggle("quiz-party-mode",!!qp?.enabled);
  host.hidden=!qp?.enabled;
  if(!qp?.enabled){if(audio?.musicEnabled)audio.music(false);return;}
  const liveMusic=qp.music!==false&&["lobby","intro","answering"].includes(qp.phase);
  if(audio&&audio.musicEnabled!==liveMusic)audio.music(liveMusic);
  const q=questions[qp.questionIndex];words("qpHostQuestion",q?.q||"Waiting for question…");
  choices($("qpHostChoices"),q,false);
  const remaining=qp.phase==="answering"?Math.max(0,Math.ceil((qp.closesAt-now())/1000)):0;
  words("qpHostClock",qp.phase==="answering"?remaining+" seconds":qp.phase==="intro"?"🎤 Listen up!":
   qp.phase==="reveal"?"Results":qp.phase==="finished"?"🏆 Winners!":"Ready");
  words("qpHostMessage",qp.phase==="answering"?Object.keys(qp.answers||{}).length+" boys have answered":
   qp.phase==="reveal"?(qp.correctCount||0)+" correct out of "+(qp.answerCount||0):
   qp.phase==="finished"?"Final leaderboard":"Ready for all players.");
  $("qpStart").hidden=!["lobby","off","finished"].includes(qp.phase);
  $("qpOpen").hidden=qp.phase!=="intro";
  $("qpReveal").hidden=qp.phase!=="answering";
  $("qpNext").hidden=qp.phase!=="reveal"||qp.questionIndex+1>=questions.length;
  $("qpFinish").hidden=!["reveal","answering"].includes(qp.phase);
  leaders($("qpHostLeaders"),qp.scores);
  if(qp.phase==="answering"&&remaining===0)reveal(false);
 }
 gameRef.on("value",snap=>{
  qp=(snap.val()||{}).quizParty||null;
  $("qpEnable").checked=!!qp?.enabled;
  if(qp?.enabled){$("qpMusic").checked=qp.music!==false;$("qpVoice").checked=qp.voice!==false;}
  render();
 });
 setInterval(()=>{if(qp?.enabled)render();},300);
}else{
 const panel=document.createElement("section");panel.id="qpStudent";panel.hidden=true;
 panel.innerHTML='<div class="qp-title">🎉 QUIZ PARTY</div><p id="qpStudentNumber"></p>'+
 '<div class="qp-title" id="qpStudentClock"></div><div class="qp-question" id="qpStudentQuestion"></div>'+
 '<div class="qp-options" id="qpStudentChoices"></div><p id="qpStudentMessage" aria-live="polite"></p>'+
 '<p id="qpStudentCorrect" style="font-weight:900;color:#ffe878"></p>';
 $("gameArea").insertBefore(panel,$("gameArea").querySelector(".scoreboard"));
 function submit(index){
  if(!qp||qp.phase!=="answering"||!myStudentId||masterBlocked||teacherPreview)return;
  const id=safeId(myStudentId),name=myName,roundId=qp.roundId;
  ref.transaction(s=>answer(s,id,name,index,now(),roundId),(error)=>{
   if(error)words("qpStudentMessage","Could not submit. Please try again.");
  });
 }
 function render(){
  if(!myStudentId||masterBlocked){panel.hidden=true;return;}
  document.body.classList.toggle("quiz-party-mode",!!qp?.enabled);
  panel.hidden=!qp?.enabled;
  if(!qp?.enabled)return;
  const q=questions[qp.questionIndex],mine=qp.answers?.[safeId(myStudentId)];
  const secs=qp.phase==="answering"?Math.max(0,Math.ceil((qp.closesAt-now())/1000)):0;
  words("qpStudentNumber","Question "+(Number(qp.questionIndex)+1)+" of "+questions.length);
  words("qpStudentClock",qp.phase==="answering"?secs+" seconds":qp.phase==="intro"?"🎤 Listen!":
   qp.phase==="reveal"?"Results!":qp.phase==="finished"?"🏆 Game Over!":"Waiting for teacher");
  words("qpStudentQuestion",q?.q||"");
  choices($("qpStudentChoices"),q,qp.phase==="answering"&&secs>0&&!mine&&!teacherPreview&&valid(q),mine?.choice,submit);
  words("qpStudentMessage",qp.phase==="answering"?(mine?"Answer locked in!":secs?"Choose your answer!":"Time is up!"):
   qp.phase==="reveal"?"Check your score!":qp.phase==="finished"?"Well done, contestants!":"Get ready.");
  words("qpStudentCorrect",qp.phase==="reveal"&&valid(q)?
   "Correct: "+palette[q.correctIndex][0]+" — "+q.choices[q.correctIndex]:
   qp.phase==="finished"?ranking(qp.scores).slice(0,3).map((r,i)=>(i+1)+". "+r.name+" ("+r.score+")").join(" · "):"");
  if(typeof renderScoreboard==="function")renderScoreboard(qp.scores||{});
 }
 gameRef.on("value",snap=>{qp=(snap.val()||{}).quizParty||null;render();});
 setInterval(()=>{if(qp?.enabled)render();},500);
}
})(window);
