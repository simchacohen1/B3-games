import { test, expect, type Browser, type Page } from '@playwright/test';
import { SITE, loadCredentials, signInStudent, watchPage, expectStagingIsolation, type PageWatch } from './staging-common';

// Runs only against the isolated staging site with fictional TEST-ALEF students.
const credentials = loadCredentials();
const classAccounts = credentials?.studentAccounts.filter(row => row.classId === 'TEST-ALEF') || [];
const NOT_CONFIGURED = 'NOT VERIFIED: fictional staging credentials are not configured';

async function finishRashiRace(page: Page) {
  for (let question = 1; question <= 10; question += 1) {
    const target = page.locator('#simArea .letter-box .sim-big');
    await expect(target).toBeVisible({ timeout: 30000 });
    const letter = (await target.textContent())?.trim() || '';
    const choices = await page.locator('#simArea .choice-btn').allTextContents();
    const answer = choices.findIndex(choice => choice.trim() === letter);
    expect(answer, 'the displayed matching letter is one of the choices').toBeGreaterThanOrEqual(0);
    await page.locator('#simArea .choice-btn').nth(answer).click();
    if (question < 10) {
      await expect(page.locator('#simArea .sim-status')).toContainText(`Letter ${question + 1} of 10`, { timeout: 15000 });
    }
  }
  await expect(page.locator('#simArea')).toContainText(/wins!|You won the race!/, { timeout: 30000 });
}

const gameJourneys: Array<{ name: string; card: number; hostBox: string; guestBox: string; status: string; nextStatus: string; choices: string; configureWeeklyQuiz?: boolean }> = [
  { name: 'Shorashim Race', card: 0, hostBox: '#shFriendsBox', guestBox: '#shFriendsBox', status: 'Question 1 of', nextStatus: 'Question 2 of', choices: '.b3r-choices button' },
  { name: 'Yiddish Race', card: 1, hostBox: '#yiFriendsBox', guestBox: '#yiFriendsBox', status: 'Question 1 of', nextStatus: 'Question 2 of', choices: '.b3r-choices button' },
  { name: 'Gematria Race', card: 2, hostBox: '#raceBox', guestBox: '#raceBox', status: 'Question 1 of', nextStatus: 'Question 2 of', choices: '.b3r-choices button' },
  { name: 'Weekly Quiz Race', card: 3, hostBox: '#raceBox', guestBox: '#raceBox', status: 'Question 1 of', nextStatus: 'Question 2 of', choices: '.b3r-choices button', configureWeeklyQuiz: true },
  { name: 'Rashi Letters Match', card: 4, hostBox: '#simArea', guestBox: '#simArea', status: 'Letter 1 of', nextStatus: 'Letter 2 of', choices: '.choice-btn' },
];

async function answerOneQuestion(page: Page, game: typeof gameJourneys[number]) {
  const box = page.locator(game.guestBox);
  await expect(box).toContainText(game.status, { timeout: 30000 });
  await box.locator(game.choices).first().click();
  await expect(box).toContainText(game.nextStatus, { timeout: 15000 });
}

function latestInvite(page: Page, studentName: string, gameName: string) {
  return page.locator('.invite').filter({ hasText: studentName }).filter({ hasText: gameName }).last();
}

