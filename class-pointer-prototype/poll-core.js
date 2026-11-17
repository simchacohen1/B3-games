'use strict';
// Ephemeral poll state. Identity is supplied by the authenticated connection, never a vote payload.
(function(root){
  const presets={thumbs:['👍','👎'],numbers:['1','2','3'],letters:['A','B','C']};
  function create(type,question,answers,id){
    const choices=presets[type]|| (type==='custom'&&Array.isArray(answers)?answers.map(a=>String(a).trim()):null);
    if(!choices||choices.length<2||choices.length>4||choices.some(a=>!a||a.length>80)||new Set(choices).size!==choices.length)throw Error('Enter 2–4 different answers, up to 80 characters each.');
    if(typeof question!=='string'||question.length>240)throw Error('Keep the question under 240 characters.');
    return {id,question:question.trim(),answers:choices.slice(),votes:Object.create(null),open:true,show:false};
  }
  function vote(p,id,index){if(!p?.open||typeof id!=='string'||!Number.isInteger(index)||index<0||index>=p.answers.length)return false;p.votes[id]=index;return true}
  function counts(p){return p.answers.map((_,i)=>Object.values(p.votes).filter(v=>v===i).length)}
  function view(p,id){return {type:'poll-state',id:p.id,question:p.question,answers:p.answers,open:p.open,show:p.show,choice:p.votes[id]??null,...(p.show?{counts:counts(p)}:{})}}
  const api={create,vote,counts,view};if(typeof module!=='undefined')module.exports=api;else root.ClassPointerPollCore=api;
})(typeof window==='undefined'?globalThis:window);
