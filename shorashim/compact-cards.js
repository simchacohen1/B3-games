/* Preserve both faces, picture selection, drawing and the original save handler. */
(function(){
  'use strict';
  let flipper,button,lastKey=null,queued=false;
  const effects=[
    [{opacity:0,transform:'translateY(-45px)'},{opacity:1,transform:'translateY(10px)'},{transform:'translateY(-5px)'},{transform:'translateY(0)'}],
    [{opacity:0,transform:'translateX(-70px)'},{opacity:1,transform:'translateX(0)'}],
    [{opacity:0,transform:'translateX(70px)'},{opacity:1,transform:'translateX(0)'}],
    [{opacity:0,transform:'scale(.65)'},{opacity:1,transform:'scale(1.08)'},{transform:'scale(1)'}],
    [{opacity:0,transform:'translateY(35px) scale(.3)'},{opacity:1,transform:'translateY(-10px) scale(1.12)'},{transform:'translateY(0) scale(1)'}]
  ];
  function animate(){
    flipper.classList.remove('sc-flipped');
    flipper.getAnimations?.().forEach(a=>a.cancel());
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)
      flipper.animate(effects[Math.floor(Math.random()*effects.length)],{duration:650,easing:'ease-out'});
  }
  function fit(){
    const stage=flipper.parentElement;
    if(!stage.clientWidth)return;
    const size=Math.max(120,Math.min(stage.clientWidth-button.offsetWidth-20,Math.max(240,innerHeight*.43)*31/18,860));
    const width=Math.floor(size)+'px';if(flipper.style.width!==width)flipper.style.width=width;
    // The old fitting code changed the card width without updating its text.
    // Read the final width immediately, and again after fonts/layout settle.
    if(typeof scaleEditorCardContents==='function')scaleEditorCardContents();
  }
  function check(){
    const stage=document.querySelector('#learnWorkspace .flip-stage');
    if(!stage)return;
    if(!flipper){
      const front=document.getElementById('frontCard'),back=document.getElementById('backCard');
      if(!front||!back)return;
      flipper=document.createElement('div');flipper.className='sc-flipper';flipper.append(front,back);stage.append(flipper);
      button=document.createElement('button');button.type='button';button.className='sc-flip-btn';button.textContent='↔ Flip';button.setAttribute('aria-label','Flip the card');
      button.onclick=()=>{flipper.classList.toggle('sc-flipped');button.setAttribute('aria-pressed',String(flipper.classList.contains('sc-flipped')))};stage.append(button);
      new ResizeObserver(schedule).observe(stage);window.addEventListener('resize',schedule);
      document.getElementById('learnWorkspace').addEventListener('pointerdown',e=>{if(e.target.closest('.tool-columns,.ux-tool-tabs'))flipper.classList.remove('sc-flipped')},true);
      document.fonts?.ready.then(schedule);
    }
    const editor=document.getElementById('editorContent'),word=document.getElementById('hebrewText');
    if(editor.classList.contains('hidden')){lastKey=null;return}
    fit();
    const key=document.getElementById('editorTitle').textContent+'|'+word.textContent;
    if(word.textContent.trim()&&key!==lastKey){const first=lastKey===null;lastKey=key;if(first)flipper.classList.remove('sc-flipped');else animate()}
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;check()})}
  function boot(){check();new MutationObserver(schedule).observe(document.getElementById('learnWorkspace'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']})}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
