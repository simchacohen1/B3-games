import { test } from '@playwright/test';

test('Manual Interactive Bandwidth Test', async ({ page }) => {
  // Prevent Playwright from timing out early
  test.setTimeout(60000);

  let totalBytesReceived = 0;

  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const payloadSize = typeof frame.payload === 'string' 
        ? Buffer.byteLength(frame.payload, 'utf8') 
        : frame.payload.length;
        
      totalBytesReceived += payloadSize;
    });
  });

  await page.goto('https://funtorahtools.com');
  
  console.log('\n>>> BROWSER IS OPEN! You have 20 seconds to click around tools/dashboards... <<<\n');
  await page.waitForTimeout(20000);

  const megabytesReceived = totalBytesReceived / (1024 * 1024);
  console.log(`\n===================================`);
  console.log(`INTERACTIVE SESSION DOWNLOAD: ${megabytesReceived.toFixed(3)} MB`);
  console.log(`===================================\n`);
});
