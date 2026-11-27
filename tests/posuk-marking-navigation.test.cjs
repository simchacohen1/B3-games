const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const H = require("../rashi-letters/history-core.js");

const html = fs.readFileSync("record_pesukim/teacher.html", "utf8");
const queueSource = fs.readFileSync("record_pesukim/grading-queue.js", "utf8");
const start = html.indexOf("const gradeView = ");
const end = html.indexOf("async function closeGradeOpen(");
assert.ok(start > 0 && end > start, "marking list code is present");

function load(now) {
  const els = {};
  const el = id => els[id] || (els[id] = {id, innerHTML: "", textContent: "", disabled: false});
  const window = {RashiHistoryCore: H};
  vm.runInNewContext(queueSource, {window});
  const ctx = {
    window,
    B3PosukGradingQueue: window.B3PosukGradingQueue,
    B3SubmissionOpenCore: {isPosukOpen: () => true},
    studentsMap: {}, teacherAccess: {role: "teacher"}, POSUK_GOLD_POINTS: 10,
    document: {getElementById: el, querySelectorAll: () => [], addEventListener() {}},
    escapeHtml: s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]),
    formatDuration: s => Math.round(s) + "s", gradeRefLabel: s => "Perek " + s.perek + " · Posuk " + s.startPosuk,
    gradeScoreOf: s => s.status === "pending" ? null : s.score,
    openOnlyPref: () => false, markingAllClassesPref: () => false, submissionPosukKeys: () => [],
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  return {ctx, el, list: {get innerHTML() { return el("gradeWaiting").innerHTML + "\n" + el("gradeEarlier").innerHTML; }}};
}

const noon = new Date(2026, 10, 25, 12, 0, 0).getTime();        // Wednesday
const day = n => noon - n * 86400000;
const items = [
  {sid: "a", id: "1", status: "pending", submittedAt: noon - 3600000, perek: 1, startPosuk: 1},
  {sid: "b", id: "2", status: "pending", submittedAt: noon - 7200000, perek: 1, startPosuk: 2},
  {sid: "a", id: "3", status: "gold", score: 10, submittedAt: day(1), perek: 1, startPosuk: 3},
  {sid: "a", id: "4", status: "pending", submittedAt: day(20), perek: 2, startPosuk: 1},
];
const roster = {a: {name: "Fictional Aaron", classId: "et"}, b: {name: "Fictional Ben", classId: "wt"}};

test("waiting: every waiting recording, or only the boy picked in the strip; earlier: marked ones by period and search", () => {
  const {ctx} = load(noon);
  ctx.__d = {items, roster, scope: ["et", "wt"], openConfigs: {}}; vm.runInContext("gradeData = __d", ctx);
  const waiting = () => vm.runInContext("gradeWaiting().map(s => s.id).sort().join()", ctx);
  const earlier = () => vm.runInContext("gradeEarlier().map(s => s.id).sort().join()", ctx);
  assert.equal(waiting(), "1,2,4");
  assert.equal(earlier(), "3");
  vm.runInContext("gradeView.sid='b'", ctx);
  assert.equal(waiting(), "2");
  assert.equal(earlier(), "");
  vm.runInContext("gradeView.sid=''; gradeView.range='today'", ctx);
  assert.equal(earlier(), "", "the marked one is from yesterday");
  vm.runInContext("gradeView.range='yesterday'", ctx);
  assert.equal(earlier(), "3");
  vm.runInContext("gradeView.range='all'; gradeView.text='posuk 3'", ctx);
  assert.equal(earlier(), "3");
  vm.runInContext("gradeView.text='nothing like this'", ctx);
  assert.equal(earlier(), "");
});

