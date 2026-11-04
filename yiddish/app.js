'use strict';
const APP_BUILD='2026-10-12-word-blaster';
window.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='build: '+APP_BUILD;b.style.cssText='position:fixed;bottom:6px;right:8px;font:11px monospace;color:#94a3a0;background:rgba(255,255,255,.85);padding:2px 6px;border-radius:6px;z-index:9999;pointer-events:none';document.body.appendChild(b)});
const C=window.YIDDISH_CONTENT,$=id=>document.getElementById(id),API=YiddishAPI;
window.addEventListener('ftt:before-follow-navigation',e=>{if(busy||pending)e.preventDefault();});
let group=0,part=0,round=null,showAll=false,progress={},config=null,student=null,busy=false,pending=null,advanceTimer=null,blast=null,sentenceGame=null,soundGame=null;
const word=id=>C.words.find(w=>w.id===id),node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
const status=p=>!p?'New':p.credits>=2?'Learned':'Practicing';
function message(s){$('notice').textContent=s}
function cheer(){
  const p=node('p','🎉 Great job, you finished! 🎉','cheer-message');
  p.setAttribute('role','status');
  p.style.cssText='font-size:26px;font-weight:900;color:#155431;background:#e2f3e8;border-radius:16px;padding:12px 18px;margin:12px auto;max-width:520px';
  return p;
}
function clearAdvance(){if(advanceTimer){clearTimeout(advanceTimer);advanceTimer=null}}
function focusPractice(){requestAnimationFrame(()=>$('practice')?.scrollIntoView({behavior:'smooth',block:'start'}))}
function block(s){clearAdvance();$('lesson').hidden=true;$('practice').hidden=true;document.querySelectorAll('audio').forEach(a=>a.pause());message(s)}
function open(g){return config&&g<config.unlocked[student.classId]&&config.sections[g].verified}
// Each story section is split into steps of 4 new words. Every activity in a step
// uses those 4 new words plus up to 4 review words from earlier steps.
const STEP_SIZE=4;
function partCount(g){return Math.max(1,Math.ceil(config.sections[g].words.length/STEP_SIZE))}
function newWords(g,p){return config.sections[g].words.slice(p*STEP_SIZE,p*STEP_SIZE+STEP_SIZE)}
function earlierWords(g,p){return [...config.sections.slice(0,g).flatMap(s=>s.words),...config.sections[g].words.slice(0,p*STEP_SIZE)]}
function reviewWords(g,p){return shuffleClient(earlierWords(g,p)).sort((a,b)=>(progress[a]?.credits||0)-(progress[b]?.credits||0)).slice(0,STEP_SIZE)}
function lessonWords(g,p){return [...newWords(g,p),...reviewWords(g,p)]}
function stepNumber(g,p){let n=0;for(let i=0;i<g;i++)n+=partCount(i);return n+p+1}
// The teacher opens steps one at a time (config.unlockedSteps); older settings open whole sections.
function stepOpen(g,p){if(!open(g))return false;const n=config.unlockedSteps&&config.unlockedSteps[student.classId];return !Number.isInteger(n)||stepNumber(g,p)<=n}
// A class the admin has not given a Yiddish story to: show one clear message, no lesson.
let noStory=false;
const NO_STORY_MESSAGE='Your teacher has not added a Yiddish story for your class yet.';
function showNoStory(){noStory=true;round=null;blast=null;sentenceGame=null;soundGame=null;$('login').hidden=true;block(NO_STORY_MESSAGE)}
function render(){
  if(!student||!config||noStory)return;
  if(!round&&!blast&&!sentenceGame&&!soundGame&&!window.yiddishFriendsOpen){$('words').hidden=false;$('toolbar').hidden=false;}
  $('login').hidden=true;$('lesson').hidden=false;$('who').textContent=student.name+' · '+student.classId.toUpperCase();
  const ids=[...new Set(config.sections.flatMap(s=>s.words))];
  $('stats').textContent=`${ids.filter(id=>status(progress[id])==='Learned').length} learned · ${ids.filter(id=>status(progress[id])==='Practicing').length} practicing`;
  $('segments').replaceChildren();
  if(part>=partCount(group))part=0;
  if(!stepOpen(group,part)){for(let i=config.sections.length-1;i>=0;i--){let found=false;for(let pp=partCount(i)-1;pp>=0;pp--){if(stepOpen(i,pp)){group=i;part=pp;found=true;break}}if(found)break}}
  config.sections.forEach((s,i)=>{for(let pp=0;pp<partCount(i);pp++){const b=node('button',`${stepOpen(i,pp)?'':'🔒 '}Step ${stepNumber(i,pp)}`,i===group&&pp===part?'active':'');b.type='button';b.disabled=!stepOpen(i,pp);b.title='Story section '+(i+1);b.onclick=()=>{if(busy||pending)return;clearAdvance();group=i;part=pp;showAll=false;round=null;blast=null;sentenceGame=null;soundGame=null;$('practice').hidden=true;$('blastgame').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;render()};$('segments').append(b)}});
  $('words').replaceChildren();$('start').disabled=!stepOpen(group,part);$('blastStart').disabled=!stepOpen(group,part);$('sentenceStart').disabled=!stepOpen(group,part);$('soundStart').disabled=!stepOpen(group,part);$('readStory').hidden=!stepOpen(group,part);$('readStory').href='story.html?section='+group+'&part='+part+(API.preview?'&class='+encodeURIComponent(student.classId):'');$('readStory').textContent='📖 Read the illustrated story — Step '+stepNumber(group,part);
  $('title').textContent=showAll?'My vocabulary':`Step ${stepNumber(group,part)} · new words`;
  const visible=showAll?config.sections.flatMap((s,i)=>open(i)?s.words:[]):stepOpen(group,part)?newWords(group,part):[];
  for(const id of visible){const w=word(id);if(!w)continue;const card=node('article','','word'),st=status(progress[id]);card.append(node('span',st,'status '+st.toLowerCase()));const yi=node('div',w.yiNikud||w.yi,'yi');yi.lang='yi';card.append(yi,node('div',w.en));$('words').append(card)}
  if(!visible.length)$('words').append(node('p','Your teacher will open your next section soon.'));
  else if(!showAll&&earlierWords(group,part).length)$('words').append(node('p','The games will also mix in some review words from earlier steps.','note'));
  if(window.B3Guest&&window.B3Guest.isGuest())$('words').append(node('p','🔓 Guest preview: Step 1 only. Sign in to unlock all 8 steps.','note'));
  if(round&&open(round.group))question();
  if(blast&&!open(blast.group)){blast=null;$('blastgame').hidden=true;$('blastgame').replaceChildren();$('words').hidden=false;$('toolbar').hidden=false}
  if(sentenceGame&&open(sentenceGame.group))sentenceGameRender();else if(sentenceGame){sentenceGame=null}
  if(soundGame&&open(soundGame.group))soundGameRender();else if(soundGame){soundGame=null}
}
async function refresh(){const s=await API.call('status');student=s.student;config=s.config;progress=s.progress;if(s.noStory)return showNoStory();noStory=false;if(!open(group))group=Math.max(0,config.unlocked[student.classId]-1);round=null;if(s.round&&!s.round.finished&&open(s.round.group)){group=s.round.group;part=Number.isInteger(s.round.part)?s.round.part:0}render()}
async function login(id,pin){const s=await API.call('login',{studentId:id,pin:pin.trim(),classId:sessionStorage.getItem('b3Games_studentClass')||''});sessionStorage.setItem('yiddishSession',s.token);sessionStorage.setItem('yiddishSessionClass',sessionStorage.getItem('b3Games_studentClass')||'');await refresh();if(!noStory)message('Progress connected ✓')}
$('all').onclick=()=>{if(busy||pending)return;clearAdvance();showAll=!showAll;round=null;blast=null;sentenceGame=null;soundGame=null;$('practice').hidden=true;$('blastgame').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;render()};
function shuffleClient(a){const b=a.slice();for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b}


