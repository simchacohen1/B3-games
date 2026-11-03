/* Siman Beis illustrated seif-by-seif lesson. Additive; saved pages remain untouched. */
(function(){
'use strict';
const DATA={
 1:{title:'Wake Up Ready for a New Day',cards:[['🌅','A Fresh Morning','We wake up like a new person, thankful for a new day.'],['🚰','Prepare to Wash','Wash hands promptly when waking up.'],['👐','Three Times Alternating','Pour on each hand alternately three times.'],['✨','A Holy Beginning','Start the morning ready to serve Hashem.']]},
 2:{title:'Tzitzis in the Morning',cards:[['👕','My Tallis Katan','Put on the tallis katan when getting dressed.'],['🧵','Look at the Tzitzis','Notice the special strings on the four corners.'],['☀️','Begin the Day','Remember this mitzvah in the morning.']]},
 3:{title:'Right Hand, Left Hand',cards:[['🤚','Start with the Right','Use the right hand to take the vessel.'],['↔️','Change Hands','Move the vessel to the left hand to pour on the right.'],['🫗','Pour in Order','Continue the alternating order carefully.'],['🔁','Repeat Three Times','Wash right and left, alternating three times.']]},
 4:{title:'Where the Water Goes',cards:[['🥣','Use a Vessel','Pour the washing water into a suitable vessel.'],['💧','Treat Water Carefully','Do not leave the used water where people walk.'],['🚫','Avoid Splashing','Keep the used water away from others.']]},
 5:{title:'Before Washing',cards:[['🙌','Hands First','Before washing, avoid touching the places mentioned in the seif.'],['👀','Be Careful','Remember the special care needed before netilas yadayim.'],['🚰','Then Wash','Wash first, then carry on with the morning.']]},
 6:{title:'How to Wash Properly',cards:[['🏺','A Washing Cup','Choose a suitable keli for washing.'],['💦','Clean Water','Use appropriate water.'],['🫗','Pour by Hand','Pour the water with your own action.'],['✅','Follow the Halachos','Learn the conditions of proper netilah.']]},
 7:{title:'The Bracha on Washing',cards:[['👐','Wash Your Hands','Complete the morning washing.'],['📜','Al Netilas Yadayim','Learn when to say the bracha on washing.'],['🙏','Say a Bracha With Kavanah','Pay attention to the words of the bracha.']]},
 8:{title:'When There Is a Doubt',cards:[['❔','A Question Comes Up','What if you are unsure about the washing?'],['📖','Learn the Rule','Read this seif carefully to understand the special case.'],['👨‍🏫','Ask Your Teacher','Do not guess when you are unsure about a practical halacha.']]},
 9:{title:'Other Times We Wash',cards:[['✂️','After Cutting Nails','Learn the rule for washing after cutting nails.'],['🚿','Other Situations','See the full list in the original seif.'],['👐','Remember to Wash','Practice recognizing when washing is needed.'],['📚','Find Each Example','Match the example to the wording of the seif.']]}
};
const GROUPS={s2a:[1,2],s2b:[3,4,5],s2c:[6,7,8],s2d:[9]};
const HEB=['','א','ב','ג','ד','ה','ו','ז','ח','ט'];
const style=document.createElement('style');
style.textContent=`
.hal2-visual{margin:14px 0 18px}.hal2-visual>h3{font-size:21px;color:#173b62;margin:10px 0}
.hal2-seif{border:1px solid #bad1e4;background:#f7fbff;border-radius:15px;padding:13px;margin:14px 0}
.hal2-seif h4{margin:0 0 11px;color:#173b62;font-size:19px}
.hal2-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:11px}
.hal2-card{border:1px solid #d2e2e9;border-radius:13px;background:white;box-shadow:0 3px 12px #1b466010;overflow:hidden;display:flex;flex-direction:column}
.hal2-scene{background:linear-gradient(140deg,#fff2d5,#d9f0ff);min-height:115px;display:grid;place-items:center;font-size:69px;line-height:1.2;padding:13px}
.hal2-caption{padding:10px 11px;flex:1}.hal2-caption strong{display:block;font-size:15px;color:#163d63}.hal2-caption p{margin:6px 0 0;font-size:13px;line-height:1.4}
.hal2-actions{display:flex;gap:5px;padding:7px 9px 10px}.hal2-actions button{flex:1;min-width:0;border:1px solid #9fbfd4;border-radius:8px;background:#eef8ff;padding:7px 4px;font-size:12px;font-weight:bold}
.hal2-actions button:disabled{opacity:.5;cursor:not-allowed}
.hal2-note{font-size:12px;color:#526b7e;margin:6px 0 0}
@media(max-width:650px){.hal2-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.hal2-scene{font-size:48px;min-height:90px}}
`;
document.head.appendChild(style);
function node(tag,cls,txt){const el=document.createElement(tag);if(cls)el.className=cls;if(txt!=null)el.textContent=txt;return el;}
function readonly(){return typeof HALACHA_TEACHER_VIEW!=='undefined'&&!!HALACHA_TEACHER_VIEW;}
function safe(s){return String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
function save(id,type,html,width){if(readonly()||typeof window.add!=='function')return;const piece=window.add(id,type,html,0);if(piece){piece.style.width=width+'px';if(typeof window.persist==='function')window.persist(id);}}
function install(id){
 const sec=document.getElementById(id), guide=sec&&sec.querySelector('.hal-b-inner');
 if(!guide||guide.querySelector('.hal2-visual'))return;
 const host=node('section','hal2-visual');host.setAttribute('aria-label','Illustrated examples for every seif');
 host.appendChild(node('h3','','🖼️ Picture Examples — Each Seif'));
 for(const n of GROUPS[id]||[]){
  const data=DATA[n],wrap=node('section','hal2-seif'),heading=node('h4','','סעיף '+HEB[n]+' — '+data.title);
  wrap.appendChild(heading);const grid=node('div','hal2-cards');
  for(const [symbol,title,desc] of data.cards){
   const card=node('article','hal2-card'),pic=node('div','hal2-scene',symbol);pic.setAttribute('role','img');pic.setAttribute('aria-label',title);
   const label=node('div','hal2-caption');label.append(node('strong','',title),node('p','',desc));
   const acts=node('div','hal2-actions'),addPic=node('button','','＋ Picture'),addText=node('button','','＋ Words');
   addPic.type=addText.type='button';addPic.disabled=addText.disabled=readonly();
   addPic.addEventListener('click',()=>save(id,'textbox','<div class="tb-text" contenteditable="true" style="font-size:72px;text-align:center">'+safe(symbol)+'</div>',150));
   addText.addEventListener('click',()=>save(id,'textbox','<div class="tb-text" contenteditable="true">'+safe(title+': '+desc)+'</div>',245));
   acts.append(addPic,addText);card.append(pic,label,acts);grid.appendChild(card);
  }
  wrap.appendChild(grid);host.appendChild(wrap);
 }
 host.appendChild(node('p','hal2-note','These pictures are memory aids. Read the full Hebrew seif below for its exact halachos.'));
 const source=guide.querySelector('.hal-b-sources');if(source)guide.insertBefore(host,source.previousElementSibling||source);else guide.prepend(host);
}
const oldRender=render;
render=function(lesson){oldRender(lesson);if(lesson&&GROUPS[lesson.id])install(lesson.id);};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>Object.keys(GROUPS).forEach(install),{once:true});
else Object.keys(GROUPS).forEach(install);
})();