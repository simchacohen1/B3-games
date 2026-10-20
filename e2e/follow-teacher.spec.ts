import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT=path.resolve(__dirname,'..');
const core=fs.readFileSync(path.join(ROOT,'follow-teacher/core.js'),'utf8');
const student=fs.readFileSync(path.join(ROOT,'follow-teacher/student.js'),'utf8');
const teacher=fs.readFileSync(path.join(ROOT,'follow-teacher/teacher.js'),'utf8');

test('teacher chooses Locked then Unlock for an assigned class',async({page})=>{
  const raw=fs.readFileSync(path.join(ROOT,'follow-teacher/teacher.html'),'utf8');
  const body=raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]||'';
  await page.route('http://localhost:8099/**',route=>route.fulfill({
    status:200,contentType:'text/html',body:'<!doctype html><html><head><style>.hidden{display:none!important}</style></head><body>'+body+'</body></html>'
  }));
  await page.goto('http://localhost:8099/follow-teacher/teacher.html');
  await page.evaluate(()=>{
    const listeners=new Map<string,Function>();
    const user={uid:'teacher1'};
    const cls={name:'ET',active:true,toolGrants:{shorashim:true},members:{boy1:{name:'Boy One',active:true}}};
    (window as any).__followState=null;
    (window as any).B3_APP_CONTEXT={workspaceId:'b3-2026'};
    (window as any).firebase={
      apps:[{}],
      auth:()=>({currentUser:user}),
      database:()=>({ref:(url:string)=>({
        once:async()=>({val:()=>url.endsWith('/classes/et')?cls:(window as any).__followState}),
        on:(_event:string,fn:Function)=>{listeners.set(url,fn);fn({val:()=>url==='.info/serverTimeOffset'?0:(window as any).__followState});},
        off:()=>listeners.delete(url),
        set:async(row:any)=>{(window as any).__followState=row;listeners.get(url)?.({val:()=>row});},
        update:async(row:any)=>{(window as any).__followState={...(window as any).__followState,...row};listeners.get(url)?.({val:()=>(window as any).__followState});}
      })})
    };
    (window as any).B3SiteSettings={onAuthStateChanged:(cb:Function)=>{
      queueMicrotask(()=>cb(user,true,{role:'teacher',classIds:['et']}));
    }};
  });
  await page.addScriptTag({content:core});
  await page.addScriptTag({content:teacher});
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('input[name="mode"][value="independent"]')).toHaveCount(0);
  await expect(page.locator('input[name="mode"][value="free"]')).toBeChecked();
  await page.locator('#subdestination').selectOption('review');
  await page.locator('input[name="mode"][value="locked"]').check();
  await page.locator('#apply').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__followState?.mode)).toBe('locked');
  await expect(page.locator('#state')).toContainText('Review Shorashim');
  expect(await page.evaluate(()=>(window as any).__followState.subdestination)).toBe('review');
  await page.locator('#unlock').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__followState?.mode)).toBe('independent');
  await expect(page.locator('#state')).toContainText('free to choose');
  await page.locator('#destination').selectOption('class-pointer');
  await expect(page.locator('#pointerWorkspace')).toHaveAttribute('src',/class=et/);
  await expect(page.locator('#pointerWorkspace')).toHaveAttribute('src',/followTeacherWhiteboard=1/);
  await expect(page.locator('#subdestinationRow')).toBeHidden();
  expect(page.context().pages()).toHaveLength(1);
  await page.locator('#apply').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__followState?.destination)).toBe('class-pointer');
});

