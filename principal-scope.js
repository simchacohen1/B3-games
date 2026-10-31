/* Principal supervision derives teacher-equivalent class access from owner assignments.
 * A principal is NEVER an administrator. No grant exists without a supervised teacher.
 * This helper is shared by owner administration and Node regression tests.
 */
(function(root){
  'use strict';
  function principal(record){return !!record&&(record.accountType==='principal'||record.role==='principal');}
  function derive(invites,assignment,classes){
    const classIds={},supervisedTeachers={};
    const candidates=assignment&&assignment.supervisedTeacherIds||{};
    Object.keys(candidates).sort().forEach(id=>{
      if(candidates[id]!==true)return;
      const t=(invites||{})[id];
      if(!t||principal(t)||t.active===false)return;
      const ids=Object.keys(t.classIds||{}).filter(c=>
        c!=='*'&&/^[A-Za-z0-9_-]{1,100}$/.test(c)&&t.classIds[c]===true&&
        (!classes||classes[c]&&classes[c].active!==false)).sort();
      if(!ids.length)return;
      ids.forEach(id=>{classIds[id]=true;});
      supervisedTeachers[id]={name:String(t.name||t.email||id),classIds:Object.fromEntries(ids.map(c=>[c,true]))};
    });
    return {classIds,supervisedTeachers,active:Object.keys(classIds).length>0};
  }
  const api={principal,derive};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.B3PrincipalScope=api;
})(typeof window==='object'?window:globalThis);
