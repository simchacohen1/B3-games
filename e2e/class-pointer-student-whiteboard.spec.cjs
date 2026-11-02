'use strict';
// A teacher presents one boy's whiteboard to the whole class (issue 66). One real teacher page and four real
// student pages run the real student-boards.js; only the network between them is replaced by a small relay,
// so every message still passes through the teacher page's own checks.
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const path=require('node:path');
const proto=file=>path.join(__dirname,'..','class-pointer-prototype',file);

const TEACHER_HTML=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/class-pointer-prototype/student-boards.css"><style>[hidden]{display:none!important}</style></head>
<body style="margin:0"><main id="stage" style="position:relative;width:1200px;height:700px;display:flex;flex-direction:column"></main>
<button id="studentBoards">Student Screens</button>
<script>
const presence=new Map();
window.__presence=presence;
window.__addStudent=(peer,name,studentId)=>{
  const entry={id:'presence:'+peer,presence:true,admitted:true,studentId,name,activity:'',connection:{open:true,peer},connectedAt:Date.now()};
  presence.set(entry.id,entry);window.ClassPointerBoards.studentJoined(entry);return entry.id;
};
window.__dropStudent=id=>{const entry=presence.get(id);presence.delete(id);window.ClassPointerBoards.studentLeft(entry)};
window.__fromStudent=(id,msg)=>window.ClassPointerBoards.fromStudent(presence.get(id),msg);
window.ClassPointerBridge={isTeacher:true,send(conn,msg){window.__out(conn.peer,JSON.parse(JSON.stringify(msg)))},fail(m){window.__fail=m},status(m){window.__status=m},
  started:()=>true,members:()=>new Map(),presence:()=>presence};
</script><script src="/class-pointer-prototype/student-boards.js"></script></body></html>`;
const STUDENT_HTML=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/class-pointer-prototype/student-boards.css"></head><body style="margin:0;background:#cde">
<p>Activity page</p>
<script>
const boardStage=document.createElement('div');boardStage.style.cssText='position:fixed;inset:0;z-index:2147483636;display:none;background:#e8eef7';document.body.append(boardStage);
window.__got=[];
window.ClassPointerBridge={isTeacher:false,embedded:true,embeddedStage:boardStage,sendTeacher(msg){window.__toTeacher(JSON.parse(JSON.stringify(msg)))},status(m){window.__status=m},fail(){},callTeacher:null};
window.__deliver=msg=>{window.__got.push(msg);return window.ClassPointerBoards.fromTeacher(msg)};
</script><script src="/class-pointer-prototype/student-boards.js"></script></body></html>`;

const BLUE=[29,78,216],RED=[198,40,40];
const countColor=(page,selector,rgb)=>page.locator(selector).first().evaluate((c,rgb)=>{
  if(!c.width)return 0;
  const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;
  for(let i=0;i<d.length;i+=4)if(Math.abs(d[i]-rgb[0])<40&&Math.abs(d[i+1]-rgb[1])<40&&Math.abs(d[i+2]-rgb[2])<40&&d[i+3]>0)n++;
  return n;
},rgb);
async function serve(page){
  await page.route('https://pointer.test/**',route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/student-boards.js'))return route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(proto('student-boards.js'),'utf8')});
    if(url.pathname.endsWith('/student-boards.css'))return route.fulfill({status:200,contentType:'text/css',body:fs.readFileSync(proto('student-boards.css'),'utf8')});
    return route.fulfill({status:200,contentType:'text/html',body:url.pathname==='/teacher'?TEACHER_HTML:STUDENT_HTML});
  });
}
async function stroke(page,selector,points,hold){
  const box=await page.locator(selector).boundingBox();
  const at=p=>[box.x+box.width*p[0],box.y+box.height*p[1]];
  await page.mouse.move(...at(points[0]));await page.mouse.down();
  for(const p of points.slice(1))await page.mouse.move(...at(p),{steps:6});
  if(!hold)await page.mouse.up();
}

