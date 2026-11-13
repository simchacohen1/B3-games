'use strict';
// Passcode gate — must pass before dashboard check.
(function(){
  const KEY='ftt_teacher_gate_v1';
  async function sha256(str){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
  async function check(){
    if(sessionStorage.getItem(KEY)==='1')return;
    document.documentElement.style.visibility='hidden';
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
    overlay.innerHTML='<div style="background:#fff;border-radius:18px;padding:36px 32px 28px;max-width:320px;width:90%;text-align:center;box-shadow:0 8px 40px #0005"><div style="font-size:2.2rem;margin-bottom:8px">🔒</div><h2 style="margin:0 0 6px;font-size:1.3rem;color:#1a1a2e">Teacher access only</h2><p style="margin:0 0 18px;font-size:.9rem;color:#555">Enter the teacher passcode to continue.</p><input id="fttGateInput" type="password" placeholder="Passcode" autocomplete="off" style="width:100%;box-sizing:border-box;padding:11px 14px;border:2px solid #ddd;border-radius:10px;font-size:1rem;margin-bottom:10px;outline:none"><button id="fttGateBtn" style="width:100%;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer">Enter</button><div id="fttGateErr" style="margin-top:10px;color:#dc2626;font-size:.88rem;min-height:1.2em"></div></div>';
    document.body?document.body.appendChild(overlay):(document.documentElement.appendChild(overlay));
    document.documentElement.style.visibility='visible';
    const input=overlay.querySelector('#fttGateInput'),btn=overlay.querySelector('#fttGateBtn'),err=overlay.querySelector('#fttGateErr');
    input.focus();
    async function attempt(){const h=await sha256(input.value.trim()),correct=await sha256('teacherb35787');if(h===correct){sessionStorage.setItem(KEY,'1');overlay.remove();}else{err.textContent='Incorrect passcode. Try again.';input.value='';input.focus();}}
    btn.addEventListener('click',attempt);input.addEventListener('keydown',e=>{if(e.key==='Enter')attempt();});
  }
  if(document.body)check();else document.addEventListener('DOMContentLoaded',check);
})();

// Runs first on classroom.html. Class Pointer must be opened from the Fun Torah Tools dashboard:
// ?dashboard=teacher (teacher, no room) or ?dashboard=student&room=<id> (student).
// Otherwise stop loading the page (so no other script runs) and show a way back.
(function(){
  const params=new URL(location.href).searchParams;
  const room=params.get('room'),entry=params.get('dashboard');
  const allowed=room?entry==='student':entry==='teacher';
  if(allowed){window.ClassPointerBlocked=false;return;}
  window.ClassPointerBlocked=true;
  console.warn('Class Pointer must be opened from the Fun Torah Tools dashboard (missing or invalid dashboard/room link).');
  try{window.stop();}catch(_){}
  const root=document.documentElement;
  let body=document.body;
  if(!body){body=document.createElement('body');root.appendChild(body);}
  body.replaceChildren();
  body.style.cssText='margin:0;background:#f4f7fb;color:#172033';
  const main=document.createElement('main');
  main.style.cssText='max-width:520px;margin:12vh auto;padding:2rem;background:#fff;border-radius:16px;box-shadow:0 8px 28px #0f172a22;font:1rem/1.5 system-ui,sans-serif;text-align:center';
  const h=document.createElement('h1');h.textContent='Open Class Pointer from Fun Torah Tools';h.style.cssText='font-size:1.4rem;margin:0 0 .6rem';
  const p=document.createElement('p');p.textContent='This page needs a link from the dashboard, so it can tell which class you are in. Your link may be old or incomplete. Please go back and open Class Pointer again.';
  const go=document.createElement('a');go.href='../index.html';go.textContent='Go to Fun Torah Tools dashboard';
  go.style.cssText='display:inline-block;margin-top:.8rem;padding:12px 20px;border-radius:10px;background:#2563eb;color:#fff;font-weight:700;text-decoration:none';
  const t=document.createElement('p');t.style.cssText='margin:1.2rem 0 0;font-size:.9rem';
  const tl=document.createElement('a');tl.href='dashboard.html?teacher=1';tl.textContent='Teachers: open Class Pointer';
  t.appendChild(tl);
  main.append(h,p,go,t);
  body.appendChild(main);
  document.title='Class Pointer';
})();
