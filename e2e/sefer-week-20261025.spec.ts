import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

test('Oct 25–31 coloring pictures fill, save, switch, reopen and stay responsive', async ({ page }) => {
  test.setTimeout(120000);
  const root = process.cwd();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('b3Games_studentId', 'synthetic-sefer-week-20261025');
    sessionStorage.setItem('b3Games_studentClass', 'et');
    localStorage.setItem('ftt-sefer-hamitzvos:'+JSON.stringify(['b3-2026','et','synthetic-sefer-week-20261025',500]),
      JSON.stringify([{ type: 'legacy-record-preserved' }]));
    const w=window as any;
    w.B3_FIREBASE_CONFIG={};
    w.firebase={apps:[{}],database:()=>({ref:(path:string)=>({
      once:async()=>({val:()=>JSON.parse(localStorage.getItem('synthetic-cloud:'+path)||'null')}),
      set:async(value:any)=>{localStorage.setItem('synthetic-cloud:'+path,JSON.stringify(value));}
    })})};
    (window as any).B3SiteSettings = {
      onAuthStateChanged: (callback: Function) => callback({}, true, { authorized: true, role: 'teacher' })
    };
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.gstatic.com' || url.pathname.endsWith('/firebase-config.js') ||
        url.pathname.endsWith('/gallery-share.js') || url.pathname.includes('/word-bank/') ||
        url.pathname.includes('/class-pointer-prototype/')) {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return;
    }
    if (url.hostname !== 'sefer.week.local') { await route.abort(); return; }
    const requested = decodeURIComponent(url.pathname).replace(/^\//, '');
    const filename = path.resolve(root, requested || 'sefer-hamitzvos/index.html');
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      await route.fulfill({ status: 404, body: '' }); return;
    }
    const type = filename.endsWith('.png') ? 'image/png'
      : filename.endsWith('.html') ? 'text/html'
      : filename.endsWith('.js') ? 'application/javascript' : 'text/plain';
    await route.fulfill({ status: 200, contentType: type, body: fs.readFileSync(filename) });
  });
  await page.goto('https://sefer.week.local/sefer-hamitzvos/index.html');
  await page.evaluate(() => { canBrowseDates=true; });

  const week = [
    ['2026-10-25', 'N250', 500], ['2026-10-26', 'N250', 500],
    ['2026-10-27', 'N251', 501], ['2026-10-28', 'N251', 501],
    ['2026-10-29', 'N253', 502], ['2026-10-30', 'N253', 502],
    ['2026-10-31', 'N252', 503],
  ] as const;
  const timings: number[] = [];
  const savedPictures = new Map<string,string>();
  for (const [date, ref, card] of week) {
    const started = Date.now();
    await page.evaluate(date => showDate(date), date);
    await page.waitForFunction(card => !!regionMask && !paintLoading && num === card &&
      regionMask.width === cv.width && regionMask.height === cv.height, card, { timeout: 15000 });
    timings.push(Date.now() - started);
    expect(await page.locator('#dayCards button').evaluateAll(buttons => buttons.map(b => (b as HTMLElement).dataset.card)))
      .toContain(String(card));
    expect(await page.locator('#outline').getAttribute('src')).toContain(`coloring-v2/${String(card).padStart(3, '0')}.png`);
    expect(await page.evaluate(() => [cv.width, cv.height, ($('outline') as HTMLImageElement).naturalWidth,
      ($('outline') as HTMLImageElement).naturalHeight])).toEqual(card===503?[1537,1023,1537,1023]:[1536,1024,1536,1024]);

    if (date === '2026-10-25') {
      const seeds = await page.evaluate(() => {
        const counts = new Map<number, number>(), first = new Map<number, number>();
        for (let i=0; i<regionMask.labels.length; i++) {
          const id=regionMask.labels[i]; if (id) { counts.set(id,(counts.get(id)||0)+1); if (!first.has(id)) first.set(id,i); }
        }
        return [...counts].filter(([,size])=>size>=100&&size<=50000).sort((a,b)=>b[1]-a[1]).slice(0,2)
          .map(([id])=>{const i=first.get(id)!;return {id,x:i%cv.width,y:Math.floor(i/cv.width)};});
      });
      expect(seeds).toHaveLength(2);
      const tap = async (seed: {x:number;y:number},color:string) => page.evaluate(({point,color})=>{selectedColor=color;applyAreaFill([point.x+.5,point.y+.5]);},{point:seed,color});
      await tap(seeds[0],'#e53935'); await tap(seeds[0],'#1976d2'); await tap(seeds[1],'#43a047');
      await expect(page.locator('#notice')).toContainText('Section filled');
      const fillCheck = await page.evaluate((picked) => {
        const data=fillCtx.getImageData(0,0,cv.width,cv.height).data, labels=regionMask.labels;
        const colors=new Map<number,number[]>(),allowed=new Set<number>(),sizes=new Map<number,number>(),painted=new Map<number,number>();
        for(const seed of picked){const i=seed.y*cv.width+seed.x,id=labels[i],color=Array.from(data.slice(i*4,i*4+4));allowed.add(id);colors.set(id,color);}
        let inkCovered=0,otherRegionPixels=0,fringePixels=0;
        for(let i=0;i<labels.length;i++){
          if(labels[i])sizes.set(labels[i],(sizes.get(labels[i])||0)+1);
          if(!data[i*4+3])continue;
          if(sourcePixels.data[i*4]<232||sourcePixels.data[i*4+1]<232||sourcePixels.data[i*4+2]<232)inkCovered++;
          if(labels[i]){
            if(!allowed.has(labels[i]))otherRegionPixels++;
            else painted.set(labels[i],(painted.get(labels[i])||0)+1);
          }else fringePixels++;
        }
        return {colors:[...colors.values()],inkCovered,otherRegionPixels,fringePixels,coverage:[...allowed].map(id=>painted.get(id)===sizes.get(id)),legacy:localStorage.getItem('ftt-sefer-hamitzvos:'+JSON.stringify(['b3-2026','et','synthetic-sefer-week-20261025',500]))};
      }, seeds);
      expect(fillCheck.colors).toEqual([[25,118,210,255],[67,160,71,255]]);
      expect(fillCheck.inkCovered).toBe(0); expect(fillCheck.otherRegionPixels).toBe(0);expect(fillCheck.coverage).toEqual([true,true]);
      expect(fillCheck.legacy).toBe(JSON.stringify([{type:'legacy-record-preserved'}]));
      expect(await page.evaluate(()=>key(500))).toContain('"approved-20261025"');
      expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(key(500))||'[]'))).toHaveLength(3);
    }
    if (date === '2026-10-26') {
      await page.waitForFunction(() => !paintLoading && num===500);
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem(key(500))||'[]'));
      expect(saved.filter((stroke:any)=>stroke.type==='fill')).toHaveLength(3);
    }
    if(card!==500 && !savedPictures.has(date)) {
      await page.evaluate(()=>{const i=regionMask.labels.findIndex(Boolean);selectedColor='#8e24aa';applyAreaFill([i%cv.width+.5,Math.floor(i/cv.width)+.5]);});
    }
    savedPictures.set(date,await page.evaluate(()=>fillCv.toDataURL()));
  }
  await page.waitForFunction(()=>!cardSaveTimers.size&&!cardWriteChains.size);
  for(const card of [500,501,502,503]) {
    expect(await page.evaluate(card=>!!localStorage.getItem('synthetic-cloud:'+studentCardPath(card)),card)).toBe(true);
  }
  // Remove device saves to prove account restoration on reopening.
  await page.evaluate(()=>{for(const card of [500,501,502,503]){localStorage.removeItem(key(card));localStorage.removeItem(key(card)+':savedAt');}});
  await page.reload();
  await page.evaluate(()=>{canBrowseDates=true;});
  for(const [date,expected] of savedPictures) {
    await page.evaluate(date=>showDate(date),date);
    await page.waitForFunction(()=>!!regionMask&&!paintLoading);
    expect(await page.evaluate(()=>fillCv.toDataURL())).toBe(expected);
  }
  expect(Math.max(...timings)).toBeLessThan(15000);
  const runtime = await page.evaluate(() => ({cache:regionMaskCache.size, memory:(performance as any).memory?.usedJSHeapSize||0}));
  expect(runtime.cache).toBeLessThanOrEqual(2);
  if (runtime.memory) expect(runtime.memory).toBeLessThan(200*1024*1024);
  console.log(JSON.stringify({pictureSwitchMs:timings,peakObservedHeapBytes:runtime.memory||null,maskCacheEntries:runtime.cache}));
  expect(pageErrors).toEqual([]);
});
