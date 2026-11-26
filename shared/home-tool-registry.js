(function(root){
  // ONE source for the tiles on index.html (owner admin + student home) and
  // teacher-home.html. Add or rename a tile here and both pages follow.
  // Audiences: "admin" = owner admin only; "teacher" = a teacher, for the
  // classes they are assigned. Teacher tiles are further limited by the class's
  // tool grants (see `grant`).
  var REBBE='<svg viewBox="0 0 64 64" width="52" height="52" role="img" aria-label="Rebbe"><path d="M9 64c0-13 10-20 23-20s23 7 23 20z" fill="#1f2937"/><path d="M26 44l6 13 6-13z" fill="#fff"/><ellipse cx="32" cy="29" rx="11" ry="12" fill="#f3c79d"/><path d="M20.5 28c0 15 5 25 11.5 25s11.5-10 11.5-25c-2 6-6 9-11.5 9s-9.5-3-11.5-9z" fill="#4a3426"/><path d="M27 36.5c2-1.6 3.5-1.6 5-.6 1.5-1 3-1 5 .6-2 .8-3.5 1-5 .4-1.5.6-3 .4-5-.4z" fill="#4a3426"/><circle cx="28" cy="28" r="1.5" fill="#1f2937"/><circle cx="36" cy="28" r="1.5" fill="#1f2937"/><path d="M25.5 24.5q2.5-1.5 5 0M33.5 24.5q2.5-1.5 5 0" stroke="#4a3426" stroke-width="1.3" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="19" rx="18" ry="3.6" fill="#111827"/><path d="M21.5 19c0-8 3-12.5 10.5-12.5S42.5 11 42.5 19z" fill="#111827"/><path d="M21.8 15.5h20.4v3H21.8z" fill="#374151"/><path d="M32 7.5v4" stroke="#374151" stroke-width="1.4" stroke-linecap="round"/></svg>';
  var YIDDISH='assets/yiddish-icon-v2.png';
  // Tile fields: id = class-grant key (data-game-id); href = student page;
  // teacherHref = teacher page (teacher-home opens this one); companion = extra
  // tile shown whenever its parent tool is on; studentHome:false = not on the
  // student grid of index.html.
  var groups=[
    {id:"learn",icon:REBBE,title:"Chumash Cheder",subtitle:"Learn your posuk, then review it",extra:" island-main",tiles:[
      {id:"posuk-practice-scroll",title:"Posuk Practice Scroll",icon:"📜",href:"record_pesukim/student.html",teacherHref:"record_pesukim/teacher.html"},
      {id:"posuk-practice-scroll",key:"chumash-quiz",companion:true,title:"Chumash חידון",icon:"🧠",href:"record_pesukim/student.html?mode=quiz"},
      {id:"posuk-practice-scroll",key:"record-mishnayos",companion:true,title:"Mishnayos Practice",icon:"📖",href:"record-mishnayos/student.html",teacherHref:"record-mishnayos/teacher.html"},
      {id:"posuk-practice-scroll",key:"record-mishnayos-quiz",companion:true,title:"Mishnayos חידון",icon:"🧠",href:"record-mishnayos/student.html?mode=quiz"},
      {id:"chazara",title:"Chazara Chart",icon:"🔁",href:"chazara/index.html",teacherHref:"chazara/teacher.html"}]},
    {id:"roots",icon:"🌳",title:"Shorashim Grove",subtitle:"Grow your Hebrew word skills",extra:" island-main island-roots",tiles:[
      {id:"shorashim",title:"Shorashim",icon:"🌳",href:"shorashim/index.html",teacherHref:"shorashim/teacher.html"}]},
    {id:"skills",icon:"📚",title:"Skills Library",subtitle:"Rashi letters, Yiddish, and Gematria",extra:"",tiles:[
      {id:"rashi-letters",title:"Rashi Letters",icon:"אב",iconKind:"rashi",href:"rashi-letters/student.html",teacherHref:"rashi-letters/teacher.html"},
      {id:"yiddish",title:"Yiddish",icon:YIDDISH,iconKind:"img",href:"yiddish/index.html",teacherHref:"yiddish/teacher.html"},
      {id:"gematria",title:"Gematria",icon:"🔢",href:"gematria/index.html",teacherHref:"gematria/teacher.html"}]},
    {id:"more-learning",icon:"🕍",title:"Learning Beis Midrash",subtitle:"Halacha and Sefer HaMitzvos",teacherSubtitle:"Halacha, Sefer HaMitzvos, and Mishnayos",extra:"",tiles:[
      {id:"halacha",title:"Halacha",icon:"📔",href:"halacha/index.html?v=20261007-teacher-sync",teacherHref:"halacha/teacher.html"},
      {id:"sefer-hamitzvos",title:"Sefer HaMitzvos",icon:"📖",href:"sefer-hamitzvos/index.html"},
      {id:"chayus-meter",title:"Chayus Meter",icon:"🔥",href:"chayus-meter/index.html",teacherHref:"chayus-meter/teacher.html"},
      {id:"mishnayos-practice",title:"Mishnayos Practice (classic)",icon:"🕍",href:"mishnayos/student.html",teacherHref:"mishnayos/teacher.html",studentHome:false}]},
    {id:"class",icon:"🏡",title:"Class Village",subtitle:"Your gallery and rewards",extra:"",tiles:[
      {id:"class-gallery",title:"Class Gallery",icon:"🖼️",href:"class-gallery/index.html"},
      {id:"gallery",title:"Gallery",icon:"🖼️",href:"class-gallery/index.html",studentHome:false},
      {id:"student-rewards",title:"Student Rewards",icon:"🌟",href:"student-rewards/student.html",teacherHref:"student-rewards/teacher.html"},
      {id:"daily-points",title:"Daily Points",icon:"✅",href:"student-rewards/student.html",teacherHref:"student-rewards/teacher.html?tab=Daily%20Points",studentHome:false},
      {id:"daily-checklist",title:"Daily Checklist",icon:"☑️",href:"daily-checklist/index.html",teacherHref:"daily-checklist/teacher.html"},
      {id:"tag",title:"Tag Game",icon:"🏃",href:"class-gallery/index.html",studentHome:false}]},
    {id:"challenge",icon:"🏆",title:"Challenge Playground",subtitle:"Quiz yourself or play a game",extra:"",tiles:[
      {id:"weekly-quiz",title:"Weekly Quiz & Practice",icon:"📝",href:"weekly-quiz/index.html",teacherHref:"weekly-quiz/teacher.html"},
      {id:"game-show",title:"Game Show",icon:"🏆",href:"game-show/player.html",teacherHref:"game-show/teacher.html"},
      {id:"multiplayer-center",title:"Multiplayer Center",icon:"🎲",href:"multiplayer/index.html"}]}
  ];
  // Teacher Tools cards. audiences: who sees it. grant: a teacher needs this
  // class grant (the owner admin sees it regardless). previewTool: key used by
  // the owner's read-only teacher preview. elId/cls/newTab are rendering details.
  var teacherTools=[
    {id:"act-as-student",special:true,icon:"👀",title:"Sign in as a Student",audiences:["admin","teacher"],noPreview:true},
    {id:"manage-class",icon:"🎛️",title:"Student tool access",teacherTitle:"Manage Class",href:"admin.html?tab=students",audiences:["admin","teacher"],previewTool:"manage-class"},
    {id:"homework",elId:"homeworkCenterCard",icon:"📚",title:"Homework & Assignments",href:"assignment-center/teacher.html",grant:"homework",audiences:["admin","teacher"]},
    {id:"daily-points-dashboard",icon:"✓",title:"Daily Points",href:"student-rewards/teacher.html",audiences:["admin"]},
    {id:"class-pointer",icon:"👆",title:"Classroom Pointer",href:"class-pointer-prototype/dashboard.html?teacher=1",grant:"class-pointer",audiences:["admin","teacher"]},
    {id:"send-everyone-share",icon:"🖥",title:"Send Everyone to Share Screen",href:"class-pointer-prototype/classroom.html?dashboard=teacher&sendEveryoneShare=1",grant:"class-pointer",audiences:["teacher"],noPreview:true},
    {id:"follow-teacher",icon:"👣",title:"Follow the Teacher",href:"follow-teacher/teacher.html",newTab:true,audiences:["admin","teacher"],noPreview:true},
    {id:"game-show-host",icon:"🏆",title:"Game Show — Host",href:"game-show/teacher.html",audiences:["admin"]},
    {id:"posuk-dash",icon:"📜",title:"Posuk Practice Scroll — Teacher Dashboard",href:"record_pesukim/teacher.html",audiences:["admin"]},
    {id:"mishnayos-dash",icon:"📖",title:"Mishnayos Practice — Teacher Dashboard",href:"record-mishnayos/teacher.html",audiences:["admin"]},
    {id:"shorashim-dash",icon:"🌳",title:"Shorashim — Teacher Dashboard",href:"shorashim/teacher.html?v=20260917-correct-dashboard",audiences:["admin"]},
    {id:"chazara-dash",icon:"🔁",title:"Chazara — Teacher Dashboard",href:"chazara/teacher.html",audiences:["admin"]},
    {id:"rashi-dash",icon:"אב",iconKind:"rashi",title:"Rashi Letters — Teacher Dashboard",href:"rashi-letters/teacher.html",audiences:["admin"]},
    {id:"checklist-dash",icon:"☑️",title:"Daily Checklist — Teacher View",href:"daily-checklist/teacher.html",audiences:["admin"]},
    {id:"gematria-dash",icon:"🔢",title:"Gematria — Teacher Dashboard",href:"gematria/teacher.html",audiences:["admin"]},
    {id:"rewards-dash",icon:"🏅",title:"Student Rewards — Teacher",href:"student-rewards/teacher.html",audiences:["admin"]},
    {id:"quiz-dash",icon:"📝",title:"Weekly Quiz — Teacher",href:"weekly-quiz/teacher.html",audiences:["admin"]},
    {id:"halacha-lesson",icon:"📔",title:"Halacha — Teacher Lesson",href:"halacha/index.html?teacher=1&v=20261007-teacher-sync",audiences:["admin"]},
    {id:"halacha-work",icon:"🗂️",title:"Halacha — Student Work",href:"halacha/teacher.html",audiences:["admin"]},
    {id:"chavrusa",icon:"👥",title:"Chavrusa of the Day",href:"chavrusa/index.html",grant:"chavrusa",audiences:["admin","teacher"]},
    {id:"name-picker",icon:"🎡",title:"Name Picker",href:"name-picker/index.html",grant:"name-picker",audiences:["admin","teacher"]},
    {id:"class-dashboard",icon:"📊",title:"Class Dashboard",href:"class-dashboard/index.html",audiences:["admin"]},
    {id:"student-report",icon:"📈",title:"Student Report — All Tools",teacherTitle:"Student Report",href:"student-report/index.html",audiences:["admin","teacher"],previewTool:"student-report"},
    {id:"vocab-progress",icon:"📚",title:"Vocabulary Progress",href:"word-bank/teacher.html",audiences:["teacher"],noPreview:false},
    {id:"nigri-sync",elId:"nigriSyncCard",idLast:true,cls:" nigri-hidden",icon:"🔄",title:"Sync to Nigri",href:"sync-to-nigri/index.html",audiences:["admin"]},
    {id:"davening",icon:"📖",title:"Davening Player",href:"davening_student_app/index.html",grant:"davening",audiences:["teacher"]},
    {id:"davening-et",icon:"📖",iconLabel:"Siddur",title:"Davening Player — ET",href:"davening_student_app_et/index.html",audiences:["admin"]},
    {id:"davening-wt",icon:"📖",iconLabel:"Siddur",title:"Davening Player — WT",href:"davening_student_app_wt/index.html",audiences:["admin"]}
  ];
  function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function iconHtml(t,where){
    if(t.iconKind==="img")return where==="student"
      ?'<img class="yiddish-icon" src="'+esc(t.icon)+'" loading="lazy" decoding="async" width="74" height="74" alt="" aria-hidden="true">'
      :'<img class="yiddish-icon tool-icon" src="'+esc(t.icon)+'" alt="">';
    if(t.iconKind==="rashi")return '<span class="card-icon rashi-icon" lang="he" dir="rtl">'+esc(t.icon)+'</span>';
    return '<span class="card-icon"'+(t.iconLabel?' role="img" aria-label="'+esc(t.iconLabel)+'"':'')+'>'+esc(t.icon)+'</span>';
  }
  function withClass(href,classId){return classId?href+(href.indexOf("?")>=0?"&":"?")+"class="+encodeURIComponent(classId):href;}
  // Tile grid. opts.audience "student" (index.html) or "teacher" (teacher-home).
  // Teacher: opts.isOn(grantId) decides which tiles show, opts.hrefFor(tile) the link.
  function renderMap(opts){
    opts=opts||{};
    var teacher=opts.audience==="teacher",html="";
    groups.forEach(function(g){
      var tiles=g.tiles.filter(function(t){return teacher?opts.isOn(t.id):t.studentHome!==false;});
      if(!tiles.length)return;
      var cards=tiles.map(function(t){
        var href=opts.hrefFor?opts.hrefFor(t):t.href;
        return '<a class="game-card" data-game-id="'+esc(t.id)+'"'+(t.key?' data-tile-key="'+esc(t.key)+'"':'')+(t.companion?' data-companion-of="'+esc(t.id)+'"':'')+' href="'+esc(href)+'">'+iconHtml(t,teacher?"teacher":"student")+'<span class="card-title">'+esc(t.title)+'</span></a>';
      }).join("\n");
      html+='<section class="game-group island-place'+g.extra+'" data-game-group="'+g.id+'"><div class="game-group-head"><span class="game-group-icon" aria-hidden="true">'+g.icon+'</span><div><div class="game-group-title">'+esc(g.title)+'</div><div class="game-group-subtitle">'+esc((teacher&&g.teacherSubtitle)||g.subtitle)+'</div></div></div><div class="game-group-grid">'+cards+'</div></section>';
    });
    return html;
  }
  // Teacher Tools cards. opts.audience "admin"|"teacher". Teacher: classId,
  // isOn(grant), preview (owner read-only preview), previewHref(tool).
  function renderTeacherTools(opts){
    var teacher=opts.audience==="teacher";
    return teacherTools.filter(function(t){
      if(t.audiences.indexOf(opts.audience)<0)return false;
      if(teacher){
        if(t.grant&&!opts.isOn(t.grant))return false;
        if(opts.preview&&t.noPreview)return false;
      }
      return true;
    }).map(function(t){
      var title=esc((teacher&&t.teacherTitle)||t.title);
      if(t.special)return teacher
        ?'<button type="button" class="teacher-tool-card act-as-student" data-act-as-student><span class="card-icon" aria-hidden="true">'+t.icon+'</span><span class="card-title">'+title+'</span></button>'
        :'<button type="button" id="actAsStudentCard" class="teacher-tool-card" style="cursor:pointer;font:inherit;border:1px solid #bbf7d0;background:#f0fdf4"><span class="card-icon">'+t.icon+'</span><span class="card-title" style="color:#166534">'+title+'</span></button>';
      var href=t.href;
      if(teacher)href=opts.preview&&t.previewTool?opts.previewHref(t.previewTool):withClass(href,opts.classId);
      return '<a class="teacher-tool-card'+(t.cls||"")+'"'+(t.elId&&!t.idLast?' id="'+t.elId+'"':'')+' href="'+esc(href)+'"'+(t.elId&&t.idLast?' id="'+t.elId+'"':'')+(t.newTab?' target="_blank" rel="noopener"':'')+'>'+iconHtml(t,"tool")+'<span class="card-title">'+title+'</span></a>';
    }).join("\n");
  }
  // Review queues a teacher can open from the Approvals button on teacher-home.
  var approvalLinks=[
    {grant:"chazara",title:"Chazara recordings",icon:"🔁",href:"chazara/teacher.html"},
    {grant:"shorashim",title:"Shorashim recordings",icon:"🌳",href:"shorashim/teacher.html"},
    {grant:"posuk-practice-scroll",title:"Posuk recordings",icon:"📜",href:"record_pesukim/teacher.html"},
    {grant:"student-rewards",title:"Point requests",icon:"🌟",href:"student-rewards/teacher.html"},
    {grant:"homework",title:"Homework to review",icon:"📚",href:"assignment-center/teacher.html"}
  ];
  root.B3HomeToolRegistry=Object.freeze({groups:groups,teacherTools:teacherTools,approvalLinks:approvalLinks,renderMap:renderMap,renderTeacherTools:renderTeacherTools,withClass:withClass,esc:esc});
})(typeof window!=="undefined"?window:globalThis);
