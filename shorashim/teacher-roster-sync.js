(function(root){
  'use strict';
  function bindStudentEvents(studentsRef,state,renderDashboard,options={}){
    const delay=Number.isFinite(options.renderDelayMs)?options.renderDelayMs:100;
    let ready=false,renderTimer=null,closed=false;
    const queueRender=()=>{
      if(!ready||closed)return;
      clearTimeout(renderTimer);
      renderTimer=setTimeout(()=>{renderTimer=null;if(!closed&&ready)renderDashboard();},delay);
    };
    const upsert=snap=>{
      if(closed)return;
      const value=snap.val();
      if(value==null)delete state.students[snap.key];
      else state.students[snap.key]=value;
      queueRender();
    };
    const remove=snap=>{if(closed)return;delete state.students[snap.key];queueRender();};
    studentsRef.on('child_added',upsert);
    studentsRef.on('child_changed',upsert);
    studentsRef.on('child_removed',remove);
    return {
      ready(){if(ready)return;ready=true;queueRender();},
      dispose(){if(closed)return;closed=true;clearTimeout(renderTimer);studentsRef.off('child_added',upsert);studentsRef.off('child_changed',upsert);studentsRef.off('child_removed',remove);}
    };
  }
  function bindStudentValues(studentRefs,state,renderDashboard,options={}){
    const delay=Number.isFinite(options.renderDelayMs)?options.renderDelayMs:100;
    let ready=false,renderTimer=null,closed=false;
    const queueRender=()=>{
      if(!ready||closed)return;
      clearTimeout(renderTimer);
      renderTimer=setTimeout(()=>{renderTimer=null;if(!closed&&ready)renderDashboard();},delay);
    };
    const callbacks=new Map();
    const initial=Object.entries(studentRefs).map(([id,studentRef])=>new Promise(resolve=>{
      let first=true;
      const callback=snap=>{
        if(closed)return;
        if(snap.exists())state.students[id]=snap.val();
        else delete state.students[id];
        if(first){first=false;resolve();}
        else queueRender();
      };
      studentRef.on('value',callback);
      callbacks.set(id,callback);
    }));
    return {
      initial:Promise.all(initial),
      ready(){ready=true;},
      dispose(){if(closed)return;closed=true;clearTimeout(renderTimer);for(const [id,studentRef] of Object.entries(studentRefs))studentRef.off('value',callbacks.get(id));}
    };
  }
  const api={bindStudentEvents,bindStudentValues};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.B3ShorashimTeacherRosterSync=api;
})(typeof window!=='undefined'?window:globalThis);

