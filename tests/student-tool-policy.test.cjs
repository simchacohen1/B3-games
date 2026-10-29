const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../backend/functions/student-tool-policy.js');
test('existing students retain tools by default and restrictions stay within the selected membership',()=>{
 const cls={members:{one:{toolAccess:{yiddish:false}},two:{}}};
 assert.equal(policy.allowed(cls,'one','yiddish'),false);assert.equal(policy.allowed(cls,'two','yiddish'),true);assert.equal(policy.allowed(cls,'one','chazara'),true);
});
test('Gallery aliases cannot bypass a restriction or an administrator grant',()=>{
 const cls={toolGrants:{tag:true},members:{one:{toolAccess:{gallery:false}}}};
 for(const tool of ['gallery','tag','class-gallery']){assert.equal(policy.granted(cls,tool),true);assert.equal(policy.allowed(cls,'one',tool),false);}
 assert.equal(policy.granted(cls,'yiddish'),false);
});
test('Rashi Letters recognizes the legacy rashi class grant',()=>{
 const cls={toolGrants:{rashi:true},members:{one:{toolAccess:{'rashi-letters':false}}}};
 assert.equal(policy.granted(cls,'rashi-letters'),true);
 assert.equal(policy.allowed(cls,'one','rashi-letters'),false);
 assert.deepEqual(policy.aliases('rashi-letters'),['rashi','rashi-letters']);
});
test('Multiplayer Center is teacher-managed as a student activity',()=>{
 assert.ok(policy.studentActivities.includes('multiplayer-center'));
 const cls={toolGrants:{'multiplayer-center':true},members:{one:{toolAccess:{'multiplayer-center':false}},two:{}}};
 assert.equal(policy.granted(cls,'multiplayer-center'),true);
 assert.equal(policy.allowed(cls,'one','multiplayer-center'),false);
 assert.equal(policy.allowed(cls,'two','multiplayer-center'),true);
});
test('teacher controls show granted student activities with current per-student selections',()=>{
 const window={B3StudentTools:policy};vm.runInNewContext(fs.readFileSync('student-tool-controls.js','utf8'),{window});
 const html=window.B3StudentToolControls.render('mine',{toolGrants:{yiddish:true,chazara:false,'name-picker':true},members:{one:{name:'One <script>',toolAccess:{yiddish:false}},two:{name:'Two'}}},{yiddish:['Yiddish'],chazara:['Chazara'],'name-picker':['Name Picker']});
 assert.match(html,/One &lt;script&gt;/);assert.doesNotMatch(html,/Chazara|Name Picker|<script>/);
 assert.equal((html.match(/data-tool="yiddish"/g)||[]).length,2);assert.equal((html.match(/data-tool="yiddish" checked/g)||[]).length,1);
});
test('class-wide teacher writes cannot override administrator tool grants',()=>{
 const rule=JSON.parse(fs.readFileSync('firebase-rules.json','utf8')).rules.b3Games.workspaces.$workspaceId.classes.$classId;
 assert.doesNotMatch(rule['.write'],/teachers/);assert.match(rule.access['.write'],/teachers/);assert.equal(rule.members,undefined);
});

test('owner and teacher see the same granted tools for any class, including ET and WT',()=>{
 const window={B3StudentTools:policy};vm.runInNewContext(fs.readFileSync('student-tool-controls.js','utf8'),{window});
 const cls={toolGrants:{yiddish:true,chazara:false},members:{pupil:{name:'Pupil'}}};
 const catalog={yiddish:['Yiddish'],chazara:['Chazara']};
 for(const id of ['et','wt','roomC']){
  const owner=window.B3StudentToolControls.render(id,cls,catalog,true);
  const teacher=window.B3StudentToolControls.render(id,cls,catalog,false);
  assert.equal(owner,teacher);
  assert.match(owner,/Yiddish/);
  assert.doesNotMatch(owner,/Chazara/);
 }
});
