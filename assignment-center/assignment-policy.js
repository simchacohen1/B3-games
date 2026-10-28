'use strict';
/**
 * Assignment authorization and state transitions.
 * Pure server-side building block: NOT a callable endpoint or production rule.
 * Identity, active class roster and teacher assignment MUST come from trusted
 * authenticated server reads, never client-submitted context.
 */
const KEY=/^[A-Za-z0-9_-]{1,100}$/;
const STATES=new Set(['assigned','in_progress','submitted','approved','returned']);
const TYPES=new Set(['shorashim','posuk','chazara','workbook','audio','video','other']);
function validId(x){return typeof x==='string'&&KEY.test(x);}
function authorized(actor,scope,ctx,action){
  if(!actor||actor.authenticated!==true||!validId(actor.id)||
     !scope||![scope.workspaceId,scope.classId,scope.studentId].every(validId)||
     !ctx||ctx.workspaceId!==scope.workspaceId||ctx.classId!==scope.classId||
     ctx.classActive!==true||ctx.studentActive!==true||ctx.membershipActive!==true)return false;
  if(actor.role==='student')return action==='read'||action==='submit'
    ?actor.id===scope.studentId&&ctx.studentVerifiedId===actor.id:false;
  if(actor.role==='teacher')return ctx.teacherVerifiedId===actor.id&&
    ctx.teacherAuthorized===true&&ctx.teacherAssignedToClass===true;
  return false;
}
function cleanDefinition(d){
  if(!d||!TYPES.has(d.type)||typeof d.title!=='string'||!d.title.trim()||
    d.title.length>120||typeof d.details!=='string'||d.details.length>1200||
    (d.dueAt!==null&&d.dueAt!==undefined&&
      (!Number.isSafeInteger(d.dueAt)||d.dueAt<0)))throw Error('Invalid assignment');
  return {type:d.type,title:d.title.trim(),details:d.details.trim(),dueAt:d.dueAt??null};
}
function assignmentPath(s,id){
  if(!s||![s.workspaceId,s.classId,s.studentId,id].every(validId))throw Error('Invalid scope');
  return ['assignmentCenter','workspaces',s.workspaceId,'classes',s.classId,'students',s.studentId,'assignments',id].join('/');
}
function transition(record,action,actor,scope,ctx,now){
  if(!authorized(actor,scope,ctx,action==='submit'?'submit':'write')||
    !record||!STATES.has(record.status)||!Number.isSafeInteger(now))throw Error('Unauthorized or invalid state');
  const allowed={
    submit:{assigned:'submitted',in_progress:'submitted',returned:'submitted'},
    start:{assigned:'in_progress'},
    approve:{submitted:'approved'},
    return:{submitted:'returned'},
  };
  if(action!=='submit'&&actor.role!=='teacher')throw Error('Teacher required');
  const next=allowed[action]?.[record.status];
  if(!next)throw Error('Invalid transition');
  return {...record,status:next,updatedAt:now,updatedBy:actor.id};
}
module.exports={authorized,cleanDefinition,assignmentPath,transition};
