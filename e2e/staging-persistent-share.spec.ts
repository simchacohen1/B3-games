import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(__dirname,'..');
const room='class-pointer-12345678-1234-1234-1234-123456789abc';
test.use({video:'off'});

test('staging-only persistent window keeps student capture active while navigating',async({page,context})=>{
  await context.addInitScript(({room})=>{
    (window as any).B3_STAGING_MODE=true;
    (window as any).B3_FIREBASE_CONFIG={projectId:'fun-torah-tools-staging'};
    (window as any).FunTorahStudentClass={resolve:async()=>({workspaceId:'b3-2026',classId:'TEST-ALEF'})};
    (window as any).ClassPointerBoards={reset(){}};
    const auth:any=()=>({setPersistence:async()=>{},signInWithCustomToken:async(token:string)=>{(window as any).__signedInToken=token;}});
    auth.Auth={Persistence:{SESSION:'session'}};
    (window as any).firebase={
      apps:[{}],initializeApp(){},
      auth,
      database:()=>({ref:(key:string)=>({
        on(_event:string,callback:(value:any)=>void){
          if(key.endsWith('/classPointerSessions'))setTimeout(()=>callback({val:()=>({[room]:{roomId:room,createdAt:Date.now(),teacherUid:'teacher-alef',studentScreenSharing:true,shareRequest:{at:Date.now()}}})}),20);
        },
        off(){},
        once:async()=>({val:()=>({})})
      })})
    };
    class Peer{
      id:string; handlers:Record<string,Function>={};
      constructor(id:string){this.id=id;queueMicrotask(()=>this.handlers.open?.(id));}
      once(type:string,callback:Function){this.handlers[type]=callback;}
      on(type:string,callback:Function){this.handlers[type]=callback;}
      connect(target:string){return{peer:target,open:true,on(){},send(){},close(){}};}
      call(){return{on(){},close(){}};}
      destroy(){}
    }
    (window as any).Peer=Peer;
  },{room});
  await context.route('https://us-central1-fun-torah-tools-staging.cloudfunctions.net/**',async route=>{
    const body=JSON.parse(route.request().postData()||'{}');
    let response:any={ok:true};
    if(body.action==='login')response={ok:true,id:'test_student_alef',classId:'TEST-ALEF',customToken:'fictional-student-token'};
    if(body.action==='permissions')response={ok:true,screenSharingDenied:false,whiteboardDenied:false};
    if(body.action==='issue')response={ok:true,token:'a'.repeat(64),studentName:'Test Student A1'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
  });
  await context.route('https://share.test/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/class-pointer-prototype/activity-share.js')){
      const script=fs.readFileSync(path.join(root,'class-pointer-prototype/activity-share.js'),'utf8')
        .replaceAll('us-central1-b3-games.cloudfunctions.net','us-central1-fun-torah-tools-staging.cloudfunctions.net');
      return route.fulfill({status:200,contentType:'application/javascript',body:script});
    }
    if(url.pathname.endsWith('/class-pointer-prototype/student-share-window.html')){
      return route.fulfill({status:200,contentType:'text/html',body:fs.readFileSync(path.join(root,'class-pointer-prototype/student-share-window.html'),'utf8')});
    }
    if(url.pathname.endsWith('/class-pointer-prototype/student-boards.js'))return route.fulfill({status:200,contentType:'application/javascript',body:'window.ClassPointerBoards={reset(){}};'});
    if(url.pathname.endsWith('/class-pointer-prototype/student-boards.css'))return route.fulfill({status:200,contentType:'text/css',body:''});
    return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><title>Fictional staging activity</title></head><body><main>Fictional staging activity</main></body></html>'});
  });
  await page.goto('https://share.test/shorashim/index.html');
  await page.evaluate(()=>{
    sessionStorage.setItem('b3Games_studentId','test_student_alef');
    sessionStorage.setItem('b3Games_classPin','123456');
    sessionStorage.setItem('b3Games_studentClass','TEST-ALEF');
  });
  await page.addScriptTag({url:'https://share.test/class-pointer-prototype/activity-share.js'});
  await expect(page.getByRole('button',{name:'Keep Sharing While Navigating'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Share My Screen'})).toBeVisible();
  const popupPromise=page.waitForEvent('popup');
  await page.getByRole('button',{name:'Keep Sharing While Navigating'}).click();
  const popup=await popupPromise;
  await popup.waitForURL('**/class-pointer-prototype/student-share-window.html?pointerShare=1');
  await expect.poll(()=>popup.evaluate(()=>(window as any).__signedInToken)).toBe('fictional-student-token');
  expect(await popup.evaluate(()=>sessionStorage.getItem('b3Games_studentId'))).toBe('test_student_alef');
  await expect(popup.getByRole('button',{name:'Share My Screen'})).toBeVisible();
  await popup.evaluate(()=>{
    const media={
      getDisplayMedia:async()=>{
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
        const stream=canvas.captureStream(5);(window as any).__capture=stream;return stream;
      }
    };
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:media});
  });
  await popup.getByRole('button',{name:'Share My Screen'}).click();
  await expect(popup.getByRole('button',{name:'Stop Sharing'})).toBeVisible();
  await page.goto('https://share.test/weekly-quiz/index.html');
  expect(popup.isClosed()).toBe(false);
  expect(await popup.evaluate(()=>(window as any).__capture.getVideoTracks()[0].readyState)).toBe('live');
  await popup.getByRole('button',{name:'Stop Sharing'}).click();
  await expect.poll(()=>popup.evaluate(()=>(window as any).__capture.getVideoTracks()[0].readyState)).toBe('ended');
});
