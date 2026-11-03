// Owner-only, read-only teacher home preview. Never changes authentication or grants.
(function(root){
  function entries(teachers,invites,ownerUid){
    const result=[],seen=new Set();
    Object.entries(invites||{}).forEach(([id,invite])=>{
      const uid=invite.claimedUid,record=uid&&teachers[uid];
      if(invite.active===false||uid===ownerUid||seen.has(uid)||(uid&&(!record||record.active===false)))return;
      const effective=record||invite;
      if(['owner','admin'].includes(effective.role))return;
      if(uid)seen.add(uid);
      result.push({id,type:'invite',name:invite.name||invite.email||id,email:invite.email||'',classIds:Object.keys(effective.classIds||{}).filter(k=>k!=='*'&&effective.classIds[k]===true)});
    });
    Object.entries(teachers||{}).forEach(([id,record])=>{
      if(id===ownerUid||seen.has(id)||record.active===false||['owner','admin'].includes(record.role))return;
      result.push({id,type:'teacher',name:record.displayName||record.name||record.email||id,email:record.email||'',classIds:Object.keys(record.classIds||{}).filter(k=>k!=='*'&&record.classIds[k]===true)});
    });
    return result.sort((a,b)=>a.name.localeCompare(b.name));
  }
  async function list(db,ws,access,ownerUid){
    if(access?.authorized!==true||access.role!=='admin')throw new Error('Only the owner can preview teachers.');
    const base='b3Games/workspaces/'+ws;
    const [teachers,invites]=await Promise.all([db.ref(base+'/teachers').once('value'),db.ref(base+'/teacherInvites').once('value')]);
    return entries(teachers.val()||{},invites.val()||{},ownerUid);
  }
  const api={entries,list};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.B3TeacherPreview=api;
})(typeof window==='object'?window:globalThis);
