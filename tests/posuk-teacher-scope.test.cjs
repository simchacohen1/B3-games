const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function scoped(access,selected,data){
 const reads=[];
 const db={ref:p=>({once:async()=>{reads.push(p);return {val:()=>data[p]??null}}})};
 const ctx={db,window:{B3SiteSettings:{workspaceId:'b3-2026'}},URLSearchParams,location:{search:selected?'?class='+selected:''},studentsMap:{assigned_child:'Child'}};
 const html=fs.readFileSync('record_pesukim/teacher.html','utf8'),start=html.indexOf('let teacherAccess='),end=html.indexOf('/* Comprehension',start);
 vm.runInNewContext(html.slice(start,end)+`\nteacherAccess=${JSON.stringify(access)};this.scope={scopedRosterSnapshot,scopedStudentData};`,ctx);
 return {scope:ctx.scope,reads};
}
test('Posuk teacher roster contains only selected assigned class members',async()=>{const x=scoped({authorized:true,role:'teacher',classIds:['mine']},'mine',{'b3Games/workspaces/b3-2026/classes/mine':{name:'My Class',active:true,toolGrants:{'posuk-practice-scroll':true},members:{assigned_child:{name:'Child',active:true},blocked:{active:false}}},'posukPractice/allowedStudents':{unrelated:{name:'Other Child'}}});const result=(await x.scope.scopedRosterSnapshot()).val();assert.deepEqual(Object.keys(result),['assigned_child']);assert.equal(result.assigned_child.classSection,'My Class');assert.deepEqual(x.reads,['b3Games/workspaces/b3-2026/classes/mine'])});
test('Posuk teacher cannot request an unassigned class through a URL',async()=>{const x=scoped({authorized:true,role:'teacher',classIds:['mine']},'another',{});await assert.rejects(x.scope.scopedRosterSnapshot(),/not assigned/);assert.equal(x.reads.length,0)});
test('Posuk aggregate history reads student-specific paths',async()=>{const x=scoped({authorized:true,role:'teacher',classIds:['mine']},'mine',{});await x.scope.scopedStudentData('posukPractice/attempts');assert.deepEqual(x.reads,['posukPractice/attempts/assigned_child'])});
