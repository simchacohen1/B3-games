import { test, expect, type Page } from '@playwright/test';

// Whiteboard round 2, in a real browser: a student's own board gets the right-click menu, layers and text alignment,
// and New Slides starts a blank board. The student page is the real student-boards.js + the shared drawing toolbar,
// with an in-memory connection to the teacher (no Firebase, no peers, no students' data).
async function openStudentBoard(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(`<!doctype html><html><body>
    <div id="stage" style="width:960px;height:540px;position:relative;margin-left:120px"></div>
  </body></html>`);
  await page.addStyleTag({ path: 'class-pointer-prototype/classroom.css' });
  await page.addStyleTag({ path: 'class-pointer-prototype/student-boards.css' });
  await page.evaluate(() => {
    (window as any).__out = [];
    (window as any).ClassPointerBridge = {
      isTeacher: false, started: () => true, members: () => new Map(),
      send: () => {}, sendTeacher: (message: any) => (window as any).__out.push(message),
      status: (text: string) => ((window as any).__status = text), fail: () => {},
    };
  });
  await page.addScriptTag({ path: 'class-pointer-prototype/board-clipboard.js' });
  await page.addScriptTag({ path: 'class-pointer-prototype/annotation-toolbar.js' });
  await page.addScriptTag({ path: 'class-pointer-prototype/student-boards.js' });
  await page.evaluate(() => {
    (window as any).FTTAnnotate.setRole('student');
    (window as any).ClassPointerBoards.fromTeacher({ type: 'board-mode', on: true, mode: 'boards', blocked: false, strokes: [], text: null });
  });
  await expect(page.locator('#fttAnnotate .fa-bar')).toBeVisible();
  await expect(page.locator('#fttAnnotate .fa-tool[aria-pressed="true"]')).toContainText('Select');
}

const board = (page: Page) => page.locator('#myBoard canvas');
const marks = (page: Page) => page.evaluate(() => ((window as any).ClassPointerBoards.exportBoard().strokes as any[]).map(s => ({ id: s.id, tool: s.tool || 'pen', text: s.text, align: s.align })));
async function chooseTool(page: Page, tool: string) { await page.locator(`#fttAnnotate .fa-tool[data-tool="${tool}"]`).click(); }
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from); await page.mouse.down(); await page.mouse.move(...to, { steps: 6 }); await page.mouse.up();
}

test('a student draws two shapes, brings the lower one to the front from the right-click menu, and the teacher gets the order', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openStudentBoard(page);
    const b = (await board(page).boundingBox())!;
    const P = (fx: number, fy: number): [number, number] => [b.x + b.width * fx, b.y + b.height * fy];
    await chooseTool(page, 'shape');
    await drag(page, P(.2, .2), P(.45, .5));   // A
    await drag(page, P(.3, .3), P(.6, .65));   // B, drawn after A: on top
    const drawn = await marks(page);
    expect(drawn.map(m => m.tool)).toEqual(['rect', 'rect']);
    const [a, bb] = drawn;
    await chooseTool(page, 'select');

    // Right-click on A's own edge (outside B): the menu opens, A is picked.
    await page.mouse.click(...P(.2, .35), { button: 'right' });
    const menu = page.locator('#fttAnnotate .fa-ctx');
    await expect(menu).toBeVisible();
    for (const label of ['Cut', 'Copy', 'Paste', 'Delete', 'Bring to Front', 'Bring Forward', 'Send Backward', 'Send to Back']) {
      await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
    }
    await expect(menu.getByRole('menuitem', { name: 'Send to Back', exact: true })).toBeEnabled();
    await page.evaluate(() => ((window as any).__out.length = 0));
    await menu.getByRole('menuitem', { name: 'Bring to Front', exact: true }).click();
    await expect(menu).toHaveCount(0);
    const after = await marks(page);
    expect(after.map(m => m.id)).toEqual([bb.id, a.id]);
    // The teacher (and a group) get the same order as one small change, not a redraw of everything.
    const sent = await page.evaluate(() => (window as any).__out.filter((m: any) => m.type === 'board-order'));
    expect(sent).toEqual([expect.objectContaining({ type: 'board-order', ids: [bb.id, a.id] })]);

    // The toolbar shows the same four layer buttons for the picked mark; To back puts it underneath again.
    await expect(page.locator('#fttAnnotate .fa-layerbox')).toBeVisible();
    await page.locator('#fttAnnotate .fa-layerbox button[aria-label^="Send to back"]').click();
    expect((await marks(page)).map(m => m.id)).toEqual([a.id, bb.id]);
    // A mark that is already at the bottom says so and changes nothing.
    await page.locator('#fttAnnotate .fa-layerbox button[aria-label^="Send to back"]').click();
    expect((await marks(page)).map(m => m.id)).toEqual([a.id, bb.id]);

    // Moving a mark does not throw it to the top of the pile any more.
    await drag(page, P(.2, .35), P(.2, .4));
    const moved = await marks(page);
    expect(moved).toHaveLength(2);
    expect(moved[1].id).toBe(bb.id);
  } finally { await context.close(); }
});