test('teacher presents a boy’s whiteboard; writing is allowed boy by boy; teacher stays in control',async({browser})=>{
  test.setTimeout(90000);
  const context=await browser.newContext({viewport:{width:1200,height:700}});
  const teacher=await context.newPage();
  const names=[['moshe','Moshe','s1'],['dov','Dov','s2'],['levi','Levi','s3']];
  const students={},entry={};
  await serve(teacher);
  await teacher.exposeFunction('__out',async(peer,msg)=>{const page=students[peer];if(page&&!page.isClosed())await page.evaluate(m=>window.__deliver(m),msg).catch(()=>{})});
  await teacher.goto('https://pointer.test/teacher');
  async function addStudent([peer,name,studentId]){
    const page=await context.newPage();await serve(page);
    await page.exposeFunction('__toTeacher',async msg=>{await teacher.evaluate(([id,m])=>window.__fromStudent(id,m),[entry[peer],msg])});
    await page.goto('https://pointer.test/student');students[peer]=page;
    entry[peer]=await teacher.evaluate(([p,n,s])=>window.__addStudent(p,n,s),[peer,name,studentId]);
    return page;
  }
  for(const n of names)await addStudent(n);

  // Teacher opens the student whiteboards (Whiteboards mode).
  await teacher.click('#studentBoards');
  await teacher.getByRole('button',{name:/Whiteboards/}).first().click();
  for(const page of Object.values(students))await expect(page.locator('#myBoard canvas')).toBeVisible();

  // Moshe draws a line on his own board.
  await stroke(students.moshe,'#myBoard canvas',[[.1,.5],[.9,.5]]);
  await expect.poll(()=>countColor(teacher,'.board-tile:has(.board-name:text-is("Moshe")) canvas',[31,41,55])).toBeGreaterThan(20);

  // Nothing is shown to the class until the teacher chooses.
  for(const peer of ['dov','levi'])await expect(students[peer].locator('#fttClassBoardOverlay')).toBeHidden();
  await expect(teacher.locator('#classBoardBar')).toBeHidden();

  // Teacher presents Moshe's board to the whole class.
  await teacher.locator('.board-tile:has(.board-name:text-is("Moshe")) .board-class-share').click();
  await expect(teacher.locator('#classBoardBar')).toBeVisible();
  await expect(teacher.locator('#classBoardBar')).toContainText('Moshe');
  await expect(teacher.getByRole('button',{name:/Stop showing Moshe/})).toBeVisible();
  for(const peer of ['dov','levi']){
    const overlay=students[peer].locator('#fttClassBoardOverlay');
    await expect(overlay).toBeVisible();await expect(overlay).toContainText('Moshe');
    await expect.poll(()=>countColor(students[peer],'#fttClassBoardOverlay canvas',[31,41,55])).toBeGreaterThan(20); // his line is there
  }
  await expect(students.moshe.locator('#fttClassBoardOverlay')).toBeHidden(); // he keeps his own board
  await expect(students.moshe.locator('#fttClassBoardPresenter')).toBeVisible();
  // Starting state: nobody may write.
  await expect(students.dov.locator('#fttClassBoardOverlay .boards-group')).toBeHidden();
  await expect(students.dov.locator('#fttClassBoardOverlay')).toContainText('Watching');

  // Watchers cannot write even if they try to send a line anyway (a hand-made message).
  const classId=await students.levi.evaluate(()=>window.__got.find(m=>m.type==='board-class'&&m.active).id);
  const forged=[{id:'gforged1',color:'#c62828',size:0.012,points:[{x:.1,y:.2},{x:.9,y:.2}]}];
  await students.levi.evaluate(([id,stroke])=>window.ClassPointerBridge.sendTeacher({type:'board-class-write',id,op:{type:'board-add',stroke}}),[classId,forged[0]]);
  // …nor change who may write.
  await students.levi.evaluate(id=>window.ClassPointerBridge.sendTeacher({type:'board-class-access',id,access:'everyone',allowed:[]}),classId);
  await teacher.waitForTimeout(400);
  expect(await countColor(students.dov,'#fttClassBoardOverlay canvas',RED)).toBe(0);
  await expect(students.levi.locator('#fttClassBoardOverlay')).toContainText('Watching');

  // Teacher lets Dov (only) write: Choose boys…
  await teacher.getByRole('button',{name:/Choose boys/}).click();
  await teacher.locator('#classBoardBar label:has-text("Dov") input').check();
  await expect(students.dov.locator('#fttClassBoardOverlay .boards-group')).toBeVisible();
  await expect(students.levi.locator('#fttClassBoardOverlay .boards-group')).toBeHidden();
  await expect(students.moshe.locator('#fttClassBoardPresenter')).toContainText('Choose boys');

  // Dov writes in blue; the class, Moshe and the teacher's tile all see it.
  await stroke(students.dov,'#fttClassBoardOverlay canvas',[[.2,.8],[.8,.8]]);
  await expect.poll(()=>countColor(students.levi,'#fttClassBoardOverlay canvas',BLUE)).toBeGreaterThan(20);
  await expect.poll(()=>countColor(students.moshe,'#myBoard canvas',BLUE)).toBeGreaterThan(20);
  await expect.poll(()=>countColor(teacher,'.board-tile:has(.board-name:text-is("Moshe")) canvas',BLUE)).toBeGreaterThan(20);
  // Levi still cannot write: the same forged line is refused.
  await students.levi.evaluate(([id,stroke])=>window.ClassPointerBridge.sendTeacher({type:'board-class-write',id,op:{type:'board-add',stroke}}),[classId,forged[0]]);
  await teacher.waitForTimeout(400);
  expect(await countColor(students.moshe,'#myBoard canvas',RED)).toBe(0);

  if(process.env.SHOTS){
    await teacher.screenshot({path:path.join(process.env.SHOTS,'teacher.png')});
    await students.dov.screenshot({path:path.join(process.env.SHOTS,'dov.png')});
    await students.moshe.screenshot({path:path.join(process.env.SHOTS,'moshe.png')});
  }
  // Moshe (the presenter) opens writing to everyone.
  await students.moshe.getByRole('button',{name:/Everyone can write/}).click();
  await expect(students.levi.locator('#fttClassBoardOverlay .boards-group')).toBeVisible();
  await expect(teacher.locator('#classBoardBar')).toContainText('Everyone may write');

  // The teacher takes control: Moshe cannot write; he can still be given the board back.
  await teacher.getByRole('button',{name:/Take control/}).click();
  await expect(students.moshe.locator('#fttClassBoardPresenter')).toContainText('teacher is in control');
  await expect(students.levi.locator('#fttClassBoardOverlay .boards-group')).toBeVisible(); // class writing unaffected by the lock
  const INK=[31,41,55],tile='.board-tile:has(.board-name:text-is("Moshe")) canvas';
  const before=await countColor(teacher,tile,INK);
  await stroke(students.moshe,'#myBoard canvas',[[.1,.3],[.9,.3]]);
  await teacher.waitForTimeout(400);
  expect(await countColor(teacher,tile,INK)).toBe(before); // his new line was refused while the teacher had control
  await teacher.getByRole('button',{name:/Give control back/}).click();
  await expect(students.moshe.locator('#fttClassBoardPresenter')).toContainText('Who may write');

  // A boy who arrives during the presentation gets it straight away, with the drawing.
  const late=await addStudent(['eli','Eli','s4']);
  await expect(late.locator('#fttClassBoardOverlay')).toBeVisible();
  await expect.poll(()=>countColor(late,'#fttClassBoardOverlay canvas',BLUE)).toBeGreaterThan(20);

  // One clear Stop. Everything goes back to normal at once.
  await teacher.getByRole('button',{name:/Stop showing Moshe/}).click();
  for(const page of Object.values(students))await expect(page.locator('#fttClassBoardOverlay')).toBeHidden();
  await expect(students.moshe.locator('#fttClassBoardPresenter')).toBeHidden();
  await expect(teacher.locator('#classBoardBar')).toBeHidden();
  // Stopping is not a ban: it can be started again, and it stops when the boards are closed.
  await teacher.locator('.board-tile:has(.board-name:text-is("Moshe")) .board-class-share').click();
  await expect(students.dov.locator('#fttClassBoardOverlay')).toBeVisible();
  await teacher.click('#studentBoards');
  await expect(students.dov.locator('#fttClassBoardOverlay')).toBeHidden();
  await expect(teacher.locator('#classBoardBar')).toBeHidden();
  await context.close();
});
