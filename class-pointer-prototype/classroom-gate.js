'use strict';
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
