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
