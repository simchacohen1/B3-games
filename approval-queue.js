// Shared teacher approval-queue rules (2026-10-21).
// One definition used by the homepage Approval Center, the Chazara teacher
// page and Student Rewards so every teacher screen counts the same items.
//
// - Posuk Practice 100% milestones (reading/translation/understanding) are
//   earned automatically and are NEVER part of a manual approval queue.
// - Chazara and Shorashim recordings still need a teacher.
// - Rashi Letters reading recordings (2026-10-23) have their OWN category: a
//   teacher must hear the audio first, so they are never part of the generic
//   "approve all" queue.
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.FunTorahApprovalQueue=api;
})(typeof self!=="undefined"?self:this,function(){
  const AUTOMATIC_SOURCES=Object.freeze(["reading100","translation100","understand100"]);
  const CHAZARA_SOURCES=Object.freeze(["chazara","chazara-recording"]);
  const SHORASHIM_SOURCES=Object.freeze(["shorashim-recording","shorashim-no-hints"]);
  const RASHI_SOURCES=Object.freeze(["rashi-recording"]);
  const src=item=>String(item&&item.source||"");
  function isAutomaticPosukMilestone(item){return AUTOMATIC_SOURCES.includes(src(item));}
  function isChazaraApproval(item){return CHAZARA_SOURCES.includes(src(item));}
  function isShorashimApproval(item){return SHORASHIM_SOURCES.includes(src(item));}
  function isRashiApproval(item){return RASHI_SOURCES.includes(src(item));}
  function isPending(item){return !!item&&typeof item==="object"&&String(item.status||"pending")==="pending";}
  // Pending point request that a teacher must review by hand.
  function needsManualApproval(item){return isPending(item)&&!isAutomaticPosukMilestone(item)&&!isRashiApproval(item);}
  // Pending automatic milestone that should be paid without a teacher click.
  function isPendingAutomatic(item){return isPending(item)&&isAutomaticPosukMilestone(item);}
  function classOf(item,fallback){
    const c=String(item&&item.classId||"").trim();
    if(c)return c;
    return typeof fallback==="function"?String(fallback(item)||""):"";
  }
  // Count items per class id ("" = unknown) so ET and WT stay separate.
  function countByClass(items,fallback){
    const out={};
    (items||[]).forEach(item=>{const c=classOf(item,fallback);out[c]=(out[c]||0)+1;});
    return out;
  }
  function entries(map){return Object.entries(map&&typeof map==="object"?map:{}).map(([id,item])=>({id,item:item||{}}));}
  function manualQueue(map,predicate){
    return entries(map).filter(x=>needsManualApproval(x.item)&&(!predicate||predicate(x.item)))
      .sort((a,b)=>(Number(b.item.createdAt)||0)-(Number(a.item.createdAt)||0));
  }
  function automaticQueue(map){return entries(map).filter(x=>isPendingAutomatic(x.item));}
  // Pending Rashi recordings, newest first (own category in the Approval Center).
  function rashiQueue(map){
    return entries(map).filter(x=>isPending(x.item)&&isRashiApproval(x.item))
      .sort((a,b)=>(Number(b.item.createdAt)||0)-(Number(a.item.createdAt)||0));
  }
  return {AUTOMATIC_SOURCES,CHAZARA_SOURCES,SHORASHIM_SOURCES,RASHI_SOURCES,isAutomaticPosukMilestone,isChazaraApproval,isShorashimApproval,isRashiApproval,rashiQueue,isPending,needsManualApproval,isPendingAutomatic,countByClass,manualQueue,automaticQueue};
});
