import { test, expect } from '@playwright/test';
import path from 'node:path';

const modulePath=path.resolve(process.cwd(),'halacha/sefer-style.js');
async function fixture(page:any,readOnly=false){
  await page.setContent('<main id="sections"><section id="a" class="section"><div class="work">Existing scrapbook is untouched</div></section><section id="s2a" class="section"><div class="work">Siman Beis scrapbook</div></section></main>');
  await page.evaluate((readOnly:boolean)=>{
    (window as any).lessons=[
      {id:'a',seif:'סעיף א',title:'שויתי',objective:'Remember Hashem',},
      {id:'s2a',seif:'סעיפים א–ב',title:'נטילת ידים',objective:'Wash your hands'}
    ];
    (window as any).S={};
    (window as any).HALACHA_TEACHER_VIEW=readOnly?'student-preview':'';
    (window as any).halachaCloudLoading=false;
    (window as any).simanOfLesson=(l:any)=>l.id==='a'?'א':'ב';
    (window as any).__saves=0;
    (window as any).save=()=>{(window as any).__saves++};
    (window as any).FTTHalachaVocabulary={
      get:(id:string)=>id==='a'?
        [{id:'a',hebrew:'אֱמוּנָה',english:'faith'},{id:'b',hebrew:'תּוֹרָה',english:'Torah'}]:
        [{id:'c',hebrew:'כְּלִי',english:'vessel'},{id:'d',hebrew:'מַיִם',english:'water'}]
    };
  },readOnly);
  await page.addScriptTag({path:modulePath});
}
test('adds Sefer-style lesson panels without changing scrapbook content',async ({page})=>{
  await fixture(page);
  await expect(page.locator('[data-hal-sefer-study]')).toHaveCount(2);
  await expect(page.locator('#a > .work')).toHaveText('Existing scrapbook is untouched');
  await expect(page.locator('#a .hal-sefer-vocab')).toContainText('Match the Hebrew Words');
});
test('filled vector region never changes an adjacent region; undo restores white',async ({page})=>{
  await fixture(page);
  const left=page.locator('#a [data-color-part="left-page"]');
  const right=page.locator('#a [data-color-part="right-page"]');
  await left.evaluate((n:Element)=>n.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await expect(left).toHaveAttribute('fill','#fdd835');
  await expect(right).toHaveAttribute('fill','#ffffff');
  expect(await page.evaluate(()=>(window as any).S.halacha_sefer_color_a.length)).toBe(1);
  await page.locator('#a .hal-sefer-buttons button').filter({hasText:'Undo'}).click();
  await expect(left).toHaveAttribute('fill','#ffffff');
});
test('matching Hebrew and English words gives correct and incorrect feedback',async ({page})=>{
  await fixture(page);
  await page.locator('#a .hal-sefer-english button').filter({hasText:'faith'}).click();
  await page.locator('#a .hal-sefer-hebrew button').filter({hasText:'תּוֹרָה'}).click();
  await expect(page.locator('#a .hal-sefer-feedback')).toContainText('Not quite');
  await page.locator('#a .hal-sefer-hebrew button').filter({hasText:'אֱמוּנָה'}).click();
  await expect(page.locator('#a .hal-sefer-feedback')).toContainText('Correct');
});
test('teacher view is read-only; no coloring writes',async ({page})=>{
  await fixture(page,true);
  await page.locator('#a [data-color-part="left-page"]').evaluate((n:Element)=>n.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await expect(page.locator('#a [data-color-part="left-page"]')).toHaveAttribute('fill','#ffffff');
  expect(await page.evaluate(()=>(window as any).__saves)).toBe(0);
});
test('cloud state change triggers fresh picture panels with saved colors',async ({page})=>{
  await fixture(page);
  await page.evaluate(()=>{
    (window as any).S.halacha_sefer_color_a=[{tool:'fill',part:'left-page',color:'#1e88e5'}];
    document.getElementById('sections')!.innerHTML='<section id="a" class="section"><div class="work">Restored scrapbook</div></section>';
  });
  await expect(page.locator('#a [data-color-part="left-page"]')).toHaveAttribute('fill','#1e88e5');
  await expect(page.locator('#a > .work')).toHaveText('Restored scrapbook');
});
