const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("rashi-letters/teacher.html", "utf8");
const LM = require("../rashi-letters/rashi-letter-marks-core.js");
const start = html.indexOf("const rashiView = ");
const end = html.indexOf("async function loadRecordings(");
assert.ok(start > 0 && end > start, "Rashi marking list code is present");

const WORDS = ["בְּרֵאשִׁית", "בָּרָא", "אֱלֹהִים", "אֵת", "הַשָּׁמַיִם", "וְאֵת", "הָאָרֶץ"];
const now = Date.now();
const rows = () => [
  {id: "r1", studentId: "a", studentName: "Fictional Aaron", classId: "et", className: "ET", sectionLabel: "Part 1", words: WORDS, createdAt: now - 3600000, durationMs: 20000, letterReview: null, sendOpen: true, _classId: "et"},
  {id: "r2", studentId: "b", studentName: "Fictional Ben", classId: "wt", className: "WT", sectionLabel: "Part 2", words: WORDS, createdAt: now - 7200000, durationMs: 15000, letterReview: null, sendOpen: true, _classId: "wt"},
  {id: "r3", studentId: "a", studentName: "Fictional Aaron", classId: "et", className: "ET", sectionLabel: "Part 3", words: WORDS, createdAt: now - 86400000, durationMs: 18000, letterReview: null, sendOpen: true, _classId: "et"},
  {id: "r4", studentId: "b", studentName: "Fictional Ben", classId: "wt", className: "WT", sectionLabel: "Part 4", words: WORDS, createdAt: now - 3000, durationMs: 18000, letterReview: {total: 30, missed: []}, sendOpen: true, _classId: "wt"},
];

