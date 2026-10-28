// Read-only roster resolver for the owner's selected-teacher preview.
(function(root){
  "use strict";
  const SAFE_ID=/^[A-Za-z0-9_-]{1,100}$/;
  async function activeClassStudents(db,workspaceId,classId){
    if(!SAFE_ID.test(String(workspaceId||""))||!SAFE_ID.test(String(classId||"")))throw new Error("Invalid class selection.");
    const classPath="b3Games/workspaces/"+workspaceId+"/classes/"+classId;
    const cls=(await db.ref(classPath).once("value")).val();
    if(!cls||cls.active===false)throw new Error("This class is unavailable.");
    const members=Object.entries(cls.members||{}).filter(([id,member])=>SAFE_ID.test(id)&&member&&member.active!==false);
    const checked=await Promise.all(members.map(async([id,member])=>{
      const [profileSnap,membershipSnap]=await Promise.all([
        db.ref("b3Games/students/"+id+"/profile").once("value"),
        db.ref("b3Games/students/"+id+"/memberships/"+workspaceId+"_"+classId).once("value")
      ]);
      const profile=profileSnap.val(),membership=membershipSnap.val();
      if(!profile||profile.active===false||!membership||membership.active===false||membership.classId!==classId||membership.workspaceId!==workspaceId)return null;
      return {id,name:String(profile.name||member.name||"").trim()||id};
    }));
    return checked.filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
  }
  const api={activeClassStudents};
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.B3TeacherPreviewRoster=api;
})(typeof window==="object"?window:globalThis);
