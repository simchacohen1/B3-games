/* Live gallery access uses the same policy as the home page. */
(function(root){
  root.B3GalleryAccess = function(api, settings, classId, studentId, teacher, date){
    if(teacher)return true;
    if(!settings || !studentId || !classId)return false;
    if(!['et','wt'].includes(classId))return true; // Membership/tool grants remain checked by game-gate.
    if(!api.isGameEnabledForClass(settings,classId,'class-gallery'))return false;
    if(api.studentHasGameOverride(settings,studentId,'class-gallery') || api.classHasLockedGameOverride(settings,classId,'class-gallery'))return true;
    return api.isClassOpen(settings,classId,date);
  };
})(window);
