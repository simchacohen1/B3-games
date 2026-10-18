import { test, expect, type Page } from '@playwright/test';

// Exercise the real Student Boards UI with in-memory teacher/student connections.
// No Firebase credentials, peer signaling, camera, or access to student data required.
async function openBoard(page: Page, teacher: boolean) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.setContent(`<!doctype html><html><body>
    <div id="tbStudentsMenu"></div><button id="studentBoards">Student boards</button>
    <button id="openWhiteboard">Whiteboard</button>
    <select id="teacherTool"><option value="pen">Pen</option></select>
    <select id="teacherColor"><option value="#1f2937">Black</option></select>
    <div id="stage" style="width:960px;height:540px;position:relative"></div>
  </body></html>`);
  await page.addStyleTag({ path: 'class-pointer-prototype/classroom.css' });
  await page.addStyleTag({ path: 'class-pointer-prototype/student-boards.css' });
  await page.evaluate((isTeacher) => {
    const outbound: unknown[] = [];
    const members = new Map<string, any>();
    if (isTeacher) {
      for (const id of ['a', 'b']) {
        members.set(id, { id, studentId: id, name: id === 'a' ? 'Ari' : 'Levi', admitted: true, peerId: id,
          connection: { id } });
      }
    }
    (window as any).ClassPointerDashboard = {
      students: async () => [{id:'a',name:'Ari'},{id:'b',name:'Levi'}],
      updateActivityPermissions: async (policy: any) => { (window as any).__policy = policy; },
      setStudentScreenSharing: async () => {},
    };
    (window as any).__out = outbound;
    (window as any).__members = members;
    (window as any).__failures = [];
    (window as any).ClassPointerBridge = {
      isTeacher, started: () => true, members: () => members,
      send: (connection: any, message: any) => outbound.push({ id: connection.id, message }),
      sendTeacher: (message: any) => outbound.push(message),
      status: () => {}, fail: (message: any) => (window as any).__failures.push(message),
    };
  }, teacher);
  await page.addScriptTag({ path: 'class-pointer-prototype/student-boards.js' });
}

async function deliver(teacher: Page, students: Record<string, Page>) {
  const items = await teacher.evaluate(() => (window as any).__out.splice(0));
  for (const { id, message } of items) {
    if (students[id]) {
      await students[id].evaluate((m) => (window as any).ClassPointerBoards.fromTeacher(m), message);
    }
  }
  return items;
}

async function inkPixels(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width || !canvas.height) return 0;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let p = 0; p < pixels.length; p += 4) {
      if (pixels[p] < 190 && pixels[p + 1] < 190 && pixels[p + 2] < 190) n++;
    }
    return n;
  });
}

test('teacher broadcasts a shoresh, keeps boards independent, and sends a coloring page', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const teacher = await context.newPage(), ari = await context.newPage(), levi = await context.newPage();
  const students = { a: ari, b: levi };
  try {
    await openBoard(teacher, true);
    await openBoard(ari, false);
    await openBoard(levi, false);
    await teacher.locator('#studentBoards').click();
    await teacher.getByRole('button', { name: '📝 Whiteboards', exact: true }).click();
    await deliver(teacher, students);
    await expect(teacher.locator('.board-tile')).toHaveCount(2);

    await teacher.getByLabel('Hebrew word or shoresh').fill('וישלח');
    await teacher.getByLabel('Activity instructions').fill('Circle the shoresh');
    await teacher.getByRole('button', { name: '📤 Send word' }).click();
    const wordEvents = await deliver(teacher, students);
    expect(wordEvents.filter((e: any) => e.message?.activity?.text === 'וישלח')).toHaveLength(2);
    await expect.poll(() => inkPixels(ari, '#myBoard canvas')).toBeGreaterThan(100);
    await expect.poll(() => inkPixels(levi, '#myBoard canvas')).toBeGreaterThan(100);

    // Only Ari draws; Levi's board must not change.
    const b = await ari.locator('#myBoard canvas').boundingBox();
    expect(b).toBeTruthy();
    await ari.mouse.move(b!.x + b!.width * 0.15, b!.y + b!.height * 0.75);
    await ari.mouse.down();
    await ari.mouse.move(b!.x + b!.width * 0.75, b!.y + b!.height * 0.75, { steps: 12 });
    await ari.mouse.up();
    const marks = await ari.evaluate(() => (window as any).__out.splice(0));
    expect(marks.some((m: any) => m.type === 'board-add')).toBeTruthy();
    for (const op of marks) {
      await teacher.evaluate((message) => {
        (window as any).ClassPointerBoards.fromStudent((window as any).__members.get('a'), message);
      }, op);
    }
    await expect.poll(async () => teacher.locator('.board-tile canvas').evaluateAll((list: HTMLCanvasElement[]) => {
      const snaps = list.map((c) => c.toDataURL('image/png'));
      return snaps.length === 2 && snaps[0] !== snaps[1];
    })).toBeTruthy();

    // A late joiner gets the currently displayed activity.
    const late = await teacher.evaluate(() => {
      const m = { id: 'c', name: 'Moshe', admitted: true, peerId: 'c', connection: { id: 'c' } };
      (window as any).__members.set('c', m);
      (window as any).ClassPointerBoards.studentJoined(m);
      return (window as any).__out.splice(0);
    });
    expect(late.some((e: any) => e.id === 'c' && e.message?.activity?.text === 'וישלח')).toBeTruthy();

    // Replace with an uploaded coloring page. Existing marks require confirmation.
    teacher.on('dialog', async dialog => await dialog.accept());
    const png = await teacher.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#d02828'; ctx.fillRect(0, 0, 64, 64);
      return c.toDataURL('image/png').split(',')[1];
    });
    await teacher.locator('.boards-activity-bar input[type=file]').setInputFiles({
      name: 'coloring.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64'),
    });
    await expect.poll(() => teacher.evaluate(() => (window as any).__out
      .filter((e: any) => e.message?.activity?.kind === 'image').length)).toBeGreaterThanOrEqual(2);
    const pictureEvents = await deliver(teacher, students);
    const picture = pictureEvents.find((e: any) => e.message?.activity?.kind === 'image')?.message.activity.data;
    expect(picture).toMatch(/^data:image\/jpeg;base64,/);
    expect(picture.length).toBeLessThan(420000);
    await expect.poll(async () => ari.locator('#myBoard canvas').evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')!;
      const p = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return p[0] > p[1] * 1.5 && p[0] > p[2] * 1.5;
    })).toBeTruthy();
    expect(await teacher.evaluate(() => (window as any).__failures)).toEqual([]);
    await context.close();
  } finally {
    if (context.browser()) await context.close().catch(() => {});
  }
});


