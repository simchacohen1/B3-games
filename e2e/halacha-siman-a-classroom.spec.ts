import {test,expect} from '@playwright/test';
import path from 'node:path';

const script=path.resolve(process.cwd(),'halacha/siman-a-classroom.js');
const ids=['a','b','c','d','e','a6','a7'];
async function fixture(page:any,teacher=false){
  const sections=ids.map(id=>'<section id="'+id+'" class="section"><div class="work">Preserve legacy work</div>'+(id==='a'?'<p class="hal-a-full-text">שויתי ה׳ לנגדי תמיד הוא כלל גדול בתורה.</p>':'')+'</section>').join('');
  await page.setContent('<main id="sections">'+sections+'</main>');
  await page.evaluate(({ids,teacher}:{ids:string[],teacher:boolean})=>{
    (window as any).lessons=ids.map(id=>({id,objective:'Learn the halacha',qs:['What does this teach?']}));
    (window as any).S={};(window as any).__saves=0;
    (window as any).save=()=>{(window as any).__saves++};
    (window as any).show=(id:string)=>{(window as any).__shown=id};
    (window as any).halachaCloudLoading=false;
    (window as any).HALACHA_TEACHER_PREVIEW=teacher;
    (window as any).HalachaSimanAExtraSource=Array.from({length:6},()=>'יהודה בן תימא אומר הוי עז כנמר וקל כנשר, רץ כצבי וגבור כארי. וזה סימן ללימוד תורה.');
  },{ids,teacher});
  await page.addScriptTag({path:script});
  await expect(page.locator('.ha-classroom')).toHaveCount(7);
  await expect(page.locator('.ha-art canvas[data-ready="true"]')).toHaveCount(7);
}
test('seven original Siman Alef lessons have distinct art and hide, not erase, old scrapbook',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await fixture(page);
  const art=await page.evaluate(()=>Array.from(document.querySelectorAll('.ha-art canvas')).map((c:any)=>c.toDataURL().slice(0,200)));
  expect(art.length).toBe(7);
  expect(new Set(art).size).toBeGreaterThan(1);
  await expect(page.locator('#a .work')).toHaveText('Preserve legacy work');
  await expect(page.locator('#a .ha-hebrew')).toContainText('שויתי');
  await expect(page.locator('#a .ha-hebrew')).not.toContainText('ִ');
  expect(errors).toEqual([]);
});
test('fill stays with lesson key; undo and other lessons are isolated',async({page})=>{
  await fixture(page);
  await page.locator('#c .ha-art canvas').click({position:{x:280,y:220}});
  expect(await page.evaluate(()=>(window as any).S.halacha_picture_siman_a_v2_c?.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).S.halacha_picture_siman_a_v2_a)).toBeUndefined();
  await page.locator('#c .ha-undo').click();
  expect(await page.evaluate(()=>(window as any).S.halacha_picture_siman_a_v2_c?.length)).toBe(0);
});
test('English vocabulary, audio controls and next button',async({page})=>{
  await fixture(page);
  await page.locator('#b .ha-wordchips button').nth(1).click();
  await page.locator('#b .ha-practice').click();
  await expect(page.locator('#b .ha-answers button')).toHaveCount(3);
  await expect(page.locator('#b .ha-instruction')).toContainText('Click');
  await page.locator('#b .ha-next').click();
  expect(await page.evaluate(()=>(window as any).__shown)).toBe('c');
});
test('teacher preview painting is temporary and never touches student saved work',async({page})=>{
  await fixture(page,true);
  await page.locator('#a .ha-art canvas').click({position:{x:240,y:190}});
  expect(await page.evaluate(()=>(window as any).__saves)).toBe(0);
  expect(await page.evaluate(()=>(window as any).S.halacha_picture_siman_a_v2_a)).toBeUndefined();
});
test('Special Tefillah wall picture has no crown and keeps its frame',async({page})=>{
  await fixture(page);
  const result=await page.evaluate(()=>{
    const canvas=document.querySelector('#a7 .ha-art canvas') as HTMLCanvasElement;
    const ctx=canvas.getContext('2d')!;
    const cleared=ctx.getImageData(649,94,72,110).data;
    let darkInside=0;
    for(let i=0;i<cleared.length;i+=4){
      if(cleared[i]<240||cleared[i+1]<240||cleared[i+2]<240)darkInside++;
    }
    // The original picture frame outside the cleared area remains visible.
    const panel=ctx.getImageData(625,30,120,235).data;
    let darkFrame=0;
    for(let i=0;i<panel.length;i+=4){
      if(panel[i]<80&&panel[i+1]<80&&panel[i+2]<80)darkFrame++;
    }
    return {darkInside,darkFrame};
  });
  expect(result.darkInside).toBe(0);
  expect(result.darkFrame).toBeGreaterThan(100);
});
