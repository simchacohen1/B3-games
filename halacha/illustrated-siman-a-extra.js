/* Fresh illustrated scenes for Kitzur Siman Aleph Seifim Beis–Zayin.
 * Additive only: no seed/reset/update of saved scrapbook pages or drawing keys.
 */
(function(){
'use strict';
const data={
 b:{file:'modeh-ani',title:'A New Morning',description:'I wake up and thank Hashem for returning my neshama.',stickers:[['bed-window','My bedroom'],['heart','Gratitude'],['book','Sefer']]},
 c:{file:'four-middos',title:'Four Middos for a Chayol',description:'I use courage, care, energy and a strong heart to serve Hashem.',stickers:[['heart','Courage'],['boy-walking','Run to a mitzvah'],['book','Learn the middos']]},
 d:{file:'zerizus',title:'Getting Up with Zerizus',description:'I can overcome excuses and start the day with energy.',stickers:[['bed-window','My bedroom'],['thought','My choice'],['boy-walking','Ready to go']]},
 e:{file:'night-learning',title:'Torah Learning at Night',description:'A quiet moment to learn with care and concentration.',stickers:[['lamp','Study lamp'],['book','Sefer'],['shtender','Shtender']]},
 a6:{file:'tehillim',title:'Reading Carefully from a Sefer',description:'I read Tehillim and pesukim carefully from the text.',stickers:[['book','Tehillim'],['shtender','Shtender'],['thought','Careful words']]},
 a7:{file:'shomea-tefillah',title:'Davening with Care',description:'I remember to use the correct words of the tefillah.',stickers:[['book','Sefer'],['heart','Tefillah'],['speech','My words']]}
};
const photos='art/seifim/';
const stickers='art/stickers/';
const cache='?v=20261019-alef-scenes2';
const esc=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const readonly=()=>typeof HALACHA_TEACHER_VIEW!=='undefined'&&!!HALACHA_TEACHER_VIEW;
const make=(tag,klass,text)=>{const e=document.createElement(tag);e.className=klass||'';if(text!==undefined)e.textContent=text;return e;};
function savePicture(id,url,label,sticker){
 if(readonly()||typeof window.add!=='function')return;
 const markup='<img alt="'+esc(label)+'" src="'+esc(url)+'">';
 const added=window.add(id,'photo',markup,0);
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
 const added=window.add(id,'textbox','<div class="tb-text" contenteditable="true">'+esc(words)+'</div>',0);
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
 const featured=make('figure','hal-extra-art-feature');
 const mainFile=photos+config.file+'.jpg'+cache;
 featured.append(picture(mainFile,config.title));
 const fig=make('figcaption','');
 fig.append(make('strong','',config.title),make('span','',config.description));
 const actions=make('div','hal-extra-art-actions');
 actions.append(
  button('＋ Use picture',()=>savePicture(id,mainFile,config.title,false),'Add '+config.title+' to scrapbook'),
  button('＋ Use words',()=>saveWords(id,config.description),'Add caption to scrapbook')
 );
 featured.append(fig,actions);row.appendChild(featured);
 const shelf=make('div','hal-extra-mini-shelf');
 shelf.appendChild(make('h4','', 'More pictures to decorate with'));
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
Object.keys(data).forEach(insert);
})();