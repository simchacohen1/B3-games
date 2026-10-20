(function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(classId,cls,catalog,ownerLegacy=false){
    const tools=Object.entries(catalog).filter(([id])=>window.B3StudentTools.studentActivities.includes(id)&&(ownerLegacy||window.B3StudentTools.granted(cls,id)));
    const seen=new Set(),choices=tools.filter(([id])=>{const canonical=window.B3StudentTools.aliases(id)[0];if(seen.has(canonical))return false;seen.add(canonical);return true;});
    const students=Object.entries(cls.members||{}).filter(([,m])=>m&&m.active!==false);
    if(!choices.length)return '';
    return '<details class="student-tool-controls" data-class="'+esc(classId)+'" style="margin-top:20px"><summary style="cursor:pointer;font-weight:bold">Student tool access</summary><p>Students keep their current tools unless you turn them off. You can assign only tools enabled by the administrator. Gallery and Tag share one entry.</p>'+students.map(([id,m])=>'<fieldset data-student="'+esc(id)+'" style="margin:12px 0;padding:14px;border:1px solid #cbd5e1;border-radius:10px"><legend>'+esc(m.name||id)+'</legend><div style="display:flex;flex-wrap:wrap;gap:14px">'+choices.map(([tool,[name]])=>'<label><input type="checkbox" data-tool="'+esc(tool)+'" '+(window.B3StudentTools.allowed(cls,id,tool)?'checked':'')+'> '+esc(name)+'</label>').join('')+'</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" data-choice="all">Select all</button><button type="button" data-choice="none">Clear all</button><button type="button" data-save>Save tools</button><span role="status" aria-live="polite"></span></div></fieldset>').join('')+(students.length?'':'<p>No active students in this class.</p>')+'</details>';
  }
  function bind(root){
    root.querySelectorAll('.student-tool-controls').forEach(panel=>panel.querySelectorAll('fieldset').forEach(row=>{
      const checks=()=>[...row.querySelectorAll('input[data-tool]')],status=row.querySelector('[role="status"]');
      row.querySelectorAll('[data-choice]').forEach(button=>button.onclick=()=>{checks().forEach(input=>input.checked=button.dataset.choice==='all');status.textContent='Press Save tools to apply.';});
      row.querySelector('[data-save]').onclick=async()=>{
        const buttons=[...row.querySelectorAll('button,input')];buttons.forEach(b=>b.disabled=true);status.textContent='Saving…';
        try{
          const user=firebase.auth().currentUser;if(!user)throw Error('Sign in with your teacher Google account.');
          const response=await fetch('https://us-central1-b3-games.cloudfunctions.net/funTorahManageStudents',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify({action:'studentTools',classId:panel.dataset.class,studentId:row.dataset.student,toolAccess:Object.fromEntries(checks().map(input=>[input.dataset.tool,input.checked]))})});
          const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Could not save tools.');
          status.textContent='Saved. Student access will update automatically.';
        }catch(error){status.textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}
      };
    }));
  }
  window.B3StudentToolControls={render,bind};
})();