test('verified student follows Locked teacher to Shorashim without screen capture',async({page})=>{
  await page.route('http://localhost:8099/**',route=>route.fulfill({
    status:200,contentType:'text/html',body:'<!doctype html><html><body><h1>Learning activity</h1></body></html>'
  }));
  await page.goto('http://localhost:8099/chazara/index.html');
  await page.evaluate(()=>{
    sessionStorage.setItem('b3Games_studentId','boy1');
    sessionStorage.setItem('b3Games_studentClass','et');
    const ws='b3Games/workspaces/b3-2026/classes/et';
    const state={version:1,workspaceId:'b3-2026',classId:'et',teacherUid:'teacher1',
      mode:'locked',destination:'shorashim',revision:'lessonA',targets:'all',
      issuedAt:Date.now()-5000,heartbeatAt:Date.now()-1000,expiresAt:Date.now()+60000};
    const data:any={
      [ws+'/access/followTeacher']:state,
      [ws+'/members/boy1']:{active:true,toolAccess:{shorashim:true}},
      'b3Games/students/boy1/profile/active':true,
      [ws+'/toolGrants/shorashim']:true,
      [ws+'/active']:true,
      'b3Games/siteSettings':{}
    };
    const snap=(v:any)=>({val:()=>v,exists:()=>v!=null,child:(p:string)=>snap(p.split('/').reduce((o:any,k:string)=>o?.[k],v))});
    (window as any).firebase={
      auth:()=>({currentUser:{uid:'student1',getIdTokenResult:async()=>({
        claims:{b3StudentRole:'student',b3StudentId:'boy1',b3ClassId:'et'}})}}),
      database:()=>({ref:(url:string)=>({
        on:(ev:string,fn:Function)=>fn(snap(url==='.info/serverTimeOffset'?0:data[url])),
        off:()=>{},
        once:async()=>snap(data[url])
      })})
    };
  });
  await page.addScriptTag({content:core});
  await page.addScriptTag({content:student});
  await page.evaluate(()=>(window as any).FTTFollowStudent.start({
    workspaceId:'b3-2026',classId:'et',studentId:'boy1'
  }));
  await page.waitForURL('http://localhost:8099/shorashim/',{timeout:10000});
});

const destinations = Object.entries(require('../follow-teacher/core.js').DESTINATIONS) as [string,{label:string,path:string}][];
for (const classId of ['et','wt']) for (const [destination, entry] of destinations) {
  test(`${classId}: locked student follows to ${entry.label}, then Unlock revokes the lock exception`,async({page})=>{
    const now=Date.now();
    const state={version:1,workspaceId:'b3-2026',classId,teacherUid:'teacher1',
      mode:'locked',destination,revision:'expanded',targets:'all',
      issuedAt:now-5000,heartbeatAt:now-1000,expiresAt:now+60000};
    await page.route('http://localhost:8099/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><body><h1>Test learning activity</h1></body>'}));
    await page.addInitScript(({core,student,state,classId})=>{
      sessionStorage.setItem('b3Games_studentId','testBoy');sessionStorage.setItem('b3Games_studentClass',classId);
      const ws='b3Games/workspaces/b3-2026/classes/'+classId;
      const data:any={
        [ws+'/access/followTeacher']:state,[ws+'/members/testBoy']:{active:true},
        [ws+'/active']:true,'b3Games/students/testBoy/profile/active':true,
        'b3Games/siteSettings':{siteEnabled:false,access:{et:{mode:'locked'},wt:{mode:'locked'}}}
      };
      const snap=(v:any)=>({val:()=>v,exists:()=>v!=null,child:(p:string)=>snap(p.split('/').reduce((o:any,k:string)=>o?.[k],v))});
      let listener:Function=()=>{};
      (window as any).firebase={auth:()=>({currentUser:{uid:'testBoy',getIdTokenResult:async()=>({claims:{b3StudentRole:'student',b3StudentId:'testBoy',b3ClassId:classId}})}}),database:()=>({ref:(url:string)=>({
        on:(_ev:string,fn:Function)=>{if(url.endsWith('/followTeacher'))listener=fn;fn(snap(url==='.info/serverTimeOffset'?0:data[url]));},off:()=>{},once:async()=>snap(data[url])
      })})};
      (window as any).__unlock=()=>listener(snap({...state,mode:'independent'}));
      document.addEventListener('DOMContentLoaded',()=>{
        const a=document.createElement('script');a.textContent=core;document.body.append(a);
        const b=document.createElement('script');b.textContent=student;document.body.append(b);
        (window as any).FTTFollowStudent.start({workspaceId:'b3-2026',classId,studentId:'testBoy'});
      });
    },{core,student,state,classId});
    await page.goto('http://localhost:8099/');
    await page.waitForURL('http://localhost:8099'+entry.path,{timeout:10000});
    await expect.poll(()=>page.evaluate(tool=>(window as any).FTTFollowStudent.allowsLockedActivity(tool),destination)).toBe(true);
    expect(await page.evaluate(()=>(window as any).FTTFollowStudent.allowsLockedActivity('not-a-tool'))).toBe(false);
    await page.evaluate(()=>(window as any).__unlock());
    await expect.poll(()=>page.evaluate(tool=>(window as any).FTTFollowStudent.allowsLockedActivity(tool),destination)).toBe(false);
    await expect(page.locator('#fttFollowTeacherNotice')).toHaveCount(0);
  });
}

