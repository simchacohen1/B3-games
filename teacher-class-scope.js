(function(root){
'use strict';
const WS='b3-2026',validKey=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const fail=message=>{throw Object.assign(new Error(message),{code:403})};
async function roster(get,access,selected,tool='chazara'){
 if(!access?.authorized)fail('Teacher sign-in required.');
 const owner=access.role==='admin';
 if(selected&&!validKey(selected))fail('Choose a valid class.');
 if(!owner&&selected&&!(access.classIds||[]).includes(selected))fail('This class is not assigned to your teacher account.');
 let ids=selected?[selected]:(access.classIds||[]);
 if(owner&&!selected){
  const all=await get('b3Games/workspaces/'+WS+'/classes')||{};
  ids=Object.keys(all).filter(id=>validKey(id)&&all[id]&&all[id].active!==false).sort();
 }
 if(!owner&&ids.length!==1)fail('Choose a class from your teacher dashboard.');
 const result={students:{},classes:{},selected:selected||(!owner?ids[0]:''),owner};
 // Fetch all selected class documents together; a teacher normally has one,
 // while an owner can choose several classes.
 const classRows=await Promise.all(ids.map(async classId=>[classId,await get('b3Games/workspaces/'+WS+'/classes/'+classId)]));
 for(const [classId,cls] of classRows){
  if(!cls||cls.active===false||(!owner&&cls.toolGrants?.[tool]!==true))fail('This class or tool is not available to your account.');
  result.classes[classId]={name:cls.name||classId};
 }
 const candidates=[];
 for(const [classId,cls] of classRows)for(const [id,member] of Object.entries(cls.members||{})){
  if(validKey(id)&&member?.active!==false)candidates.push({id,member,classId,cls});
 }
 const details=await Promise.all(candidates.map(async row=>{
  const [profile,memberships]=await Promise.all([
   get('b3Games/students/'+row.id+'/profile'),
   get('b3Games/students/'+row.id+'/memberships')
  ]);
  return {...row,profile,memberships:memberships||{}};
 }));
 for(const {id,member,classId,cls,profile,memberships} of details){
  if(profile?.active===false)continue;
  const activeIds=Object.values(memberships).filter(m=>m?.active!==false&&m?.workspaceId===WS&&validKey(m.classId)).map(m=>m.classId);
  if(Object.keys(memberships).length&&!activeIds.includes(classId))continue;
  result.students[id]={name:profile?.name||member?.name||id,classId,className:cls.name||classId,membershipClassIds:activeIds};
 }
 return result;
}
function recordAllowed(scope,studentId,record){
 const student=scope.students[studentId];if(!student||!record)return false;
 if(scope.owner&&!scope.selected)return true;
 const classId=record.workspaceClassId||record.sourceClassId||record.classId;
 if(classId)return classId===student.classId||classId==='b3_'+student.classId;
 // Classless legacy records can only be attributed when exactly one verified
 // membership exists, regardless of the class name. Ambiguous records must
 // be backfilled with class provenance before a teacher can modify them.
 const memberships=Array.isArray(student.membershipClassIds)?student.membershipClassIds:[];
 return memberships.length===1&&memberships[0]===student.classId;
}
const api={roster,recordAllowed,validKey};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FunTorahTeacherScope=api;
})(typeof window==='undefined'?globalThis:window);
