/* Siman Aleph, complete seifim ב–ז supplied by teacher. Separate learning, original source closed until requested. */
(function(){
'use strict';
const src=window.HalachaSimanAExtraSource;
if(!Array.isArray(src)||src.length!==6)return;
const lessons={
 b:{no:2,title:'Modeh Ani & a New Morning',intro:'We thank Hashem for returning our neshama.',phrases:[
  ['מוֹדֶה אֲנִי לְפָנֶיךָ','I thank You'],
  ['בְּחֶמְלָה, רַבָּה אֱמוּנָתֶךָ','with compassion; great is Your faithfulness']],
  idea:'I thank Hashem for a new day.'},
 c:{no:3,title:'Four Middos to Serve Hashem',intro:'Our eyes, legs and hearts can help us do what is right.',phrases:[
  ['עַז כַּנָּמֵר','bold as a leopard'],['קַל כַּנֶּשֶׁר','light as an eagle'],['רָץ כַּצְּבִי','swift as a deer'],['גִבּוֹר כָּאֲרִי','strong as a lion']],idea:'I can be strong to do a mitzvah.'},
 d:{no:4,title:'Get Up with Zerizus',intro:'Overcome excuses and begin the day ready to serve Hashem.',phrases:[
  ['יָקוּם בִּזְרִיזוּת','get up promptly'],['וְהַבָּא לִטָּהֵר','one who comes to purify himself']],idea:'I will get up with zerizus.'},
 e:{no:5,title:'Learning at Night',intro:'The Kitzur discusses Tikun Chatzos and the value of Torah at night.',phrases:[
  ['תִּקּוּן חֲצוֹת','midnight prayers'],['מִשְׁנָה אוֹתִיּוֹת נְשָׁמָה','Mishnah shares the letters of neshama'],['וְטוֹב מְעַט בְּכַוָּנָה','a little with concentration is better']],idea:'I can learn Torah with concentration.'},
 a6:{no:6,title:'Pesukim & Tehillim by Heart',intro:'Know when we should read unfamiliar pesukim from a sefer.',phrases:[
  ['אָסוּר לְאָמְרָם בְּעַל פֶּה','must not recite them by heart'],['וְסוּמָא מֻתָּר','the exception for a blind person']],idea:'I read pesukim carefully.'},
 a7:{no:7,title:'Shomea Tefillah',intro:'Be careful to say the correct words at the end of the tefillah.',phrases:[
  ['בָּרוּךְ שׁוֹמֵעַ תְּפִלָּה','Blessed is the One who hears prayer'],['בְּלֹא שֵׁם','without Hashem’s Name']],idea:'I am careful with the words of davening.'}
};
const names=['','א','ב','ג','ד','ה','ו','ז'];
const mk=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e;};
const enc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readonly=()=>typeof HALACHA_TEACHER_VIEW!=='undefined'&&!!HALACHA_TEACHER_VIEW;
function copy(id,txt,hebrew){
 if(readonly()||typeof window.add!=='function')return;
 const extra=hebrew?' lang="he" dir="rtl"':'';
 const e=window.add(id,'textbox','<div class="tb-text" contenteditable="true"'+extra+'>'+enc(txt)+'</div>');
 if(e){e.classList.add('hal-a-extra-text');e.style.width='265px';if(typeof window.persist==='function')window.persist(id);}
}
function sourceP(p,txt,phrases){
 let matched=[];
 phrases.forEach(([word],i)=>{const n=txt.indexOf(word);if(n>=0)matched.push({at:n,end:n+word.length,i})});
 matched.sort((a,b)=>a.at-b.at);let cur=0;
 for(const h of matched){if(h.at<cur)continue;p.appendChild(document.createTextNode(txt.slice(cur,h.at)));const m=mk('mark','hal-b-source-highlight',txt.slice(h.at,h.end));m.dataset.phrase=String(h.i);m.title='Important phrase from this seif';p.appendChild(m);cur=h.end;}
 p.appendChild(document.createTextNode(txt.slice(cur)));
}
function install(id){
 const config=lessons[id],section=document.getElementById(id);
 if(!config||!section||section.querySelector('.hal-a-extra-guide'))return;
 const work=section.querySelector('.work');if(!work)return;
 const panel=mk('section','hal-b-guide hal-a-extra-guide');
 const bar=mk('div','hal-b-top');
 bar.appendChild(mk('h2','','סִימָן א׳ · סְעִיף '+names[config.no]));
 const jump=mk('button','hal-b-jump','🎨 Scrapbook');jump.type='button';
 jump.addEventListener('click',()=>work.scrollIntoView({behavior:'smooth',block:'start'}));
 const hide=mk('button','hal-b-hide','Hide lesson');hide.type='button';
 hide.setAttribute('aria-expanded','true');
 hide.addEventListener('click',()=>{const hidden=panel.classList.toggle('hal-b-hidden');hide.textContent=hidden?'Show lesson':'Hide lesson';hide.setAttribute('aria-expanded',String(!hidden));});
 bar.append(jump,hide);panel.appendChild(bar);
 const body=mk('div','hal-b-inner');
 body.appendChild(mk('p','hal-b-intro',config.title+'. '+config.intro));
 const reading=mk('details','hal-b-seif-source');
 reading.appendChild(mk('summary','','📖 Full original Kitzur text — click to read'));
 const p=mk('p','hal-b-hebrew');p.dir='rtl';p.lang='he';
 sourceP(p,src[config.no-2],config.phrases);
 reading.appendChild(p);body.appendChild(reading);
 body.appendChild(mk('h3','','Important phrases from this סעיף'));
 const cards=mk('div','hal-b-phrases');
 for(const [word,meaning] of config.phrases){
  const card=mk('div','hal-b-phrase-card'),heading=mk('strong','',word);
  heading.lang='he';heading.dir='rtl';
  card.append(heading,mk('span','hal-b-meaning',meaning));
  const buttons=mk('div','hal-b-phrase-actions');
  const find=mk('button','hal-b-find','🔎 Find in the seif');
  find.type='button';find.addEventListener('click',()=>{reading.open=true;const mark=[...p.querySelectorAll('mark')].find(m=>m.textContent===word);if(mark){mark.scrollIntoView({behavior:'smooth',block:'center'});mark.classList.add('hal-b-source-found');setTimeout(()=>mark.classList.remove('hal-b-source-found'),1800);}});
  const add=mk('button','hal-b-copy','＋ Put in scrapbook');add.type='button';add.disabled=readonly();add.addEventListener('click',()=>copy(id,word,true));
  buttons.append(find,add);card.appendChild(buttons);cards.appendChild(card);
 }
 body.appendChild(cards);
 const makeIdea=mk('button','hal-b-title','＋ Add an idea to scrapbook');
 makeIdea.type='button';makeIdea.disabled=readonly();makeIdea.addEventListener('click',()=>copy(id,config.idea,false));body.appendChild(makeIdea);
 panel.appendChild(body);section.insertBefore(panel,work);
}
const previousRender=render;
render=function(lesson){previousRender(lesson);if(lesson&&lessons[lesson.id])install(lesson.id);};
for(const id of Object.keys(lessons))install(id);
})();
