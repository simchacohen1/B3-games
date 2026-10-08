'use strict';
const APP_BUILD='2026-10-08-teacher-demo';
window.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='build: '+APP_BUILD;b.style.cssText='position:fixed;bottom:6px;right:8px;font:11px monospace;color:#94a3a0;background:rgba(255,255,255,.85);padding:2px 6px;border-radius:6px;z-index:9999;pointer-events:none';document.body.appendChild(b)});
const C=window.YIDDISH_CONTENT,$=id=>document.getElementById(id),API=YiddishAPI;
let group=0,part=0,round=null,showAll=false,progress={},config=null,student=null,busy=false,pending=null,advanceTimer=null,flash=null,storyQuiz=null,sentenceGame=null,soundGame=null;
const word=id=>C.words.find(w=>w.id===id),node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n};
const status=p=>!p?'New':p.credits>=2?'Learned':'Practicing';
const STORY_SUMMARIES={
  2:'The story begins in Prague, where the great Rav Rabbi Yechezkel Landau lived.',
  3:'Reb Pesach was a good teacher, but his school did not pay him very much.',
  4:'Reb Pesach needed money for his daughter Gitl’s wedding, so he decided to travel for work.',
  5:'He planned to work in Hungary for two years, earn money, and then come back home.',
  6:'In Hungary he worked very hard for two years and saved his money in a small bag.',
  7:'Before Pesach, Reb Pesach decided it was time to go back home.',
  8:'A wine merchant named Mr. Weinman was also traveling back with a wagon full of wine.',
  9:'Reb Pesach offered to guard the kosher wine as the mashgiach in exchange for a free ride.',
  10:'Reb Pesach took his bag of money and was excited to see his family again after two years.',
  11:'Before Shabbos, Reb Pesach hid his money bag between the wine barrels, but someone saw him.',
  12:'After Shabbos, Reb Pesach searched for his money and discovered that it was gone.',
  13:'Reb Pesach suspected Mr. Weinman and decided to speak to him calmly about the missing money.',
  14:'Mr. Weinman denied taking the money, so Reb Pesach decided to ask the Rav for help in Prague.',
  15:'Reb Pesach came home with no money and told his family that someone had stolen it.',
  16:'Reb Pesach went to the Rav and told him the whole story about the missing bag of money.',
  17:'The Rav promised to help, and the next day Mr. Weinman came to ask for a hechsher on his wine.',
  18:'Mr. Weinman asked the Rav to certify the wine as kosher and offered money for maos chitim.',
  19:'Mr. Weinman said Reb Pesach had guarded the wine carefully as his mashgiach.',
  20:'The Rav told Mr. Weinman there was a problem: Reb Pesach’s bag of money had disappeared.',
  21:'The Rav said that if Mr. Weinman did not take the money, perhaps somebody else had.',
  22:'The Rav suggested that maybe a non-Jew entered the wagon, which could create a kashrus problem for the wine.',
  23:'Mr. Weinman admitted that he took the money, returned the bag, and asked the Rav for the hechsher.',
  24:'The Rav said there was still a problem: perhaps the money had been stolen on Shabbos.',
  25:'Mr. Weinman insisted it was not on Shabbos, begged the Rav to believe him, and began to cry.',
  26:'The Rav saw that Mr. Weinman truly regretted what he had done and proposed a deal.',
  27:'The Rav told Mr. Weinman to pay for Gitl’s entire wedding as part of making things right.',
  28:'Mr. Weinman wrote a large check for Reb Pesach, and the Rav called Reb Pesach on the telephone.',
  29:'The Rav told Reb Pesach that he had very good news for him.',
  30:'The Rav told Reb Pesach that yesterday he had a problem, but today the problem was solved.',
  31:'The Rav said he had both the money bag and a large check, and Reb Pesach said he would come right away.',
  32:'Reb Pesach said his daughter would now be able to have a beautiful wedding after Pesach.',
  33:'Reb Pesach happily told his wife that they had good news and there would be a big wedding.',
  34:'Reb Pesach received the money, had a wonderful Pesach, and Gitl later found a fine chosson.',
  35:'The whole town came to Gitl’s wedding, including Mr. Weinman, and everyone celebrated.'
};
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
function showNoStory(){noStory=true;round=null;flash=null;storyQuiz=null;sentenceGame=null;soundGame=null;$('login').hidden=true;block(NO_STORY_MESSAGE)}
function render(){
  if(!student||!config||noStory)return;
  if(!round&&!flash&&!storyQuiz&&!sentenceGame&&!soundGame&&!window.yiddishFriendsOpen){$('words').hidden=false;$('toolbar').hidden=false;}
  $('login').hidden=true;$('lesson').hidden=false;$('who').textContent=student.name+' · '+student.classId.toUpperCase();
  const ids=[...new Set(config.sections.flatMap(s=>s.words))];
  $('stats').textContent=`${ids.filter(id=>status(progress[id])==='Learned').length} learned · ${ids.filter(id=>status(progress[id])==='Practicing').length} practicing`;
  $('segments').replaceChildren();
  if(part>=partCount(group))part=0;
  if(!stepOpen(group,part)){for(let i=config.sections.length-1;i>=0;i--){let found=false;for(let pp=partCount(i)-1;pp>=0;pp--){if(stepOpen(i,pp)){group=i;part=pp;found=true;break}}if(found)break}}
  config.sections.forEach((s,i)=>{for(let pp=0;pp<partCount(i);pp++){const b=node('button',`${stepOpen(i,pp)?'':'🔒 '}Step ${stepNumber(i,pp)}`,i===group&&pp===part?'active':'');b.type='button';b.disabled=!stepOpen(i,pp);b.title='Story section '+(i+1);b.onclick=()=>{if(busy||pending)return;clearAdvance();group=i;part=pp;showAll=false;round=null;flash=null;storyQuiz=null;sentenceGame=null;soundGame=null;$('practice').hidden=true;$('flashcards').hidden=true;$('storyquiz').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;render()};$('segments').append(b)}});
  $('words').replaceChildren();$('start').disabled=!stepOpen(group,part);$('flashStart').disabled=!stepOpen(group,part);$('sentenceStart').disabled=!stepOpen(group,part);$('soundStart').disabled=!stepOpen(group,part);$('storyQuizStart').disabled=!open(group);$('readStory').hidden=!stepOpen(group,part);$('readStory').href='story.html?section='+group+'&part='+part+(API.preview?'&class='+encodeURIComponent(student.classId):'');$('readStory').textContent='📖 Read the illustrated story — Step '+stepNumber(group,part);
  $('title').textContent=showAll?'My vocabulary':`Step ${stepNumber(group,part)} · new words`;
  const visible=showAll?config.sections.flatMap((s,i)=>open(i)?s.words:[]):stepOpen(group,part)?newWords(group,part):[];
  for(const id of visible){const w=word(id);if(!w)continue;const card=node('article','','word'),st=status(progress[id]);card.append(node('span',st,'status '+st.toLowerCase()));const yi=node('div',w.yi,'yi');yi.lang='yi';card.append(yi,node('div',w.en));$('words').append(card)}
  if(!visible.length)$('words').append(node('p','Your teacher will open your next section soon.'));
  else if(!showAll&&earlierWords(group,part).length)$('words').append(node('p','The games will also mix in some review words from earlier steps.','note'));
  if(round&&open(round.group))question();
  if(flash&&open(flash.group))flashRender();else if(flash){flash=null}
  if(storyQuiz&&open(storyQuiz.group))storyQuizRender();else if(storyQuiz){storyQuiz=null}
  if(sentenceGame&&open(sentenceGame.group))sentenceGameRender();else if(sentenceGame){sentenceGame=null}
  if(soundGame&&open(soundGame.group))soundGameRender();else if(soundGame){soundGame=null}
}
async function refresh(){const s=await API.call('status');student=s.student;config=s.config;progress=s.progress;if(s.noStory)return showNoStory();noStory=false;if(!open(group))group=Math.max(0,config.unlocked[student.classId]-1);round=null;if(s.round&&!s.round.finished&&open(s.round.group)){group=s.round.group;part=Number.isInteger(s.round.part)?s.round.part:0}render()}
async function login(id,pin){const s=await API.call('login',{studentId:id,pin:pin.trim(),classId:sessionStorage.getItem('b3Games_studentClass')||''});sessionStorage.setItem('yiddishSession',s.token);sessionStorage.setItem('yiddishSessionClass',sessionStorage.getItem('b3Games_studentClass')||'');await refresh();if(!noStory)message('Progress connected ✓')}
$('all').onclick=()=>{if(busy||pending)return;clearAdvance();showAll=!showAll;round=null;flash=null;storyQuiz=null;sentenceGame=null;soundGame=null;$('practice').hidden=true;$('flashcards').hidden=true;$('storyquiz').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;render()};
function shuffleClient(a){const b=a.slice();for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b}
function focusFlash(){requestAnimationFrame(()=>$('flashcards')?.scrollIntoView({behavior:'smooth',block:'start'}))}

