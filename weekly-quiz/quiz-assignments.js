// Weekly Quiz individual assignments (issue #376).
// Each student has his own queue at <QROOT>/settings/studentAssignments/<studentId>/<launchId>,
// so a teacher can give several retakes / make-ups / take-anytime quizzes at
// once without one replacing another. The old single pointer
// <QROOT>/settings/studentActiveLaunch/<studentId> is still written (newest
// assignment) so pages and functions that only know it keep working.
// Revoking removes one student's unfinished assignment and marks
// launches/<id>/revokedStudents/<studentId>; responses, completions and audit stay.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WeeklyQuizAssignments=api;
})(typeof self!=='undefined'?self:this,function(){
  const validKey=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
  const queuePath=(qroot,studentId,launchId)=>qroot+'/settings/studentAssignments/'+studentId+(launchId?'/'+launchId:'');
  const pointerPath=(qroot,studentId)=>qroot+'/settings/studentActiveLaunch/'+studentId;
  const targetsOf=launch=>launch&&launch.targetStudents?Object.keys(launch.targetStudents).filter(k=>launch.targetStudents[k]===true):[];

  // Adds one launch to each student's queue; never removes another assignment.
  function assignUpdates(qroot,studentIds,launchId,{kind='anytime',classId='',assignedAt=Date.now()}={}){
    if(!validKey(launchId))throw new Error('Invalid launch id');
    const updates={};
    studentIds.filter(validKey).forEach(sid=>{
      updates[queuePath(qroot,sid,launchId)]={assignedAt,kind,classId};
      updates[pointerPath(qroot,sid)]=launchId;
    });
    return updates;
  }

  // Takes a launch off students' queues (ending or deleting a launch).
  function clearUpdates(qroot,launchId,studentIds,legacyPointers={}){
    const updates={};
    studentIds.filter(validKey).forEach(sid=>{
      updates[queuePath(qroot,sid,launchId)]=null;
      if(legacyPointers[sid]===launchId)updates[pointerPath(qroot,sid)]=null;
    });
    return updates;
  }

  // Revokes ONE student's unfinished assignment. History is never deleted.
  function revokeUpdates(qroot,launchId,studentId,legacyPointer,revokedAt=Date.now()){
    if(!validKey(launchId)||!validKey(studentId))throw new Error('Invalid assignment');
    const updates={[queuePath(qroot,studentId,launchId)]:null,[qroot+'/launches/'+launchId+'/revokedStudents/'+studentId]:revokedAt};
    if(legacyPointer===launchId)updates[pointerPath(qroot,studentId)]=null;
    return updates;
  }

  const isCompleted=(completions,launchId,studentId)=>!!(completions&&completions[launchId]&&completions[launchId][studentId]);
  const isRevoked=(launch,studentId)=>!!(launch&&launch.revokedStudents&&launch.revokedStudents[studentId]);

  // Every unfinished individual assignment, one row per student + launch.
  // Includes old single pointers that were never added to a queue.
  function pendingRows({queue={},legacyPointers={},launches={},completions={},responses={},classFilter='all'}){
    const seen=new Set(),rows=[];
    const add=(studentId,launchId,source,assignedAt)=>{
      const key=studentId+'|'+launchId,launch=launches[launchId];
      if(seen.has(key)||!launch)return;seen.add(key);
      if(classFilter!=='all'&&launch.classId!==classFilter)return;
      const targets=targetsOf(launch);
      if(targets.length&&!targets.includes(studentId))return;
      if(isRevoked(launch,studentId)||isCompleted(completions,launchId,studentId)||launch.endedAt)return;
      const answers=(responses[launchId]||{})[studentId]||{};
      const total=Array.isArray(launch.quizSnapshot&&launch.quizSnapshot.questions)?launch.quizSnapshot.questions.length:Object.keys((launch.quizSnapshot&&launch.quizSnapshot.questions)||{}).length;
      rows.push({studentId,launchId,launch,source,assignedAt:Number(assignedAt||launch.createdAt)||0,answered:Object.values(answers).filter(Boolean).length,total,attempt:Number(launch.attemptNumber)||1});
    };
    Object.entries(queue||{}).forEach(([sid,entries])=>Object.entries(entries||{}).forEach(([lid,entry])=>add(sid,lid,'assigned',entry&&entry.assignedAt)));
    Object.entries(legacyPointers||{}).forEach(([sid,lid])=>{if(validKey(lid))add(sid,lid,'legacy',0);});
    return rows.sort((a,b)=>b.assignedAt-a.assignedAt);
  }

  return {validKey,queuePath,pointerPath,targetsOf,assignUpdates,clearUpdates,revokeUpdates,isCompleted,isRevoked,pendingRows};
});
