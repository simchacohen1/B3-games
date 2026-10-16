/* Assignment Center message authorization policy — pure, server-side helper.
 * This is NOT an authentication endpoint. Callers must supply identity and roster
 * derived from verified authentication and trusted server-side database reads.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AssignmentMessagePolicy=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const KEY=/^[a-zA-Z0-9_-]{1,100}$/;
function valid(v){return typeof v==='string'&&KEY.test(v);}
function deny(){return {allowed:false,reason:'Access denied'};}
function authorize(args){
  if(!args||!args.actor||!args.thread||!args.context)return deny();
  const {actor,thread,context}=args;
  if(!valid(thread.workspaceId)||!valid(thread.classId)||!valid(thread.studentId))return deny();
  if(context.workspaceId!==thread.workspaceId||context.classId!==thread.classId)return deny();
  if(context.classActive!==true||context.studentActive!==true||context.membershipActive!==true)return deny();
  if(!valid(actor.id)||actor.authenticated!==true||!['student','teacher'].includes(actor.role))return deny();
  if(actor.role==='student'){
    if(actor.id!==thread.studentId||context.studentVerifiedId!==actor.id)return deny();
    return {allowed:true,role:'student'};
  }
  if(context.teacherVerifiedId!==actor.id)return deny();
  if(context.teacherAuthorized!==true||context.teacherAssignedToClass!==true)return deny();
  return {allowed:true,role:'teacher'};
}
function threadPath(t){if(!t||![t.workspaceId,t.classId,t.studentId].every(valid))throw new Error('Invalid thread');return ['assignmentCenter','workspaces',t.workspaceId,'classes',t.classId,'threads',t.studentId].join('/');}
function validateText(message){return typeof message==='string'&&message.trim().length>0&&message.trim().length<=2000;}
return Object.freeze({authorize,threadPath,validateText});
});