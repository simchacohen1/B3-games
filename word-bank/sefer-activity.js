(function(root){
 'use strict';
 const host=document.getElementById('vocabMatches'),status=document.getElementById('vocabStatus'),celebrate=document.getElementById('vocabCelebrate');let activeRef='',pairs=[],matched=new Set(),selected='';
 const norm=x=>String(x||'').replace(/[^\p{L}\p{N}]/gu,'');
 function collectDay(iso,refs){
  if(!root.FTTWordBank||!Array.isArray(refs))return;
  for(const ref of refs){const words=root.FTTSeferVocabulary.forRef(ref);root.FTTWordBank.collect({id:'sefer:'+ref,title:root.FTTSeferVocabulary.title(ref)+' · '+iso},words)}
 }
 function announce(text,good){status.textContent=text;status.classList.toggle('good',!!good)}
 function open(ref){
  activeRef=ref||'';matched=new Set();selected='';celebrate.textContent='';
  if(!host)return;
  pairs=activeRef?root.FTTSeferVocabulary.forRef(activeRef):[];
  host.replaceChildren();
  if(!pairs.length){announce(activeRef?'Vocabulary is being reviewed for this mitzvah.':'Choose a mitzvah card to see its words.',false);return}
  root.FTTWordBank&&root.FTTWordBank.collect({id:'sefer:'+activeRef,title:root.FTTSeferVocabulary.title(activeRef)},pairs);
  const shuffled=pairs.slice().sort(()=>Math.random()-.5);
  const shuffledEnglish=pairs.slice().sort(()=>Math.random()-.5);
  const englishById=new Map(shuffledEnglish.map(w=>[w.id,w]));
  for(const word of shuffled){
   const he=document.createElement('button');he.type='button';he.className='vocab-he';he.lang='he';he.dir='rtl';he.textContent=word.hebrew;he.dataset.word=word.id;he.setAttribute('aria-label','Hebrew word '+word.hebrew+'; choose its English meaning');
   he.ondragover=e=>e.preventDefault();he.ondrop=e=>{e.preventDefault();match(e.dataTransfer.getData('text/plain'),word.id,he)};
   he.onclick=()=>{if(selected)match(selected,word.id,he)};
   const enWord=englishById.get(word.id),en=document.createElement('button');en.type='button';en.className='vocab-en';en.textContent=enWord.english;en.dataset.word=word.id;en.draggable=true;en.onclick=()=>{selected=enWord.id;host.querySelectorAll('.vocab-en').forEach(x=>x.classList.toggle('selected',x===en));announce('Now tap its Hebrew word.',false)};en.ondragstart=e=>e.dataTransfer.setData('text/plain',enWord.id);
   host.append(he,en);
  }
  announce('Match each English meaning to the Hebrew word.',false);
 }
 function match(englishId,hebrewId,target){
  if(!englishId||matched.has(hebrewId))return;
  const right=englishId===hebrewId,button=host.querySelector('.vocab-en[data-word="'+CSS.escape(englishId)+'"]');
  if(!right){if(button){button.classList.add('bad');setTimeout(()=>button.classList.remove('bad'),500)}announce('Not quite. Try another word.',false);return}
  matched.add(hebrewId);target.classList.add('good');target.disabled=true;if(button){button.classList.add('good');button.classList.remove('selected');button.disabled=true}selected='';
  if(matched.size===pairs.length){announce('Fantastic! You matched every word! 🎉',true);celebrate.textContent='🌟 ⭐ 🎉 ⭐ 🌟';}
  else announce('That’s right! Keep going! ✓',true);
 }
 root.FTTSeferWordActivity={open,collectDay};
 // On first load, collect the currently displayed study day's words. Later date
 // changes are collected by the showDate hook in the Sefer HaMitzvos page.
 setTimeout(()=>{try{const iso=root.FTTMitzvahCalendar.studyToday(new Date(),root.FTTSunTimes);const lesson=root.FTTMitzvahCalendar.lesson(iso,root.FTT_MITZVAH_DAYS);collectDay(iso,lesson.mitzvos);if(lesson.mitzvos.length)open(lesson.mitzvos[0])}catch(_){ }},0);
})(typeof window==='object'?window:globalThis);