test("waiting recordings are clean cards with Play and Grade; earlier is grouped by day, newest first, with class labels", () => {
  const {ctx, list, el} = load(noon);
  ctx.__d = {items, roster, scope: ["et", "wt"], openConfigs: {}}; vm.runInContext("gradeData = __d", ctx);
  vm.runInContext("gradeView.range='all'; gradeView.sid=''; gradeView.text=''", ctx);
  vm.runInContext("renderGradeList()", ctx);
  const w = el("gradeWaiting").innerHTML;
  assert.equal([...w.matchAll(/class="gm-item wt-card"/g)].length, 3);
  assert.equal([...w.matchAll(/data-playopen="1">▶ Play</g)].length, 3);
  assert.equal([...w.matchAll(/class="wt-grade"/g)].length, 3);
  assert.match(w, /Today, /);
  assert.equal(el("gradeWaitingN").textContent, "3");
  assert.match(el("gradeStartBtn").textContent, /Start marking \(3\)/);
  const e = el("gradeEarlier").innerHTML;
  assert.equal([...e.matchAll(/<details class="gm-day"/g)].length, 1);
  assert.match(e, /Yesterday/);
  assert.match(e, /🏅 10\/10/);
  assert.doesNotMatch(e, /Needs grading/, "waiting ones are only in the waiting list");
  assert.match(w, /gm-cls">ET</);
  assert.match(w, /gm-cls">WT</);
  // older days are listed newest first
  const more = items.concat([{sid: "b", id: "5", status: "scored", score: 7, submittedAt: day(3), perek: 1, startPosuk: 5}]);
  ctx.__d2 = {items: more, roster, scope: ["et", "wt"], openConfigs: {}}; vm.runInContext("gradeData = __d2; renderGradeList()", ctx);
  const e2 = el("gradeEarlier").innerHTML;
  assert.ok(e2.indexOf("Yesterday") < e2.indexOf("Sunday"));
  vm.runInContext("gradeView.sid='b'; renderGradeList()", ctx);
  assert.match(el("gradeWaiting").innerHTML, /Fictional Ben/);
  assert.doesNotMatch(el("gradeWaiting").innerHTML, /Fictional Aaron/);
  assert.doesNotMatch(list.innerHTML, /Fictional Aaron/);
});

test("the pill is one link to the marking view for all of my classes", () => {
  const window = {};
  const created = [];
  const el = () => { const e = {children: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, append(x) { this.children.push(x); }, querySelector: () => el(), set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }}; created.push(e); return e; };
  vm.runInNewContext(queueSource, {window, document: {createElement: el}});
  const card = window.B3PosukGradingQueue.approvalCard({total: 3, classes: [{id: "et", name: "ET", count: 2}, {id: "wt", name: "WT", count: 1}]});
  assert.ok(card);
  assert.ok(created.some(e => e.attrs.href === "record_pesukim/teacher.html?view=marking"));
  assert.ok(!created.some(e => /class=/.test(e.attrs.href || "")));
});

test("the page has the full-width scrubber, speed buttons and the progress-view link", () => {
  assert.match(html, /class="gm-scrub"[^>]*type="range"|type="range" class="gm-scrub"/);
  assert.match(html, /\[1, 1\.5, 2\]/);
  assert.match(html, /openRecordingFromProgress\(activeStudentId, posukKey\)/);
  assert.match(html, /shared\/one-audio-at-a-time\.js/);
});

/* ---- Start marking ---- */
function loadMarking() {
  const els = {};
  const el = id => els[id] || (els[id] = {id, hidden: false, innerHTML: "", textContent: "", onclick: null, firstElementChild: null});
  const window = {RashiHistoryCore: H};
  vm.runInNewContext(queueSource, {window});
  const buttons = {};
  const card = {
    _player: {toggle() { card.toggled = (card.toggled || 0) + 1; }, autoplay() { card.autoplayed = true; }},
    querySelectorAll: () => [],
    querySelector: sel => { const m = /data-pts="(\d+)"/.exec(sel); return m ? buttons[m[1]] : null; },
  };
  const ctx = {
    window, B3PosukGradingQueue: window.B3PosukGradingQueue, B3SubmissionOpenCore: {isPosukOpen: () => true}, B3PrivateMedia: {attach() {}},
    studentsMap: {}, teacherAccess: {role: "teacher"}, POSUK_GOLD_POINTS: 10, console, setTimeout, clearTimeout, Promise,
    document: {
      getElementById: el, activeElement: null, querySelectorAll: () => [], addEventListener() {},
      body: {classList: {add() {}, remove() {}}},
    },
    escapeHtml: s => String(s == null ? "" : s), formatDuration: s => Math.round(s) + "s",
    gradeRefLabel: s => "Posuk " + s.startPosuk, gradeScoreOf: s => s.score ?? null, openOnlyPref: () => false, markingAllClassesPref: () => false,
    submissionPosukKeys: () => [],
    gradeCardHtml: () => "<card>", wireGradeCard() {}, wirePlayer() {},
    flushGradeSaves: async () => { ctx.flushed++; ctx.pendingGrade && ctx.pendingGrade(); },
    flushed: 0, picked: [],
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, html.indexOf("async function loadGradeTab(")), ctx);
  const now = Date.now();
  ctx.__d = {
    items: [
      {sid: "a", id: "n1", status: "pending", submittedAt: now - 5000, startPosuk: 1},
      {sid: "a", id: "n2", status: "pending", submittedAt: now - 9000, startPosuk: 2},
      {sid: "b", id: "y1", status: "pending", submittedAt: now - 86400000, startPosuk: 3},
      {sid: "b", id: "g1", status: "gold", score: 10, submittedAt: now - 3000, startPosuk: 4},
    ],
    roster: {a: {name: "Fictional Aaron", classId: "et"}, b: {name: "Fictional Ben", classId: "wt"}}, scope: ["et", "wt"], openConfigs: {},
  };
  vm.runInContext("gradeData = __d; gradeView.range='all'; gradeView.sid=''", ctx);
  // each render makes a fresh card whose number buttons record the pick and mark the recording graded, like the real save does
  const origRender = vm.runInContext("renderMarking", ctx);
  return {ctx, els, el, card, buttons};
}
const keyEvent = (ctx, k, extra = {}) => vm.runInContext("markingKey", ctx)({key: k, code: k === " " ? "Space" : "Key" + k, target: {tagName: "BODY"}, preventDefault() {}, ...extra}, true);
const settle = () => new Promise(r => setTimeout(r, 20));

