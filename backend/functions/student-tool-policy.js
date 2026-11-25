(function(root){
  'use strict';
  const aliases=tool=>{
    if(['gallery','tag','class-gallery'].includes(tool))return ['gallery','tag','class-gallery'];
    if(['rashi','rashi-letters'].includes(tool))return ['rashi','rashi-letters'];
    // The Chayus Meter tile follows the class's Davening setting: no separate grant, no Davening player for students.
    if(tool==='chayus-meter')return ['chayus-meter','davening'];
    return [tool];
  };
  function granted(cls,tool){return aliases(tool).some(id=>cls?.toolGrants?.[id]===true);}
  function allowed(cls,studentId,tool){
    return !aliases(tool).some(id=>cls?.members?.[studentId]?.toolAccess?.[id]===false);
  }
  const studentActivities=['sefer-hamitzvos','halacha','yiddish','posuk-practice-scroll','rashi-letters','gematria','shorashim','chazara','game-show','student-rewards','weekly-quiz','multiplayer-center','gallery','tag','class-gallery','daily-checklist'];
  const api={aliases,granted,allowed,studentActivities};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.B3StudentTools=api;
})(typeof window==='object'?window:globalThis);
