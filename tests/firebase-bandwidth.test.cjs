const { test, expect } = require('@playwright/test');

test('Firebase Realtime Database Bandwidth Test', async ({ page }) => {
  let totalBytesReceived = 0;

  // Track incoming WebSocket frames from Firebase
  page.on('websocket', ws => {
    ws.on('framereceived', frame => {
      const payloadSize = typeof frame.payload === 'string' 
        ? Buffer.byteLength(frame.payload, 'utf8') 
        : frame.payload.length;
        
      totalBytesReceived += payloadSize;
    });
  });

  // Navigate to your site
  await page.goto('https://funtorahtools.com');
  await page.waitForTimeout(5000); // Observe network for 5 seconds

  const megabytesReceived = totalBytesReceived / (1024 * 1024);
  console.log(`\n--- FIREBASE BANDWIDTH METRICS ---`);
  console.log(`Total Downloaded: ${megabytesReceived.toFixed(3)} MB`);
  console.log(`-----------------------------------\n`);

  // Assert threshold: fail if page load downloads > 1 MB of database data
  expect(megabytesReceived).toBeLessThan(1.0);
});