function focusSoundGame(){requestAnimationFrame(()=>$('soundgame')?.scrollIntoView({behavior:'smooth',block:'start'}))}
const SOUND_PROFILES={
  'געלט':[
    {raw:'גע',answer:'געֶ',choices:['געֶ','געַ','געָ','געְ']},
    {raw:'לט'}
  ],
  'טאכטער':[
    {raw:'טא',answer:'טאָ',choices:['טאָ','טאַ','טע','טוּ']},
    {raw:'כ',answer:'כ',choices:['כ','כּ']},
    {raw:'טע',answer:'טעֶ',choices:['טעֶ','טעַ','טעָ','טעְ']},
    {raw:'ר'}
  ],
  'גיין':[
    {raw:'ג'},
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יָי']},
    {raw:'ן'}
  ],
  'צוויי':[
    {raw:'צוו'},
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יָי']}
  ],
  'יאר':[
    {raw:'יא',answer:'יאָ',choices:['יאָ','יאַ','יאֵ','יאְ']},
    {raw:'ר'}
  ],
  'צוריק':[
    {raw:'צו',answer:'צוּ',choices:['צוּ','צוֹ','צוַ','צוְ']},
    {raw:'רי',answer:'רִי',choices:['רִי','רֵי','רַי','רָי']},
    {raw:'ק'}
  ],
  'קליין':[
    {raw:'קל'},
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יָי']},
    {raw:'ן'}
  ],
  'שטוב':[
    {raw:'ש',answer:'שׁ',choices:['שׁ','שׂ','שָ','שְ']},
    {raw:'טו',answer:'טוּ',choices:['טוּ','טוֹ','טוַ','טוְ']},
    {raw:'ב',answer:'בּ',choices:['בּ','ב','בָ','בְ']}
  ],
  'נעמען':[
    {raw:'נע',answer:'נעֶ',choices:['נעֶ','נעַ','נעָ','נעְ']},
    {raw:'מע',answer:'מעֶ',choices:['מעֶ','מעַ','מעָ','מעְ']},
    {raw:'ן'}
  ],
  'זען':[
    {raw:'זע',answer:'זעֶ',choices:['זעֶ','זעַ','זעָ','זעְ']},
    {raw:'ן'}
  ],
  'צווישן':[
    {raw:'צ'},
    {raw:'וו'},
    {raw:'י',answer:'יִ',choices:['יִ','י','יי','ײַ']},
    {raw:'ש',answer:'שׁ',choices:['שׁ','שׂ','שָ','שְ']},
    {raw:'ן'}
  ],
  'געזוכט':[
    {raw:'גע',answer:'געֶ',choices:['געֶ','געַ','געָ','געְ']},
    {raw:'זו',answer:'זוּ',choices:['זוּ','זוֹ','זוַ','זוְ']},
    {raw:'כ',answer:'כ',choices:['כ','כּ']},
    {raw:'ט'}
  ],
  'געבן':[
    {raw:'גע',answer:'געֶ',choices:['געֶ','געַ','געָ','געְ']},
    {raw:'ב',answer:'בּ',choices:['בּ','ב','בָ','בְ']},
    {raw:'ען',answer:'עֶן',choices:['עֶן','עַן','עָן','עְן']}
  ],
  'שווער':[
    {raw:'ש',answer:'שׁ',choices:['שׁ','שׂ','שָ','שְ']},
    {raw:'וו'},
    {raw:'ער',answer:'עֶר',choices:['עֶר','עַר','עָר','עְר']}
  ],
  'רעדן':[
    {raw:'רע',answer:'רעֶ',choices:['רעֶ','רעַ','רעָ','רעְ']},
    {raw:'דן'}
  ],
  'העלפן':[
    {raw:'הע',answer:'העֶ',choices:['העֶ','העַ','העָ','העְ']},
    {raw:'ל'},
    {raw:'פ',answer:'פ',choices:['פ','פּ']},
    {raw:'ן'}
  ],
  'טיר':[
    {raw:'טי',answer:'טִי',choices:['טִי','טֵי','טַי','טָי']},
    {raw:'ר'}
  ],
  'שרייבן':[
    {raw:'ש',answer:'שׁ',choices:['שׁ','שׂ','שָ','שְ']},
    {raw:'ר'},
    {raw:'יי',answer:'יַי',choices:['יַי','יֵי','יִי','יָי']},
    {raw:'ב',answer:'בּ',choices:['בּ','ב','בָ','בְ']},
    {raw:'ען'}
  ],
  'נעכטן':[
    {raw:'נע',answer:'נעֶ',choices:['נעֶ','נעַ','נעָ','נעְ']},
    {raw:'כ',answer:'כ',choices:['כ','כּ']},
    {raw:'טן'}
  ],
  'ווער':[
    {raw:'וו'},
    {raw:'ער',answer:'עֶר',choices:['עֶר','עַר','עָר','עְר']}
  ],
  'אנדערש':[
    {raw:'א',answer:'אַ',choices:['אַ','אָ','א','אְ']},
    {raw:'נדער'},
    {raw:'ש',answer:'שׁ',choices:['שׁ','שׂ','שָ','שְ']}
  ],
  'יעצט':[
    {raw:'י'},
    {raw:'עצט',answer:'עֶצט',choices:['עֶצט','עַצט','עָצט','עְצט']}
  ],
  'קלוג':[
    {raw:'ק'},
    {raw:'לו',answer:'לוּ',choices:['לוּ','לוֹ','לוַ','לוְ']},
    {raw:'ג'}
  ],
  'וויינען':[
    {raw:'וו'},
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יָי']},
    {raw:'נע',answer:'נעֶ',choices:['נעֶ','נעַ','נעָ','נעְ']},
    {raw:'ן'}
  ],
  'צאלן':[
    {raw:'צא',answer:'צאָ',choices:['צאָ','צאַ','צע','צוּ']},
    {raw:'לן'}
  ],
  'גוטע':[
    {raw:'גו',answer:'גוּ',choices:['גוּ','גוֹ','גוַ','גוְ']},
    {raw:'טע',answer:'טעֶ',choices:['טעֶ','טעַ','טעָ','טעְ']}
  ],
  'נייעס':[
    {raw:'נ'},
    {raw:'יי',answer:'יַי',choices:['יַי','יֵי','יִי','יָי']},
    {raw:'עס',answer:'עֶס',choices:['עֶס','עַס','עָס','עְס']}
  ],
  'היינט':[
    {raw:'ה'},
    {raw:'יי',answer:'יַי',choices:['יַי','יֵי','יִי','יָי']},
    {raw:'נט'}
  ],
  'גלייך':[
    {raw:'גל'},
    {raw:'יי',answer:'יַי',choices:['יַי','יֵי','יִי','יָי']},
    {raw:'כ',answer:'כ',choices:['כ','כּ']}
  ],
  'קומען':[
    {raw:'קו',answer:'קוּ',choices:['קוּ','קוֹ','קוַ','קוְ']},
    {raw:'מע',answer:'מעֶ',choices:['מעֶ','מעַ','מעָ','מעְ']},
    {raw:'ן'}
  ],
  'שיינע':[
    {raw:'ש',answer:'שׁ',choices:['שׁ','שׂ','שָ','שְ']},
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יָי']},
    {raw:'נע',answer:'נעֶ',choices:['נעֶ','נעַ','נעָ','נעְ']}
  ],
  'מענטשן':[
    {raw:'מע',answer:'מעֶ',choices:['מעֶ','מעַ','מעָ','מעְ']},
    {raw:'נ'},
    {raw:'טש',answer:'טש',choices:['טש','זש','דזש','ש']},
    {raw:'ן'}
  ]
};
function soundProfile(w){
  return SOUND_PROFILES[w.yi]||[{raw:w.yi}];
}
function soundEligibleWords(ids){
  return [...new Set(ids)].filter(id=>{const w=word(id);return w&&soundChallengeIndexes(soundProfile(w)).length>0});
}
function soundChallengeIndexes(profile){
  const out=[];
  profile.forEach((part,i)=>{if(part.choices&&part.choices.length)out.push(i)});
  return out;
}
function soundResetWord(){
  soundGame.choiceOrder={};soundGame.cursor=0;soundGame.placed=new Set();soundGame.transitioning=false;soundGame.lastCorrect=null;soundGame.feedback='';soundGame.wrongChoice=null;
}
$('soundStart').onclick=()=>{
  if(busy||pending||!stepOpen(group,part))return;
  clearAdvance();round=null;blast=null;sentenceGame=null;
  $('practice').hidden=true;$('blastgame').hidden=true;$('sentencegame').hidden=true;
  const ids=shuffleClient(soundEligibleWords(lessonWords(group,part)));
  soundGame={group:group,ids:ids,wordIndex:0,cursor:0,placed:new Set(),transitioning:false,lastCorrect:null,feedback:'',wrongChoice:null};
  soundGameRender();focusSoundGame();
};
function soundChoose(choice){
  if(!soundGame||soundGame.transitioning)return;
  const w=word(soundGame.ids[soundGame.wordIndex]),profile=soundProfile(w),steps=soundChallengeIndexes(profile),partIndex=steps[soundGame.cursor],part=profile[partIndex];
  if(!part)return;
  if(choice===part.answer){
    soundGame.placed.add(partIndex);soundGame.lastCorrect=partIndex;soundGame.transitioning=true;soundGame.feedback='✓ Right sound!';soundGame.wrongChoice=null;soundGameRender();
    setTimeout(()=>{
      if(!soundGame)return;
      soundGame.cursor++;soundGame.transitioning=false;soundGame.lastCorrect=null;soundGame.feedback='';soundGameRender();focusSoundGame();
    },480);
  }else{
    soundGame.wrongChoice=choice;soundGame.feedback='Not that sound — try again.';soundGameRender();
  }
}
function soundGameRender(){
  const box=$('soundgame');box.hidden=false;box.replaceChildren();$('words').hidden=true;$('toolbar').hidden=true;
  if(soundGame.wordIndex>=soundGame.ids.length){
    box.append(node('div','🔤','round-check'),node('h2','Sound Builder complete!'),cheer(),node('p','You built all '+soundGame.ids.length+' Yiddish words in this step.'));
    const again=node('button','Build them again');again.type='button';again.onclick=()=>{soundGame.ids=shuffleClient(soundEligibleWords(lessonWords(group,part)));soundGame.wordIndex=0;soundResetWord();soundGameRender();focusSoundGame()};
    const back=node('button','Back to my words');back.type='button';back.style.marginLeft='10px';back.onclick=()=>{soundGame=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;window.scrollTo({top:0,behavior:'smooth'})};
    box.append(again,back);focusSoundGame();return;
  }

  const w=word(soundGame.ids[soundGame.wordIndex]),profile=soundProfile(w),steps=soundChallengeIndexes(profile),activePart=steps[soundGame.cursor];
  const top=node('div','','sound-topbar'),back=node('button','← Back to my words','sound-exit');back.type='button';
  back.onclick=()=>{soundGame=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;window.scrollTo({top:0,behavior:'smooth'})};
  top.append(back);box.append(top);
  box.append(node('div','Word '+(soundGame.wordIndex+1)+' of '+soundGame.ids.length,'practice-progress'),node('h2','Build the sound of the word'));
  const meaning=node('div',w.en,'sound-meaning');box.append(meaning);

  const wordLine=node('div','','sound-word');wordLine.lang='yi';wordLine.dir='rtl';
  profile.forEach((part,i)=>{
    let shown=soundGame.placed.has(i)?part.answer:part.raw;
    const cls='sound-part'+(i===activePart?' active':'')+(soundGame.placed.has(i)?' placed':'')+(i===soundGame.lastCorrect?' pop':'');
    const span=node('span',shown,cls);span.lang='yi';span.dir='rtl';wordLine.append(span);
  });
  box.append(wordLine);

  if(soundGame.cursor>=steps.length){
    box.append(node('p','✓ You built the whole word!','sound-complete'));
    const next=node('button',soundGame.wordIndex===soundGame.ids.length-1?'Finish →':'Next word →','sound-next');next.type='button';
    next.onclick=()=>{soundGame.wordIndex++;soundResetWord();soundGameRender();focusSoundGame()};
    box.append(next);return;
  }

  const part=profile[activePart];
  box.append(node('p','Choose the correct version for the highlighted part. In this learning activity, ע with an “e” sound gets a segol; two yuds get patach for “ay” and tzere for “ey.”','sound-hint'));
  const opts=node('div','','sound-options');
  soundGame.choiceOrder=soundGame.choiceOrder||{};const orderKey=soundGame.wordIndex+':'+w.id+':'+activePart;
  if(!soundGame.choiceOrder[orderKey])soundGame.choiceOrder[orderKey]=part.choices.slice();
  for(const choice of soundGame.choiceOrder[orderKey]){
    const b=node('button',choice,'sound-option'+(soundGame.wrongChoice===choice?' wrong':''));
    b.type='button';b.lang='yi';b.dir='rtl';b.disabled=soundGame.transitioning;b.onclick=()=>soundChoose(choice);opts.append(b);
  }
  box.append(opts);
  const feedback=node('p',soundGame.feedback||'','sound-feedback '+(soundGame.feedback.startsWith('✓')?'feedback-correct':soundGame.feedback?'feedback-wrong':''));feedback.setAttribute('role','status');box.append(feedback);
}

