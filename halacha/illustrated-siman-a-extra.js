/* Fresh illustrated scenes for Kitzur Siman Aleph Seifim Beis–Zayin.
 * Additive only: no seed/reset/update of saved scrapbook pages or drawing keys.
 */
(function(){
'use strict';
const data={
 b:{file:'modeh-ani',title:'A New Morning',description:'I wake up and thank Hashem for returning my neshama.',stickers:[['bed-window','My bedroom'],['heart','Gratitude'],['book','Sefer']],scenes:[
  ['alone','A Quiet Thank You','I can begin the day thinking about the gift of another morning.'],
  ['speaking','Kind Words','I can speak politely and say thank you.'],
  ['helping','Show Gratitude','Thankfulness inspires me to help others.'],
  ['walking','Begin a Good Day','I am ready to do mitzvos today.']]},
 c:{file:'four-middos',title:'Four Middos for a Chayol',description:'I use courage, care, energy and a strong heart to serve Hashem.',stickers:[['heart','Courage'],['boy-walking','Run to a mitzvah'],['book','Learn the middos']],scenes:[
  ['walking','Run Like a Deer','I move quickly when it is time to do a mitzvah.'],
  ['learning','Strong in Torah','I work hard and stay focused when I learn.'],
  ['helping','Brave to Do Good','I use my strength to help someone.'],
  ['speaking','Choose Courage','I can stand up for what is right.']]},
 d:{file:'zerizus',title:'Getting Up with Zerizus',description:'I can overcome excuses and start the day with energy.',stickers:[['bed-window','My bedroom'],['thought','My choice'],['boy-walking','Ready to go']],scenes:[
  ['walking','Get Moving','When it is time for a mitzvah, I start promptly.'],
  ['alone','Beat the Excuse','Even when no one is watching, I choose to do the right thing.'],
  ['helping','Do It Now','I help instead of putting things off.'],
  ['learning','Ready to Learn','I begin learning without delay.']]},
 e:{file:'night-learning',title:'Torah Learning at Night',description:'A quiet moment to learn with care and concentration.',stickers:[['lamp','Study lamp'],['book','Sefer'],['shtender','Shtender']],scenes:[
  ['learning','Precious Torah Time','I learn carefully and give Torah my attention.'],
  ['alone','Quiet Focus','A quiet moment is a chance to think and learn.'],
  ['speaking','Share a Torah Thought','I can tell someone something meaningful I learned.'],
  ['helping','Use Time Well','I try to fill my day with good deeds.']]},
 a6:{file:'tehillim',title:'Reading Carefully from a Sefer',description:'I read Tehillim and pesukim carefully from the text.',stickers:[['book','Tehillim'],['shtender','Shtender'],['thought','Careful words']],scenes:[
  ['learning','Read from Inside','I look carefully inside a sefer when reading.'],
  ['speaking','Say Each Word','I pay attention to the words I say.'],
  ['alone','Take My Time','I can slow down to read accurately.'],
  ['helping','Practice Together','Learning with a friend can help us read correctly.']]},
 a7:{file:'shomea-tefillah',title:'Davening with Care',description:'I remember to use the correct words of the tefillah.',stickers:[['book','Sefer'],['heart','Tefillah'],['speech','My words']],scenes:[
  ['speaking','Careful Words','I choose the right words when I daven.'],
  ['alone','Focus on Tefillah','I take a quiet moment to think about my tefillah.'],
  ['learning','Look Inside','I check the correct wording in a sefer.'],
  ['helping','A Thoughtful Heart','I try to carry the care of davening into the day.']]}
};
const photos='art/seifim/';
const stickers='art/stickers/';
const cache='?v=20261019-two-fixed-pictures5';
const esc=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const readonly=()=>typeof HALACHA_TEACHER_VIEW!=='undefined'&&!!HALACHA_TEACHER_VIEW;
const make=(tag,klass,text)=>{const e=document.createElement(tag);e.className=klass||'';if(text!==undefined)e.textContent=text;return e;};
function savePicture(id,url,label,sticker){
 if(readonly()||typeof window.add!=='function')return;
 const markup='<img alt="'+esc(label)+'" src="'+esc(url)+'">';
 const added=window.add(id,'photo',markup,typeof window.studioTarget==='function'?window.studioTarget(id):0);
 if(!added)return;
 added.classList.add('hal-illustrated-piece','studio-sticker');
 if(sticker)added.classList.add('clear');
 added.style.width=sticker?'130px':'185px';
 if(typeof window.persist==='function')window.persist(id);
 const status=document.querySelector('#'+id+' .hal-extra-art-status');
 if(status)status.textContent='Added '+label+' to my scrapbook ✓';
}
function saveWords(id,words){
 if(readonly()||typeof window.add!=='function')return;
 const added=window.add(id,'textbox','<div class="tb-text" contenteditable="true">'+esc(words)+'</div>',typeof window.studioTarget==='function'?window.studioTarget(id):0);
 if(!added)return;
 added.style.width='240px';
 if(typeof window.persist==='function')window.persist(id);
 const status=document.querySelector('#'+id+' .hal-extra-art-status');
 if(status)status.textContent='Added words to my scrapbook ✓';
}
function button(text,action,label){
 const b=make('button','hal-extra-art-button',text);b.type='button';b.disabled=readonly();b.setAttribute('aria-label',label||text);b.addEventListener('click',action);return b;
}
function picture(url,alt){
 const img=make('img','hal-extra-image');img.src=url;img.alt=alt;img.loading='lazy';img.decoding='async';return img;
}
function insert(id) {
 const config=data[id],section=document.getElementById(id);
 if(!config||!section||section.querySelector('.hal-extra-illustrations'))return;
 const guide=section.querySelector('.hal-a-extra-guide .hal-b-inner');
 if(!guide)return;
 const panel=make('section','hal-extra-illustrations');
 panel.setAttribute('aria-label','Illustrated learning and scrapbook pictures for this seif');
 const head=make('div','hal-extra-art-heading');
 const title=make('h3','', '🖼 Pictures from this סעיף');
 const caption=make('p','', 'Choose a picture or words to use on your scrapbook pages.');
 head.append(title,caption);panel.appendChild(head);
 const row=make('div','hal-extra-art-layout');
 const gallery=make('div','hal-extra-scene-grid');
 const scenes=[{url:photos+config.file+'.jpg'+cache,title:config.title,description:config.description}].concat(
   config.scenes.map(([file,title,description])=>({url:'art/scenes/'+file+'.jpg?v=20261019-chabad1',title,description}))
 );
 // Five illustrated story cards for every seif, matching the first seif.
 scenes.forEach(scene=>{
   const card=make('figure','hal-extra-scene-card');
   card.appendChild(picture(scene.url,scene.title+': '+scene.description));
   const fig=make('figcaption','');
   fig.append(make('strong','',scene.title),make('span','',scene.description));
   const actions=make('div','hal-extra-art-actions');
   actions.append(
    button('＋ Picture',()=>savePicture(id,scene.url,scene.title,false),'Add '+scene.title+' picture to scrapbook'),
    button('＋ Words',()=>saveWords(id,scene.description),'Add '+scene.title+' words to scrapbook')
   );
   card.append(fig,actions);
   gallery.appendChild(card);
 });
 row.appendChild(gallery);
 const shelf=make('details','hal-extra-mini-shelf');
 shelf.appendChild(make('summary','', 'More pictures to decorate with'));
 const grid=make('div','hal-extra-mini-grid');
 config.stickers.forEach(([name,label])=>{
   const url=stickers+name+'.jpg?v=20261019-chabad1';
   const b=make('button','hal-extra-mini');
   b.type='button';b.disabled=readonly();
   b.append(picture(url,''),make('span','',label));
   b.setAttribute('aria-label','Add '+label+' image to scrapbook');
   b.addEventListener('click',()=>savePicture(id,url,label,true));
   grid.appendChild(b);
 });
 shelf.appendChild(grid);row.appendChild(shelf);panel.appendChild(row);
 const status=make('p','hal-extra-art-status','');
 status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 panel.appendChild(status);
 guide.insertBefore(panel,guide.firstChild);
}
// The account may rebuild every lesson after the initial page load.
 // Reattach the professional pictures every time each section is rendered.
const previousRender = render;
render = function (lesson) {
  previousRender(lesson);
  if (lesson && data[lesson.id]) insert(lesson.id);
};
Object.keys(data).forEach(insert);
})();