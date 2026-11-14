/* Compact principal dashboard: presentation-only enhancement of already-authorized class cards.
 * Does not perform network reads or change class grants, controls, or access decisions.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  else root.B3PrincipalDashboard=api;
})(typeof window==="object"?window:globalThis,function(){
  "use strict";
  function gradeOf(name){
    const match=String(name||"").trim().match(/\b([A-Za-z]{1,3}\s*\d{1,2})\b/);
    return match?match[1].replace(/\s+/g,"").toUpperCase():"Other classes";
  }
  function safeText(value){return String(value==null?"":value);}
  function build(root,items,opts={}){
    if(!root||!root.ownerDocument)throw new TypeError("A dashboard container is required");
    const doc=root.ownerDocument;
    const entries=(items||[]).filter(x=>x&&x.card&&x.card.nodeType===1).map(x=>({
      name:safeText(x.name),teacher:safeText(x.teacher),id:safeText(x.id||x.name),card:x.card,grade:gradeOf(x.name)
    }));
    const shell=doc.createElement("section");shell.className="principal-overview";
    shell.setAttribute("aria-label","Supervised classes overview");
    const heading=doc.createElement("h2");heading.textContent="School overview";shell.append(heading);
    const summary=doc.createElement("p");summary.className="principal-overview-summary";
    summary.textContent=entries.length+" supervised "+(entries.length===1?"class":"classes")+
      (opts.teacherCount!=null?" · "+Number(opts.teacherCount)+" supervised teachers":"")+
      (opts.studentCount!=null?" · "+Number(opts.studentCount)+" students":"");
    shell.append(summary);
    const controls=doc.createElement("div");controls.className="principal-overview-controls";
    const search=doc.createElement("input");search.type="search";search.placeholder="Find a class or teacher";
    search.setAttribute("aria-label","Find a class or teacher");controls.append(search);
    const expand=doc.createElement("button");expand.type="button";expand.textContent="Expand all";controls.append(expand);
    const collapse=doc.createElement("button");collapse.type="button";collapse.textContent="Collapse all";controls.append(collapse);
    shell.append(controls);
    const groups=doc.createElement("div");groups.className="principal-overview-groups";shell.append(groups);
    const byGrade=new Map();
    entries.forEach(entry=>{if(!byGrade.has(entry.grade))byGrade.set(entry.grade,[]);byGrade.get(entry.grade).push(entry);});
    const allDetails=[];
    // Remember only UI expansion positions, not authorization or any student data.
    const storage=opts.storage||(typeof sessionStorage==="undefined"?null:sessionStorage);
    const key=opts.persistKey?"b3-principal-folds:"+opts.persistKey:null;
    let saved=[];
    try{if(storage&&key){const value=JSON.parse(storage.getItem(key)||"[]");if(Array.isArray(value))saved=value;}}catch(_){}
    const expanded=new Set(saved);
    function remember(){
      if(!storage||!key)return;
      try{storage.setItem(key,JSON.stringify(allDetails.filter(d=>d.open).map(d=>d.dataset.foldKey)));}catch(_){}
    }

    [...byGrade].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).forEach(([grade,list])=>{
      const group=doc.createElement("details");group.className="principal-grade";group.dataset.foldKey="grade:"+grade;group.open=expanded.has(group.dataset.foldKey);
      const title=doc.createElement("summary");title.textContent=grade+" · "+list.length+" "+(list.length===1?"class":"classes");group.append(title);
      const content=doc.createElement("div");content.className="principal-grade-classes";
      list.forEach(entry=>{
        const detail=doc.createElement("details");detail.className="principal-class";detail.dataset.foldKey="class:"+entry.id;detail.open=expanded.has(detail.dataset.foldKey);
        const caption=doc.createElement("summary");caption.textContent=entry.name+(entry.teacher?" · "+entry.teacher:"");
        detail.append(caption,entry.card);content.append(detail);allDetails.push(detail);
        detail.dataset.search=(entry.name+" "+entry.teacher+" "+entry.grade).toLocaleLowerCase();
      });
      group.append(content);groups.append(group);allDetails.push(group);
    });
    function applySearch(){
      const term=search.value.trim().toLocaleLowerCase();
      let shown=0;
      for(const group of groups.children){
        let matches=0;
        for(const detail of group.querySelectorAll(".principal-class")){
          const matched=!term||detail.dataset.search.includes(term);
          detail.hidden=!matched;
          if(matched)matches++;
        }
        group.hidden=!matches;shown+=matches;
        if(term&&matches)group.open=true;
      }
      summary.textContent=shown+" of "+entries.length+" supervised classes"+
        (opts.teacherCount!=null?" · "+Number(opts.teacherCount)+" supervised teachers":"")+
      (opts.studentCount!=null?" · "+Number(opts.studentCount)+" students":"");
    }
    allDetails.forEach(d=>d.addEventListener("toggle",remember));
    search.addEventListener("input",applySearch);
    expand.addEventListener("click",()=>{allDetails.forEach(d=>{if(!d.hidden)d.open=true;});remember();});
    collapse.addEventListener("click",()=>{allDetails.forEach(d=>{d.open=false;});remember();});
    root.replaceChildren(shell);
    return {shell,search,expand,collapse,entries};
  }
  return {gradeOf,build};
});
