'use strict';
const APP_BUILD='2026-09-29-story-detective-v5-short-excerpts';
window.addEventListener('DOMContentLoaded',()=>{const b=document.createElement('div');b.textContent='build: '+APP_BUILD;b.style.cssText='position:fixed;bottom:6px;right:8px;font:11px monospace;color:#94a3a0;background:rgba(255,255,255,.85);padding:2px 6px;border-radius:6px;z-index:9999;pointer-events:none';document.body.appendChild(b)});
const C=window.YIDDISH_CONTENT,$=id=>document.getElementById(id),API=YiddishAPI;
let group=0,round=null,showAll=false,progress={},config=null,student=null,busy=false,pending=null,advanceTimer=null,flash=null,storyQuiz=null;
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
function clearAdvance(){if(advanceTimer){clearTimeout(advanceTimer);advanceTimer=null}}
function focusPractice(){requestAnimationFrame(()=>$('practice')?.scrollIntoView({behavior:'smooth',block:'start'}))}
function block(s){clearAdvance();$('lesson').hidden=true;$('practice').hidden=true;document.querySelectorAll('audio').forEach(a=>a.pause());message(s)}
function open(g){return config&&g<config.unlocked[student.classId]&&config.sections[g].verified}
function render(){
  if(!student||!config)return;
  if(!round&&!flash&&!storyQuiz){$('words').hidden=false;$('toolbar').hidden=false;}
  $('login').hidden=true;$('lesson').hidden=false;$('who').textContent=student.name+' · '+student.classId.toUpperCase();
  const ids=[...new Set(config.sections.flatMap(s=>s.words))];
  $('stats').textContent=`${ids.filter(id=>status(progress[id])==='Learned').length} learned · ${ids.filter(id=>status(progress[id])==='Practicing').length} practicing`;
  $('segments').replaceChildren();
  config.sections.forEach((s,i)=>{const b=node('button',`${open(i)?'':'🔒 '}Section ${i+1}`,i===group?'active':'');b.type='button';b.disabled=!open(i);b.onclick=()=>{if(busy||pending)return;clearAdvance();group=i;showAll=false;round=null;flash=null;storyQuiz=null;$('practice').hidden=true;$('flashcards').hidden=true;$('storyquiz').hidden=true;render()};$('segments').append(b)});
  $('words').replaceChildren();$('start').disabled=!open(group);$('flashStart').disabled=!open(group);$('storyQuizStart').disabled=!open(group);$('readStory').hidden=!open(group);$('readStory').href='story.html?section='+group;$('readStory').textContent='📖 Read the illustrated story — Section '+(group+1);
  $('title').textContent=showAll?'My vocabulary':`Section ${group+1} words`;
  const visible=showAll?config.sections.flatMap((s,i)=>open(i)?s.words:[]):open(group)?config.sections[group].words:[];
  for(const id of visible){const w=word(id);if(!w)continue;const card=node('article','','word'),st=status(progress[id]);card.append(node('span',st,'status '+st.toLowerCase()));const yi=node('div',w.yi,'yi');yi.lang='yi';card.append(yi,node('div',w.en));$('words').append(card)}
  if(!visible.length)$('words').append(node('p','Your teacher will open your next section soon.'));
  if(round&&open(round.group))question();
  if(flash&&open(flash.group))flashRender();else if(flash){flash=null}
  if(storyQuiz&&open(storyQuiz.group))storyQuizRender();else if(storyQuiz){storyQuiz=null}
}
async function refresh(){const s=await API.call('status');student=s.student;config=s.config;progress=s.progress;if(!open(group))group=Math.max(0,config.unlocked[student.classId]-1);round=(s.round&&!s.round.finished&&open(s.round.group))?s.round:null;if(round)group=round.group;render()}
async function login(id,pin){const s=await API.call('login',{studentId:id,pin:pin.trim()});sessionStorage.setItem('yiddishSession',s.token);await refresh();message('Progress connected ✓')}
$('loginForm').onsubmit=async e=>{e.preventDefault();$('signIn').disabled=true;try{await login($('name').value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''),$('pin').value);$('pin').value=''}catch(e){message(e.message)}finally{$('signIn').disabled=false}};
$('all').onclick=()=>{if(busy||pending)return;clearAdvance();showAll=!showAll;round=null;flash=null;storyQuiz=null;$('practice').hidden=true;$('flashcards').hidden=true;$('storyquiz').hidden=true;render()};
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
  clearAdvance();round=null;flash=null;$('practice').hidden=true;$('flashcards').hidden=true;
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
    b.onclick=()=>{
      if(storyQuiz.answered)return;
      const correct=choice===STORY_SUMMARIES[pIndex];
      if(correct){
        storyQuiz.answered=true;const wrongCount=storyQuiz.wrong.size;if(wrongCount===0)storyQuiz.score++;
        feedback.textContent='✓ Yes — that is the main point.';feedback.className='feedback-correct';
        answers.querySelectorAll('button').forEach(x=>x.disabled=true);recordStoryAnswer(pIndex,wrongCount);
        const next=node('button',storyQuiz.idx===storyQuiz.ids.length-1?'See my score →':'Next paragraph →','story-next');next.type='button';
        next.onclick=()=>{storyQuiz.idx++;storyQuiz.answered=false;storyQuiz.wrong=new Set();storyQuiz.choices=null;storyQuizRender();focusStoryQuiz()};
        box.append(next);
      }else{
        storyQuiz.wrong.add(choice);b.disabled=true;feedback.textContent='Not this one. Use the highlighted Yiddish clues and try again.';feedback.className='feedback-wrong';
      }
    };
    row.append(b,storySpeaker(choice));answers.append(row);
  }
  box.append(answers,feedback);focusStoryQuiz();
}

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
$('start').onclick=async()=>{if(busy)return;clearAdvance();busy=true;$('start').disabled=true;try{message('');const s=await API.call('start',{group});round=s.round;pending=null;$('practice').hidden=false;question();focusPractice()}catch(e){message(e.message)}finally{busy=false;$('start').disabled=!open(group)}};
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
