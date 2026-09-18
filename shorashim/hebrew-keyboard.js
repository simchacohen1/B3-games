(function(){
  const LETTERS=['א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ך','ל','מ','ם','נ','ן','ס','ע','פ','ף','צ','ץ','ק','ר','ש','ת'];
  const NIKUD=[['ְ','שְׁוָא'],['ֱ','חֲטַף סֶגוֹל'],['ֲ','חֲטַף פַּתַח'],['ֳ','חֲטַף קָמַץ'],['ִ','חִירִיק'],['ֵ','צֵירֵי'],['ֶ','סֶגוֹל'],['ַ','פַּתַח'],['ָ','קָמַץ'],['ֹ','חוֹלָם'],['ֻ','קֻבּוּץ'],['ּ','דָּגֵשׁ'],['ׁ','שִׁין'],['ׂ','שִׂין']];
  let target=null;
  const style=document.createElement('style');
  style.textContent=`
    .heb-kbd{display:none;position:fixed;z-index:100000;padding:10px;border:1.5px solid #d7cfbd;border-radius:12px;background:#fffaf0;box-shadow:0 10px 30px #0003;direction:rtl;max-width:min(720px,calc(100vw - 20px));box-sizing:border-box}
    .heb-kbd.open{display:block}.heb-kbd-title{font-size:.78rem;font-weight:900;color:#665b47;margin:0 2px 7px;text-align:right}
    .heb-kbd-row{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px}.heb-kbd-row:last-child{margin-bottom:0}
    .heb-key{min-width:34px;height:36px;padding:3px 8px;border:1px solid #d8d0bf;border-radius:8px;background:white;font-size:1.2rem;line-height:1;cursor:pointer}
    .heb-key:hover{background:#fff2c7;border-color:#b99928}.heb-key.nikud{font-size:1.45rem;min-width:38px}.heb-key.action{font-size:.78rem;font-weight:800;direction:ltr}
    #tFront,#tWord{direction:rtl;text-align:right;font-size:1.2rem}
  `;
  document.head.appendChild(style);
  const kbd=document.createElement('div'); kbd.className='heb-kbd'; kbd.id='hebrewEditKeyboard';
  const key=(text,value,cls='',title='')=>`<button type="button" class="heb-key ${cls}" data-value="${value}" title="${title}">${text}</button>`;
  kbd.innerHTML=`<div class="heb-kbd-title">מקלדת עברית ונקודות</div><div class="heb-kbd-row">${LETTERS.map(x=>key(x,x)).join('')}</div><div class="heb-kbd-row">${NIKUD.map(([x,n])=>key(x,x,'nikud',n)).join('')}${key('Space',' ','action')}${key('⌫','BACKSPACE','action','Backspace')}</div>`;
  document.body.appendChild(kbd);
  function place(){
    if(!target||!kbd.classList.contains('open'))return;
    const r=target.getBoundingClientRect(), gap=6, margin=10;
    kbd.style.width=Math.min(Math.max(r.width,560),window.innerWidth-margin*2)+'px';
    kbd.style.left='0px';kbd.style.top='0px';
    const kr=kbd.getBoundingClientRect();
    let left=Math.min(Math.max(margin,r.left),window.innerWidth-kr.width-margin);
    let top=r.bottom+gap;
    if(top+kr.height>window.innerHeight-margin && r.top-kr.height-gap>=margin) top=r.top-kr.height-gap;
    else top=Math.min(top,window.innerHeight-kr.height-margin);
    kbd.style.left=Math.round(left)+'px';kbd.style.top=Math.round(Math.max(margin,top))+'px';
  }
  function show(el){target=el;kbd.classList.add('open');requestAnimationFrame(place)}
  function insertValue(value){
    if(!target)return; target.focus();
    let start=target.selectionStart??target.value.length,end=target.selectionEnd??start;
    if(value==='BACKSPACE'){
      if(start!==end){target.value=target.value.slice(0,start)+target.value.slice(end);end=start;}
      else if(start>0){const chars=Array.from(target.value.slice(0,start));chars.pop();const before=chars.join('');target.value=before+target.value.slice(end);start=end=before.length;}
    }else{target.value=target.value.slice(0,start)+value+target.value.slice(end);start=end=start+value.length;}
    target.setSelectionRange(start,end);target.dispatchEvent(new Event('input',{bubbles:true}));place();
  }
  kbd.addEventListener('mousedown',e=>e.preventDefault());
  kbd.addEventListener('click',e=>{const b=e.target.closest('[data-value]');if(b)insertValue(b.dataset.value)});
  function attach(){
    const dialog=document.getElementById('teacherCatalogDialog');
    ['tFront','tWord'].forEach(id=>{const el=document.getElementById(id);if(el){el.addEventListener('focus',()=>show(el));el.addEventListener('click',()=>show(el));el.addEventListener('keyup',place)}});
    if(dialog)dialog.addEventListener('close',()=>{kbd.classList.remove('open');target=null});
    window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach);else attach();
})();
