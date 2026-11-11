(function(root){
  // The canonical class-grant catalog used to render the teacher homepage.
  // Companion cards are intentionally represented by the primary grant and
  // are added by index.html's existing shared-access behavior.
  const groups=[
    {id:"learn",icon:"📜",title:"Chumash Cheder",subtitle:"Learn your posuk, then review it",tools:["posuk-practice-scroll","chazara"]},
    {id:"roots",icon:"🌳",title:"Shorashim Grove",subtitle:"Grow your Hebrew word skills",tools:["shorashim"]},
    {id:"skills",icon:"📚",title:"Skills Library",subtitle:"Rashi letters, Yiddish, and Gematria",tools:["rashi-letters","yiddish","gematria"]},
    {id:"more-learning",icon:"🕍",title:"Learning Beis Midrash",subtitle:"Halacha, Sefer HaMitzvos, and Mishnayos",tools:["halacha","sefer-hamitzvos","mishnayos-practice"]},
    {id:"class",icon:"🏡",title:"Class Village",subtitle:"Your gallery and rewards",tools:["gallery","class-gallery","student-rewards","daily-points","tag"]},
    {id:"challenge",icon:"🏆",title:"Challenge Playground",subtitle:"Quiz yourself or play a game",tools:["weekly-quiz","game-show","multiplayer-center"]}
  ];
  const tools={
    "sefer-hamitzvos":{title:"Sefer HaMitzvos",href:"sefer-hamitzvos/index.html",icon:"📖",group:"more-learning"},
    halacha:{title:"Halacha",href:"halacha/teacher.html",icon:"📔",group:"more-learning"},
    yiddish:{title:"Yiddish",href:"yiddish/teacher.html",icon:"assets/yiddish-icon-v2.png",group:"skills"},
    "posuk-practice-scroll":{title:"Posuk Practice",href:"record_pesukim/teacher.html",icon:"📜",group:"learn"},
    "rashi-letters":{title:"Rashi Letters",href:"rashi-letters/teacher.html",icon:"אב",group:"skills"},
    gematria:{title:"Gematria",href:"gematria/teacher.html",icon:"🔢",group:"skills"},
    shorashim:{title:"Shorashim",href:"shorashim/teacher.html",icon:"🌳",group:"roots"},
    chazara:{title:"Chazara",href:"chazara/teacher.html",icon:"🔁",group:"learn"},
    "game-show":{title:"Game Show",href:"game-show/teacher.html",icon:"🏆",group:"challenge"},
    "student-rewards":{title:"Student Rewards",href:"student-rewards/teacher.html",icon:"🌟",group:"class"},
    "daily-points":{title:"Daily Points",href:"student-rewards/teacher.html?tab=Daily%20Points",icon:"✅",group:"class"},
    "weekly-quiz":{title:"Weekly Quiz",href:"weekly-quiz/teacher.html",icon:"📝",group:"challenge"},
    homework:{title:"Homework & Assignments",href:"assignment-center/teacher.html",icon:"📚"},
    gallery:{title:"Gallery",href:"class-gallery/index.html",icon:"🖼️",group:"class"},
    tag:{title:"Tag Game",href:"class-gallery/index.html",icon:"🏃",group:"class"},
    davening:{title:"Davening Player",href:"davening_student_app/index.html",icon:"📖"},
    "class-pointer":{title:"Class Pointer",href:"class-pointer-prototype/dashboard.html?teacher=1",icon:"👆"},
    "multiplayer-center":{title:"Multiplayer Arcade",href:"multiplayer/index.html",icon:"🎮",group:"challenge"},
    "name-picker":{title:"Name Picker",href:"name-picker/index.html",icon:"🎡"},
    chavrusa:{title:"Chavrusa of the Day",href:"chavrusa/index.html",icon:"👥"},
    "mishnayos-practice":{title:"Mishnayos Practice",href:"mishnayos/teacher.html",icon:"🕍",group:"more-learning"}
  };
  tools["class-gallery"]=tools.gallery;
  root.B3HomeToolRegistry=Object.freeze({tools:Object.freeze(tools),groups:Object.freeze(groups)});
})(typeof window!=="undefined"?window:globalThis);
