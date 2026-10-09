(() => {
  const button=document.getElementById('viewAsTeacher');
  const dialog=document.getElementById('teacherPreviewPicker');
  const list=document.getElementById('teacherPreviewList');
  document.getElementById('closeTeacherPreviewPicker').onclick=()=>dialog.close();
  button.onclick=async()=>{
    if(!isOwnerNow())return;
    dialog.showModal();list.textContent='Loading teachers…';
    try{
      const w=frame.contentWindow,api=w.B3SiteSettings;
      const teachers=await B3TeacherPreview.list(w.firebase.database(),api.workspaceId||'b3-2026',api.getCurrentAccess(),w.firebase.auth().currentUser?.uid);
      if(!isOwnerNow()){dialog.close();return;}
      list.replaceChildren();
      if(!teachers.length){list.textContent='No other active teachers yet. Add a teacher in Owner Admin first.';return;}
      teachers.forEach(teacher=>{
        const item=document.createElement('button');item.type='button';item.className='teacher-preview-choice';
        const title=document.createElement('strong');title.textContent=teacher.name;
        const hint=document.createElement('span');hint.textContent=teacher.classIds.length+' assigned class'+(teacher.classIds.length===1?'':'es');
        item.append(title,hint);
        item.onclick=()=>{if(isOwnerNow())location.href='teacher-home.html?previewTeacher='+encodeURIComponent(teacher.id)+'&previewType='+teacher.type;};
        list.append(item);
      });
    }catch(error){list.textContent='Could not load teachers. Please try again.';console.warn(error);}
  };
})();
