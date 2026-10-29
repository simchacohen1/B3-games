(function(){
  const bank=window.FTTWordBank,$=id=>document.getElementById(id),listEl=$('wordList'),filterButtons=[...document.querySelectorAll('[data-filter]')],viewButtons=[...document.querySelectorAll('[data-view]')];
  let filter='all',view='words',mode='quiz',current=null,queue=[],queueIndex=0,answered=false,matchRows=[],matchDone=new Set(),selectedHe='',selectedEn='';
  const words=()=>bank.list(filter);
  function render(){
    const all=bank.list('all');$('collected').textContent=all.length;$('practiced').textContent=all.filter(w=>w.practiceCount>0).length;$('mastered').textContent=all.filter(w=>w.mastered).length;
    $('wordList').hidden=view!=='words';$('practice').hidden=view!=='practice';$('practiceQuiz').hidden=mode!=='quiz';$('practiceMatch').hidden=mode!=='match';document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
    const rows=words();listEl.replaceChildren();
    if(!rows.length){$('message').textContent='Your word list will grow when you open a Sefer HaMitzvos or Halacha lesson.';return}
    $('message').textContent='';
    for(const word of rows){const card=document.createElement('article');card.className='word-card';const he=document.createElement('div');he.className='hebrew';he.dir='rtl';he.lang='he';he.textContent=word.hebrew;const en=document.createElement('div');en.className='english';en.textContent=word.english;const source=document.createElement('div');source.className='lesson';source.textContent=(word.sources||[word.source]).map(x=>x==='halacha'?'Halacha':'Sefer HaMitzvos').join(' + ')+' · '+(word.lessons||[]).map(x=>x.title).filter(Boolean).join(', ');card.append(he,en,source);listEl.append(card)}
    if(view==='practice'){if(mode==='quiz')startPractice();else startMatching();}
  }
  function startPractice(){queue=words().slice().sort(()=>Math.random()-.5);queueIndex=0;answered=false;showQuestion()}
  function startMatching(){const own=words(),ownIds=new Set(own.map(w=>w.id)),extra=bank.list('all').filter(w=>!ownIds.has(w.id));matchRows=(bank.matchSet?bank.matchSet(own,extra,4,Math.max(6,own.length)):own).slice().sort(()=>Math.random()-.5);matchDone=new Set();selectedHe='';selectedEn='';drawMatching()}
  function drawMatching(){const he=$('matchHebrew'),en=$('matchEnglish');he.replaceChildren();en.replaceChildren();const fb=$('matchFeedback');fb.textContent='';fb.className='';if(!matchRows.length){fb.textContent='Open a lesson first to collect words to practice.';return}if(matchDone.size===matchRows.length){fb.textContent='🎉 Amazing! You matched every word!';fb.className='good';return}
    const left=matchRows.filter(w=>!matchDone.has(w.id)).slice().sort(()=>Math.random()-.5),right=left.slice().sort(()=>Math.random()-.5);
    for(const w of left){const b=document.createElement('button');b.className='word-choice hebrew-choice';b.lang='he';b.dir='rtl';b.textContent=w.hebrew;b.onclick=()=>{selectedHe=w.id;he.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));tryPair()};he.append(b)}
    for(const w of right){const b=document.createElement('button');b.className='word-choice';b.textContent=w.english;b.onclick=()=>{selectedEn=w.id;en.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));tryPair()};en.append(b)}
  }
  function tryPair(){if(!selectedHe||!selectedEn)return;const fb=$('matchFeedback');if(selectedHe===selectedEn){matchDone.add(selectedHe);bank.recordAnswer(selectedHe,true);fb.textContent='That’s right! ✓';fb.className='good';selectedHe='';selectedEn='';renderStats();setTimeout(drawMatching,450)}else{bank.recordAnswer(selectedHe,false);fb.textContent='Not quite. Try another match!';fb.className='try';renderStats();selectedHe='';selectedEn='';setTimeout(drawMatching,650)}}

  function showQuestion(){
    const q=$('question'),answers=$('answers');answers.replaceChildren();$('feedback').textContent='';$('feedback').className='';$('next').hidden=true;
    if(!queue.length){q.textContent='Open a lesson first to collect words to practice!';return}
    if(queueIndex>=queue.length){q.textContent='🎉 Great practice! You reviewed every word in this set.';return}
    current=queue[queueIndex];q.innerHTML='';const n=document.createElement('div');n.textContent='Match this word';const he=document.createElement('div');he.className='hebrew';he.lang='he';he.dir='rtl';he.textContent=current.hebrew;q.append(n,he);
    const choices=[current,...words().filter(w=>w.id!==current.id).sort(()=>Math.random()-.5).slice(0,3)].sort(()=>Math.random()-.5);
    for(const choice of choices){const b=document.createElement('button');b.textContent=choice.english;b.onclick=()=>answer(b,choice.id===current.id);answers.append(b)}
  }
  function answer(button,correct){if(answered)return;answered=true;const saved=bank.recordAnswer(current.id,correct);document.querySelectorAll('#answers button').forEach(b=>{b.disabled=true;if(b===button)b.classList.add(correct?'correct':'wrong')});const fb=$('feedback');fb.textContent=correct?'⭐ נכון! That’s right!':'Almost! The answer is: '+current.english;fb.className=correct?'good':'try';$('next').hidden=false;$('next').textContent=queueIndex===queue.length-1?'Finish 🎉':'Next Word ➜';renderStats();}
  function renderStats(){const all=bank.list('all');$('collected').textContent=all.length;$('practiced').textContent=all.filter(w=>w.practiceCount>0).length;$('mastered').textContent=all.filter(w=>w.mastered).length}
  filterButtons.forEach(b=>b.onclick=()=>{filter=b.dataset.filter;filterButtons.forEach(x=>x.classList.toggle('active',x===b));render()});
  viewButtons.forEach(b=>b.onclick=()=>{view=b.dataset.view;viewButtons.forEach(x=>x.classList.toggle('active',x===b));render()});
  document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render()});
  $('next').onclick=()=>{queueIndex++;answered=false;showQuestion();renderStats()};
  render();
  window.addEventListener('ftt-wordbank-synced',()=>{$('saveStatus').textContent='✓ Saved to your student account across devices.'});
  bank.sync().then(()=>render()).catch(error=>{const s=$('saveStatus');s.textContent='Saved on this device; account sync will retry when available.';console.warn('Word bank load failed:',error.message)});
})();
