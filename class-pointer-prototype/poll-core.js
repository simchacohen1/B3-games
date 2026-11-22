'use strict';
// Ephemeral poll state. Identity is supplied by the authenticated connection, never a vote payload.
(function(root){
  const presets={thumbs:['👍','👎'],numbers:['1','2','3'],letters:['A','B','C']};
  // seconds: auto-close timer (30, 60 or 120). null/0 = no timer.
  const TIMERS=[30,60,120];
  function create(type,question,answers,id,seconds){
    const choices=presets[type]|| (type==='custom'&&Array.isArray(answers)?answers.map(a=>String(a).trim()):null);
    if(!choices||choices.length<2||choices.length>4||choices.some(a=>!a||a.length>80)||new Set(choices).size!==choices.length)throw Error('Enter 2–4 different answers, up to 80 characters each.');
    if(typeof question!=='string'||question.length>240)throw Error('Keep the question under 240 characters.');
    if(seconds!=null&&seconds!==0&&!TIMERS.includes(seconds))throw Error('Choose 30 seconds, 1 minute, 2 minutes or no timer.');
    return {id,question:question.trim(),answers:choices.slice(),votes:Object.create(null),open:true,show:false,seconds:seconds||null,endsAt:null};
  }
  function vote(p,id,index){if(!p?.open||typeof id!=='string'||!Number.isInteger(index)||index<0||index>=p.answers.length)return false;p.votes[id]=index;return true}
  function counts(p){return p.answers.map((_,i)=>Object.values(p.votes).filter(v=>v===i).length)}
  // Whole seconds left on the auto-close timer, or null (no timer / already closed). Sent as a duration, never a clock time, so student clocks do not matter.
  function remaining(p,now){return p?.open&&p.endsAt!=null?Math.max(0,Math.ceil((p.endsAt-(now??Date.now()))/1000)):null}
  function view(p,id,now){return {type:'poll-state',id:p.id,question:p.question,answers:p.answers,open:p.open,show:p.show,secondsLeft:remaining(p,now),choice:p.votes[id]??null,...(p.show?{counts:counts(p)}:{})}}
  const api={create,vote,counts,view,remaining,TIMERS};if(typeof module!=='undefined')module.exports=api;else root.ClassPointerPollCore=api;
})(typeof window==='undefined'?globalThis:window);
