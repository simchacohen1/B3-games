(function(root){
'use strict';
const WS='b3-2026',validKey=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const fail=message=>{throw Object.assign(new Error(message),{code:403})};
// Students and classes are many-to-many: a student can be in several classes and
// a teacher can have several classes. `selected` limits the roster to one class.
// With no selection the owner gets every active class; a teacher gets all of
// their own classes only when the caller asks for it with {allowAll:true}
// (Chazara's "All my classes"). Backend callers never pass it, so every server
// action stays limited to one chosen class.
async function roster(get,access,selected,tool='chazara',options={}){
 if(!access?.authorized)fail('Teacher sign-in required.');
 const owner=access.role==='admin';
 if(selected&&!validKey(selected))fail('Choose a valid class.');
 if(!owner&&selected&&!(access.classIds||[]).includes(selected))fail('This class is not assigned to your teacher account.');
 let ids=selected?[selected]:[...new Set((access.classIds||[]).filter(id=>validKey(id)))].sort();
 if(owner&&!selected){
  const all=await get('b3Games/workspaces/'+WS+'/classes')||{};
  ids=Object.keys(all).filter(id=>validKey(id)&&all[id]&&all[id].active!==false).sort();
 }
 const allMine=!owner&&!selected&&options?.allowAll===true;
 if(!owner&&(allMine?!ids.length:ids.length!==1))fail('Choose a class from your teacher dashboard.');
 const result={students:{},classes:{},selected:selected||(!owner&&!allMine?ids[0]:''),owner};
 // Fetch all selected class documents together.
 const classRows=await Promise.all(ids.map(async classId=>[classId,await get('b3Games/workspaces/'+WS+'/classes/'+classId)]));
 for(const [classId,cls] of classRows){
  if(!cls||cls.active===false||(!owner&&cls.toolGrants?.[tool]!==true)){
   // In "all my classes" a class without this tool is skipped, not fatal.
   if(allMine)continue;
   fail('This class or tool is not available to your account.');
  }
  result.classes[classId]={name:cls.name||classId};
 }
 if(allMine&&!Object.keys(result.classes).length)fail('This class or tool is not available to your account.');
 const candidates=[];
 for(const [classId,cls] of classRows)if(result.classes[classId])for(const [id,member] of Object.entries(cls.members||{})){
  if(validKey(id)&&member?.active!==false)candidates.push({id,member,classId,cls});
 }
 // One profile/membership read per student, even when they are in several classes.
 const unique=[...new Set(candidates.map(row=>row.id))];
 // Stricter database rules may not let a teacher's browser read a student's profile or
 // whole membership list (a student can also be in another teacher's class). Only when the
 // caller passes {partialMemberships:true} is a refused read tolerated: the roster then
 // reads just the memberships for its own classes and marks the list as incomplete, so
 // nothing is decided from memberships it could not see. Backend callers never pass it.
 const tolerant=options?.partialMemberships===true;
 const loaded=Object.fromEntries(await Promise.all(unique.map(async id=>{
  const [profile,memberships]=await Promise.all([
   get('b3Games/students/'+id+'/profile').catch(error=>{if(tolerant)return null;throw error;}),
   get('b3Games/students/'+id+'/memberships').then(rows=>({rows:rows||{},complete:true}),async error=>{
    if(!tolerant)throw error;
    const rows={};
    await Promise.all(candidates.filter(row=>row.id===id).map(async({classId})=>{
     try{const row=await get('b3Games/students/'+id+'/memberships/'+WS+'_'+classId);if(row)rows[WS+'_'+classId]=row;}catch(denied){}
    }));
    return {rows,complete:false};
   })
  ]);
  return [id,{profile,memberships:memberships.rows,complete:memberships.complete}];
 })));
 for(const {id,member,classId,cls} of candidates){
  const {profile,memberships,complete}=loaded[id];
  if(profile?.active===false)continue;
  const activeIds=Object.values(memberships).filter(m=>m?.active!==false&&m?.workspaceId===WS&&validKey(m.classId)).map(m=>m.classId);
  if(Object.keys(memberships).length&&!activeIds.includes(classId))continue;
  const existing=result.students[id];
  if(existing){
   // Same student in another class of this roster: keep every class, never overwrite.
   if(!existing.classIds.includes(classId)){existing.classIds.push(classId);existing.classNames.push(cls.name||classId);}
   continue;
  }
  result.students[id]={name:profile?.name||member?.name||id,classId,className:cls.name||classId,classIds:[classId],classNames:[cls.name||classId],membershipClassIds:complete?activeIds:null};
 }
 return result;
}
function recordAllowed(scope,studentId,record){
 const student=scope.students[studentId];if(!student||!record)return false;
 if(scope.owner&&!scope.selected)return true;
 // Every class of this roster the student is in (one when a class is selected).
 const inScope=Array.isArray(student.classIds)&&student.classIds.length?student.classIds:[student.classId];
 const classId=record.workspaceClassId||record.sourceClassId||record.classId;
 if(classId)return inScope.some(id=>classId===id||classId==='b3_'+id);
 // Classless legacy records can only be attributed when exactly one verified
 // membership exists, regardless of the class name. Ambiguous records must
 // be backfilled with class provenance before a teacher can modify them.
 const memberships=Array.isArray(student.membershipClassIds)?student.membershipClassIds:[];
 return memberships.length===1&&inScope.includes(memberships[0]);
}
const api={roster,recordAllowed,validKey};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.FunTorahTeacherScope=api;
})(typeof window==='undefined'?globalThis:window);
