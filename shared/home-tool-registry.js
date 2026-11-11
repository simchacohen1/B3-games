(function(root){
  // The canonical class-grant catalog used to render the teacher homepage.
  // Companion cards are intentionally represented by the primary grant and
  // are added by index.html's existing shared-access behavior.
  const groups=[
    {id:"learn",icon:"<svg viewBox=\"0 0 64 64\" width=\"52\" height=\"52\" role=\"img\" aria-label=\"Rebbe\"><path d=\"M9 64c0-13 10-20 23-20s23 7 23 20z\" fill=\"#1f2937\"/><path d=\"M26 44l6 13 6-13z\" fill=\"#fff\"/><ellipse cx=\"32\" cy=\"29\" rx=\"11\" ry=\"12\" fill=\"#f3c79d\"/><path d=\"M20.5 28c0 15 5 25 11.5 25s11.5-10 11.5-25c-2 6-6 9-11.5 9s-9.5-3-11.5-9z\" fill=\"#4a3426\"/><path d=\"M27 36.5c2-1.6 3.5-1.6 5-.6 1.5-1 3-1 5 .6-2 .8-3.5 1-5 .4-1.5.6-3 .4-5-.4z\" fill=\"#4a3426\"/><circle cx=\"28\" cy=\"28\" r=\"1.5\" fill=\"#1f2937\"/><circle cx=\"36\" cy=\"28\" r=\"1.5\" fill=\"#1f2937\"/><path d=\"M25.5 24.5q2.5-1.5 5 0M33.5 24.5q2.5-1.5 5 0\" stroke=\"#4a3426\" stroke-width=\"1.3\" fill=\"none\" stroke-linecap=\"round\"/><ellipse cx=\"32\" cy=\"19\" rx=\"18\" ry=\"3.6\" fill=\"#111827\"/><path d=\"M21.5 19c0-8 3-12.5 10.5-12.5S42.5 11 42.5 19z\" fill=\"#111827\"/><path d=\"M21.8 15.5h20.4v3H21.8z\" fill=\"#374151\"/><path d=\"M32 7.5v4\" stroke=\"#374151\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>",title:"Chumash Cheder",subtitle:"Learn your posuk, then review it",tools:["posuk-practice-scroll","chazara"]},
    {id:"roots",icon:"🌳",title:"Shorashim Grove",subtitle:"Grow your Hebrew word skills",tools:["shorashim"]},
    {id:"skills",icon:"📚",title:"Skills Library",subtitle:"Rashi letters, Yiddish, and Gematria",tools:["rashi-letters","yiddish","gematria"]},
    {id:"more-learning",icon:"🕍",title:"Learning Beis Midrash",subtitle:"Halacha, Sefer HaMitzvos, and Mishnayos",tools:["halacha","sefer-hamitzvos","mishnayos-practice"]},
    {id:"class",icon:"🏡",title:"Class Village",subtitle:"Your gallery and rewards",tools:["gallery","class-gallery","student-rewards","daily-points","tag"]},
    {id:"challenge",icon:"🏆",title:"Challenge Playground",subtitle:"Quiz yourself or play a game",tools:["weekly-quiz","game-show","multiplayer-center"]}
  ];
  const tools={
    "sefer-hamitzvos":{title:"Sefer HaMitzvos",href:"sefer-hamitzvos/index.html",studentHref:"sefer-hamitzvos/index.html",icon:"📖",group:"more-learning",classGrant:"sefer-hamitzvos",grantGroup:"dual"},
    halacha:{title:"Halacha",href:"halacha/teacher.html",icon:"📔",group:"more-learning",companions:[{title:"Halacha — Teacher Lesson",href:"halacha/index.html?teacher=1",icon:"📖"}],classGrant:"halacha",grantGroup:"dual"},
    yiddish:{title:"Yiddish",href:"yiddish/teacher.html",icon:"assets/yiddish-icon-v2.png",group:"skills",classGrant:"yiddish",grantGroup:"dual"},
    "posuk-practice-scroll":{title:"Posuk Practice",href:"record_pesukim/teacher.html",studentHref:"record_pesukim/student.html",icon:"📜",group:"learn",companions:[{title:"Chumash חידון",href:"record_pesukim/student.html?mode=quiz",icon:"🧠",classGrant:"posuk-practice-scroll",grantGroup:"dual"},{title:"Mishnayos Practice",href:"record-mishnayos/student.html",teacherHref:"record-mishnayos/teacher.html",icon:"📖"},{title:"Mishnayos חידון",href:"record-mishnayos/student.html?mode=quiz",icon:"🧠"}]},
    "rashi-letters":{title:"Rashi Letters",href:"rashi-letters/teacher.html",icon:"אב",group:"skills",classGrant:"rashi-letters",grantGroup:"dual"},
    gematria:{title:"Gematria",href:"gematria/teacher.html",icon:"🔢",group:"skills",classGrant:"gematria",grantGroup:"dual"},
    shorashim:{title:"Shorashim",href:"shorashim/teacher.html",icon:"🌳",group:"roots",classGrant:"shorashim",grantGroup:"dual"},
    chazara:{title:"Chazara",href:"chazara/teacher.html",studentHref:"chazara/index.html",icon:"🔁",group:"learn",classGrant:"chazara",grantGroup:"dual"},
    "game-show":{title:"Game Show",href:"game-show/teacher.html",icon:"🏆",group:"challenge",classGrant:"game-show",grantGroup:"dual"},
    "student-rewards":{title:"Student Rewards",href:"student-rewards/teacher.html",icon:"🌟",group:"class",classGrant:"student-rewards",grantGroup:"dual"},
    "daily-points":{title:"Daily Points",href:"student-rewards/teacher.html?tab=Daily%20Points",icon:"✅",group:"class"},
    "weekly-quiz":{title:"Weekly Quiz",href:"weekly-quiz/teacher.html",icon:"📝",group:"challenge",classGrant:"weekly-quiz",grantGroup:"dual"},
    homework:{title:"Homework & Assignments",href:"assignment-center/teacher.html",icon:"📚",classGrant:"homework",grantGroup:"dual"},
    gallery:{title:"Gallery",href:"class-gallery/index.html",icon:"🖼️",group:"class",classGrant:"gallery",grantGroup:"dual"},
    tag:{title:"Tag Game",href:"class-gallery/index.html",icon:"🏃",group:"class",classGrant:"tag",grantGroup:"dual"},
    davening:{title:"Davening Player",href:"",classHrefs:{et:"davening_student_app_et/index.html",wt:"davening_student_app_wt/index.html"},supportedClasses:["et","wt"],icon:"📖",classGrant:"davening",grantGroup:"teacher"},
    "class-pointer":{title:"Class Pointer",href:"class-pointer-prototype/dashboard.html?teacher=1",icon:"👆",classGrant:"class-pointer",grantGroup:"unsorted"},
    "multiplayer-center":{title:"Multiplayer Arcade",href:"multiplayer/index.html",icon:"🎮",group:"challenge",classGrant:"multiplayer-center",grantGroup:"dual"},
    "name-picker":{title:"Name Picker",href:"name-picker/index.html",icon:"🎡",classGrant:"name-picker",grantGroup:"teacher"},
    chavrusa:{title:"Chavrusa of the Day",href:"chavrusa/index.html",icon:"👥",classGrant:"chavrusa",grantGroup:"teacher"},
    "mishnayos-practice":{title:"Mishnayos Practice",href:"mishnayos/teacher.html",icon:"🕍",group:"more-learning"}
  };
  tools["sync-to-nigri"]={title:"Sync to Nigri",href:"sync-to-nigri/index.html",icon:"🔄",classGrant:"sync-to-nigri",grantGroup:"teacher",schoolGate:"nigri"};
  tools["class-gallery"]=tools.gallery;
  const ownerToolGroups=[
    {id:"dual",title:"Student activities",description:"Students use these. The teacher also gets a control or reports view."},
    {id:"teacher",title:"Teacher-only tools",description:"Only the teacher sees these. Students never do."},
    {id:"unsorted",title:"Not sorted yet",description:"Still deciding where these belong."}
  ];
  const teacherActions=[
    {id:"act-as-student",title:"Sign in as a Student",icon:"👀",kind:"button",command:"act-as-student"},
    {id:"student-report",title:"Student Report",icon:"📈",href:"student-report/index.html",classParam:true},
    {id:"vocabulary-progress",title:"Vocabulary Progress",icon:"📚",href:"word-bank/teacher.html",classParam:true},
    {id:"manage-class",title:"Manage Class",icon:"🎛️",href:"admin.html?tab=students",classParam:true,preview:true},
    {id:"follow-teacher",title:"Follow the Teacher",icon:"👣",href:"follow-teacher/teacher.html",classParam:true,newTab:true,preview:false},
    {id:"share-screen",title:"Send Everyone to Share Screen",icon:"🖥️",href:"class-pointer-prototype/classroom.html?dashboard=teacher&sendEveryoneShare=1",classParam:true,newTab:true,preview:false,classGrant:"class-pointer"}
  ];
  root.B3HomeToolRegistry=Object.freeze({tools:Object.freeze(tools),groups:Object.freeze(groups),ownerToolGroups:Object.freeze(ownerToolGroups),teacherActions:Object.freeze(teacherActions)});
})(typeof window!=="undefined"?window:globalThis);
