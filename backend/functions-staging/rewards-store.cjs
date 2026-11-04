'use strict';
// Per-class prize stores. Classes created from Teacher Center (rewards class
// "b3_<classId>" for anything other than the original ET/WT) run their own
// store: only items with ownerClassId === that class, opened and closed with
// settings/classStoreEnabled/<class>. Every other class keeps the shared store
// (items without ownerClassId, opened with settings/rewardStoreEnabled).
const LEGACY=['et','wt'];

function isTeacherStore(root,classId){
 const c=root?.classes?.[classId];
 return Boolean(classId&&c&&c.b3ClassId&&!LEGACY.includes(String(c.b3ClassId)));
}
function storeOpenFor(root,classId){
 if(isTeacherStore(root,classId))return root?.settings?.classStoreEnabled?.[classId]===true;
 const v=root?.settings?.rewardStoreEnabled;return v===true||String(v)==='true';
}
function itemInStore(root,classId,item){
 if(!item)return false;
 return isTeacherStore(root,classId)?item.ownerClassId===classId:!item.ownerClassId;
}
function studentClassIds(root,studentId){
 const out=[];
 for(const [classId,members] of Object.entries(root?.enrollments||{}))
  if(members?.[studentId]===true&&root?.classes?.[classId]?.active!==false)out.push(classId);
 const own=root?.students?.[studentId]?.classId;
 if(!out.length&&own&&root?.classes?.[own])out.push(own);
 return out;
}
// The store a student shops in: their preferred class if they are in it,
// otherwise their first class.
function storeClassFor(root,studentId,preferred=''){
 const ids=studentClassIds(root,studentId),wanted=String(preferred||'').trim();
 return ids.includes(wanted)?wanted:(ids[0]||'');
}
module.exports={isTeacherStore,storeOpenFor,itemInStore,studentClassIds,storeClassFor};
