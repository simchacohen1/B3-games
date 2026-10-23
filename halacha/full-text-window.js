/* "Full text" button for every Halacha lesson card: shows the whole seif in one large window,
   sized to fit the screen so nobody has to scroll. Read-only: it never changes lesson or saved data. */
(function(){
'use strict';
const css=document.createElement('style');
css.textContent=`
.ha-fulltext-btn{display:block;margin:6px auto 0;padding:6px 12px;border:1px solid #8bb8d3;border-radius:8px;background:#fff7d6;color:#174a78;font-weight:800;cursor:pointer;font:inherit;font-weight:800}
.ha-fulltext-btn:focus-visible{outline:3px solid #128cf0;outline-offset:2px}
.ha-ft-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(10,30,55,.72);display:flex;align-items:center;justify-content:center;padding:2vh 2vw}
.ha-ft-dialog{background:#fffef6;border:3px solid #eac657;border-radius:18px;width:96vw;height:94vh;max-width:1900px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px #0008;font-family:Trebuchet MS,Arial,sans-serif;color:#123b66}
.ha-ft-head{display:flex;align-items:center;gap:12px;background:#fff1c5;padding:10px 16px;border-bottom:2px solid #eac657}
.ha-ft-head h2{flex:1;margin:0;font-size:clamp(18px,2.2vw,26px);text-align:center}
.ha-ft-head button{border:3px solid #145daa;background:#0983ed;color:#fff;font:inherit;font-weight:900;border-radius:12px;padding:8px 16px;cursor:pointer;font-size:18px}
.ha-ft-head button:focus-visible{outline:3px solid #ffbf00;outline-offset:2px}
.ha-ft-body{flex:1;min-height:0;padding:2vh 3vw;direction:rtl;text-align:right;font-family:Arial,sans-serif;line-height:1.7;overflow:hidden;white-space:pre-wrap}
.ha-ft-word{display:inline;background:#ffee77;border:0;border-radius:6px;padding:0 5px;font:inherit;font-weight:800;color:#123b66;cursor:pointer;direction:rtl}
.ha-ft-word:nth-of-type(3n+1){background:#a5eaf7}.ha-ft-word:nth-of-type(3n+2){background:#ffc9e1}
.ha-ft-foot{border-top:2px solid #eac657;background:#effff0;padding:8px 18px;min-height:48px;font-size:clamp(16px,1.8vw,22px);display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
.ha-ft-foot .he{direction:rtl;font-weight:900;font-size:1.25em}
@media print{.ha-fulltext-btn,.ha-ft-backdrop{display:none!important}}
`;
document.head.append(css);
let opener=null;
function close(){
 const open=document.querySelector('.ha-ft-backdrop');if(open)open.remove();
 document.removeEventListener('keydown',onKey,true);
 if(opener&&document.contains(opener))opener.focus();
 opener=null;
}
function onKey(e){
 if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();return}
 if(e.key==='Tab'){ // keep keyboard focus inside the window
  const d=document.querySelector('.ha-ft-dialog');if(!d)return;
  const f=[...d.querySelectorAll('button')].filter(b=>!b.disabled);if(!f.length)return;
  const first=f[0],last=f[f.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
 }
}
// Make the text as large as possible while still fitting the window with no scrolling.
function fit(body){
 let size=Math.min(window.innerHeight*0.075,64);
 const min=16;
 body.style.fontSize=size+'px';
 while(size>min&&body.scrollHeight>body.clientHeight+1){size-=1;body.style.fontSize=size+'px'}
}
function openFor(card,button){
 close();
 opener=button;
 const source=card.querySelector('.ha-hebrew');if(!source)return;
 const heading=card.querySelector('.ha-mast h2');
 const title=heading?[...heading.childNodes].map(n=>n.textContent.trim()).filter(Boolean).join(' · '):'The Halacha';
 const back=document.createElement('div');back.className='ha-ft-backdrop';
 const dlg=document.createElement('div');dlg.className='ha-ft-dialog';dlg.setAttribute('role','dialog');dlg.setAttribute('aria-modal','true');dlg.setAttribute('aria-label','Full Halacha text');
 const head=document.createElement('div');head.className='ha-ft-head';
 const h=document.createElement('h2');h.textContent=title.replace(/\s+/g,' ').trim();
 const x=document.createElement('button');x.type='button';x.textContent='✕ Close';x.onclick=close;
 head.append(h,x);
 const body=document.createElement('div');body.className='ha-ft-body';body.lang='he';body.dir='rtl';
 const foot=document.createElement('div');foot.className='ha-ft-foot';foot.setAttribute('role','status');
 foot.textContent='Click a highlighted word to see its meaning.';
 // Copy the text; highlighted words stay clickable and show their meaning below.
 source.childNodes.forEach(node=>{
  if(node.nodeType===1&&node.classList.contains('ha-keyword')){
   const w=document.createElement('button');w.type='button';w.className='ha-ft-word';w.textContent=node.textContent;
   w.onclick=()=>{node.click();const he=card.querySelector('.ha-wordhe'),en=card.querySelector('.ha-worden');
    foot.replaceChildren();const a=document.createElement('span');a.className='he';a.lang='he';a.textContent=(he&&he.textContent)||w.textContent;
    const b=document.createElement('span');b.textContent=(en&&en.textContent)||'';foot.append(a,document.createTextNode(' — '),b)};
   body.append(w);
  }else body.append(document.createTextNode(node.textContent));
 });
 dlg.append(head,body,foot);back.append(dlg);
 back.addEventListener('mousedown',e=>{if(e.target===back)close()});
 document.body.append(back);
 document.addEventListener('keydown',onKey,true);
 fit(body);
 x.focus();
}
function install(){
 document.querySelectorAll('.ha-classroom .ha-halachacard').forEach(card=>{
  if(card.querySelector('.ha-fulltext-btn'))return;
  const toggle=card.querySelector('.ha-text-toggle');
  const b=document.createElement('button');b.type='button';b.className='ha-fulltext-btn';b.textContent='🔍 Full text in a big window';
  b.setAttribute('aria-haspopup','dialog');
  b.onclick=()=>openFor(card.closest('.ha-classroom'),b);
  if(toggle)toggle.after(b);else card.append(b);
 });
}
window.addEventListener('resize',()=>{const body=document.querySelector('.ha-ft-body');if(body)fit(body)});
install();
const holder=document.getElementById('sections');
if(holder)new MutationObserver(install).observe(holder,{childList:true,subtree:true});
})();
