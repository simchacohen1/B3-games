'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(require.resolve('playwright',{
  paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]
}));

const html=fs.readFileSync('halacha/index.html','utf8');
const start=html.indexOf('function ensureBgToggle(e){');
const end=html.indexOf('function ensureResizeHandle(e){',start);
assert.ok(start>=0&&end>start,'Halacha scrapbook helpers are present');
const helpers=html.slice(start,end);
let browser;

test.before(async()=>{
  browser=await chromium.launch({
    headless:true,
    executablePath:process.env.HALACHA_TEST_CHROMIUM||undefined,
    args:['--no-sandbox','--disable-gpu']
  });
});
test.after(async()=>browser?.close());

test('restoring a legacy textbox creates controls without an insertBefore exception',async()=>{
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<div class="scrap textbox"><div class="tb-text">saved work</div></div>');
  await page.addScriptTag({content:'var HALACHA_TEACHER_VIEW=false; function persist(){} function removeP(){} '+helpers+' ensureDeleteControl(document.querySelector(".scrap"));'});
  assert.equal(await page.locator('.tb-text').textContent(),'saved work');
  assert.equal(await page.locator('.mini .bg-toggle').count(),1);
  assert.equal(await page.locator('.mini .delete-piece').count(),1);
  assert.deepEqual(errors,[]);
  await page.close();
});