test('paste Ctrl+V to everyone and edit Hebrew text independently per student', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const teacher = await context.newPage(), ari = await context.newPage(), levi = await context.newPage();
  try {
    await openBoard(teacher, true);
    await openBoard(ari, false);
    await openBoard(levi, false);
    const students = { a: ari, b: levi };
    await teacher.locator('#studentBoards').click();
    await teacher.getByRole('button', { name: '📝 Whiteboards', exact: true }).click();
    await deliver(teacher, students);

    // Teacher pastes text from an ordinary clipboard outside text-entry fields.
    await teacher.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'בראשית');
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      document.dispatchEvent(event);
    });
    const sent = await deliver(teacher, students);
    expect(sent.filter((e: any) => e.message?.activity?.text === 'בראשית')).toHaveLength(2);
    await expect(ari.getByLabel('Edit Hebrew text')).toHaveValue('בראשית');
    await expect(levi.getByLabel('Edit Hebrew text')).toHaveValue('בראשית');

    // Ari edits only his word and settings. None of Levi's state changes.
    await ari.getByLabel('Edit Hebrew text').fill('שלום');
    await ari.getByRole('button', { name: 'A+', exact: true }).click();
    await ari.getByLabel('Hebrew text color').fill('#c62828');
    const messages = await ari.evaluate(() => (window as any).__out.splice(0));
    const changed = messages.filter((m: any) => m.type === 'board-text');
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.at(-1).text).toMatchObject({ value: 'שלום', size: 0.35, color: '#c62828' });
    for (const message of messages) {
      await teacher.evaluate((msg) => {
        (window as any).ClassPointerBoards.fromStudent((window as any).__members.get('a'), msg);
      }, message);
    }
    await expect(levi.getByLabel('Edit Hebrew text')).toHaveValue('בראשית');

    // Word repositioning is drag-based and broadcast only for Ari.
    await ari.getByRole('button', { name: '↔ Move' }).click();
    const rect = await ari.locator('#myBoard canvas').boundingBox();
    expect(rect).toBeTruthy();
    await ari.mouse.move(rect!.x + rect!.width * .5, rect!.y + rect!.height * .5);
    await ari.mouse.down();
    await ari.mouse.move(rect!.x + rect!.width * .7, rect!.y + rect!.height * .7, { steps: 8 });
    await ari.mouse.up();
    const moved = await ari.evaluate(() => (window as any).__out.splice(0));
    expect(moved.some((m: any) => m.type === 'board-text' && m.text.x > .6 && m.text.y > .6)).toBeTruthy();
    for(const msg of moved) {
      await teacher.evaluate((message) => {
        (window as any).ClassPointerBoards.fromStudent((window as any).__members.get('a'), message);
      }, msg);
    }
    // Teacher focus board receives Ari's personalized text.
    await teacher.locator('.board-tile').first().click();
    await expect(teacher.getByLabel('Edit Hebrew text')).toHaveValue('שלום');
    await teacher.getByLabel('Edit Hebrew text').fill('תורה');
    const teacherMessage = await deliver(teacher, students);
    expect(teacherMessage.filter((m: any) => m.id === 'a' && m.message?.type === 'board-text').at(-1)?.message.text.value).toBe('תורה');
    expect(teacherMessage.some((m: any) => m.id === 'b' && m.message?.type === 'board-text')).toBeFalsy();
    await expect(ari.getByLabel('Edit Hebrew text')).toHaveValue('תורה');
    await expect(levi.getByLabel('Edit Hebrew text')).toHaveValue('בראשית');

    // A pasted image from another application opens the coloring activity.
    await teacher.getByRole('button', { name: '◀ Back to gallery' }).click();
    teacher.on('dialog', async dialog => await dialog.accept());
    await teacher.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 80; c.height = 60;
      const ctx = c.getContext('2d')!; ctx.fillStyle = '#dc3030'; ctx.fillRect(0, 0, 80, 60);
      const image = await new Promise<Blob>((resolve) => c.toBlob(b => resolve(b!), 'image/png'));
      const data = new DataTransfer();
      data.items.add(new File([image], 'clipboard.png', { type: 'image/png' }));
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      document.dispatchEvent(event);
    });
    await expect.poll(() => teacher.evaluate(() => (window as any).__out.filter((m: any) =>
      m.message?.activity?.kind === 'image').length)).toBeGreaterThanOrEqual(2);
    const imageMessages = await deliver(teacher, students);
    expect(imageMessages.filter((m: any) => m.message?.activity?.kind === 'image')).toHaveLength(2);
    await expect.poll(async () => ari.locator('#myBoard canvas').evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(
        Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1).data;
      return data[0] > data[1] * 1.5 && data[0] > data[2] * 1.5;
    })).toBeTruthy();
    await expect.poll(async () => levi.locator('#myBoard canvas').evaluate((canvas: HTMLCanvasElement) => {
      const data = canvas.getContext('2d')!.getImageData(
        Math.floor(canvas.width/2), Math.floor(canvas.height/2), 1, 1).data;
      return data[0] > data[1] * 1.5 && data[0] > data[2] * 1.5;
    })).toBeTruthy();

    expect(await teacher.evaluate(() => (window as any).__failures)).toEqual([]);
  } finally {
    await context.close();
  }
});


