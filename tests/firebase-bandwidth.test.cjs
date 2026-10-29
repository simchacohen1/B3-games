// Live-site check: opening the home page must not download more than 1 MB of
// Firebase Realtime Database data over WebSockets in the first 5 seconds.
// Runs under plain `node --test` (this folder is not a Playwright runner folder),
// and always closes its browser so a launch failure fails fast instead of hanging.
const test=require('node:test'),assert=require('node:assert/strict');
let chromium;try{({chromium}=require('playwright'))}catch{({chromium}=require('@playwright/test'))}

test('Firebase Realtime Database Bandwidth Test',{timeout:60000},async()=>{
  let browser,totalBytesReceived=0;
  try{
    browser=await chromium.launch();
    const page=await browser.newPage();
    // Track incoming WebSocket frames from Firebase
    page.on('websocket',ws=>{
      ws.on('framereceived',frame=>{
        totalBytesReceived+=typeof frame.payload==='string'?Buffer.byteLength(frame.payload,'utf8'):frame.payload.length;
      });
    });
    await page.goto('https://funtorahtools.com');
    await page.waitForTimeout(5000); // Observe network for 5 seconds
    const megabytesReceived=totalBytesReceived/(1024*1024);
    console.log(`\n--- FIREBASE BANDWIDTH METRICS ---\nTotal Downloaded: ${megabytesReceived.toFixed(3)} MB\n-----------------------------------\n`);
    // Fail if page load downloads > 1 MB of database data
    assert.ok(megabytesReceived<1.0,`Expected under 1 MB of database data, got ${megabytesReceived.toFixed(3)} MB`);
  }finally{
    await browser?.close();
  }
});
