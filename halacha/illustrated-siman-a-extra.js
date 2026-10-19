
/* More illustrated Halacha lessons. All pictures are optional and NEVER replace saved scrapbook work. */
(function(){
'use strict';
const stickers='art/stickers/', scenes='art/scenes/',v='?v=20261019-chabad1';
const packs={
 b:{title:'מודה אני · A New Morning',cards:[['מוֹדֶה אֲנִי לְפָנֶיךָ','bed-window','The first words of our morning'],['בְּחֶמְלָה','heart','With compassion'],['רַבָּה אֱמוּנָתֶךָ','lamp','A bright new day'],['הוֹדָאָה','house','I thank Hashem']]},
 c:{title:'ארבע מידות · Four Middos',cards:[['עַז כַּנָּמֵר','🐆','Bold like a leopard'],['קַל כַּנֶּשֶׁר','🦅','Light like an eagle'],['רָץ כַּצְּבִי','🦌','Swift like a deer'],['גִּבּוֹר כָּאֲרִי','🦁','Strong like a lion']]},
 d:{title:'זריזות · Get Up with Energy',cards:[['יָקוּם בִּזְרִיזוּת','bed-window','Get up promptly'],['הִתְגַּבְּרוּת','boy-walking','Overcome excuses'],['לַעֲבוֹדַת ה׳','shtender','Ready for mitzvos'],['מִצְוָה','@helping','Help others']]},
 e:{title:'לימוד תורה בלילה · Night Learning',cards:[['תִּקּוּן חֲצוֹת','lamp','The time of night'],['תּוֹרָה','book','Learn Torah'],['מִשְׁנָה','shtender','Learn Mishnah'],['בְּכַוָּנָה','@learning','Learn with care']]},
 a6:{title:'פסוקים בעל פה · Read Carefully',cards:[['פְּסוּקִים','book','Read from a sefer when needed'],['בְּעַל פֶּה','thought','Know what may be said by heart'],['מִן הַסֵּפֶר','shtender','Use the printed words'],['בִּזְהִירוּת','@learning','Read every word carefully']]},
 a7:{title:'שומע תפילה · The Words of Tefillah',cards:[['שׁוֹמֵעַ תְּפִלָּה','book','Be careful in tefillah'],['בְּלֹא שֵׁם','thought','Do not add Hashem’s Name'],['בְּכַוָּנָה','heart','Say each word carefully'],['דִּבּוּר','@speaking','Speak respectfully']]},
 f:{title:'נעגל וואסער · Morning Washing',cards:[['נֶעגֶל וַאסֶער','bed-window','Prepare before bedtime'],['נְטִילַת יָדַיִם','lamp','Wash in the morning'],['רוּחַ רָעָה','thought','Remember the reason'],['בֹּקֶר','house','A new day']]}
};
const mk=(tag,cls,tx)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(tx!==undefined)e.textContent=tx;return e};
const enc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readonly=()=>typeof HALACHA_TEACHER_VIEW!=='undefined'&&!!HALACHA_TEACHER_VIEW;
const src=k=>(k[0]==='@'?scenes+k.slice(1):stickers+k)+'.jpg'+v;
function art(card){
 const key=card[1];if(key.length<=3){const e=mk('span','hal-extra-animal',key);e.setAttribute('role','img');e.setAttribute('aria-label',card[2]);return e}
 const e=mk('img','hal-extra-picture');e.src=src(key);e.alt=card[2];e.loading='lazy';return e;
}
function addCard(id,card,page=0,words=false){
 if(readonly()||typeof window.add!=='function')return null;
 const html=words?'<div class="tb-text" contenteditable="true" lang="he" dir="rtl">'+enc(card[0])+'</div>':card[1].length<=3?
  '<span class="hal-extra-animal-on-page" role="img" aria-label="'+enc(card[2])+'">'+enc(card[1])+'</span>':
  '<img src="'+src(card[1])+'" alt="'+enc(card[2])+'">';
 const e=window.add(id,words?'textbox':'photo',html,page);
 if(e){e.classList.add(words?'hal-extra-words':'hal-extra-piece');e.style.width=words?'175px':'150px';window.persist&&window.persist(id)}
 return e;
}
function starter(id,pack,status){
 const sec=document.getElementById(id);if(!sec||readonly())return;
 if(sec.querySelector('.scrap[data-extra-template]')){status.textContent='Starter page already present. Add more pictures individually.';return;}
 const pages=[...sec.querySelectorAll('.page')],hasPieces=pages.some(p=>p.querySelector('.canvas .scrap'));
 if(hasPieces&&!confirm('Keep the existing artwork and add a new illustrated starter?'))return;
 const title=addCard(id,[pack.title,'heart','Title'],0,true);
 if(title){title.dataset.extraTemplate='1';title.style.left='75px';title.style.top='25px';title.style.width='290px'}
 pack.cards.forEach((card,i)=>{
   const pg=i<2?0:1,col=i%2;
   const art=addCard(id,card,pg,false);
   if(art){art.dataset.extraTemplate='1';art.style.left=col===0?'245px':'35px';art.style.top='145px'}
   const words=addCard(id,card,pg,true);
   if(words){words.dataset.extraTemplate='1';words.style.left=col===0?'232px':'25px';words.style.top='355px'}
 });
 window.persist&&window.persist(id);status.textContent='Illustrated page added ✓ Your earlier artwork is preserved.';
}
function install(id){
 const pack=packs[id],sec=document.getElementById(id);
 if(!pack||!sec||sec.querySelector('[data-hal-extra-gallery]'))return;
 const work=sec.querySelector('.work');if(!work)return;
 const gallery=mk('section','hal-extra-gallery');gallery.dataset.halExtraGallery='1';
 gallery.append(mk('h3','','🖼 Illustrated pictures for this סעיף'),mk('p','hal-extra-explain','Hebrew reading order starts on the right. Tap Picture or Hebrew to add to your scrapbook.'));
 const grid=mk('div','hal-extra-grid');grid.dir='rtl';
 const status=mk('span','hal-extra-status','');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 pack.cards.forEach(card=>{
   const tile=mk('figure','hal-extra-tile'),picture=mk('div','hal-extra-visual');picture.appendChild(art(card));
   const cap=mk('figcaption',''),he=mk('strong','',card[0]);he.dir='rtl';he.lang='he';
   const english=mk('span','',card[2]);english.dir='ltr';cap.append(he,english);
   const actions=mk('div','hal-extra-actions');
   for(const [label,isWords] of [['＋ Picture',false],['＋ Hebrew',true]]){
     const b=mk('button','',label);b.type='button';b.disabled=readonly();
     b.addEventListener('click',()=>{addCard(id,card,0,isWords);status.textContent=(isWords?'Hebrew':'Picture')+' added ✓';});actions.appendChild(b);
   }
   tile.append(picture,cap,actions);grid.appendChild(tile);
 });
 gallery.appendChild(grid);
 const foot=mk('div','hal-extra-foot'),start=mk('button','hal-extra-make','✨ Make an illustrated starter page');
 start.type='button';start.disabled=readonly();start.addEventListener('click',()=>starter(id,pack,status));foot.append(start,status);gallery.appendChild(foot);
 const host=sec.querySelector('.hal-a-extra-guide .hal-b-inner');
 if(host)host.insertBefore(gallery,host.querySelector('.hal-b-seif-source'));
 else sec.insertBefore(gallery,work);
}
const oldRender=render;render=function(l){oldRender(l);if(l&&packs[l.id])install(l.id);};
Object.keys(packs).forEach(install);
})();