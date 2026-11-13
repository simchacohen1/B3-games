import {visibleClasses,visibleTools,dashboardStats} from "./model.mjs";
const roleInput=document.querySelector("#role"),searchInput=document.querySelector("#search");
const escapeHtml = value => String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
function render(){
 const role=roleInput.value,needle=searchInput.value.trim().toLocaleLowerCase();
 const scoped=visibleClasses(role),classes=scoped.filter(c=>[c.name,c.grade,c.teacher].some(v=>v.toLocaleLowerCase().includes(needle)));
 const tools=visibleTools(role).filter(t=>[t.name,t.description].some(v=>v.toLocaleLowerCase().includes(needle)));
 document.querySelector("#stats").innerHTML=dashboardStats(role,scoped).map(s=>`<div class="stat"><strong>${s.value}</strong><span>${escapeHtml(s.label)}</span></div>`).join("");
 document.querySelector("#classes").innerHTML=classes.length?classes.map(c=>`<article class="tile"><div class="emoji" aria-hidden="true">🏫</div><h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.teacher)}</p><span class="chip">${c.studentCount} fictional students</span></article>`).join(""):'<p class="empty">No matching classrooms.</p>';
 document.querySelector("#tools").innerHTML=tools.length?tools.map(t=>`<article class="tile"><div class="emoji" aria-hidden="true">${escapeHtml(t.icon)}</div><h3>${escapeHtml(t.name)}</h3><p>${escapeHtml(t.description)}</p><span class="chip">Planned feature · not active</span></article>`).join(""):'<p class="empty">No matching tools.</p>';
}
roleInput.addEventListener("change",render);searchInput.addEventListener("input",render);render();