function focusSentenceGame(){requestAnimationFrame(()=>$('sentencegame')?.scrollIntoView({behavior:'smooth',block:'start'}))}
const SENTENCE_TEMPLATES={
  'געלט':'ער האט אסאך ___ אין דעם זעקל.',
  'טאכטער':'רב פסח האט א ___ מיטן נאמען גיטל.',
  'גיין':'איך וויל ___ אהיים.',
  'צוויי':'ער האט געארבעט ___ יאר.',
  'יאר':'א ___ האט צוועלף חדשים.',
  'צוריק':'נאך צוויי יאר איז ער געקומען ___.',
  'קליין':'ער האט געהאט א ___ זעקל.',
  'שטוב':'פאר פסח וויל ער גיין צו זיין ___.',
  'נעמען':'איך וויל ___ דעם זעקל מיט מיר.',
  'זען':'ער וויל ___ זיין משפחה.',
  'צווישן':'דער זעקל ליגט ___ די פעסער.',
  'געזוכט':'נאך שבת האט ער ___ זיין געלט.',
  'געבן':'איך וויל ___ דיר די געלט.',
  'שווער':'ער האט געארבעט זייער ___.',
  'רעדן':'איך וויל ___ מיטן רב.',
  'העלפן':'דער רב וועט אים ___.',
  'טיר':'עמיצער קלאפט אויף די ___.',
  'שרייבן':'דער רב וועט ___ א בריוו.',
  'נעכטן':'___ איז ער געווען ביים רב.',
  'ווער':'___ האט גענומען די געלט?',
  'אנדערש':'אפשר האט עמיצער ___ עס גענומען.',
  'יעצט':'___ האב איך א פראבלעם.',
  'קלוג':'דער רב איז געווען זייער ___.',
  'וויינען':'ער האט אנגעהויבן צו ___.',
  'צאלן':'ער וועט ___ פאר די גאנצע חתונה.',
  'גוטע':'איך האב ___ נייעס פאר דיר.',
  'נייעס':'איך האב גוטע ___ פאר דיר.',
  'היינט':'___ איז אלץ גוט.',
  'גלייך':'איך וועל ___ קומען.',
  'קומען':'איך וועל ___ צום רב.',
  'שיינע':'גיטל וועט האבן א ___ חתונה.',
  'מענטשן':'אסאך ___ זענען געקומען צו דער חתונה.'
};
function sentenceTemplate(w){
  if(SENTENCE_TEMPLATES[w.yi])return SENTENCE_TEMPLATES[w.yi];
  const para=String(C.paras[w.paragraph]||'');
  const tokens=para.split(/\s+/).filter(Boolean),hit=tokens.findIndex(t=>t.includes(w.yi));
  if(hit>=0){
    const start=Math.max(0,hit-5),end=Math.min(tokens.length,hit+6);
    let sample=tokens.slice(start,end).join(' ');
    sample=sample.replace(w.yi,'___');
    return (start>0?'… ':'')+sample+(end<tokens.length?' …':'');
  }
  return 'וועלכע ווארט פעלט דא? ___';
}
function sentenceAttempt(targetId,answerId){
  if(!sentenceGame||sentenceGame.solved.has(targetId))return;
  if(answerId===targetId){
    sentenceGame.solved.add(targetId);sentenceGame.selected=null;sentenceGame.feedback='✓ גוט!';sentenceGame.feedbackKind='good';
  }else{
    sentenceGame.feedback='נישט דאס ווארט — פרוביר נאכאמאל.';sentenceGame.feedbackKind='bad';
  }
  sentenceGameRender();
}
$('sentenceStart').onclick=()=>{
  if(busy||pending||!stepOpen(group,part))return;
  clearAdvance();round=null;blast=null;soundGame=null;
  $('practice').hidden=true;$('blastgame').hidden=true;$('soundgame').hidden=true;
  const ids=shuffleClient(lessonWords(group,part));
  sentenceGame={group:group,ids:ids,setIndex:0,solved:new Set(),selected:null,feedback:'',feedbackKind:''};
  sentenceGameRender();focusSentenceGame();
};
function sentenceGameRender(){
  const box=$('sentencegame');box.hidden=false;box.replaceChildren();$('words').hidden=true;$('toolbar').hidden=true;
  const ids=sentenceGame.ids,sets=Math.max(1,Math.ceil(ids.length/4)),start=sentenceGame.setIndex*4,targets=ids.slice(start,start+4);
  if(start>=ids.length){
    box.append(node('div','🧩','round-check'),node('h2','Missing Word complete!'),cheer(),node('p','You filled in all '+ids.length+' words.'));
    const again=node('button','Play again');again.type='button';again.onclick=()=>{const nextIds=shuffleClient(lessonWords(group,part));sentenceGame={group:group,ids:nextIds,setIndex:0,solved:new Set(),selected:null,feedback:'',feedbackKind:''};sentenceGameRender();focusSentenceGame()};
    const back=node('button','Back to my words');back.type='button';back.style.marginLeft='10px';back.onclick=()=>{sentenceGame=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;window.scrollTo({top:0,behavior:'smooth'})};
    box.append(again,back);focusSentenceGame();return;
  }

  const top=node('div','','sentence-topbar'),back=node('button','← Back to my words','sentence-exit');back.type='button';
  back.onclick=()=>{sentenceGame=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;window.scrollTo({top:0,behavior:'smooth'})};
  top.append(back);box.append(top);
  box.append(node('div','Set '+(sentenceGame.setIndex+1)+' of '+sets,'practice-progress'),node('h2','Put in the missing word'));
  box.append(node('p','Drag the correct Yiddish word into each blank. All of this step’s words are in the word bank.','sentence-hint'));

  const bank=node('div','','sentence-bank');
  bank.setAttribute('aria-label','Word bank');
  if(!sentenceGame.bankOrder||sentenceGame.bankSet!==sentenceGame.setIndex){sentenceGame.bankOrder=shuffleClient(ids);sentenceGame.bankSet=sentenceGame.setIndex}
  for(const id of sentenceGame.bankOrder){
    const w=word(id);if(!w)continue;
    const used=sentenceGame.solved.has(id)&&targets.includes(id);
    const b=node('button',w.yi,'sentence-word'+(sentenceGame.selected===id?' selected':'')+(used?' used':''));b.type='button';b.lang='yi';b.dir='rtl';b.draggable=!used;b.disabled=used;
    b.dataset.wordId=id;
    b.onclick=()=>{if(used)return;sentenceGame.selected=sentenceGame.selected===id?null:id;sentenceGame.feedback=sentenceGame.selected?'Now click a blank, or drag the word.':'';sentenceGame.feedbackKind='';sentenceGameRender()};
    b.ondragstart=e=>{if(used){e.preventDefault();return}sentenceGame.selected=id;e.dataTransfer.setData('text/plain',id);e.dataTransfer.effectAllowed='copy'};
    bank.append(b);
  }
  box.append(bank);

  const board=node('div','','sentence-board');
  targets.forEach((targetId,i)=>{
    const w=word(targetId);if(!w)return;
    const card=node('article','','sentence-card'),num=node('span',String(i+1),'sentence-number'),line=node('div','','sentence-line');line.lang='yi';line.dir='rtl';
    const template=sentenceTemplate(w),parts=template.split('___'),solved=sentenceGame.solved.has(targetId);
    line.append(document.createTextNode(parts[0]||''));
    const blank=node('button',solved?w.yi:'________','sentence-blank'+(solved?' solved':''));blank.type='button';blank.lang='yi';blank.dir='rtl';blank.disabled=solved;
    blank.setAttribute('aria-label',solved?'Correct word: '+w.yi:'Missing word');
    blank.ondragover=e=>{if(!solved){e.preventDefault();blank.classList.add('drag-over')}};
    blank.ondragleave=()=>blank.classList.remove('drag-over');
    blank.ondrop=e=>{e.preventDefault();blank.classList.remove('drag-over');sentenceAttempt(targetId,e.dataTransfer.getData('text/plain'))};
    blank.onclick=()=>{if(sentenceGame.selected)sentenceAttempt(targetId,sentenceGame.selected)};
    line.append(blank,document.createTextNode(parts.slice(1).join('___')||''));
    card.append(num,line);board.append(card);
  });
  box.append(board);

  const feedback=node('p',sentenceGame.feedback||'','sentence-feedback '+(sentenceGame.feedbackKind==='good'?'feedback-correct':sentenceGame.feedbackKind==='bad'?'feedback-wrong':''));feedback.setAttribute('role','status');box.append(feedback);
  const allDone=targets.length>0&&targets.every(id=>sentenceGame.solved.has(id));
  if(allDone){
    const next=node('button',sentenceGame.setIndex+1>=sets?'Finish →':'Next 4 sentences →','sentence-next');next.type='button';
    next.onclick=()=>{sentenceGame.setIndex++;sentenceGame.solved=new Set();sentenceGame.selected=null;sentenceGame.feedback='';sentenceGame.feedbackKind='';sentenceGameRender();focusSentenceGame()};
    box.append(next);
  }
}

