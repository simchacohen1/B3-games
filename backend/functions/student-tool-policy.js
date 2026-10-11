(function(root){
  'use strict';
  const aliases=tool=>['gallery','tag','class-gallery'].includes(tool)?['gallery','tag','class-gallery']:[tool];
  function granted(cls,tool){return aliases(tool).some(id=>cls?.toolGrants?.[id]===true);}
  function allowed(cls,studentId,tool){
    return !aliases(tool).some(id=>cls?.members?.[studentId]?.toolAccess?.[id]===false);
  }
  const studentActivities=['halacha','yiddish','posuk-practice-scroll','rashi-letters','gematria','shorashim','chazara','game-show','student-rewards','weekly-quiz','gallery','tag','class-gallery'];
  const api={aliases,granted,allowed,studentActivities};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.B3StudentTools=api;
})(typeof window==='object'?window:globalThis);