// Gives the card number buttons that behave like the real ones: a tap saves the grade, so the recording is no longer waiting.
function armCard(m) {
  const s = vm.runInContext("gradeMarking.queue[gradeMarking.idx]", m.ctx);
  m.current = s;
  [..."0123456789", "10"].forEach(n => {
    m.buttons[n] = {disabled: false, click() { m.picks.push(s.id + ":" + n); s.status = "scored"; m.listeners.forEach(f => f()); }};
  });
}

async function startRun() {
  const m = loadMarking();
  m.picks = []; m.listeners = [];
  // renderMarking re-reads the card each time; capture the click listener that markingPicked relies on
  m.card.querySelectorAll = () => [{dataset: {pts: "x"}, addEventListener: (_e, f) => { m.listeners.length = 0; m.listeners.push(() => f()); }}];
  m.ctx.wireGradeCard = () => {};
  m.ctx.gradeCardHtml = () => "<card>";
  const box = m.el("gradeMarkingCard");
  Object.defineProperty(box, "firstElementChild", {get: () => m.card});
  await vm.runInContext("startMarking()", m.ctx);
  armCard(m);
  return m;
}
const left = m => /(\d+ of \d+ left)/.exec(m.el("gradeMarking").innerHTML)[1];

test("Start marking: first waiting recording in list order, 'N of M left', auto-plays", async () => {
  const m = await startRun();
  assert.equal(vm.runInContext("gradeMarking.queue.map(s => s.id).join()", m.ctx), "n2,n1,y1");
  assert.equal(left(m), "3 of 3 left");
  assert.equal(m.card.autoplayed, true);
  assert.equal(m.el("gradeNav").hidden, true);
  assert.equal(m.el("gradeMarking").hidden, false);
});

test("Number key grades and goes straight to the next; Space plays and pauses; 1 then 0 is 10", async () => {
  const m = await startRun();
  keyEvent(m.ctx, " ");
  assert.equal(m.card.toggled, 1);
  keyEvent(m.ctx, "7");
  await settle();
  assert.deepEqual(m.picks, ["n2:7"]);
  assert.equal(left(m), "2 of 3 left");
  armCard(m);
  keyEvent(m.ctx, "1"); keyEvent(m.ctx, "0");
  await settle();
  assert.deepEqual(m.picks, ["n2:7", "n1:10"]);
  assert.equal(left(m), "1 of 3 left");
  armCard(m);
  keyEvent(m.ctx, "1");                         // a lone 1 is grade 1 after a short wait
  await new Promise(r => setTimeout(r, 750));
  assert.deepEqual(m.picks, ["n2:7", "n1:10", "y1:1"]);
  assert.match(m.el("gradeMarking").innerHTML, /All done/);
  assert.match(m.el("gradeMarking").innerHTML, /3 graded/);
});

test("Skip moves on without grading; the recording stays waiting; keys are ignored in text boxes", async () => {
  const m = await startRun();
  keyEvent(m.ctx, "5", {target: {tagName: "INPUT", type: "text"}});
  assert.deepEqual(m.picks, []);
  m.el("gradeMarking").onclick = null;
  vm.runInContext("markingAdvance(true)", m.ctx);
  assert.equal(left(m), "2 of 3 left");
  assert.equal(vm.runInContext("gradeMarking.skipped", m.ctx), 1);
  assert.equal(m.ctx.__d.items.find(s => s.id === "n2").status, "pending");
});

test("A grade that fails to save is reported and the recording stays waiting", async () => {
  const m = await startRun();
  m.ctx.flushGradeSaves = async () => {};       // the save did not go through: still pending afterwards
  m.buttons["4"].click = () => m.listeners.forEach(f => f());
  keyEvent(m.ctx, "4");
  await settle();
  assert.match(m.el("gradeMarkingLast").textContent, /Could not save/);
  assert.equal(vm.runInContext("gradeMarking.failed.length", m.ctx), 1);
});

test("Back to list saves everything first and shows the list again", async () => {
  const m = await startRun();
  await vm.runInContext("exitMarking()", m.ctx);
  assert.ok(m.ctx.flushed >= 1);
  assert.equal(m.el("gradeNav").hidden, false);
  assert.equal(m.el("gradeMarking").hidden, true);
});
