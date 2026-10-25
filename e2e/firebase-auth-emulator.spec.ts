import { test, expect } from '@playwright/test';
import {serveSyntheticSite,closeSyntheticSite,configureBrowser} from './helpers/synthetic-firebase';

test.skip(!process.env.FIREBASE_AUTH_EMULATOR_HOST,'Requires only the demo Auth emulator.');
test('fresh browser reaches teacher sign-in and configures remembered Auth too',async({page})=>{
  const {server,origin}=await serveSyntheticSite();
  const errors:string[]=[],failed:string[]=[];
  try{
    await configureBrowser(page,errors,failed);
    await page.goto(origin+'/teacher-home.html?signin=1');
    await expect(page.getByRole('button',{name:'Sign in with Google'})).toBeVisible();
    expect(await page.evaluate(()=>window.firebase.apps.map((app:any)=>({name:app.name,port:app.auth().emulatorConfig?.port})))).toEqual([{name:'[DEFAULT]',port:19099},{name:'FTTRememberedTeacher',port:19099}]);
    await page.reload();
    await expect(page.getByRole('button',{name:'Sign in with Google'})).toBeVisible();
    expect(errors).toEqual([]);expect(failed).toEqual([]);
  }finally{await closeSyntheticSite(server);}
});

test('legacy app-before-Auth loading still uses only the demo emulator',async({page})=>{
  const {server,origin}=await serveSyntheticSite();
  const errors:string[]=[],failed:string[]=[];
  try{
    await configureBrowser(page,errors,failed);
    await page.route(origin+'/legacy-auth-test.html',route=>route.fulfill({contentType:'text/html',body:`<!doctype html>
      <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js"></script>
      <script>firebase.initializeApp({apiKey:'must-be-replaced',projectId:'must-be-replaced'});</script>
      <script src="https://www.gstatic.com/firebasejs/8.10.1/firebase-auth.js"></script>
      <body><p id="state">Checking</p><script>firebase.auth().onAuthStateChanged(()=>document.getElementById('state').textContent='Ready');</script></body>`}));
    await page.goto(origin+'/legacy-auth-test.html');
    await expect(page.locator('#state')).toHaveText('Ready');
    expect(await page.evaluate(()=>({project:window.firebase.app().options.projectId,port:window.firebase.auth().emulatorConfig?.port}))).toEqual({project:'demo-ftt-readiness',port:19099});
    expect(errors).toEqual([]);expect(failed).toEqual([]);
  }finally{await closeSyntheticSite(server);}
});

// Pages that used to open Firebase's IndexedDB before Auth (removed after PR 349).
// In a brand-new browser Auth must be able to create its own database with its
// object store; the old scanner left it empty and blocked Auth's repair.
for(const pagePath of ['chazara/index.html','chazara/teacher.html','shorashim/index.html','record_pesukim/student.html','record_pesukim/teacher.html','halacha/index.html','student-rewards/student.html','class-gallery/index.html']){
  test(`fresh browser lets Firebase Auth create its own storage on ${pagePath}`,async({browser})=>{
    const {server,origin}=await serveSyntheticSite();
    const context=await browser.newContext();
    try{
      const page=await context.newPage();
      await configureBrowser(page,[],[]);
      await page.goto(`${origin}/${pagePath}`);
      // Only inspect databases that already exist; opening by name would create one.
      await expect.poll(async()=>page.evaluate(async()=>{
        const info=(await indexedDB.databases()).find(db=>db.name==='firebaseLocalStorageDb');
        if(!info)return 'missing';
        return await new Promise<string>(resolve=>{
          const req=indexedDB.open(info.name!,info.version);
          req.onsuccess=()=>{const ok=req.result.objectStoreNames.contains('firebaseLocalStorage');req.result.close();resolve(ok?'ready':'no store');};
          req.onerror=()=>resolve('error');req.onblocked=()=>resolve('blocked');
        });
      }).catch(()=>'navigating'),{timeout:20000}).toBe('ready');
    }finally{
      // Pages keep live database requests open; stop routing before closing.
      await context.unrouteAll({behavior:'ignoreErrors'});
      await context.close();await closeSyntheticSite(server);
    }
  });
}