function focusStoryQuiz(){requestAnimationFrame(()=>$('storyquiz')?.scrollIntoView({behavior:'smooth',block:'start'}))}
const STORY_SECTION_PARAS=[
  [2,3,4,5,6,7,8,9],
  [10,11,12,13,14,15,16],
  [17,18,19,20,21,22,23,24,25],
  [26,27,28,29,30,31,32,33,34,35]
];
const STORY_CLUES={
  2:[['פראג','Prague'],['גרויסער רב','a great Rav'],['רבי יחזקאל לאנדאו','Rabbi Yechezkel Landau']],
  3:[['רב פסח','Reb Pesach'],['רבי','teacher'],['גוטער רבי','good teacher'],['געלט','money']],
  4:[['טאכטער','daughter'],['גיטל','Gitl'],['חתונה','wedding'],['גענוג געלט','enough money'],['גיין','go']],
  5:[['אנדערע קאנטרי','another country'],['צוויי יאר','two years'],['געלט','money'],['צוריק','back']],
  6:[['האנגערי','Hungary'],['ארבעט','work'],['צוויי יאר','two years'],['געלט','money'],['קליין','small']],
  7:[['פאר פסח','before Pesach'],['גיין אהיים','go home'],['שטוב','home'],['געלט','money']],
  8:[['מענטש','man'],['צוריק','back'],['מיסטער וויינמאן','Mr. Weinman'],['וויין','wine']],
  9:[['מיסטער וויינמאן','Mr. Weinman'],['וואגן','wagon'],['משגיח','mashgiach'],['וויין','wine'],['נעמען','take']],
  10:[['זעקל מיט געלט','bag of money'],['צוויי יאר','two years'],['טאכטער','daughter'],['חתונה','wedding'],['זען','see'],['משפחה','family']],
  11:[['האטעל','hotel'],['געלט','money'],['קיינער','nobody'],['זעקל','bag'],['צווישן','between'],['וויין','wine']],
  12:[['שבת','Shabbos'],['צוריק','back'],['געזוכט','looked for'],['געלט','money']],
  13:[['מיסטער וויימאן','Mr. Weinman'],["געגנב'עט",'stolen'],['רעדן','speak'],['געלט','money']],
  14:[['נישט גענומען','did not take'],['ווער','who'],['רב','Rav'],['העלפן','help']],
  15:[['גארנישט קיין געלט','no money at all'],['משפחה','family'],["געגנב'עט",'stolen']],
  16:[['רב','Rav'],['גאנצע מעשה','whole story'],['געארבעט','worked'],['געלט','money'],['האנגערי','Hungary']],
  17:[['רב','Rav'],['העלפן','help'],['נעקסטע טאג','next day'],['טיר','door'],['מיסטער וויינמאן','Mr. Weinman']],
  18:[['הכשר','kosher certification'],['וויין','wine'],['כשר','kosher'],['שרייבן','write'],['רב','Rav']],
  19:[['משגיח','mashgiach'],['האנגערי','Hungary'],['וואגן','wagon'],['טריפ צוריק','trip back'],['גאנצע צייט','the whole time'],['רב פסח','Reb Pesach']],
  20:[['פראבלעם','problem'],['משגיח','mashgiach'],['נעכטן','yesterday'],['געלט','money']],
  21:[['נישט גענומען','did not take'],['ווער','who'],['עמיצער אנדערש','someone else'],['גענומען','took'],['אמת','truth']],
  22:[['גוי','non-Jew'],['עמיצער אנדערש','someone else'],['אריינגעקומען','came in'],['וואגן','wagon'],['געטשעפעט','touched'],['וויין','wine']],
  23:[['גענומען','took'],['זעקל פון געלט','bag of money'],['הכשר','kosher certification'],['קלוג','clever']],
  24:[['נישט אזוי סימפל','not so simple'],['יעצט','now'],['זעקל פון געלט','bag of money'],['גענומען','took'],['שבת','Shabbos']],
  25:[['שבת','Shabbos'],['גענומען די געלט','took the money'],['גלייבן','believe'],['משגיח','mashgiach'],['וויינען','cry']],
  26:[['תשובה','teshuvah'],['אמת','truth'],['רב','Rav'],['מיסטער וויינמאן','Mr. Weinman'],['דיעל','deal'],['געלט','money']],
  27:[['גוטן פלאן','good plan'],['גרויסע מצוה','big mitzvah'],['צאלן','pay'],['גאנצע חתונה','whole wedding'],['גיטל','Gitl']],
  28:[['טשעקבוק','checkbook'],['צוועלף טויזנט דאלער','twelve thousand dollars'],['טשעק','check'],['רב','Rav'],['רעב פסח','Reb Pesach'],['געקלונגען','called']],
  29:[['גוטע נייעס','good news'],['זייער גוטע נייעס','very good news'],['רבי יחזקאל לאנדא','Rabbi Yechezkel Landau'],['רב','Rav'],['פראג','Prague']],
  30:[['נעכטן','yesterday'],['פראבלעם','problem'],['גוטע נייעס','good news'],['היינט','today'],['קיין פראבלעם','no problem']],
  31:[['טשעק','check'],['צוועלף טויזנט דאלער','twelve thousand dollars'],['זעקל פון געלט','bag of money'],['גלייך','right away'],['פסח','Pesach']],
  32:[['טאכטער','daughter'],['שיינע חתונה','beautiful wedding'],['נאך פסח','after Pesach'],['חתן','chosson'],['גלייך','right away']],
  33:[['צופרידן','happy'],['מיר האבן גוטע נייעס','we have good news'],['גוטע נייעס','good news'],['גרויסע חתונה','big wedding'],['זלאטע דבורה','Zlata Devorah']],
  34:[['צוועלף טויזנט דאלער','twelve thousand dollars'],['טשעק','check'],['גאנצע מעשה','whole story'],['זעקל פון געלט','bag of money'],['שענסטן פסח','best Pesach'],['גיטל','Gitl'],['תלמיד חכם','Torah scholar'],['חתונה','wedding']],
  35:[['מענטשן','people'],['חתונה','wedding'],['מיסטער וויינמאן','Mr. Weinman'],['רב','Rav'],['מסדר קידושין','officiated the wedding'],['מזל טוב','Mazel tov']]
};
function storyParagraphs(g){
  const sec=config.sections[g],canonical=STORY_SECTION_PARAS[g]||[];
  const first=Number(sec?.first),last=Number(sec?.last);
  return canonical.filter(i=>i>=first&&i<=last&&C.paras[i]&&STORY_SUMMARIES[i]);
}
function storyClues(pIndex,para,g){
  const base=(STORY_CLUES[pIndex]||[]).filter(([yi])=>para.includes(yi)).map(([yi,en])=>({yi,en}));
  const learned=C.words.filter(w=>w.paragraph===pIndex&&w.group===g&&para.includes(w.yi)).map(w=>({yi:w.yi,en:w.en}));
  const out=[];
  for(const clue of [...base,...learned]){
    if(!out.some(x=>x.yi===clue.yi))out.push(clue);
  }
  return out.slice(0,8);
}
function storyExcerpt(para,clues,maxWords=30){
  const words=String(para||'').trim().split(/\s+/).filter(Boolean);
  if(words.length<=maxWords)return String(para||'').trim();
  let bestStart=0,bestScore=-1;
  for(let start=0;start<=words.length-maxWords;start++){
    const sample=words.slice(start,start+maxWords).join(' ');
    let score=0;
    for(const clue of clues){
      if(sample.includes(clue.yi))score+=1+Math.min(2,clue.yi.split(/\s+/).length*.25);
    }
    if(score>bestScore){bestScore=score;bestStart=start}
  }
  const chosen=words.slice(bestStart,bestStart+maxWords).join(' ');
  return (bestStart>0?'… ':'')+chosen+(bestStart+maxWords<words.length?' …':'');
}
function appendHighlightedText(el,text,terms){
  let pos=0;
  while(pos<text.length){
    let hit=null,at=-1;
    for(const term of terms){
      const i=text.indexOf(term,pos);
      if(i>=0&&(at<0||i<at||(i===at&&term.length>(hit||'').length))){at=i;hit=term}
    }
    if(at<0){el.append(document.createTextNode(text.slice(pos)));break}
    if(at>pos)el.append(document.createTextNode(text.slice(pos,at)));
    const mark=node('mark',hit,'story-key');el.append(mark);pos=at+hit.length;
  }
}
function speakEnglish(text){
  if(!('speechSynthesis'in window))return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text);u.lang='en-US';u.rate=.88;window.speechSynthesis.speak(u);
}
function storySpeaker(text,label='Listen to this answer'){
  const b=node('button','🔊','story-speak');b.type='button';b.title='Listen';b.setAttribute('aria-label',label);
  b.onclick=e=>{e.stopPropagation();speakEnglish(text)};return b;
}
function storyExit(box){
  const wrap=node('div','','story-topbar'),back=node('button','← Back to my words','story-exit');back.type='button';
  back.onclick=()=>{window.speechSynthesis?.cancel();storyQuiz=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;render();window.scrollTo({top:0,behavior:'smooth'})};
  wrap.append(back);box.append(wrap);
}
function recordStoryAnswer(pIndex,wrongCount){
  const payload={requestId:crypto.randomUUID(),group:storyQuiz.group,paragraph:pIndex,wrongCount,position:storyQuiz.idx+1,total:storyQuiz.ids.length};
  API.call('storyAnswer',payload).catch(e=>console.warn('Story Detective progress was not saved:',e.message));
}
$('storyQuizStart').onclick=()=>{
  if(busy||pending||!open(group))return;
  clearAdvance();round=null;flash=null;sentenceGame=null;soundGame=null;$('practice').hidden=true;$('flashcards').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;
  const ids=shuffleClient(storyParagraphs(group));
  storyQuiz={group,ids,idx:0,score:0,answered:false,wrong:new Set(),choices:null,choiceFor:null};
  storyQuizRender();focusStoryQuiz();
};
function storyChoices(correctIndex,g){
  const correct=STORY_SUMMARIES[correctIndex],sectionIds=storyParagraphs(g);
  const pool=sectionIds.filter(i=>i!==correctIndex).map(i=>({index:i,text:STORY_SUMMARIES[i]})).filter(x=>x.text&&x.text!==correct);
  const near=pool.filter(x=>Math.abs(x.index-correctIndex)<=4),chosen=[];
  for(const x of shuffleClient(near)){if(chosen.length<3)chosen.push(x.text)}
  for(const x of shuffleClient(pool)){if(chosen.length>=3)break;if(!chosen.includes(x.text))chosen.push(x.text)}
  return shuffleClient([correct,...chosen.slice(0,3)]);
}
function storyQuizRender(){
  const box=$('storyquiz');box.hidden=false;box.replaceChildren();$('words').hidden=true;$('toolbar').hidden=true;storyExit(box);
  if(!storyQuiz.ids.length){
    box.append(node('h2','Story Detective'),node('p','There are no story paragraphs set for this section yet.'));return;
  }
  if(storyQuiz.idx>=storyQuiz.ids.length){
    box.append(node('div','🔎','round-check'),node('h2','Story Detective complete!'),node('p',`You figured out ${storyQuiz.score} of ${storyQuiz.ids.length} paragraphs on the first try.`));
    const again=node('button','Play again');again.type='button';again.onclick=()=>{storyQuiz={group,ids:shuffleClient(storyParagraphs(group)),idx:0,score:0,answered:false,wrong:new Set(),choices:null,choiceFor:null};storyQuizRender();focusStoryQuiz()};
    box.append(again);focusStoryQuiz();return;
  }
  const pIndex=storyQuiz.ids[storyQuiz.idx],para=C.paras[pIndex],allClues=storyClues(pIndex,para,storyQuiz.group),excerpt=storyExcerpt(para,allClues),clues=allClues.filter(c=>excerpt.includes(c.yi)),keys=clues.map(c=>c.yi);
  box.append(node('div',`Story part ${storyQuiz.idx+1} of ${storyQuiz.ids.length}`,'practice-progress'),node('h2','What mainly happened here?'));
  const directions=storySpeaker('What mainly happened here? Read just this short Yiddish piece. Use the highlighted clues and the clue words box, then choose the main idea.','Hear the directions');directions.textContent='🔊 Hear directions';directions.className='story-directions';
  const hint=node('p','Read this short piece. Use the highlighted words and clue-word glossary.','story-hint');box.append(directions,hint);
  const reading=node('div','','story-reading-layout');
  const text=node('div','','story-para');text.lang='yi';text.dir='rtl';appendHighlightedText(text,excerpt,keys);
  const glossary=node('aside','','story-glossary');glossary.append(node('h3','Clue words'));
  for(const clue of clues){
    const row=node('div','','story-glossary-row'),yi=node('span',clue.yi,'story-glossary-yi'),en=node('span',clue.en,'story-glossary-en'),listen=storySpeaker(clue.en,'Hear '+clue.yi+' in English');
    yi.lang='yi';yi.dir='rtl';listen.className='story-glossary-speak';row.append(yi,en,listen);glossary.append(row);
  }
  reading.append(text,glossary);box.append(reading);
  const answers=node('div','','story-answers'),feedback=node('p','','story-feedback');feedback.setAttribute('role','status');
  const choices=storyQuiz.choices&&storyQuiz.choiceFor===pIndex?storyQuiz.choices:storyChoices(pIndex,storyQuiz.group);
  storyQuiz.choices=choices;storyQuiz.choiceFor=pIndex;
  for(const choice of choices){
    const row=node('div','','story-answer-row'),b=node('button',choice,'story-answer');b.type='button';
    if(storyQuiz.wrong.has(choice))b.disabled=true;
    b.onclick=()=>{
      if(storyQuiz.answered)return;
      const correct=choice===STORY_SUMMARIES[pIndex];
      if(correct){
        storyQuiz.answered=true;const wrongCount=storyQuiz.wrong.size;if(wrongCount===0)storyQuiz.score++;
        feedback.textContent='✓ Yes — that is the main point.';feedback.className='feedback-correct';
        answers.querySelectorAll('button').forEach(x=>x.disabled=true);recordStoryAnswer(pIndex,wrongCount);
        const next=node('button',storyQuiz.idx===storyQuiz.ids.length-1?'See my score →':'Next paragraph →','story-next');next.type='button';
        next.onclick=()=>{storyQuiz.idx++;storyQuiz.answered=false;storyQuiz.wrong=new Set();storyQuiz.choices=null;storyQuiz.choiceFor=null;storyQuizRender();focusStoryQuiz()};
        box.append(next);
      }else{
        storyQuiz.wrong.add(choice);b.disabled=true;feedback.textContent='Not this one. Use the highlighted Yiddish clues and try again.';feedback.className='feedback-wrong';
      }
    };
    row.append(b,storySpeaker(choice));answers.append(row);
  }
  box.append(answers,feedback);
  if(storyQuiz.answered){
    answers.querySelectorAll('button').forEach(x=>x.disabled=true);
    feedback.textContent='✓ Yes — that is the main point.';
    feedback.className='feedback-correct';
    const next=node('button',storyQuiz.idx===storyQuiz.ids.length-1?'See my score →':'Next paragraph →','story-next');next.type='button';
    next.onclick=()=>{storyQuiz.idx++;storyQuiz.answered=false;storyQuiz.wrong=new Set();storyQuiz.choices=null;storyQuiz.choiceFor=null;storyQuizRender();focusStoryQuiz()};
    box.append(next);
  }
  focusStoryQuiz();
}



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
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יי']},
    {raw:'ן'}
  ],
  'צוויי':[
    {raw:'צוו'},
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יי']}
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
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יי']},
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
    {raw:'יי',answer:'יַי',choices:['יַי','יֵי','יִי','יי']},
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
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יי']},
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
    {raw:'יי',answer:'יַי',choices:['יַי','יֵי','יִי','יי']},
    {raw:'עס',answer:'עֶס',choices:['עֶס','עַס','עָס','עְס']}
  ],
  'היינט':[
    {raw:'ה'},
    {raw:'יי',answer:'יַי',choices:['יַי','יֵי','יִי','יי']},
    {raw:'נט'}
  ],
  'גלייך':[
    {raw:'גל'},
    {raw:'יי',answer:'יַי',choices:['יַי','יֵי','יִי','יי']},
    {raw:'כ',answer:'כ',choices:['כ','כּ']}
  ],
  'קומען':[
    {raw:'קו',answer:'קוּ',choices:['קוּ','קוֹ','קוַ','קוְ']},
    {raw:'מע',answer:'מעֶ',choices:['מעֶ','מעַ','מעָ','מעְ']},
    {raw:'ן'}
  ],
  'שיינע':[
    {raw:'ש',answer:'שׁ',choices:['שׁ','שׂ','שָ','שְ']},
    {raw:'יי',answer:'יֵי',choices:['יֵי','יַי','יִי','יי']},
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
  return SOUND_PROFILES[w.yi]||[{raw:w.yi,answer:w.yi,choices:[w.yi]}];
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
  clearAdvance();round=null;flash=null;storyQuiz=null;sentenceGame=null;
  $('practice').hidden=true;$('flashcards').hidden=true;$('storyquiz').hidden=true;$('sentencegame').hidden=true;
  const ids=shuffleClient(lessonWords(group,part));
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
    const again=node('button','Build them again');again.type='button';again.onclick=()=>{soundGame.ids=shuffleClient(lessonWords(group,part));soundGame.wordIndex=0;soundResetWord();soundGameRender();focusSoundGame()};
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
  if(!soundGame.choiceOrder[orderKey])soundGame.choiceOrder[orderKey]=shuffleClient(part.choices);
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
  clearAdvance();round=null;flash=null;storyQuiz=null;soundGame=null;
  $('practice').hidden=true;$('flashcards').hidden=true;$('storyquiz').hidden=true;$('soundgame').hidden=true;
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

$('flashStart').onclick=()=>{
  if(busy||pending||!stepOpen(group,part))return;
  clearAdvance();round=null;storyQuiz=null;sentenceGame=null;soundGame=null;$('practice').hidden=true;$('storyquiz').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;
  flash={group,ids:shuffleClient(lessonWords(group,part)),idx:0,flipped:false};
  flashRender();focusFlash();
};
function flashRender(){
  const box=$('flashcards');box.hidden=false;box.replaceChildren();$('words').hidden=true;$('toolbar').hidden=true;
  if(flash.idx>=flash.ids.length){
    box.append(node('div','✓','round-check'),node('h2','Nice work!'),cheer(),node('p',`You went through all ${flash.ids.length} flashcards in this step.`));
    const again=node('button','Go again');again.type='button';again.onclick=()=>{flash={group,ids:shuffleClient(lessonWords(group,part)),idx:0,flipped:false};flashRender();focusFlash()};
    const back=node('button','Back to my words');back.type='button';back.style.marginLeft='10px';back.onclick=()=>{flash=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;window.scrollTo({top:0,behavior:'smooth'})};
    box.append(again,back);focusFlash();return;
  }
  const id=flash.ids[flash.idx],w=word(id);
  const flashTop=node('div','','sentence-topbar'),flashBackBtn=node('button','← Back to my words','sentence-exit');flashBackBtn.type='button';
  flashBackBtn.onclick=()=>{flash=null;box.hidden=true;$('words').hidden=false;$('toolbar').hidden=false;window.scrollTo({top:0,behavior:'smooth'})};
  flashTop.append(flashBackBtn);
  box.append(flashTop,node('div',`Card ${flash.idx+1} of ${flash.ids.length}`,'practice-progress'));
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
$('start').onclick=async()=>{if(busy||!stepOpen(group,part))return;clearAdvance();flash=null;storyQuiz=null;sentenceGame=null;soundGame=null;$('flashcards').hidden=true;$('storyquiz').hidden=true;$('sentencegame').hidden=true;$('soundgame').hidden=true;busy=true;$('start').disabled=true;try{message('');const s=await API.call('start',{group,part});round=s.round;pending=null;$('practice').hidden=false;question();focusPractice()}catch(e){message(e.message)}finally{busy=false;$('start').disabled=!open(group)}};
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
  if(API.preview){await refresh();if(!noStory)message('Teacher demonstration - practice stays in this tab.')}
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