test('unsaved work defers navigation; latest Unlock cancels it',async({page})=>{
  await page.route('http://localhost:8099/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<body><div data-ftt-unsaved="true">Unsent recording</div></body>'}));
  await page.goto('http://localhost:8099/chazara/');
  await page.evaluate(()=>{
    sessionStorage.setItem('b3Games_studentId','testBoy');sessionStorage.setItem('b3Games_studentClass','wt');
    const ws='b3Games/workspaces/b3-2026/classes/wt';
    const state={workspaceId:'b3-2026',classId:'wt',teacherUid:'teacher1',mode:'locked',destination:'halacha',revision:'busy',targets:'all',issuedAt:Date.now()-5000,heartbeatAt:Date.now()-1000,expiresAt:Date.now()+60000};
    let handler:Function=()=>{};
    const snap=(v:any)=>({val:()=>v,exists:()=>v!=null,child:(p:string)=>snap(p.split('/').reduce((o:any,k:string)=>o?.[k],v))});
    const data:any={[ws+'/access/followTeacher']:state,[ws+'/members/testBoy']:{active:true},[ws+'/active']:true,'b3Games/students/testBoy/profile/active':true,'b3Games/siteSettings':{}};
    (window as any).firebase={auth:()=>({currentUser:{uid:'testBoy',getIdTokenResult:async()=>({claims:{b3StudentRole:'student',b3StudentId:'testBoy',b3ClassId:'wt'}})}}),database:()=>({ref:(url:string)=>({on:(_e:string,fn:Function)=>{if(url.endsWith('/followTeacher'))handler=fn;fn(snap(data[url]));},off:()=>{},once:async()=>snap(data[url])})})};
    (window as any).__unlock=()=>handler(snap({...state,mode:'independent'}));
  });
  await page.addScriptTag({content:core});await page.addScriptTag({content:student});
  await page.evaluate(()=>(window as any).FTTFollowStudent.start({workspaceId:'b3-2026',classId:'wt',studentId:'testBoy'}));
  await expect(page.locator('#fttFollowTeacherNotice')).toContainText('Finish recording',{timeout:8000});
  expect(page.url()).toContain('/chazara/');
  await page.evaluate(()=>(window as any).__unlock());
  await expect(page.locator('#fttFollowTeacherNotice')).toHaveCount(0);
});

