'use strict';
const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'shorashim/index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
async function open(page,section){
  await page.route('**/*',r=>r.request().url().startsWith('https://section.test/shorashim/')?r.fulfill({contentType:'text/html',body:html}):r.abort());
  await page.goto('https://section.test/shorashim/?section='+section);
  await page.evaluate(()=>{
    window.firebase={apps:[{}],database:()=>({ref:()=>({once:async()=>({val:()=>null}),on(){}})}),storage:()=>({})};
    window.B3Guest={isGuest:()=>true,unlock(){}};
    window.__lockedSection=null;
    window.FTTFollowStudent={activityPolicy:()=>window.__lockedSection?{subdestination:window.__lockedSection}:null};
  });
  await page.addScriptTag({path:path.join(root,'shorashim/app.js')});
  await expect.poll(()=>page.evaluate(()=>!!window.FTTFollowActivities?.shorashim)).toBe(true);
}
for(const [section,screen] of Object.entries({review:'reviewScreen',learn:'shorashimPerekScreen',games:'gamesScreen',gallery:'galleryScreen',affixes:'affixHomeScreen'})) {
  test(`${section}: real Shorashim screens honor deep links, lock and unlock without resetting cards`,async({page})=>{
    await open(page,section);
    await expect(page.locator('#'+screen)).toHaveClass(/active/);
    const before=await page.evaluate(()=>localStorage.getItem('shorashimLearningLabV2'));
    await page.evaluate(s=>{window.__lockedSection=s;goScreen('studentHome')},section);
    await expect(page.locator('#'+screen)).toHaveClass(/active/);
    await page.evaluate(()=>{window.__lockedSection=null;goScreen('studentHome')});
    await expect(page.locator('#studentHome')).toHaveClass(/active/);
    expect(await page.evaluate(()=>localStorage.getItem('shorashimLearningLabV2'))).toBe(before);
    expect(await page.evaluate(()=>window.FTTFollowActivities.shorashim.currentSection())).toBe('');
  });
}
test('Learn New stays within Shorashim learning; prefixes and suffixes stay in affix learning',async({page})=>{
  await open(page,'learn');
  await page.evaluate(()=>{window.__lockedSection='learn';chooseLearningPerek(18)});
  await expect(page.locator('#learnScreen')).toHaveClass(/active/);
  await page.evaluate(()=>goScreen('affixHomeScreen'));
  await expect(page.locator('#learnScreen')).toHaveClass(/active/);
  expect(await page.evaluate(()=>window.FTTFollowActivities.shorashim.currentSection())).toBe('learn');
  await page.evaluate(()=>{window.__lockedSection='affixes';window.FTTFollowActivities.shorashim.applySection('affixes')});
  await page.locator('[data-go="learnScreen"][data-track="prefix"]').click();
  await expect(page.locator('#learnScreen')).toHaveClass(/active/);
  expect(await page.evaluate(()=>window.FTTFollowActivities.shorashim.currentSection())).toBe('affixes');
  await page.evaluate(()=>chooseLearningPerek(19));
  expect(await page.evaluate(()=>window.FTTFollowActivities.shorashim.currentSection())).toBe('affixes');
});
test('unknown or inherited subsection names leave the home and student records intact',async({page})=>{
  await open(page,'constructor');
  await expect(page.locator('#studentHome')).toHaveClass(/active/);
  for(const section of ['__proto__','toString','../../admin']) {
    expect(await page.evaluate(s=>window.FTTFollowActivities.shorashim.applySection(s),section)).toBe(false);
    await expect(page.locator('#studentHome')).toHaveClass(/active/);
  }
});
test('teacher navigation waits for unfinished card edits and recording saves',async({page})=>{
  await open(page,'learn');
  await page.evaluate(()=>chooseLearningPerek(18));
  const canLeave=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('ftt:before-follow-navigation',{cancelable:true})));
  await page.evaluate(()=>window.__shorashimEditorDirty=true);expect(await canLeave()).toBe(false);
  await page.evaluate(()=>{window.__shorashimEditorDirty=false;document.getElementById('saveCardBtn').disabled=true});expect(await canLeave()).toBe(false);
  await page.evaluate(()=>{document.getElementById('saveCardBtn').disabled=false;shorashimRecorder={state:'recording'}});expect(await canLeave()).toBe(false);
  await page.evaluate(()=>shorashimRecorder=null);expect(await canLeave()).toBe(true);
});