/* ---------- Word Blaster: blast the Yiddish word that matches the English meaning ---------- */
function focusBlast(){requestAnimationFrame(()=>$('blastgame')?.scrollIntoView({behavior:'smooth',block:'start'}))}
function blastNew(){return {group,part,ids:shuffleClient(lessonWords(group,part)),idx:0,score:0,lives:3,streak:0,missed:[],over:false,token:0}}
function blastExit(){blast=null;const box=$('blastgame');box.hidden=true;box.replaceChildren();$('words').hidden=false;$('toolbar').hidden=false;window.scrollTo({top:0,behavior:'smooth'})}
$('blastStart').onclick=()=>{
  if(busy||pending||!stepOpen(group,part))return;
  clearAdvance();round=null;sentenceGame=null;soundGame=null;$('practice').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;
  blast=blastNew();blastRender();focusBlast();
};
function blastRender(){
  const b=blast,box=$('blastgame');box.hidden=false;box.replaceChildren();$('words').hidden=true;$('toolbar').hidden=true;
  const token=++b.token;
  const top=node('div','','sentence-topbar'),exit=node('button','← Back to my words','sentence-exit');exit.type='button';exit.onclick=blastExit;top.append(exit);box.append(top);
  if(b.over||b.idx>=b.ids.length){
    const won=!b.over;
    box.append(node('div',won?'🚀':'💫','round-check'),node('h2',won?'Mission complete!':'Out of shields!'));
    if(won)box.append(cheer());
    box.append(node('p',`⭐ Score: ${b.score} · ${Math.min(b.idx,b.ids.length)} of ${b.ids.length} words blasted`,'blast-final'));
    const missed=[...new Set(b.missed)].map(word).filter(Boolean);
    if(missed.length){const rv=node('div','','blast-review');rv.append(node('p','Words to practice:','note'));for(const w of missed){const r=node('div','','blast-review-row'),yi=node('span',w.yi,'yi');yi.lang='yi';r.append(yi,node('span',' = '+w.en));rv.append(r)}box.append(rv)}
    const again=node('button','Play again');again.type='button';again.onclick=()=>{blast=blastNew();blastRender();focusBlast()};
    const back=node('button','Back to my words');back.type='button';back.style.marginLeft='10px';back.onclick=blastExit;
    box.append(again,back);focusBlast();return;
  }
  const id=b.ids[b.idx],w=word(id);
  if(!w){b.idx++;return blastRender()}
  const hud=node('div','','blast-hud'),lives=node('span','','blast-lives'),score=node('span','','blast-score');
  const showHud=()=>{lives.textContent='❤️'.repeat(Math.max(0,b.lives))+'🖤'.repeat(3-Math.max(0,b.lives));lives.setAttribute('aria-label',Math.max(0,b.lives)+' shields left');score.textContent='⭐ '+b.score};
  showHud();hud.append(lives,node('span',`Word ${b.idx+1} of ${b.ids.length}`,'blast-count'),score);box.append(hud);
  const prompt=node('div','','blast-prompt');prompt.append(node('small','Blast the Yiddish word for'),node('strong',w.en));box.append(prompt);
  const field=node('div','','blast-field');box.append(field);
  const fb=node('p','','blast-feedback');fb.setAttribute('role','status');box.append(fb);
  const pool=[...new Set([...lessonWords(b.group,b.part),...config.sections.flatMap(s=>s.words)])].filter(x=>x!==id&&word(x)&&word(x).yi!==w.yi);
  const choices=shuffleClient([id,...shuffleClient(pool).slice(0,3)]),lanes=shuffleClient([0,1,2,3]);
  const speed=32+b.idx*5;
  const rocks=choices.map((cid,i)=>{const el=node('button','','blast-rock');el.type='button';const t=node('span',word(cid).yi,'yi');t.lang='yi';el.append(t);el.style.left=(lanes[i]*25+2.5)+'%';const r={id:cid,el,y:-70-i*60,done:false};el.style.transform=`translateY(${r.y}px)`;field.append(el);return r});
  let locked=false;
  const next=delay=>{locked=true;setTimeout(()=>{if(blast!==b||b.token!==token)return;if(!b.over)b.idx++;blastRender()},delay)};
  const lose=()=>{b.lives--;b.streak=0;b.missed.push(id);if(b.lives<=0)b.over=true;showHud()};
  for(const r of rocks)r.el.onclick=()=>{
    if(locked||r.done)return;r.done=true;
    if(r.id===id){b.streak++;const h=field.clientHeight||340,pts=100+Math.max(0,Math.round(100*(1-r.y/h)))+25*(b.streak-1);b.score+=pts;r.el.classList.add('hit');fb.textContent=`💥 Yes! ${w.yi} = ${w.en}  (+${pts})`;fb.className='blast-feedback feedback-correct';showHud();next(900)}
    else{r.el.classList.add('miss');lose();fb.textContent=`Oops! That one means “${word(r.id).en}”.`;fb.className='blast-feedback feedback-wrong';if(b.over)next(1300)}
  };
  let last=performance.now();
  const step=now=>{
    if(blast!==b||b.token!==token||box.hidden)return;
    const dt=Math.min(.05,(now-last)/1000);last=now;
    if(!locked){const h=field.clientHeight||340;for(const r of rocks){if(r.done)continue;r.y+=speed*dt;r.el.style.transform=`translateY(${r.y}px)`;
      if(r.y>h-58){if(r.id===id){r.done=true;r.el.classList.add('reveal');lose();fb.textContent=`It got away! ${w.yi} = ${w.en}`;fb.className='blast-feedback feedback-wrong';next(1500);break}else r.y=-70}}}
    requestAnimationFrame(step)};
  requestAnimationFrame(step);
}
$('start').onclick=async()=>{if(busy||!stepOpen(group,part))return;clearAdvance();blast=null;sentenceGame=null;soundGame=null;$('blastgame').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;busy=true;$('start').disabled=true;try{message('');const s=await API.call('start',{group,part});round=s.round;pending=null;$('practice').hidden=false;question();focusPractice()}catch(e){message(e.message)}finally{busy=false;$('start').disabled=!open(group)}};
function question(){
  clearAdvance();
  const box=$('practice');box.hidden=false;box.replaceChildren();$('words').hidden=true;$('toolbar').hidden=true;
  if(round.finished){
    box.append(node('div','✓','round-check'),node('h2','Round complete!'),cheer(),node('p',`You practiced all ${round.total} words in this step.`),node('p','Your progress is saved. A word becomes “Learned” after two first-try correct rounds.'));
    const again=node('button','Practice this step again');again.type='button';again.onclick=async()=>{if(busy)return;busy=true;again.disabled=true;try{round=null;message('');const s=await API.call('start',{group,part,forceNew:true});round=s.round;pending=null;question();focusPractice()}catch(e){message(e.message)}finally{busy=false}};
    const back=node('button','Back to my words');back.type='button';back.style.marginLeft='10px';back.onclick=async()=>{round=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;try{await refresh()}catch(e){message(e.message)}window.scrollTo({top:0,behavior:'smooth'})};
    box.append(again,back);focusPractice();return;
  }
  const q=round.question,w=word(q.wordId);
  const progressText=node('div',`Word ${round.index+1} of ${round.total}`,'practice-progress');
  const bar=node('div','','practice-bar');const fill=node('div','','practice-bar-fill');fill.style.width=`${Math.max(4,((round.index)/round.total)*100)}%`;bar.append(fill);
  const topBack=node('div','','sentence-topbar'),backBtn=node('button','← Back to my words','sentence-exit');backBtn.type='button';
  backBtn.onclick=async()=>{if(busy)return;clearAdvance();pending=null;round=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;try{await refresh()}catch(e){message(e.message)}window.scrollTo({top:0,behavior:'smooth'})};
  topBack.append(backBtn);
  box.append(topBack,progressText,bar,node('h2','What does this word mean?'));
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
        $('practice').hidden=true;$('words').hidden=false;$('toolbar').hidden=false;
        message('Your practice round could not be continued. Press Practice to start again.');
      }catch(err){block(err.message);$('login').hidden=false}
    }
    else retry($('practice'),answers,feedback)
  }finally{busy=false}
}
(async()=>{try{
  await API.ready;
  if(API.preview){await refresh();if(!noStory)message(window.B3Guest&&window.B3Guest.isGuest()?'Guest preview - practice stays in this tab, nothing is saved.':'Teacher demonstration - practice stays in this tab.')}
  else {
  if(sessionStorage.getItem('yiddishSessionClass')!==sessionStorage.getItem('b3Games_studentClass'))sessionStorage.removeItem('yiddishSession');
  if(sessionStorage.getItem('yiddishSession')){await refresh();if(!noStory)message('Progress connected ✓')}
  else{
    const id=sessionStorage.getItem('b3Games_studentId');
    const pin=sessionStorage.getItem('b3Games_classPin');
    if(id&&pin) await login(id,pin);
    else{
      message('Open Fun Torah Tools and sign in to connect your Yiddish lesson.');
    }
  }
}
}catch(e){block(e.message);$('login').hidden=false}let statusChecking=false;setInterval(async()=>{if(!student||busy||pending||document.hidden||statusChecking)return;statusChecking=true;try{const s=await API.call('status');config=s.config;student=s.student;if(s.noStory){showNoStory();return}if(noStory){noStory=false;progress=s.progress;message('');render();return}if(round&&!open(round.group)){round=null;block('Your teacher closed this section.')}else if(!round){progress=s.progress;render()}}catch(e){block(e.message)}finally{statusChecking=false}},15000)})();