function load() {
  const els = {};
  const el = id => els[id] || (els[id] = {id, hidden: false, innerHTML: "", textContent: "", onclick: null, classList: {toggle() {}}});
  const card = {
    graded: false, toggled: 0,
    classList: {contains: c => c === "is-graded" && card.graded},
    _player: {toggle() { card.toggled++; }, autoplay() {}},
    _missed: new Set([2]),
    querySelector: sel => sel === "[data-done]" ? {hidden: false, click() { card.graded = true; }} : null,
  };
  const ctx = {
    LM, isOwner: false, pendingLegacyIds: [], setTimeout, clearTimeout, Promise, console, URLSearchParams, location: {search: ""}, firebase: {}, db: {}, window: {addEventListener() {}},
    document: {getElementById: el, querySelectorAll: () => [], addEventListener() {}, activeElement: null, body: {classList: {add() {}, remove() {}}}},
    escapeHtml: s => String(s == null ? "" : s), openOnlyPref: () => false, setOpenOnlyPref() {}, loadLetterScores() {},
    rashiTextOf: r => (r.words || []).join(" "),
    rashiCardHtml: () => "<card>", wireRashiCard() {},
    flushGradeSaves: async () => {}, gradeSavers: new Set(),
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  const box = el("recMarkingCard");
  Object.defineProperty(box, "firstElementChild", {get: () => card});
  ctx.__d = {items: rows(), scope: ["et", "wt"], warn: ""};
  vm.runInContext("rashiData = __d", ctx);
  return {ctx, el, card};
}
const left = m => /(\d+ of \d+ left)/.exec(m.el("recMarking").innerHTML)[1];
const key = (ctx, k, extra = {}) => vm.runInContext("rashiMarkingKey", ctx)({key: k, code: k === " " ? "Space" : k, target: {tagName: "BODY"}, preventDefault() {}, ...extra}, true);
const settle = () => new Promise(r => setTimeout(r, 20));

test("Rashi filters: today / this week / all, one boy, needs grading / graded", () => {
  const {ctx} = load();
  const ids = () => vm.runInContext("rashiFiltered().map(r => r.id).sort().join()", ctx);
  assert.equal(ids(), "r1,r2,r3");
  vm.runInContext("rashiView.range='today'", ctx);
  assert.equal(ids(), "r1,r2");
  vm.runInContext("rashiView.sid='b'", ctx);
  assert.equal(ids(), "r2");
  vm.runInContext("rashiView.sid=''; rashiView.range='all'; rashiView.status='graded'", ctx);
  assert.equal(ids(), "r4");
  vm.runInContext("rashiView.status='all'", ctx);
  assert.equal(ids(), "r1,r2,r3,r4");
});

test("Rashi list is grouped by day with ET and WT together", () => {
  const {ctx, el} = load();
  vm.runInContext("rashiView.status='all'; renderRashiList()", ctx);
  const out = el("recList").innerHTML;
  assert.equal([...out.matchAll(/<details class="gm-day"/g)].length, 2);
  assert.ok(out.indexOf("Today") < out.indexOf("Yesterday"));
  assert.match(out, /gm-cls">ET</);
  assert.match(out, /gm-cls">WT</);
  assert.match(out, /Needs grading/);
  assert.match(out, /\d\/5/);
});

test("Rashi Start marking: list order, 'N of M left', Enter saves and moves on, S skips, Space plays", async () => {
  const m = load();
  await vm.runInContext("startRashiMarking()", m.ctx);
  assert.equal(vm.runInContext("rashiMarking.queue.map(r => r.id).join()", m.ctx), "r2,r1,r3");
  assert.equal(left(m), "3 of 3 left");
  key(m.ctx, " ");
  assert.equal(m.card.toggled, 1);
  key(m.ctx, "Enter");
  await settle();
  assert.equal(left(m), "2 of 3 left");
  assert.match(m.el("recMarkingLast").textContent, /Saved/);
  const r2 = m.ctx.__d.items.find(r => r.id === "r2");
  assert.deepEqual(JSON.parse(JSON.stringify(r2.letterReview.missed)), [2]);
  m.card.graded = false;
  key(m.ctx, "s");
  assert.equal(left(m), "1 of 3 left");
  assert.equal(vm.runInContext("rashiMarking.skipped", m.ctx), 1);
  assert.equal(m.ctx.__d.items.find(r => r.id === "r1").letterReview, null);
  key(m.ctx, "Enter");
  await settle();
  assert.match(m.el("recMarking").innerHTML, /All done/);
  assert.match(m.el("recMarking").innerHTML, /2 graded, 1 skipped/);
});

test("Rashi: a save that did not go through is reported and the recording stays waiting", async () => {
  const m = load();
  await vm.runInContext("startRashiMarking()", m.ctx);
  m.card.querySelector = sel => sel === "[data-done]" ? {hidden: false, click() {}} : null;   // the save never marks the card graded
  key(m.ctx, "Enter");
  await settle();
  assert.match(m.el("recMarkingLast").textContent, /Could not save/);
  assert.equal(vm.runInContext("rashiMarking.failed.length", m.ctx), 1);
  assert.equal(m.ctx.__d.items.find(r => r.id === "r2").letterReview, null);
});

test("Rashi: keys are ignored in text boxes; Back to list saves first and shows the list", async () => {
  const m = load();
  await vm.runInContext("startRashiMarking()", m.ctx);
  key(m.ctx, "Enter", {target: {tagName: "INPUT", type: "text"}});
  assert.equal(left(m), "3 of 3 left");
  await vm.runInContext("exitRashiMarking()", m.ctx);
  assert.equal(m.el("recNav").hidden, false);
  assert.equal(m.el("recMarking").hidden, true);
});

test("Rashi page: one list for my classes, per-class requests, scrubber and speed, pill link", () => {
  assert.match(html, /myMarkingClassIds/);
  assert.match(html, /rashiApi\('rashi-list-pending',\{classId:id\}\)/);
  assert.match(html, /classId:r\._classId/);
  assert.match(html, /type="range" class="gm-scrub"/);
  assert.match(html, /\[1,1\.5,2\]/);
  assert.match(html, /shared\/one-audio-at-a-time\.js/);
  assert.match(fs.readFileSync("index.html", "utf8"), /rashi-letters\/teacher\.html\?view=marking/);
});
