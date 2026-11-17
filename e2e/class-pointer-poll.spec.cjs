const {test,expect}=require('@playwright/test');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
let server,base;
test.beforeAll(async()=>{
  server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const file=path.basename(req.url.split('?')[0]);
    if(['poll-core.js','poll.js','poll.css'].includes(file)){res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(path.join(__dirname,'../class-pointer-prototype',file)))}
    else res.end('<!doctype html><html><body><div id="stage"></div></body></html>');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
});
test.afterAll(()=>server.close());
test('fictional teacher and two students: live votes, changes, privacy, reconnect, end, new poll',async({browser})=>{
  const context=await browser.newContext();const teacher=await context.newPage(),a=await context.newPage(),b=await context.newPage();const students={a,b};
  await teacher.exposeFunction('deliver',async(id,message)=>students[id]?.evaluate(m=>window.ClassPointerPoll.fromTeacher(m),message));
  await teacher.goto(base);
  await teacher.evaluate(()=>{
    window.testMembers=new Map(['a','b'].map(id=>[id,{id,studentId:id,name:'Test Student '+id.toUpperCase(),admitted:true,connection:id}]));
    window.ClassPointerBridge={isTeacher:true,started:()=>true,members:()=>testMembers,presence:()=>new Map(),send:(id,m)=>window.deliver(id,m)};
    window.ClassPointerDashboard={students:async()=>['a','b','offline'].map(id=>({id,name:'Test Student '+id.toUpperCase()}))};
  });
  for(const [id,page] of Object.entries(students)){
    await page.exposeFunction('vote',m=>teacher.evaluate(({id,m})=>ClassPointerPoll.fromStudent(testMembers.get(id),m),{id,m}));
    await page.goto(base);await page.evaluate(()=>{window.ClassPointerBridge={isTeacher:false,embedded:true,sendTeacher:m=>window.vote(m)}});
    await page.addScriptTag({url:base+'/poll-core.js'});await page.addScriptTag({url:base+'/poll.js'});
  }
  await teacher.addScriptTag({url:base+'/poll-core.js'});await teacher.addScriptTag({url:base+'/poll.js'});
  await teacher.evaluate(()=>ClassPointerPoll.open());await teacher.getByRole('button',{name:'Send',exact:true}).click();
  await expect(a.getByRole('button',{name:'👍',exact:true})).toBeVisible();await expect(a.getByPlaceholder(/Question/)).toHaveCount(0);
  await expect(a.locator('progress')).toHaveCount(0);
  await a.getByRole('button',{name:'👍',exact:true}).click();await expect(a.getByRole('button',{name:'👍',exact:true})).toHaveAttribute('aria-pressed','true');
  await a.getByRole('button',{name:'👎',exact:true}).click();await b.getByRole('button',{name:'👍',exact:true}).click();
  await expect(teacher.getByText(/Answered \(2\)/)).toBeVisible();await expect(teacher.getByText(/Hasn’t answered \(1\).*OFFLINE/)).toBeVisible();
  await expect(teacher.locator('progress').nth(0)).toHaveAttribute('value','1');await expect(teacher.locator('progress').nth(1)).toHaveAttribute('value','1');
  await teacher.getByRole('checkbox',{name:'Show results to class'}).check();await expect(a.locator('progress')).toHaveCount(2);
  await teacher.getByRole('checkbox',{name:'Show results to class'}).uncheck();await expect(a.locator('progress')).toHaveCount(0);
  await a.evaluate(()=>ClassPointerPoll.reset());await teacher.evaluate(()=>document.dispatchEvent(new Event('classpointer:roster')));await expect(a.getByRole('button',{name:'👎',exact:true})).toHaveAttribute('aria-pressed','true');
  await teacher.getByRole('button',{name:'End poll',exact:true}).click();await expect(a.getByRole('button',{name:'👍',exact:true})).toBeDisabled();
  await a.getByRole('button',{name:'Close',exact:true}).click();await teacher.evaluate(()=>document.dispatchEvent(new Event('classpointer:roster')));await expect(a.getByRole('dialog')).not.toBeVisible();
  await teacher.getByRole('button',{name:'New poll',exact:true}).click();await teacher.getByRole('button',{name:'Custom',exact:true}).click();
  await teacher.getByLabel('Question (optional)',{exact:true}).fill('Choose a color');await teacher.getByLabel('Answer 1',{exact:true}).fill('Red');
  await teacher.getByRole('button',{name:'Send',exact:true}).click();await expect(teacher.getByRole('alert')).toContainText('2–4');
  await teacher.getByLabel('Answer 2',{exact:true}).fill('Blue');await teacher.getByRole('button',{name:'Send',exact:true}).click();
  await expect(a.getByText('Choose a color',{exact:true})).toBeVisible();await expect(a.getByRole('button',{name:'Red',exact:true})).toBeVisible();await expect(a.locator('[aria-pressed=true]')).toHaveCount(0);
  await teacher.evaluate(()=>document.dispatchEvent(new Event('class-pointer-teacher-signed-out')));await expect(a.getByRole('button',{name:'Red',exact:true})).toBeDisabled();
  await teacher.evaluate(()=>ClassPointerPoll.reset());await a.evaluate(()=>ClassPointerPoll.reset());await expect(a.getByRole('dialog')).not.toBeVisible();
  await context.close();
});
