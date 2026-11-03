'use strict';

const validKey=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
const toolForSource=source=>['reading100','translation100','understand100'].includes(source)?'posuk-practice-scroll'
  :String(source||'').startsWith('shorashim-')?'shorashim':'chazara';

async function authorizePracticeStudent({authorization,verifyToken,get,source,studentTools}){
  if(!String(authorization||'').startsWith('Bearer '))return {ok:false,status:401,error:'Student sign-in required.'};
  let decoded;
  try{decoded=await verifyToken(String(authorization).slice(7));}
  catch(_){return {ok:false,status:401,error:'Student sign-in expired. Please sign in again.'};}
  const studentId=String(decoded?.b3StudentId||'').trim(),classId=String(decoded?.b3ClassId||'').trim();
  if(decoded?.b3StudentRole!=='student'||!validKey(studentId)||!validKey(classId))
    return {ok:false,status:401,error:'Student sign-in required.'};
  const [profile,memberships,cls]=await Promise.all([
    get(`b3Games/students/${studentId}/profile`),
    get(`b3Games/students/${studentId}/memberships`),
    get(`b3Games/workspaces/b3-2026/classes/${classId}`)
  ]);
  const member=cls?.members?.[studentId],rows=memberships||{};
  const enrolled=Object.values(rows).some(row=>row&&row.active!==false&&row.workspaceId==='b3-2026'&&row.classId===classId)
    ||(!Object.keys(rows).length&&profile?.classId===classId);
  if(!enrolled||profile?.active===false||!member||member.active===false||!cls||cls.active===false)
    return {ok:false,status:403,error:'Student access to this class is no longer active.'};
  const tool=toolForSource(source);
  if(!studentTools.allowed(cls,studentId,tool)||(!['et','wt'].includes(classId)&&!studentTools.granted(cls,tool)))
    return {ok:false,status:403,error:'This activity is not enabled for your class.'};
  return {ok:true,studentId,classId,decoded};
}

module.exports={authorizePracticeStudent,toolForSource,validKey};
