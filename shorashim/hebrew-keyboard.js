(function(){
  const LETTERS=['א','ב','ג','ד','ה','ו','ז','ח','ט','י','כ','ך','ל','מ','ם','נ','ן','ס','ע','פ','ף','צ','ץ','ק','ר','ש','ת'];
  const NIKUD=[['ְ','שְׁוָא'],['ֱ','חֲטַף סֶגוֹל'],['ֲ','חֲטַף פַּתַח'],['ֳ','חֲטַף קָמַץ'],['ִ','חִירִיק'],['ֵ','צֵירֵי'],['ֶ','סֶגוֹל'],['ַ','פַּתַח'],['ָ','קָמַץ'],['ֹ','חוֹלָם'],['ֻ','קֻבּוּץ'],['ּ','דָּגֵשׁ'],['ׁ','שִׁין'],['ׂ','שִׂין']];
  let target=null;
  const style=document.createElement('style');
  style.textContent=`
    .heb-kbd{display:none;margin:8px 0 14px;padding:10px;border:1.5px solid #d7cfbd;border-radius:14px;background:#fffaf0;box-shadow:0 8px 22px #00000012;direction:rtl}
    .heb-kbd.open{display:block}.heb-kbd-title{font-size:.78rem;font-weight:900;color:#665b47;margin:0 2px 7px;text-align:right}
    .heb-kbd-row{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px}.heb-kbd-row:last-child{margin-bottom:0}
    .heb-key{min-width:34px;height:36px;padding:3px 8px;border:1px solid #d8d0bf;border-radius:8px;background:white;font-size:1.2rem;line-height:1;cursor:pointer}
    .heb-key:hover{background:#fff2c7;border-color:#b99928}.heb-key.nikud{font-size:1.45rem;min-width:38px}.heb-key.action{font-size:.78rem;font-weight:800;direction:ltr}
    #tFront,#tWord{direction:rtl;text-align:right;font-size:1.2rem}
  `;
  document.head.appendChild(style);

  const kbd=document.createElement('div'); kbd.className='heb-kbd'; kbd.id='hebrewEditKeyboard';
  const makeKey=(text,value,cls='',title='')=>`<button type="button" class="heb-key ${cls}" data-value="${value}" title="${title}">${text}</button>`;
  kbd.innerHTML=`<div class="heb-kbd-title">מקלדת עברית ונקודות — click letters or nekudos to insert</div>
    <div class="heb-kbd-row">${LETTERS.map(x=>makeKey(x,x)).join('')}</div>
    <div class="heb-kbd-row">${NIKUD.map(([x,n])=>makeKey(x,x,'nikud',n)).join('')}${makeKey('Space',' ','action')}${makeKey('⌫','BACKSPACE','action','Backspace')}</div>`;

  function insertValue(value){
    if(!target)return;
    target.focus();
    let start=target.selectionStart??target.value.length, end=target.selectionEnd??start;
    if(value==='BACKSPACE'){
      if(start!==end){target.value=target.value.slice(0,start)+target.value.slice(end);end=start;}
      else if(start>0){
        const before=target.value.slice(0,start); const chars=Array.from(before); chars.pop();
        const newBefore=chars.join(''); target.value=newBefore+target.value.slice(end); start=end=newBefore.length;
      }
    }else{
      target.value=target.value.slice(0,start)+value+target.value.slice(end); start=end=start+value.length;
    }
    target.setSelectionRange(start,end); target.dispatchEvent(new Event('input',{bubbles:true}));
  }
  kbd.addEventListener('mousedown',e=>e.preventDefault());
  kbd.addEventListener('click',e=>{const b=e.target.closest('[data-value]');if(b)insertValue(b.dataset.value)});

  function attach(){
    const dialog=document.getElementById('teacherCatalogDialog');
    const wordWrap=document.getElementById('tWordWrap');
    if(!dialog||!wordWrap)return;
    wordWrap.insertAdjacentElement('afterend',kbd);
    ['tFront','tWord'].forEach(id=>{
      const el=document.getElementById(id); if(!el)return;
      el.addEventListener('focus',()=>{target=el;kbd.classList.add('open')});
      el.addEventListener('click',()=>{target=el;kbd.classList.add('open')});
    });
    dialog.addEventListener('close',()=>{kbd.classList.remove('open');target=null});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',attach); else attach();
})();
