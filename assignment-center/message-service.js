'use strict';
// Server-side message operations, intended for deployment ONLY after isolated
// database rules, authenticated callable endpoints and integration tests are ready.
const policy=require('./message-policy');
const MAX_PAGE=50;
function makeService({read,write,allocateId,now}){
  if([read,write,allocateId,now].some(fn=>typeof fn!=='function'))throw new Error('Backend adapters required');
  async function verify(actor,thread){
    if(!actor||!actor.authenticated||!['teacher','student'].includes(actor.role))throw new Error('Unauthorized');
    const workspace=thread.workspaceId,classId=thread.classId,sid=thread.studentId;
    const base='b3Games/workspaces/'+workspace, student='b3Games/students/'+sid;
    // All these reads MUST use privileged backend access; never trust values
    // submitted by the browser or client-provided context.
    const [cls,membership,profile,teacher]=await Promise.all([
      read(base+'/classes/'+classId),
      read(student+'/memberships/'+classId),
      read(student+'/profile'),
      actor.role==='teacher'?read(base+'/teachers/'+actor.id):Promise.resolve(null)
    ]);
    const membershipValid=!!membership&&membership.active!==false&&membership.workspaceId===workspace&&membership.classId===classId;
    const teacherAuthorized=!!teacher&&teacher.active===true&&teacher.classIds?.[classId]===true;
    const decision=policy.authorize({actor,thread,context:{
      workspaceId:workspace,classId,classActive:!!cls&&cls.active!==false,
      studentActive:!!profile&&profile.active!==false,
      membershipActive:membershipValid&&!!cls?.members?.[sid]&&cls.members[sid].active!==false,
      studentVerifiedId:actor.role==='student'?actor.id:null,
      teacherVerifiedId:actor.role==='teacher'?actor.id:null,
      teacherAuthorized,teacherAssignedToClass:teacherAuthorized
    }});
    if(!decision.allowed)throw new Error('Unauthorized');
    return decision;
  }
  async function sendText(actor,thread,message){
    await verify(actor,thread);
    if(!policy.validateText(message))throw new Error('Invalid message');
    const id=allocateId();
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new Error('Invalid message ID');
    const record={id,senderId:actor.id,senderRole:actor.role,type:'text',text:message.trim(),createdAt:now()};
    await write(policy.threadPath(thread)+'/messages/'+id,record);
    return record;
  }
  // read implementation must implement ordered indexed pagination and have
  // a stable oldest-first cursor. Do not fetch whole histories into browsers.
  async function list(actor,thread,{limit=30,before=null}={}){
    await verify(actor,thread);
    if(!Number.isInteger(limit)||limit<1||limit>MAX_PAGE)throw new Error('Invalid limit');
    if(before!==null&&(!/^[A-Za-z0-9_-]{1,100}$/.test(before)))throw new Error('Invalid cursor');
    return read(policy.threadPath(thread)+'/messages',{limit,before});
  }
  return Object.freeze({sendText,list,verify});
}
module.exports={makeService};
