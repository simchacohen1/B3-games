/* Compact principal dashboard: School → Grade → Class → Students → Details.
 * Presentation-only. It arranges classes, rosters and class cards the page has
 * already resolved through the signed-in user's own access checks. It performs
 * no network reads and never changes grants, controls or access decisions.
 * Collapsed/expanded state is a convenience, not authorization.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.B3PrincipalDashboard=api;
})(typeof window==="object"?window:globalThis,function(){
  "use strict";
  const OTHER_GRADE="Other classes";
  const HEBREW_GRADES=["alef","beis","gimmel","daled","hei","vov","zayin","ches"];

  function text(value){return String(value==null?"":value).trim();}
  function lower(value){return text(value).toLocaleLowerCase();}
  function plural(count,one,many){return count+" "+(count===1?one:(many||one+"s"));}

  /* Grade label for a class. An explicit grade on the class record wins;
   * otherwise it is read from the class name ("B3 ET", "Grade 3", "3rd grade",
   * "Kita Gimmel"). Classes with no recognizable grade share one group. */
  function gradeOf(name,explicit){
    const given=text(explicit);
    if(given)return /^\d{1,2}$/.test(given)?"Grade "+Number(given):given;
    const value=text(name);
    let match=value.match(/\bgrade\s*(\d{1,2})\b/i)||value.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+grade\b/i);
    if(match)return "Grade "+Number(match[1]);
    match=value.match(/\b(?:kita|kitah)\s+([a-z]+)\b/i);
    if(match&&HEBREW_GRADES.includes(match[1].toLowerCase()))return "Kita "+match[1][0].toUpperCase()+match[1].slice(1).toLowerCase();
    match=value.match(/\b([A-Za-z]{1,3}\s*\d{1,2})\b/);
    return match?match[1].replace(/\s+/g,"").toUpperCase():OTHER_GRADE;
  }

  function compareNames(a,b){return a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"});}
  function compareGrades(a,b){
    if(a===OTHER_GRADE)return b===OTHER_GRADE?0:1;
    if(b===OTHER_GRADE)return -1;
    return compareNames(a,b);
  }

  /* Normalize the caller's items into the School → Grade → Class → Students
   * tree with counts at every level. Pure: no DOM, safe to unit test. */
  function buildModel(items,opts){
    opts=opts||{};
    const defaultSchool=text(opts.schoolName)||"School";
    const classes=(items||[]).filter(Boolean).map(item=>{
      const name=text(item.name)||text(item.id);
      const seen=new Set();
      const students=(item.students||[]).filter(s=>s&&text(s.id)&&!seen.has(text(s.id))&&seen.add(text(s.id))).map(s=>({
        id:text(s.id),name:text(s.name)||text(s.id),online:s.online===true
      })).sort((a,b)=>compareNames(a.name,b.name));
      return {
        id:text(item.id)||name,name,teacher:text(item.teacher),card:item.card||null,
        grade:gradeOf(name,item.grade),schoolId:text(item.schoolId),
        schoolName:text(item.schoolName)||defaultSchool,students,
        online:students.filter(s=>s.online).length
      };
    });
    const schoolMap=new Map();
    classes.forEach(cls=>{
      const key=cls.schoolId||"school:"+cls.schoolName;
      if(!schoolMap.has(key))schoolMap.set(key,{key,name:cls.schoolName,grades:new Map()});
      const school=schoolMap.get(key);
      if(!school.grades.has(cls.grade))school.grades.set(cls.grade,[]);
      school.grades.get(cls.grade).push(cls);
    });
    const unique=list=>{
      const ids=new Set(),online=new Set();
      list.forEach(cls=>cls.students.forEach(s=>{ids.add(s.id);if(s.online)online.add(s.id);}));
      return {students:ids.size,online:online.size};
    };
    const schools=[...schoolMap.values()].sort((a,b)=>compareNames(a.name,b.name)).map(school=>{
      const grades=[...school.grades.entries()].sort(([a],[b])=>compareGrades(a,b)).map(([name,list])=>{
        list.sort((a,b)=>compareNames(a.name,b.name)||compareNames(a.id,b.id));
        return Object.assign({name,key:school.key+"/"+name,classes:list},unique(list));
      });
      const all=grades.flatMap(g=>g.classes);
      return Object.assign({key:school.key,name:school.name,grades,classCount:all.length},unique(all));
    });
    const teachers=new Set();
    classes.forEach(cls=>cls.teacher.split(",").map(text).filter(Boolean).forEach(t=>teachers.add(t)));
    const totals=Object.assign({
      schools:schools.length,
      grades:schools.reduce((n,s)=>n+s.grades.length,0),
      classes:classes.length,
      teachers:opts.teacherCount!=null?Number(opts.teacherCount):teachers.size
    },unique(classes));
    return {schools,classes,totals};
  }

  /* Decide whether one class is shown for the current search and filters and
   * which of its students are listed. Pure. `studentMatch` is true when the
   * class is shown only because specific students matched the search. */
  function matchClass(cls,filters){
    filters=filters||{};
    const term=lower(filters.term),status=filters.status||"";
    const hide={show:false,students:[],studentMatch:false};
    if(filters.grade&&cls.grade!==filters.grade)return hide;
    if(filters.classId&&cls.id!==filters.classId)return hide;
    let students=cls.students;
    if(status==="online")students=students.filter(s=>s.online);
    else if(status==="offline")students=students.filter(s=>!s.online);
    if(status&&!students.length)return hide;
    if(!term)return {show:true,students,studentMatch:false};
    const classHit=lower(cls.name+" "+cls.teacher+" "+cls.grade+" "+cls.schoolName).includes(term);
    if(classHit)return {show:true,students,studentMatch:false};
    const hits=students.filter(s=>lower(s.name).includes(term));
    return hits.length?{show:true,students:hits,studentMatch:true}:hide;
  }

  function build(container,items,opts){
    opts=opts||{};
    if(!container||!container.ownerDocument)throw new TypeError("A dashboard container is required");
    const doc=container.ownerDocument;
    const model=buildModel(items,opts);
    const showOnline=opts.showOnline!==false;
    const el=(tag,className,content)=>{
      const node=doc.createElement(tag);
      if(className)node.className=className;
      if(content!=null)node.textContent=content;
      return node;
    };
    const badge=(content,kind)=>el("span","pd-badge"+(kind?" pd-badge-"+kind:""),content);
    const onlineBadge=count=>badge(count+" online",count?"online":"offline");

    // Remember only which sections are open — never authorization or student data.
    // Reading sessionStorage can throw when the browser blocks site storage.
    let storage=opts.storage||null;
    try{if(!storage&&typeof sessionStorage!=="undefined")storage=sessionStorage;}catch(_){}
    const storeKey=opts.persistKey?"b3-principal-folds:"+opts.persistKey:null;
    let saved=null;
    try{if(storage&&storeKey){const value=JSON.parse(storage.getItem(storeKey)||"null");if(Array.isArray(value))saved=value;}}catch(_){}
    const wasOpen=new Set(saved||[]);
    const folds=[];
    function remember(){
      if(!storage||!storeKey)return;
      try{storage.setItem(storeKey,JSON.stringify(folds.filter(d=>d.open).map(d=>d.dataset.foldKey)));}catch(_){}
    }
    function fold(className,key,level,defaultOpen){
      const details=el("details","pd-fold "+className);
      details.dataset.foldKey=key;details.dataset.level=level;
      details.open=saved?wasOpen.has(key):!!defaultOpen;
      const summary=el("summary","pd-summary");
      const body=el("div","pd-body");
      details.append(summary,body);
      details.addEventListener("toggle",remember);
      folds.push(details);
      return {details,summary,body};
    }
    function heading(summary,icon,title,subtitle){
      summary.append(el("span","pd-chevron"));
      if(icon){const i=el("span","pd-icon",icon);i.setAttribute("aria-hidden","true");summary.append(i);}
      const label=el("span","pd-title",title);
      if(subtitle)label.append(el("span","pd-subtitle",subtitle));
      summary.append(label);
      const badges=el("span","pd-badges");summary.append(badges);
      return badges;
    }

    const shell=el("section","principal-overview");
    shell.setAttribute("aria-label","School overview");
    shell.append(el("h2",null,model.schools.length===1?model.schools[0].name+" overview":"School overview"));

    // At-a-glance statistics.
    const stats=el("div","pd-stats");
    const totals=model.totals;
    [["Grades",totals.grades],["Classes",totals.classes],["Teachers",totals.teachers],["Students",totals.students]]
      .concat(showOnline?[["Online now",totals.online,"online"]]:[])
      .forEach(([label,value,kind])=>{
        const tile=el("div","pd-stat"+(kind?" pd-stat-"+kind:""));
        tile.append(el("strong",null,String(value)),el("span",null,label));
        stats.append(tile);
      });
    shell.append(stats);
    if(showOnline&&opts.onlineHint)shell.append(el("p","pd-hint",opts.onlineHint));

    // Search, filters and expand/collapse controls.
    const controls=el("div","principal-overview-controls");
    const search=el("input");search.type="search";
    search.placeholder="Search students, teachers or classes";
    search.setAttribute("aria-label","Search students, teachers or classes");
    const option=(value,name)=>{const o=el("option",null,name);o.value=value;return o;};
    const select=(label,options)=>{
      const node=el("select");node.setAttribute("aria-label",label);
      options.forEach(([value,name])=>node.append(option(value,name)));
      return node;
    };
    const gradeNames=[...new Set(model.classes.map(c=>c.grade))].sort(compareGrades);
    const gradeSelect=select("Filter by grade",[["","All grades"]].concat(gradeNames.map(g=>[g,g])));
    const classSelect=select("Filter by class",[["","All classes"]]);
    const statusSelect=select("Filter by status",[["","Any status"],["online","Online now"],["offline","Not online"]]);
    function fillClasses(){
      const keep=classSelect.value;
      const list=model.classes.filter(c=>!gradeSelect.value||c.grade===gradeSelect.value)
        .slice().sort((a,b)=>compareNames(a.name,b.name));
      classSelect.replaceChildren(option("","All classes"),...list.map(c=>option(c.id,c.name)));
      classSelect.value=list.some(c=>c.id===keep)?keep:"";
    }
    fillClasses();
    const expand=el("button",null,"Expand all");expand.type="button";
    const collapse=el("button",null,"Collapse all");collapse.type="button";
    const clear=el("button","pd-clear","Clear");clear.type="button";clear.hidden=true;
    controls.append(search,gradeSelect,classSelect);
    if(showOnline)controls.append(statusSelect);
    controls.append(clear,expand,collapse);
    shell.append(controls);
    const summary=el("p","principal-overview-summary");
    summary.setAttribute("role","status");summary.setAttribute("aria-live","polite");
    shell.append(summary);
    const empty=el("p","pd-empty","Nothing matches. Try a different search or clear the filters.");
    empty.hidden=true;shell.append(empty);

    // The tree.
    const groups=el("div","principal-overview-groups");shell.append(groups);
    const classViews=[];
    const crumb=(label,target)=>{
      const button=el("button","pd-crumb",label);button.type="button";
      button.addEventListener("click",()=>{
        if(target.scrollIntoView)target.scrollIntoView({block:"start",behavior:"smooth"});
        target.querySelector("summary").focus({preventScroll:true});
      });
      return button;
    };
    model.schools.forEach(school=>{
      const schoolFold=fold("principal-school","school:"+school.key,"school",true);
      const schoolBadges=heading(schoolFold.summary,"🏫",school.name);
      schoolBadges.append(badge(plural(school.grades.length,"grade")),badge(plural(school.classCount,"class","classes")),badge(plural(school.students,"student")));
      if(showOnline)schoolBadges.append(onlineBadge(school.online));
      school.grades.forEach(grade=>{
        const gradeFold=fold("principal-grade","grade:"+grade.key,"grade",false);
        const gradeBadges=heading(gradeFold.summary,"🎓",grade.name);
        gradeBadges.append(badge(plural(grade.classes.length,"class","classes")),badge(plural(grade.students,"student")));
        if(showOnline)gradeBadges.append(onlineBadge(grade.online));
        gradeFold.body.classList.add("principal-grade-classes");
        grade.classes.forEach(cls=>{
          const classFold=fold("principal-class","class:"+cls.id,"class",false);
          const classBadges=heading(classFold.summary,"📘",cls.name,cls.teacher?"Teacher: "+cls.teacher:"");
          classBadges.append(badge(plural(cls.students.length,"student")));
          if(showOnline)classBadges.append(onlineBadge(cls.online));

          const trail=el("nav","pd-trail");trail.setAttribute("aria-label","You are here");
          trail.append(crumb(school.name,schoolFold.details),el("span","pd-sep","›"),crumb(grade.name,gradeFold.details),el("span","pd-sep","›"),el("span","pd-here",cls.name));
          classFold.body.append(trail);

          // Students → details.
          const studentsFold=fold("principal-students","students:"+cls.id,"students",false);
          studentsFold.summary.append(el("span","pd-chevron"),el("span","pd-title","Students"));
          const studentBadges=el("span","pd-badges");studentsFold.summary.append(studentBadges);
          const countBadge=badge(String(cls.students.length));studentBadges.append(countBadge);
          const list=el("ul","pd-student-list");
          const none=el("p","pd-none",cls.students.length?"No students match.":"No students are in this class yet.");
          none.hidden=cls.students.length>0;
          studentsFold.body.append(none,list);
          const rows=cls.students.map(student=>{
            const item=el("li","pd-student-row");
            const studentFold=fold("principal-student","student:"+cls.id+"/"+student.id,"student",false);
            studentFold.summary.append(el("span","pd-chevron"));
            if(showOnline){
              const dot=el("span","pd-dot"+(student.online?" pd-dot-on":""));
              dot.setAttribute("aria-hidden","true");studentFold.summary.append(dot);
            }
            studentFold.summary.append(el("span","pd-title",student.name));
            if(showOnline&&student.online)studentFold.summary.append(badge("Online","online"));
            const facts=el("dl","pd-facts");
            const fact=(label,value)=>{if(value)facts.append(el("dt",null,label),el("dd",null,value));};
            if(showOnline)fact("Status",student.online?"Online now":"Not online");
            fact("Class",cls.name);fact("Grade",grade.name);fact("Teacher",cls.teacher);
            const others=model.classes.filter(c=>c!==cls&&c.students.some(s=>s.id===student.id)).map(c=>c.name);
            fact("Also in",others.join(", "));
            studentFold.body.append(facts);
            const actions=typeof opts.studentActions==="function"?opts.studentActions(cls,student)||[]:[];
            const bar=el("div","pd-actions");
            actions.forEach(action=>{
              if(!action||!action.href)return;
              const link=el("a","pd-action",action.label);link.href=action.href;
              if(action.newTab){link.target="_blank";link.rel="noopener";}
              bar.append(link);
            });
            if(bar.children.length)studentFold.body.append(bar);
            item.append(studentFold.details);list.append(item);
            return {student,item};
          });
          classFold.body.append(studentsFold.details);

          // The original class card (tools, teacher actions, class controls) is
          // moved, not cloned, so every link, button and bound handler survives.
          if(cls.card){
            const toolsFold=fold("principal-tools","tools:"+cls.id,"tools",false);
            toolsFold.summary.append(el("span","pd-chevron"),el("span","pd-title","Class tools & settings"));
            toolsFold.body.append(cls.card);
            classFold.body.append(toolsFold.details);
          }
          gradeFold.body.append(classFold.details);
          classViews.push({cls,classFold,gradeFold,schoolFold,studentsFold,rows,none,countBadge});
        });
        schoolFold.body.append(gradeFold.details);
      });
      groups.append(schoolFold.details);
    });

    function apply(){
      const filters={term:search.value,grade:gradeSelect.value,classId:classSelect.value,status:showOnline?statusSelect.value:""};
      const active=!!(text(filters.term)||filters.grade||filters.classId||filters.status);
      let shownClasses=0;const shownStudents=new Set();
      classViews.forEach(view=>{
        const result=matchClass(view.cls,filters);
        view.classFold.details.hidden=!result.show;
        if(!result.show)return;
        shownClasses++;
        const visible=new Set(result.students.map(s=>s.id));
        view.rows.forEach(row=>{row.item.hidden=!visible.has(row.student.id);});
        result.students.forEach(s=>shownStudents.add(s.id));
        view.none.hidden=result.students.length>0;
        view.countBadge.textContent=result.students.length===view.cls.students.length
          ?String(view.cls.students.length):result.students.length+" of "+view.cls.students.length;
        // Reveal what the user asked for; never collapse what they opened.
        if(active){view.schoolFold.details.open=true;view.gradeFold.details.open=true;}
        if(filters.classId||result.studentMatch||filters.status)view.classFold.details.open=true;
        if(result.studentMatch||filters.status)view.studentsFold.details.open=true;
      });
      for(const school of groups.children){
        let any=false;
        for(const grade of school.querySelectorAll(".principal-grade")){
          const has=[...grade.querySelectorAll(".principal-class")].some(c=>!c.hidden);
          grade.hidden=!has;any=any||has;
        }
        school.hidden=!any;
      }
      clear.hidden=!active;
      empty.hidden=shownClasses>0||!model.classes.length;
      summary.textContent=active
        ?"Showing "+shownClasses+" of "+plural(model.classes.length,"class","classes")+" · "+plural(shownStudents.size,"student")
        :plural(model.classes.length,"supervised class","supervised classes")+" in "+plural(totals.grades,"grade")+" · "+plural(totals.teachers,"supervised teacher")+" · "+plural(totals.students,"student");
    }
    search.addEventListener("input",apply);
    gradeSelect.addEventListener("change",()=>{fillClasses();apply();});
    classSelect.addEventListener("change",apply);
    statusSelect.addEventListener("change",apply);
    clear.addEventListener("click",()=>{search.value="";gradeSelect.value="";statusSelect.value="";fillClasses();classSelect.value="";apply();search.focus();});
    expand.addEventListener("click",()=>{folds.forEach(d=>{d.open=true;});remember();});
    collapse.addEventListener("click",()=>{folds.forEach(d=>{d.open=false;});remember();});
    apply();
    container.replaceChildren(shell);
    return {shell,search,gradeSelect,classSelect,statusSelect,expand,collapse,clear,model,entries:model.classes};
  }
  return {gradeOf,buildModel,matchClass,build};
});