for(const classId of ['et','wt']) for(const destination of ['halacha','class-pointer']) test(`${classId}: actual shared gate opens only selected ${destination} while locked, then closes on Unlock`,async({page})=>{
  const gate=fs.readFileSync(path.join(ROOT,'game-gate.js'),'utf8');
  const policy=fs.readFileSync(path.join(ROOT,'backend/functions/student-tool-policy.js'),'utf8');
  const ws='b3Games/workspaces/b3-2026/classes/'+classId;
  const data:any={
    'b3Games/students/testBoy/profile':{active:true},
    'b3Games/students/testBoy/profile/active':true,
    'b3Games/students/testBoy/memberships':{test:{workspaceId:'b3-2026',classId,active:true}},
    [ws+'/name']:classId,[ws+'/active']:true,[ws+'/members/testBoy']:{active:true},
    [ws+'/access']:{mode:'locked'},[ws+'/siteEnabled']:false,
    'b3Games/siteSettings':{siteEnabled:false,classAccess:{et:{mode:'locked'},wt:{mode:'locked'}}}
  };
  await page.route('https://b3-games-default-rtdb.firebaseio.com/**',route=>{
    const key=new URL(route.request().url()).pathname.slice(1).replace(/\.json$/,'');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data[key]??null)});
  });
  await page.route('http://localhost:8099/**',route=>{
    const pathname=new URL(route.request().url()).pathname;
    const scripts:Record<string,string>={'/game-gate.js':gate,'/follow-teacher/core.js':core,'/follow-teacher/student.js':student};
    if(pathname.endsWith('.js'))return route.fulfill({status:200,contentType:'text/javascript',body:scripts[pathname]||''});
    const tool=pathname.startsWith('/class-pointer-prototype/')?'class-pointer':pathname.startsWith('/halacha')?'halacha':'gematria';
    return route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><head><script src="/game-gate.js" data-game-id="${tool}"></script></head><body><h1>Learning</h1></body></html>`});
  });
  await page.addInitScript(({classId,data,ws,policy,destination})=>{
    sessionStorage.setItem('b3Games_studentId','testBoy');sessionStorage.setItem('b3Games_studentClass',classId);
    const state={workspaceId:'b3-2026',classId,teacherUid:'teacher1',mode:'locked',destination,revision:'gate',targets:'all',issuedAt:Date.now()-5000,heartbeatAt:Date.now()-1000,expiresAt:Date.now()+60000};
    let callback:Function=()=>{};
    const snap=(v:any)=>({val:()=>v,exists:()=>v!=null,child:(p:string)=>snap(p.split('/').reduce((o:any,k:string)=>o?.[k],v))});
    const user={uid:'testBoy',getIdToken:async()=>'synthetic-test-token',getIdTokenResult:async()=>({claims:{b3StudentRole:'student',b3StudentId:'testBoy',b3ClassId:classId}})};
    const auth={currentUser:user,authStateReady:async()=>{},onAuthStateChanged:(fn:Function)=>{queueMicrotask(()=>fn(user));return()=>{};}};
    (window as any).B3_FIREBASE_CONFIG={};
    (window as any).B3SiteSettings={onAuthStateChanged:(fn:Function)=>queueMicrotask(()=>fn(user,false,null))};
    (window as any).firebase={SDK_VERSION:'12.15.0',apps:[{}],auth:()=>auth,database:()=>({ref:(url:string)=>({
      on:(_event:string,fn:Function)=>{if(url.endsWith('/followTeacher'))callback=fn;queueMicrotask(()=>fn(snap(url.endsWith('/followTeacher')?state:url==='.info/serverTimeOffset'?0:data[url])));},off:()=>{},once:async()=>snap(data[url])
    })})};
    (window as any).__unlock=()=>callback(snap({...state,mode:'independent'}));
    // Install the actual student tool permission policy before the gate runs.
    new Function(policy)();
  },{classId,data,ws,policy,destination});
  await page.goto('http://localhost:8099'+(destination==='class-pointer'?'/class-pointer-prototype/student-view.html':'/halacha/'));
  await expect.poll(()=>page.evaluate(tool=>(window as any).FTTFollowStudent?.allowsLockedActivity(tool),destination)).toBe(true);
  await expect(page.locator('#b3-gate-overlay')).toHaveCount(0);
  await page.evaluate(()=>(window as any).__unlock());
  await expect(page.locator('#b3-gate-overlay')).toBeVisible();
});
