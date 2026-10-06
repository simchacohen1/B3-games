(function(root){
  'use strict';
  const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value);
  const validRoom=value=>typeof value==='string'&&/^class-pointer-[a-f0-9-]{36}$/.test(value);
  function permitted(access,id,row){return validId(id)&&row&&row.active!==false&&access?.authorized&&(access.role==='admin'||(access.classIds||[]).includes(id))&&(access.role==='admin'||row.toolGrants?.['class-pointer']===true)}
  function latest(rows,now=Date.now()){return Object.entries(rows||{}).filter(([key,row])=>row&&key===row.roomId&&validRoom(key)&&Number.isFinite(row.createdAt)&&row.createdAt<=now+60000&&now-row.createdAt<14400000).sort((a,b)=>b[1].createdAt-a[1].createdAt)[0]?.[1]||null}
  function handoff(value,room,now=Date.now()){return value&&value.room===room&&validRoom(room)&&validId(value.studentId)&&validId(value.classId)&&typeof value.name==='string'&&value.name.trim()&&Number.isFinite(value.at)&&value.at<=now+60000&&now-value.at<3600000?value:null}
  root.ClassPointerDashboardCore={validId,validRoom,permitted,latest,handoff};
})(typeof window==='undefined'?globalThis:window);
