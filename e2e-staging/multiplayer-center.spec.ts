import { test, expect, type BrowserContext, type Page } from '@playwright/test';
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

async function preserveStudentSession(page: Page, context: BrowserContext) {
  const session = await page.evaluate(() => Object.fromEntries(
    Object.entries(sessionStorage).filter(([key]) => /^(b3Games_student|posukPractice_student|weeklyQuiz_classId)/.test(key))
  ));
  await context.addInitScript(values => {
    Object.entries(values).forEach(([key, value]) => sessionStorage.setItem(key, String(value)));
  }, session);
}


test.describe('Multiplayer Center staging journeys @multiplayer @auth', () => {
  test.skip(!credentials, NOT_CONFIGURED);
  test.skip(classAccounts.length < 2, 'NOT VERIFIED: two fictional TEST-ALEF students are required');

  let host: Page;
  let guest: Page;
  let hostWatch: PageWatch;
  let guestWatch: PageWatch;
  let hostContext: BrowserContext;
  let guestContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const hostAuthPage = await hostContext.newPage();
    const guestAuthPage = await guestContext.newPage();
    await Promise.all([
      signInStudent(hostAuthPage, classAccounts[0]),
      signInStudent(guestAuthPage, classAccounts[1]),
    ]);
    await Promise.all([
      preserveStudentSession(hostAuthPage, hostContext),
      preserveStudentSession(guestAuthPage, guestContext),
    ]);
  });

  test.beforeEach(async () => {
    host = await hostContext.newPage();
    guest = await guestContext.newPage();
    [hostWatch, guestWatch] = await Promise.all([watchPage(host), watchPage(guest)]);
  });

  test.afterEach(async () => {
    expect(hostWatch.productionRequests, 'host requests to production').toEqual([]);
    expect(guestWatch.productionRequests, 'guest requests to production').toEqual([]);
    await Promise.all([host?.close(), guest?.close()]);
  });

  test.afterAll(async () => {
    await Promise.all([hostContext?.close(), guestContext?.close()]);
  });

  test('categories are easy to switch on desktop and tablet, and a full game card starts and returns', async () => {
    await host.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(host);
    await expect(host.locator('#accountStatus')).toContainText(classAccounts[0].name, { timeout: 30000 });

    const categories = [
      { label: 'All Games, 17 games', count: 17, games: ['Shorashim Race', 'Yiddish Race', 'Gematria Race', 'Weekly Quiz Race', 'Rashi Letters Match', 'Connect 4', 'Tic Tac Toe', 'Memory Match', 'Checkers', 'Reversi', 'Bingo', 'Math Race', 'Set', 'Ludo', 'Dominoes', 'Go Fish', 'Uno-style Cards'] },
      { label: 'Torah & Jewish, 5 games', count: 5, games: ['Shorashim Race', 'Yiddish Race', 'Gematria Race', 'Weekly Quiz Race', 'Rashi Letters Match'] },
      { label: 'Board & Strategy, 5 games', count: 5, games: ['Connect 4', 'Tic Tac Toe', 'Checkers', 'Reversi', 'Ludo'] },
      { label: 'Cards & Matching, 5 games', count: 5, games: ['Memory Match', 'Set', 'Dominoes', 'Go Fish', 'Uno-style Cards'] },
      { label: 'Quick Challenges, 2 games', count: 2, games: ['Bingo', 'Math Race'] },
    ];
    for (const category of categories) {
      const tab = host.getByRole('button', { name: category.label, exact: true });
      await tab.click();
      await expect(tab).toBeFocused();
      await expect(host.locator('.game')).toHaveCount(category.count);
      await expect(host.locator('.game-name')).toHaveText(category.games);
    }

    await host.setViewportSize({ width: 820, height: 1180 });
    await host.getByRole('button', { name: 'All Games, 17 games', exact: true }).click();
    await expect(host.locator('.game')).toHaveCount(17);
    expect(await host.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'tablet layout has no horizontal page overflow').toBe(true);

    await host.getByRole('button', { name: 'Start Game: Connect 4' }).click({ position: { x: 60, y: 55 } });
    await expect(host).toHaveURL(/multiplayer\/game\.html\?game=connect-four/);
    await expect(host.locator('#roomState')).toContainText('Waiting for classmates', { timeout: 30000 });
    await host.getByRole('button', { name: 'Close room' }).click();
    await expect(host).toHaveURL(/multiplayer\/index\.html/);
    await expect(host.locator('.game')).toHaveCount(17);
    expect(hostWatch.pageErrors).toEqual([]);
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
      await expect(guest.getByRole('heading', { name: 'Friends waiting to play' })).toBeVisible();
      await expect(guest.locator('#invitationSummary')).toContainText('ready to join');
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
