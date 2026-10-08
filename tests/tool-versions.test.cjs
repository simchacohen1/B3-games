const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('site-settings.js','utf8');
const helper=source.slice(source.indexOf('  function showToolVersions('),source.indexOf('  function onAuthStateChanged('));
function render(path,{authorized=true,acting=false,role='teacher',classIds=['mine']}={}){
 const bars=[],element=()=>({children:[],style:{},setAttribute(){},appendChild(e){this.children.push(e);}});
 const document={body:{insertBefore:e=>bars.push(e)},getElementById:()=>null,createElement:element};
 const context={document,URL,location:{href:'https://example.test/B3-games/'+path},SITE_BASE:'https://example.test/B3-games/',getActingStudent:()=>acting};
 vm.runInNewContext(helper,context);context.showToolVersions({authorized,role,classIds});return bars;
}
test('each dual-version tool offers teacher and student routes with the selected class',()=>{
 for(const path of ['yiddish','chazara','shorashim','gematria','halacha','weekly-quiz','game-show','student-rewards','record_pesukim','rashi-letters']){
  const bars=render(path+'/teacher.html?class=other');assert.equal(bars.length,1,path);
  const links=bars[0].children;assert.deepEqual(links.map(x=>x.textContent),['Teacher version','Student version']);
  assert.equal(new URL(links[1].href).searchParams.get('class'),'other');assert.equal(new URL(links[1].href).searchParams.get('demo'),'1');
 }
});
test('regular students and impersonated students do not receive teacher version links',()=>{assert.equal(render('yiddish/index.html',{authorized:false}).length,0);assert.equal(render('yiddish/index.html',{acting:true}).length,0);});
test('halacha student demonstration uses the teacher copy',()=>{const link=render('halacha/teacher.html')[0].children[1];assert.equal(new URL(link.href).searchParams.get('teacher'),'1');});

test('owner version links use ET rather than the all-classes wildcard',()=>{const bars=render('yiddish/index.html',{role:'admin',classIds:['*']});for(const link of bars[0].children)assert.equal(new URL(link.href).searchParams.get('class'),'et');});
