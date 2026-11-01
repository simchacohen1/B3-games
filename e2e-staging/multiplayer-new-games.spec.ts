import { test, expect, type Browser, type Page } from '@playwright/test';
import { SITE, loadCredentials, signInStudent, watchPage, expectStagingIsolation, resetFirebaseTraffic, type PageWatch } from './staging-common';

const credentials = loadCredentials();
const students = credentials?.studentAccounts.filter(row => row.classId === 'TEST-ALEF') || [];
const games = [
  { key: 'connect-four', title: 'Connect 4' }, { key: 'tic-tac-toe', title: 'Tic Tac Toe' },
  { key: 'memory-match', title: 'Memory Match' }, { key: 'checkers', title: 'Checkers' },
  { key: 'reversi', title: 'Reversi' }, { key: 'bingo', title: 'Bingo' },
  { key: 'math-race', title: 'Math Race' }, { key: 'set', title: 'Set' },
  { key: 'ludo', title: 'Ludo' }, { key: 'dominoes', title: 'Dominoes' },
  { key: 'go-fish', title: 'Go Fish' }, { key: 'uno-style', title: 'Uno-style Cards' },
];

test.describe('Multiplayer Center new game staging journeys @multiplayer @auth', () => {
  test.skip(!credentials, 'NOT VERIFIED: fictional staging credentials are not configured');
  test.skip(students.length < 2, 'NOT VERIFIED: two fictional TEST-ALEF students are required');
  let host: Page;
  let guest: Page;
  let hostWatch: PageWatch;
  let guestWatch: PageWatch;
  let fullMathRaceTraffic = { sent: 0, received: 0 };

  function trafficTotals() {
    return {
      sent: hostWatch.firebaseBytesSent + guestWatch.firebaseBytesSent,
      received: hostWatch.firebaseBytesReceived + guestWatch.firebaseBytesReceived,
    };
  }

  test.describe.configure({ mode: 'serial' });
  test.beforeAll(async ({ browser }) => {
    const b = browser as Browser;
    host = await b.newPage({ viewport: { width: 1280, height: 900 } });
    guest = await b.newPage({ viewport: { width: 390, height: 844 } });
    [hostWatch, guestWatch] = await Promise.all([watchPage(host), watchPage(guest)]);
    await Promise.all([signInStudent(host, students[0]), signInStudent(guest, students[1])]);
    resetFirebaseTraffic(hostWatch);
    resetFirebaseTraffic(guestWatch);
  });

  test.afterAll(async () => {
    expect(hostWatch.productionRequests, 'host requests to production').toEqual([]);
    expect(guestWatch.productionRequests, 'guest requests to production').toEqual([]);
    expect(hostWatch.pageErrors, 'host browser errors').toEqual([]);
    expect(guestWatch.pageErrors, 'guest browser errors').toEqual([]);
    console.info('Firebase RTDB WebSocket payload bytes during this staging run:', JSON.stringify({
      sent: hostWatch.firebaseBytesSent + guestWatch.firebaseBytesSent,
      received: hostWatch.firebaseBytesReceived + guestWatch.firebaseBytesReceived,
    }));
    console.info('Firebase RTDB WebSocket payload bytes for one completed two-student Math Race:', JSON.stringify(fullMathRaceTraffic));
    await Promise.all([host?.close(), guest?.close()]);
  });

  async function enterRoom(game: typeof games[number]) {
    await host.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(host);
    await expect(host.locator('#accountStatus')).toContainText(students[0].name, { timeout: 30000 });
    await host.getByRole('button', { name: 'Start Game' }).nth(games.findIndex(item => item.key === game.key) + 5).click();
    await expect(host).toHaveURL(new RegExp(`multiplayer/game\\.html\\?game=${game.key}`));
    await expect(host.locator('#roomState')).toContainText('Waiting for classmates', { timeout: 30000 });
    const hostRoomCode = await host.evaluate(() => new URLSearchParams(location.search).get('b3MultiplayerRoom'));
    expect(hostRoomCode).toMatch(/^\d{6}$/);
    await guest.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(guest);
    await expect(guest.locator('#accountStatus')).toContainText(students[1].name, { timeout: 30000 });
    const invite = guest.locator('.invite').filter({ hasText: students[0].name }).filter({ hasText: game.title }).last();
    await expect(invite).toBeVisible({ timeout: 30000 });
    await invite.getByRole('button', { name: 'Join Game' }).click();
    await expect(guest).toHaveURL(new RegExp(`[?&]b3MultiplayerRoom=${hostRoomCode}(?:&|$)`));
    await expect(guest.locator('#roomState')).toContainText('Waiting for the host to start', { timeout: 30000 });
    await expect(host.getByRole('button', { name: 'Start game', exact: true })).toBeEnabled({ timeout: 15000 });
    await host.getByRole('button', { name: 'Start game', exact: true }).click();
    await expect(host.locator('#board')).toBeVisible();
    await expect(guest.locator('#board')).toBeVisible();
    await expect(host.locator('#players')).toContainText(students[0].name);
    await expect(host.locator('#players')).toContainText(students[1].name);
    await expect(guest.locator('#players')).toContainText(students[0].name);
    await expect(guest.locator('#players')).toContainText(students[1].name);
  }

  async function otherHandDenied(page: Page) {
    return page.evaluate(async hostId => {
      const code = new URLSearchParams(location.search).get('b3MultiplayerRoom');
      try {
        await (window as any).firebase.database().ref(`b3Private/multiplayerGames/workspaces/b3-2026/classes/TEST-ALEF/rooms/${code}/hands/${hostId}`).once('value');
        return false;
      } catch { return true; }
    }, 'test_student_alef');
  }

  async function publicPlayerNames(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
      const code = new URLSearchParams(location.search).get('b3MultiplayerRoom');
      const snapshot = await (window as any).firebase.database()
        .ref(`multiplayerCenter/workspaces/b3-2026/classes/TEST-ALEF/strategyRooms/${code}`).once('value');
      return (snapshot.val()?.players || []).map((player: any) => String(player.name || ''));
    });
  }

  for (const game of games) {
    test(`${game.title} starts with two students and synchronizes a legal move`, async () => {
      const trafficBeforeSession = trafficTotals();
      await enterRoom(game);
      const hostCells = host.locator('#board .board-cell');
      const guestCells = guest.locator('#board .board-cell');
      if (game.key === 'connect-four') {
        await hostCells.first().click(); await expect(guest.locator('#board .disc-red')).toHaveCount(1);
      } else if (game.key === 'tic-tac-toe') {
        await hostCells.first().click(); await expect(guest.locator('#board .mark-x')).toHaveCount(1);
      } else if (game.key === 'memory-match') {
        await hostCells.nth(0).click(); await expect(guestCells.nth(0)).not.toHaveText('?');
        await hostCells.nth(1).click(); await expect(guestCells.nth(1)).not.toHaveText('?');
      } else if (game.key === 'checkers') {
        await hostCells.nth(40).click(); await hostCells.nth(33).click(); await expect(guestCells.nth(33)).toHaveText('●');
      } else if (game.key === 'reversi') {
        await hostCells.nth(20).click(); await expect(guest.locator('#board .piece-red')).toHaveCount(4);
      } else if (game.key === 'bingo') {
        await host.getByRole('button', { name: 'Draw next number' }).click(); await expect(guest.locator('#board')).toContainText(/Called: \d+/);
      } else if (game.key === 'math-race') {
        for (let question = 1; question <= 10; question += 1) {
          for (const page of [host, guest]) {
            await expect(page.locator('#board')).toContainText(`Question ${question} of 10`);
            const prompt = (await page.locator('#board .game-result').first().textContent()) || '';
            const m = prompt.match(/(\d+)\s*([+−×])\s*(\d+)/); expect(m, `parseable math prompt: ${prompt}`).not.toBeNull();
            const a = Number(m![1]), b = Number(m![3]); const answer = m![2] === '+' ? a + b : m![2] === '−' ? a - b : a * b;
            await page.locator('#mathAnswer').fill(String(answer)); await page.getByRole('button', { name: 'Submit answer' }).click();
          }
          if (question < 10) {
            await expect(host.locator('#board')).toContainText(`Question ${question + 1} of 10`);
            await expect(guest.locator('#board')).toContainText(`Question ${question + 1} of 10`);
          }
        }
        await expect(host.locator('#board')).toContainText('10 points');
        await expect(guest.locator('#board')).toContainText('10 points');
        await expect(host.locator('#board')).toContainText(/draw|won/i);
        const after = trafficTotals();
        fullMathRaceTraffic = { sent: after.sent - trafficBeforeSession.sent, received: after.received - trafficBeforeSession.received };
      } else if (game.key === 'set') {
        const indexes = await host.evaluate(() => {
          const cells = Array.from(document.querySelectorAll('#board .board-cell'));
          const p = cells.map(n => {
            const tokens=(n.textContent||'').trim().split(/\s{2,}/);
            const m=tokens[0]?.match(/^[●◆■](🔴|🟣|🟢)(○|◍|●)$/u);
            return [tokens.length-1,['●','◆','■'].indexOf(Array.from(tokens[0]||'')[0]),['🔴','🟣','🟢'].indexOf(m?.[1]||''),['○','◍','●'].indexOf(m?.[2]||'')];
          });
          const valid=(a:number,b:number,c:number)=>a===b&&b===c||a!==b&&a!==c&&b!==c;
          for(let a=0;a<p.length;a++)for(let b=a+1;b<p.length;b++)for(let c=b+1;c<p.length;c++)if([0,1,2,3].every(k=>valid(p[a][k],p[b][k],p[c][k])))return[a,b,c];
          return [];
        });
        expect(indexes).toHaveLength(3); for(const i of indexes)await hostCells.nth(i).click();
        await expect(host.locator('#board')).toContainText(': 1 sets'); await expect(guest.locator('#board')).toContainText(': 1 sets');
      } else if (game.key === 'ludo') {
        let movedPage: Page | null = null;
        const [hostId, guestId] = await Promise.all([host, guest].map(page => page.evaluate(() =>
          sessionStorage.getItem('b3Games_studentId') || sessionStorage.getItem('posukPractice_studentId') || ''
        )));
        const readLudoState = () => host.evaluate(async () => {
          const code = new URLSearchParams(location.search).get('b3MultiplayerRoom');
          const ref = (window as any).firebase.database().ref(`multiplayerCenter/workspaces/b3-2026/classes/TEST-ALEF/strategyRooms/${code}`);
          return (await ref.once('value')).val();
        });
        for (let i = 0; i < 60 && !movedPage; i += 1) {
          const state = await readLudoState();
          const activeId = state?.turn;
          const active = activeId === hostId ? host : activeId === guestId ? guest : null;
          expect(active, 'the public room turn belongs to one of the two authenticated students').not.toBeNull();

          if (state.lastRoll == null) {
            const roll = active!.locator('#actions').getByRole('button', { name: 'Roll die' });
            await expect(roll).toBeEnabled({ timeout: 15000 });
            await roll.click();
            await expect.poll(async () => {
              const next = await readLudoState();
              return next?.lastRoll != null || next?.turn !== activeId;
            }, { timeout: 15000 }).toBe(true);
          } else {
            const token = active!.locator('#board .ludo-token:not([disabled])').first();
            await expect(token).toBeEnabled({ timeout: 15000 });
            await token.click();
            await expect.poll(async () => {
              const next = await readLudoState();
              return Number(next?.tokens?.[activeId]?.[0]) >= 0;
            }, { timeout: 15000 }).toBe(true);
            movedPage = active;
          }
        }
        expect(movedPage,'one of the seeded rolls permits a token move').not.toBeNull();
        await expect(movedPage!.locator('#board')).toContainText(/Token 1: Track \d+/);
      } else if (game.key === 'dominoes') {
        expect(await otherHandDenied(guest),'a student cannot read the host private hand').toBe(true);
        const active=guest, buttons=active.locator('#board .playing-card:not([disabled])');
        const table=await active.locator('#board .domino-line').textContent()||''; const ends=Array.from(table.matchAll(/(\d+)\s*\|\s*(\d+)/g)).flatMap(m=>[Number(m[1]),Number(m[2])]);
        let played=false;
        for(const b of await buttons.all()){const m=(await b.textContent()||'').match(/(\d+)\s*\|\s*(\d+)/);if(m&&(ends.includes(Number(m[1]))||ends.includes(Number(m[2])))){await b.click();played=true;break;}}
        if(!played){await active.getByRole('button',{name:'Draw a tile'}).click();await expect(active.locator('#board .card-hand .playing-card')).toHaveCount(8);} else await expect(host.locator('#board .domino-line')).toContainText(/\|/);
      } else if (game.key === 'go-fish') {
        expect(await otherHandDenied(guest),'a student cannot read the host private hand').toBe(true);
        await host.locator('#board .playing-card').first().click(); await host.getByRole('button',{name:'Ask Test Student A2'}).click();
        await expect(host.locator('#board')).toContainText('Books collected:'); await expect(guest.locator('#board')).toContainText('Books collected:');
      } else if (game.key === 'uno-style') {
        expect(await otherHandDenied(guest),'a student cannot read the host private hand').toBe(true);
        const boardText=await host.locator('#board').innerText();
        const currentColor=boardText.match(/Current color:\s*(\w+)/)?.[1]?.toLowerCase()||'';
        const topValue=boardText.match(/Top card:\s*(?:red|yellow|green|blue|wild)\s+([\w-]+)/i)?.[1]?.toLowerCase()||'';
        const hand=host.locator('#board .playing-card:not([disabled])'), labels=await hand.allTextContents();
        const playable=labels.findIndex(label=>{
          const [color='',value='']=label.split(' · ').map(text=>text.trim().toLowerCase());
          return value===topValue || color===currentColor && !['wild','wild4'].includes(value) || color==='wild' && value==='wild';
        });
        const beforeCount=Number(boardText.match(/Test Student A1:\s*(\d+) cards/)?.[1]||7);
        if(playable>=0){
          await hand.nth(playable).click();
          const colors=host.locator('#actions').getByRole('button',{name:/^(red|yellow|green|blue)$/});
          if(await colors.count())await colors.first().click();
        } else await host.getByRole('button',{name:'Draw a card'}).click();
        const expectedCount=beforeCount+(playable>=0?-1:1);
        await expect(host.locator('#board')).toContainText(new RegExp(`:\\s*${expectedCount} cards`));
        await expect(guest.locator('#board')).toContainText(new RegExp(`:\\s*${expectedCount} cards`));
      }
      await expect.poll(() => publicPlayerNames(host)).toEqual([students[0].name, students[1].name]);
      await expect(host.locator('#players')).toContainText(students[0].name);
      await expect(host.locator('#players')).toContainText(students[1].name);
      await expect(guest.locator('#players')).toContainText(students[0].name);
      await expect(guest.locator('#players')).toContainText(students[1].name);
    });
  }

  test('two students can run different rooms at the same time', async () => {
    await host.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(host);
    await host.getByRole('button', { name: 'Start Game' }).nth(5).click();
    await expect(host).toHaveURL(/multiplayer\/game\.html\?game=connect-four/);
    await expect(host.locator('#roomState')).toContainText('Waiting for classmates', { timeout: 30000 });

    await guest.goto(SITE + '/multiplayer/index.html', { waitUntil: 'domcontentloaded' });
    await expectStagingIsolation(guest);
    await guest.getByRole('button', { name: 'Start Game' }).nth(6).click();
    await expect(guest).toHaveURL(/multiplayer\/game\.html\?game=tic-tac-toe/);
    await expect(guest.locator('#roomState')).toContainText('Waiting for classmates', { timeout: 30000 });

    const codes = await Promise.all([host, guest].map(page => page.evaluate(() => new URLSearchParams(location.search).get('b3MultiplayerRoom'))));
    expect(codes[0]).toMatch(/^\d{6}$/);
    expect(codes[1]).toMatch(/^\d{6}$/);
    expect(codes[0]).not.toBe(codes[1]);
    const rooms = await host.evaluate(async roomCodes => Promise.all(roomCodes.map(async code => {
      const base = 'multiplayerCenter/workspaces/b3-2026/classes/TEST-ALEF';
      const ref = (window as any).firebase.database().ref(`${base}/rooms/arcade-${code}`);
      const snapshot = await ref.once('value');
      return snapshot.val();
    })), codes);
    expect(rooms.map((room: any) => room?.gameKey)).toEqual(['connect-four', 'tic-tac-toe']);
    expect(rooms.every((room: any) => room?.state === 'lobby')).toBe(true);

    await Promise.all([
      host.getByRole('button', { name: 'Close room' }).click(),
      guest.getByRole('button', { name: 'Close room' }).click(),
    ]);
    await expect(host).toHaveURL(/multiplayer\/index\.html/);
    await expect(guest).toHaveURL(/multiplayer\/index\.html/);
  });
});
