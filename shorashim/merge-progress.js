(function(root){
  'use strict';
  function mergeStudentCards(student,oldKey,newKey,keeperId){
    if(!student||!student.cards||!Object.prototype.hasOwnProperty.call(student.cards,oldKey))return undefined;
    const cards={...student.cards},oldCard=cards[oldKey],newCard=cards[newKey];
    if(!newCard)cards[newKey]={...oldCard,itemKey:newKey,itemId:keeperId};
    else{
      const times=[newCard.learnedAt,oldCard.learnedAt].filter(value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))).map(Number);
      const merged={...oldCard,...newCard,itemKey:newKey,itemId:keeperId};
      if(times.length)merged.learnedAt=Math.min(...times);
      if(!newCard.createdAt&&oldCard.createdAt)merged.createdAt=oldCard.createdAt;
      if(!newCard.sessionId&&oldCard.sessionId)merged.sessionId=oldCard.sessionId;
      if(oldCard.design||newCard.design)merged.design={...(oldCard.design||{}),...(newCard.design||{})};
      if(newCard.reviewOrder===undefined&&oldCard.reviewOrder!==undefined)merged.reviewOrder=oldCard.reviewOrder;
      cards[newKey]=merged;
    }
    delete cards[oldKey];
    return {...student,cards};
  }
  const api={mergeStudentCards};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.B3ShorashimProgressMerge=api;
})(typeof window==='object'?window:globalThis);
