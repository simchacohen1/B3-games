import { test, expect, Page } from '@playwright/test';

// Runs against the checked-out source, without real students, Firebase, or a live site.
async function startLab(page: Page) {
  await page.setContent([
    '<!doctype html><html><head><meta charset="utf-8"></head><body>',
    '<main class="wrap">',
    '<section id="modeGate"><div>Continue quest</div><div>Existing steps</div></section>',
    '<div id="similarScreen"></div><div id="app"></div><div id="practiceCompleteScreen"></div>',
    '<div id="nameGate"></div><div id="completeScreen" class="show"></div>',
    '</main><span id="sessionStars"></span><span id="coinHud"></span>',
    '</body></html>'
  ].join(''));
  await page.evaluate(() => {
    const w = window as any;
    w.studentId = 'synthetic-test-student';
    w.teacherPreview = false;
    w.questionTimer = null;
    w.starsThisVisit = 0;
    w.coinsThisVisit = 0;
    w.passedKeys = [];
    w.savedWrites = {};
    w.firebase = { database: { ServerValue: { TIMESTAMP: 42 } } };
    w.db = {
      ref: (path: string) => ({
        once: async () => ({ val: () => w.savedWrites[path] || null }),
        set: async (data: any) => { w.savedWrites[path] = data; },
        update: async (data: any) => { w.savedWrites[path] = {...(w.savedWrites[path] || {}), ...data}; }
      })
    };
    w.leaveRoom = () => {};
    w.updateRewardHud = () => {};
    w.rewardBurst = () => {};
    w.beep = () => {};
    w.logAttempt = async () => {};
    w.markMastered = (key: string) => { w.passedKeys.push(key); };
    w.goNextStep = () => { w.nextStepInvoked = true; };
    w.showModeGate = () => {};
    w.shuffle = (a: string[]) => a.slice().reverse();
  });
  await page.addScriptTag({ path: 'rashi-letters/alphabet-lab.js' });
}

async function answerRound(page: Page, count: number) {
  for(let i=0;i<count;i++) {
    const target=(await page.locator('.lab-target').textContent())?.trim();
    expect(target).toBeTruthy();
    await page.getByRole('button',{name:'Letter '+target,exact:true}).click();
    await expect(page.getByRole('button',{name:'Next question →'})).toBeVisible();
    await page.getByRole('button',{name:'Next question →'}).click();
  }
}

test('full Alef-Beis gallery displays 27 Rashi and regular letter shapes plus handwriting',async({page})=>{
  await startLab(page);
  await page.getByRole('button',{name:/Full Alef-Beis Lab/}).click();
  await expect(page.locator('.lab-tile')).toHaveCount(27);
  await page.locator('.lab-tile').first().click();
  await expect(page.locator('.lab-compare-box')).toHaveCount(3);
  await expect(page.locator('.lab-compare-box').nth(0)).toContainText('Regular Hebrew');
  await expect(page.locator('.lab-compare-box').nth(1)).toContainText('Rashi letters');
  await expect(page.locator('.lab-compare-box').nth(2)).toContainText('Handwriting');
});

test('all 27 letters must be independently recognized before mastery is awarded',async({page})=>{
  await startLab(page);
  await page.evaluate(() => (window as any).openRashiAlphabetLab('alphabet'));
  for(let chunk=0;chunk<3;chunk++){
    await answerRound(page,9);
    if(chunk<2)await page.getByRole('button',{name:/Continue mastering letters/}).click();
  }
  await expect(page.getByText('All 27 Rashi letters mastered!')).toBeVisible();
  const result=await page.evaluate(()=>{
    const w=window as any;
    const p=w.savedWrites['rashiLetters/progress/synthetic-test-student/alphabetLab'];
    return {count:Object.values(p.mastered).filter(Boolean).length,
      stats:Object.keys(p.stats).length,done:w.passedKeys.includes('alphabetDone')};
  });
  expect(result).toEqual({count:27,stats:27,done:true});
});

test('tricky-pair challenge keeps the existing progress and unlocks at seven of eight',async({page})=>{
  await startLab(page);
  await page.evaluate(() => (window as any).openRashiAlphabetLab('confusion'));
  await answerRound(page,8);
  await expect(page.getByText('You passed the tricky-letter challenge!')).toBeVisible();
  const passed=await page.evaluate(()=>(window as any).passedKeys.includes('confusionDone'));
  expect(passed).toBe(true);
});
