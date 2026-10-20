import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const read=(path:string)=>fs.readFileSync(path,'utf8');
async function setup(page:any){
  const errors:string[]=[];page.on('pageerror',(error:Error)=>errors.push(error.message));
  await page.route('**/*',(route:any)=>route.abort());
  await page.route('https://www.gstatic.com/firebasejs/12.15.0/*',(route:any)=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({contentType:'application/javascript',body:read('vendor/firebase/12.15.0/'+name)});
  });
  await page.route('https://pointer-auth.test/**',(route:any)=>{
    const path=new URL(route.request().url()).pathname.slice(1);
    if(path==='firebase-config.js')return route.fulfill({contentType:'application/javascript',body:`window.B3_FIREBASE_CONFIG={apiKey:'synthetic-test-key',projectId:'pointer-synthetic',authDomain:'pointer-auth.test',databaseURL:'https://pointer-synthetic.firebaseio.com'};window.B3_APP_CONTEXT={workspaceId:'synthetic'};`});
    const allowed=['class-pointer-prototype/dashboard.html','class-pointer-prototype/dashboard.js','class-pointer-prototype/dashboard-core.js','class-pointer-prototype/classroom.css','guest-mode.js','site-settings.js','student-class.js'];
    if(!allowed.includes(path))return route.abort();
    return route.fulfill({contentType:path.endsWith('.html')?'text/html':path.endsWith('.css')?'text/css':'application/javascript',body:read(path)});
  });
  return errors;
}

test('fresh browser Firebase persistence initializes and the teacher chooser remains gated',async({page})=>{
  const errors=await setup(page);
  await page.goto('https://pointer-auth.test/class-pointer-prototype/dashboard.html?teacher=1');
  await expect(page.getByRole('button',{name:'Sign in with Google',exact:true})).toBeVisible({timeout:10000});
  await expect(page.locator('#teacherClassButtons button')).toHaveCount(0);
  for(const mode of ['screens','boards','lesson']){
    await page.locator('[data-classroom-mode="'+mode+'"]').click();
    await expect(page.locator('[data-classroom-mode="'+mode+'"]')).toHaveAttribute('aria-pressed','true');
  }
  expect(errors).toEqual([]);
});