test.describe('Multiplayer Center staging journeys @multiplayer @auth', () => {
  test.skip(!credentials, NOT_CONFIGURED);
  test.skip(classAccounts.length < 2, 'NOT VERIFIED: two fictional TEST-ALEF students are required');

  let host: Page;
  let guest: Page;
  let hostWatch: PageWatch;
  let guestWatch: PageWatch;

  test.beforeEach(async ({ browser }) => {
    const browserClient = browser as Browser;
    host = await browserClient.newPage({ viewport: { width: 1280, height: 900 } });
    guest = await browserClient.newPage({ viewport: { width: 390, height: 844 } });
    [hostWatch, guestWatch] = await Promise.all([watchPage(host), watchPage(guest)]);
    await Promise.all([
      signInStudent(host, classAccounts[0]),
      signInStudent(guest, classAccounts[1]),
    ]);
  });

  test.afterEach(async () => {
    expect(hostWatch.productionRequests, 'host requests to production').toEqual([]);
    expect(guestWatch.productionRequests, 'guest requests to production').toEqual([]);
    await Promise.all([host?.close(), guest?.close()]);
  });

  test('host invitation is class scoped, guests can leave, rejoin, and wait for the host', async () => {
    await host.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(host);
    await expect(host.locator('#accountStatus')).toContainText(classAccounts[0].name, { timeout: 30000 });
    await host.getByRole('button', { name: 'Start Game' }).nth(4).click();
    await expect(host).toHaveURL(/rashi-letters\/student\.html\?b3Multiplayer=start/);
    await expect(host.locator('#simArea')).toContainText('Waiting for friends to join', { timeout: 45000 });

    await guest.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(guest);
    await expect(guest.locator('#accountStatus')).toContainText(classAccounts[1].name, { timeout: 30000 });
    const invite = latestInvite(guest, classAccounts[0].name, 'Rashi Letters Match');
    await expect(invite).toContainText('Rashi Letters Match', { timeout: 30000 });
    await expect(invite).toContainText('1 player waiting');
    await invite.getByRole('button', { name: 'Join Game' }).click();
    await expect(guest).toHaveURL(/rashi-letters\/student\.html\?b3Multiplayer=join/);
    await expect(guest.locator('#simArea')).toContainText('Waiting for', { timeout: 30000 });
    // A browser refresh must rejoin the same waiting room without losing the host's control.
    await guest.reload({ waitUntil: 'domcontentloaded' });
    await expect(guest.locator('#simArea')).toContainText('Waiting for', { timeout: 30000 });
    await expect(host.locator('#simArea')).toContainText('2 players here', { timeout: 15000 });

    // Leaving removes the guest from the host's roster and keeps the host in control.
    await guest.getByRole('button', { name: '← Leave' }).click();
    await expect(host.locator('#simArea')).toContainText('1 player here', { timeout: 15000 });
    await expect(host.locator('#simArea .mp-panel > button')).toBeDisabled();

    await guest.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    const returnInvite = latestInvite(guest, classAccounts[0].name, 'Rashi Letters Match');
    await returnInvite.getByRole('button', { name: 'Join Game' }).click();
    await expect(host.locator('#simArea').getByRole('button', { name: /Start the race/ })).toBeEnabled({ timeout: 15000 });
    await host.locator('#simArea').getByRole('button', { name: /Start the race/ }).click();
    await expect(host.locator('#simArea')).toContainText('Get ready', { timeout: 10000 });
    await expect(guest.locator('#simArea')).toContainText('Get ready', { timeout: 10000 });
    await Promise.all([finishRashiRace(host), finishRashiRace(guest)]);
    expect(hostWatch.pageErrors).toEqual([]);
    expect(guestWatch.pageErrors).toEqual([]);
  });

  test('Not Now dismisses a waiting invitation and the mobile center stays usable', async () => {
    await host.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(host);
    await host.getByRole('button', { name: 'Start Game' }).nth(4).click();
    await expect(host.locator('#simArea')).toContainText('Waiting for friends to join', { timeout: 45000 });

    await guest.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(guest);
    const matchingInvites = guest.locator('.invite').filter({ hasText: classAccounts[0].name }).filter({ hasText: 'Rashi Letters Match' });
    const invite = matchingInvites.last();
    await expect(invite).toBeVisible({ timeout: 30000 });
    const inviteCount = await matchingInvites.count();
    await invite.getByRole('button', { name: 'Not Now' }).click();
    await expect(matchingInvites).toHaveCount(inviteCount - 1);
    await expect(guest.getByRole('button', { name: 'Start Game' })).toHaveCount(17);
    await expect(guest.getByRole('button', { name: 'Start Game' }).nth(4)).toBeVisible();
    expect(guestWatch.pageErrors).toEqual([]);
  });

  test('three classmates can run different games and join the one they choose', async ({ browser }) => {
    test.skip(classAccounts.length < 3, 'NOT VERIFIED: three fictional TEST-ALEF students are required');
    const secondHost = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const secondHostWatch = await watchPage(secondHost);
    try {
      await signInStudent(secondHost, classAccounts[2]);
      await host.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
      await expectStagingIsolation(host);
      await host.getByRole('button', { name: 'Start Game' }).nth(4).click();
      await expect(host.locator('#simArea')).toContainText('Waiting for friends to join', { timeout: 45000 });

      await secondHost.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
      await expectStagingIsolation(secondHost);
      await secondHost.getByRole('button', { name: 'Start Game' }).nth(2).click();
      await expect(secondHost.locator('#raceBox')).toContainText('Waiting for friends to join', { timeout: 45000 });

      await guest.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
      await expectStagingIsolation(guest);
      const rashiInvites = guest.locator('.invite').filter({ hasText: classAccounts[0].name }).filter({ hasText: 'Rashi Letters Match' });
      const rashi = rashiInvites.last();
      const gematria = latestInvite(guest, classAccounts[2].name, 'Gematria Race');
      await expect(rashi).toContainText('Rashi Letters Match', { timeout: 30000 });
      await expect(gematria).toContainText('Gematria Race', { timeout: 30000 });
      const rashiCount = await rashiInvites.count();
      await rashi.getByRole('button', { name: 'Not Now' }).click();
      await expect(rashiInvites).toHaveCount(rashiCount - 1);
      await expect(gematria).toBeVisible();
      await gematria.getByRole('button', { name: 'Join Game' }).click();
      await expect(guest).toHaveURL(/gematria\/index\.html\?b3Multiplayer=join/);
      await expect(guest.locator('#raceBox')).toContainText('Waiting for', { timeout: 30000 });
      await expect(secondHost.locator('#raceBox').getByRole('button', { name: /Start the race/ })).toBeEnabled({ timeout: 15000 });
      await expect(host.locator('#simArea')).toContainText('1 player here', { timeout: 15000 });
      expect(secondHostWatch.productionRequests).toEqual([]);
      expect(secondHostWatch.pageErrors).toEqual([]);
    } finally {
      await secondHost.close();
    }
  });

  test('a disconnected host closes the waiting room with a clear way back', async () => {
    await host.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(host);
    await host.getByRole('button', { name: 'Start Game' }).nth(4).click();
    await expect(host.locator('#simArea')).toContainText('Waiting for friends to join', { timeout: 45000 });

    await guest.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(guest);
    const invite = latestInvite(guest, classAccounts[0].name, 'Rashi Letters Match');
    await invite.getByRole('button', { name: 'Join Game' }).click();
    await expect(guest.locator('#simArea')).toContainText('Waiting for', { timeout: 30000 });
    await host.close();
    await expect(guest.locator('#simArea')).toContainText('The host left. This waiting room has closed.', { timeout: 30000 });
    await guest.locator('#simArea').getByRole('button', { name: 'Browse other games' }).click();
    await expect(guest).toHaveURL(/multiplayer\/index\.html/);
    await expect(guest.getByRole('button', { name: 'Start Game' })).toHaveCount(17);
  });

  for (const game of gameJourneys) {
    test(`${game.name} starts, joins, and accepts live answers`, async () => {
      await host.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
      await expectStagingIsolation(host);
      await host.getByRole('button', { name: 'Start Game' }).nth(game.card).click();
      if (game.configureWeeklyQuiz) {
        await expect(host.locator('#posukGrid button').first()).toBeVisible({ timeout: 45000 });
        await host.getByRole('button', { name: 'Select All' }).click();
        await host.getByRole('button', { name: /Race My Friends/ }).click();
      }
      await expect(host.locator(game.hostBox)).toBeVisible();
      await expect(host.locator(game.hostBox)).toContainText('Waiting for friends to join', { timeout: 60000 });

      await guest.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
      await expectStagingIsolation(guest);
      const invite = latestInvite(guest, classAccounts[0].name, game.name);
      await expect(invite).toContainText(game.name, { timeout: 30000 });
      await invite.getByRole('button', { name: 'Join Game' }).click();
      await expect(guest.locator(game.guestBox)).toBeVisible();
      await expect(guest.locator(game.guestBox)).toContainText('Waiting for', { timeout: 30000 });

      const start = host.locator(game.hostBox).getByRole('button', { name: /Start the race/ });
      await expect(start).toBeEnabled({ timeout: 15000 });
      await start.click();
      await expect(host.locator(game.hostBox)).toContainText('Get ready', { timeout: 10000 });
      await expect(guest.locator(game.guestBox)).toContainText('Get ready', { timeout: 10000 });
      await Promise.all([answerOneQuestion(host, game), answerOneQuestion(guest, game)]);
      expect(hostWatch.pageErrors).toEqual([]);
      expect(guestWatch.pageErrors).toEqual([]);
    });
  }
});