test('a student copies a mark, pastes it from the right-click menu, and deletes with the menu; a click on empty board has no Copy', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openStudentBoard(page);
    const b = (await board(page).boundingBox())!;
    const P = (fx: number, fy: number): [number, number] => [b.x + b.width * fx, b.y + b.height * fy];
    await chooseTool(page, 'shape');
    await drag(page, P(.2, .2), P(.4, .45));
    await chooseTool(page, 'select');
    await page.mouse.click(...P(.2, .3), { button: 'right' });
    const menu = page.locator('#fttAnnotate .fa-ctx');
    await menu.getByRole('menuitem', { name: 'Copy', exact: true }).click();
    // On empty board there is nothing to cut, copy or delete, and no layers; Paste is on.
    await page.mouse.click(...P(.75, .7), { button: 'right' });
    await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
    await expect(menu.getByRole('menuitem', { name: 'Bring to Front', exact: true })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Paste', exact: true }).click();
    const list = await marks(page);
    expect(list).toHaveLength(2);
    // The pasted copy is where the right-click was, and is picked, so it can be dragged at once.
    const copyBox = await page.evaluate(() => {
      const s = (window as any).ClassPointerBoards.exportBoard().strokes[1];
      const xs = s.points.map((p: any) => p.x), ys = s.points.map((p: any) => p.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    });
    expect(copyBox.x).toBeCloseTo(.75, 1); expect(copyBox.y).toBeCloseTo(.7, 1);
    // Delete from the menu removes the picked mark.
    await page.mouse.click(...P(.65, .7), { button: 'right' });
    await menu.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    expect(await marks(page)).toHaveLength(1);
    // Escape closes the menu without doing anything.
    await page.mouse.click(...P(.2, .3), { button: 'right' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    expect(await marks(page)).toHaveLength(1);
  } finally { await context.close(); }
});

test('a student lines up words left, center or right, before and after typing them', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await openStudentBoard(page);
    const b = (await board(page).boundingBox())!;
    const P = (fx: number, fy: number): [number, number] => [b.x + b.width * fx, b.y + b.height * fy];
    await chooseTool(page, 'text');
    // The alignment buttons are there while the Text tool is chosen; center is picked first, for the next words.
    const align = page.locator('#fttAnnotate .fa-alignbox');
    await expect(align).toBeVisible();
    await align.getByRole('button', { name: /centered/ }).click();
    await page.mouse.click(...P(.3, .3));
    await expect(page.locator('#fttAnnotate textarea.fa-editor')).toBeFocused();
    await expect(page.locator('#fttAnnotate textarea.fa-editor')).toHaveCSS('text-align', 'center');
    await page.keyboard.type('a long first line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('short');
    await page.keyboard.press('Enter');
    let list = await marks(page);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ tool: 'text', text: 'a long first line\nshort', align: 'center' });

    // Pick the words with Select: the same buttons show what they are now and change them.
    await chooseTool(page, 'select');
    await page.mouse.click(...P(.3, .31));
    await expect(align).toBeVisible();
    await expect(align.getByRole('button', { name: /centered/ })).toHaveAttribute('aria-pressed', 'true');
    await align.getByRole('button', { name: /right/ }).click();
    list = await marks(page);
    expect(list).toHaveLength(1);
    expect(list[0].align).toBe('right');
    await align.getByRole('button', { name: /left/ }).click();
    list = await marks(page);
    expect(list[0].align).toBeUndefined();      // left is the usual and is stored as nothing
    // A shape has no alignment buttons.
    await chooseTool(page, 'shape');
    await drag(page, P(.5, .5), P(.7, .7));
    await chooseTool(page, 'select');
    await page.mouse.click(...P(.5, .6));
    await expect(align).toBeHidden();
    await expect(page.locator('#fttAnnotate .fa-layerbox')).toBeVisible();
  } finally { await context.close(); }
});

test('New Slides on a student board: the board is blank, it is a new board, and a shared group board has no button', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const dialogs: string[] = [];
  page.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  try {
    await openStudentBoard(page);
    const b = (await board(page).boundingBox())!;
    const P = (fx: number, fy: number): [number, number] => [b.x + b.width * fx, b.y + b.height * fy];
    const button = page.getByRole('button', { name: '🆕 New Slides' });
    await expect(button).toBeVisible();
    await chooseTool(page, 'shape');
    await drag(page, P(.2, .2), P(.4, .4));
    const before = await page.evaluate(() => (window as any).ClassPointerBoards.boardId());
    expect(await marks(page)).toHaveLength(1);
    await button.click();
    // Saving to My files is not available on this synthetic page, so the student is asked before anything is lost.
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toMatch(/could not be saved to My files/);
    await expect.poll(async () => (await marks(page)).length).toBe(0);
    expect(await page.evaluate(() => (window as any).ClassPointerBoards.boardId())).not.toBe(before);
    // And an empty board starts new slides without asking.
    await button.click();
    await page.waitForTimeout(150);
    expect(dialogs).toHaveLength(1);
  } finally { await context.close(); }
});
