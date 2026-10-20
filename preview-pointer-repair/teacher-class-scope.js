(function(root){
'use strict';
const WS='b3-2026',validKey=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const fail=message=>{throw Object.assign(new Error(message),{code:403})};
async function roster(get,access,selected,tool='chazara'){
 if(!access?.authorized)fail('Teacher sign-in required.');
 const owner=access.role==='admin';
 if(selected&&!validKey(selected))fail('Choose a valid class.');
 if(!owner&&selected&&!(access.classIds||[]).includes(selected))fail('This class is not assigned to your teacher account.');
 const ids=selected?[selected]:owner?['et','wt']:(access.classIds||[]);
 if(!owner&&ids.length!==1)fail('Choose a class from your teacher dashboard.');
 const result={students:{},classes:{},selected:selected||(!owner?ids[0]:''),owner};
 for(const classId of ids){
  const cls=await get('b3Games/workspaces/'+WS+'/classes/'+classId);
  if(!cls||cls.active===false||(!owner&&cls.toolGrants?.[tool]!==true))fail('This class or tool is not available to your account.');
  result.classes[classId]={name:cls.name||classId};
  for(const [id,member] of Object.entries(cls.members||{})){
   if(!validKey(id)||member?.active===false)continue;
   const profile=await get('b3Games/students/'+id+'/profile');
   if(profile?.active===false)continue;
   const memberships=await get('b3Games/students/'+id+'/memberships')||{};
   const activeIds=Object.values(memberships).filter(m=>m?.active!==false&&m?.workspaceId===WS&&validKey(m.classId)).map(m=>m.classId);
   if(Object.keys(memberships).length&&!activeIds.includes(classId))continue;
   result.students[id]={name:profile?.name||member?.name||id,classId,className:cls.name||classId,membershipClassIds:activeIds};
  }
 }
 return result;
}
function recordAllowed(scope,studentId,record){
 const student=scope.students[studentId];if(!student||!record)return false;
 if(scope.owner&&!scope.selected)return true;
 const classId=record.workspaceClassId||record.sourceClassId||record.classId;
 if(classId)return classId===student.classId||classId==='b3_'+student.classId;
 return ['et','wt'].includes(student.classId)||student.membershipClassIds.length===1;
}
const api={roster,recordAllowed,validKey};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FunTorahTeacherScope=api;
})(typeof window==='undefined'?globalThis:window);
