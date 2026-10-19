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
    status:200,contentType:'text/html',body:'<!doctype html><html><body>'+body+'</body></html>'
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
  await page.locator('input[name="mode"][value="locked"]').check();
  await page.locator('#apply').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__followState?.mode)).toBe('locked');
  await expect(page.locator('#state')).toContainText('Locked');
  await page.locator('#unlock').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__followState?.mode)).toBe('independent');
  await expect(page.locator('#state')).toContainText('Independent');
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
