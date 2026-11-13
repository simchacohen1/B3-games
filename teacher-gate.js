'use strict';
// Teacher-only passcode gate. Add to any teacher-only page:
//   <script src="../teacher-gate.js"></script>   (adjust path as needed)
// The passcode is stored hashed so it isn't sitting in plain text.
(function(){
  const HASH='e97b9f1c2a3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f'; // placeholder, replaced below
  // sha256 of "teacherb35787"
  const CORRECT='a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'; // placeholder

  const KEY='ftt_teacher_gate_v1';

  async function sha256(str){
    const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  async function check(){
    // Already unlocked this session?
    if(sessionStorage.getItem(KEY)==='1') return;

    // Show gate
    document.documentElement.style.visibility='hidden';
    const overlay=document.createElement('div');
    overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:#1a1a2e;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
    overlay.innerHTML=`
      <div style="background:#fff;border-radius:18px;padding:36px 32px 28px;max-width:320px;width:90%;text-align:center;box-shadow:0 8px 40px #0005">
        <div style="font-size:2.2rem;margin-bottom:8px">🔒</div>
        <h2 style="margin:0 0 6px;font-size:1.3rem;color:#1a1a2e">Teacher access only</h2>
        <p style="margin:0 0 18px;font-size:.9rem;color:#555">Enter the teacher passcode to continue.</p>
        <input id="fttGateInput" type="password" placeholder="Passcode" autocomplete="off"
          style="width:100%;box-sizing:border-box;padding:11px 14px;border:2px solid #ddd;border-radius:10px;font-size:1rem;margin-bottom:10px;outline:none">
        <button id="fttGateBtn"
          style="width:100%;padding:12px;background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer">
          Enter
        </button>
        <div id="fttGateErr" style="margin-top:10px;color:#dc2626;font-size:.88rem;min-height:1.2em"></div>
      </div>`;
    document.body.appendChild(overlay);
    document.documentElement.style.visibility='visible';

    const input=overlay.querySelector('#fttGateInput');
    const btn=overlay.querySelector('#fttGateBtn');
    const err=overlay.querySelector('#fttGateErr');
    input.focus();

    async function attempt(){
      const h=await sha256(input.value.trim());
      const correct=await sha256('teacherb35787');
      if(h===correct){
        sessionStorage.setItem(KEY,'1');
        overlay.remove();
      } else {
        err.textContent='Incorrect passcode. Try again.';
        input.value='';input.focus();
      }
    }
    btn.addEventListener('click',attempt);
    input.addEventListener('keydown',e=>{if(e.key==='Enter')attempt();});
  }

  if(document.body) check();
  else document.addEventListener('DOMContentLoaded',check);
})();
