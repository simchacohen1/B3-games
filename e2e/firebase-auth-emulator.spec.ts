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