test('screen exclusions close active video, preserve classmates, and remain independent of boards', async ({ page }) => {
  await openBoard(page, true);
  await page.locator('#studentBoards').click();
  await expect(page.locator('.board-tile')).toHaveCount(2);
  await page.evaluate(() => {
    const events: Record<string, Function> = {};
    const call = {
      peer: 'a', on: (name: string, fn: Function) => events[name] = fn,
      answer: () => {}, close: () => { (window as any).__closed = true; events.close?.(); }
    };
    (window as any).__call = call;
    (window as any).__accepted = (window as any).ClassPointerBoards.incomingCall(call);
    const canvas = document.createElement('canvas'); canvas.width=160;canvas.height=90;
    canvas.getContext('2d')!.fillRect(0,0,160,90);
    const stream = canvas.captureStream(5);
    (window as any).__syntheticStream = stream;
    events.stream(stream);
  });
  expect(await page.evaluate(() => (window as any).__accepted)).toBe(true);
  await expect.poll(() => page.locator('.board-tile video').evaluateAll((videos: HTMLVideoElement[]) => videos.filter(v => v.srcObject).length)).toBe(1);
  await page.getByLabel('Screen sharing for Ari', {exact:true}).first().uncheck();
  expect(await page.evaluate(() => (window as any).__closed)).toBe(true);
  await expect(page.getByLabel('Screen sharing for Levi', {exact:true}).first()).toBeChecked();
  await expect(page.getByLabel('Board sharing for Ari', {exact:true}).first()).toBeChecked();
  expect(await page.evaluate(() => (window as any).ClassPointerBoards.incomingCall((window as any).__call))).toBe(false);
  await page.getByLabel('Screen sharing for Ari', {exact:true}).first().check();
  expect(await page.evaluate(() => (window as any).ClassPointerBoards.incomingCall((window as any).__call))).toBe(true);
  await page.evaluate(() => (window as any).__out.splice(0));
  await page.getByLabel('Board sharing for Ari', {exact:true}).first().uncheck();
  await page.getByRole('button', { name: '📝 Whiteboards', exact:true }).click();
  const modes = await page.evaluate(() => (window as any).__out.filter((item:any) => item.message.type==='board-mode'));
  expect(modes.some((item:any) => item.id==='a' && item.message.on===false)).toBe(true);
  expect(modes.some((item:any) => item.id==='b' && item.message.on===true)).toBe(true);
  await page.evaluate(() => {
    (window as any).ClassPointerBoards.endClass();
    (window as any).__syntheticStream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
  });
  await expect(page.getByLabel('Screen sharing for Ari', {exact:true}).first()).toBeChecked();
  await expect(page.getByLabel('Board sharing for Ari', {exact:true}).first()).toBeChecked();
});
