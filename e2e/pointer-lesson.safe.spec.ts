import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Fully synthetic class session: no production API, no real students.
const script=fs.readFileSync(path.resolve(__dirname,'../class-pointer-prototype/activity-share.js'),'utf8');

test('Pointer: student sees teacher presentation without losing unfinished work',async({page})=>{
  await page.route('**/*',route=>route.abort());
  await page.route('https://pointer-offline.test/**', route => route.fulfill(route.request().url().includes('.js') ? {contentType:'text/javascript',body:''} : {contentType:'text/html',body:'<!doctype html><title>Activity</title><input id="answer" value="unfinished work"><div>Learning activity</div>'}));
  await page.goto('https://pointer-offline.test/activity');
  await page.evaluate(()=>{
    const room='class-pointer-12345678-1234-1234-1234-123456789abc';
    (window as any).__room=room;
    sessionStorage.setItem('b3Games_studentId','synthetic-student');
    sessionStorage.setItem('b3Games_classPin','synthetic-pin');
    (window as any).firebase={apps:[{}],database:()=>({ref:()=>({on:(_event:string,callback:Function)=>{(window as any).__sessionCallback=callback;}})})};
    (window as any).B3_FIREBASE_CONFIG={};
    (window as any).FunTorahStudentClass={resolve:async()=>({workspaceId:'b3-2026',classId:'et'})};
    (window as any).fetch=async()=>({ok:true,status:200,json:async()=>({ok:true,token:'synthetic-token'})});
    class Emitter {
      handlers:Record<string,Function[]>={};
      on(ev:string,fn:Function){(this.handlers[ev] ||= []).push(fn);}
      once(ev:string,fn:Function){this.on(ev,fn);}
      emit(ev:string,data?:any){for(const fn of this.handlers[ev]||[])fn(data);}
    }
    (window as any).Peer=class extends Emitter {
      constructor(public id:string){super();(window as any).__peer=this;queueMicrotask(()=>this.emit('open'));}
      connect(peer:string){
        const connection:any=new Emitter();
        connection.peer=peer;connection.open=true;connection.send=()=>{};connection.close=()=>{};
        (window as any).__connection=connection;
        queueMicrotask(()=>connection.emit('open'));
        return connection;
      }
      destroy(){}
    };
    (window as any).__present=()=>{
      const peer:any=(window as any).__peer;
      const connection:any=new Emitter();
      connection.peer=room;
      connection.metadata={kind:'activity-lesson',presentationId:'offline'};
      connection.close=()=>{};
      connection.answer=()=>{
        const canvas=document.createElement('canvas');
        canvas.width=320;canvas.height=180;
        canvas.getContext('2d')!.fillRect(0,0,320,180);
        connection.emit('stream',canvas.captureStream(5));
      };
      peer.emit('call',connection);
    };
  });
  await page.addScriptTag({content:script});
  await expect.poll(()=>page.evaluate(()=>!!(window as any).__sessionCallback)).toBe(true);
  await page.evaluate(()=>{
    const w:any=window;
    w.__sessionCallback({val:()=>({[w.__room]:{roomId:w.__room,createdAt:Date.now()}})});
  });
  await expect.poll(()=>page.evaluate(()=>!!(window as any).__connection)).toBe(true);
  await page.evaluate(()=>{
    (window as any).__connection.emit('data',{type:'present'});
    (window as any).__connection.emit('data',{type:'lesson-presentation',id:'offline',active:true});
    (window as any).__present();
  });
  await expect(page.locator('#fttTeacherLessonOverlay')).toBeVisible();
  await expect(page.locator('#answer')).toHaveValue('unfinished work');
  await page.getByRole('button',{name:'Back to Activity'}).click();
  await expect(page.locator('#answer')).toHaveValue('unfinished work');
  await expect(page.locator('#fttTeacherLessonOverlay')).toBeHidden();
});
