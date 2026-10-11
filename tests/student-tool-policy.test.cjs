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
