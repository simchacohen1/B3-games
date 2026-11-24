const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("record_pesukim/teacher.html", "utf8");
const queueSource = fs.readFileSync("record_pesukim/grading-queue.js", "utf8");
const start = html.indexOf("const gradeView = ");
const end = html.indexOf("async function closeGradeOpen(");
assert.ok(start > 0 && end > start, "marking list code is present");

function load(now) {
  const list = {innerHTML: ""};
  const window = {};
  vm.runInNewContext(queueSource, {window});
  const ctx = {
    B3PosukGradingQueue: window.B3PosukGradingQueue,
    B3SubmissionOpenCore: {isPosukOpen: () => true},
    studentsMap: {}, teacherAccess: {role: "teacher"}, POSUK_GOLD_POINTS: 10,
    document: {getElementById: id => id === "gradeList" ? list : null},
    escapeHtml: s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"})[c]),
    formatDuration: s => Math.round(s) + "s", gradeRefLabel: s => "Perek " + s.perek + " · Posuk " + s.startPosuk,
    gradeScoreOf: s => s.status === "pending" ? null : s.score,
    openOnlyPref: () => false, markingAllClassesPref: () => false, submissionPosukKeys: () => [],
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } },
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start, end), ctx);
  return {ctx, list};
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

test("filters: today / this week / all, one boy, needs grading / graded", () => {
  const {ctx} = load(noon);
  ctx.__d = {items, roster, scope: ["et", "wt"], openConfigs: {}}; vm.runInContext("gradeData = __d", ctx);
  const ids = () => vm.runInContext("gradeFiltered().map(s => s.id).sort().join()", ctx);
  vm.runInContext("gradeView.range='all'; gradeView.status='pending'", ctx);
  assert.equal(ids(), "1,2,4");
  vm.runInContext("gradeView.range='today'", ctx);
  assert.equal(ids(), "1,2");
  vm.runInContext("gradeView.sid='b'", ctx);
  assert.equal(ids(), "2");
  vm.runInContext("gradeView.sid=''; gradeView.range='all'; gradeView.status='graded'", ctx);
  assert.equal(ids(), "3");
  vm.runInContext("gradeView.status='all'", ctx);
  assert.equal(ids(), "1,2,3,4");
});

test("the list is grouped by day, newest day first, with class labels for ET and WT together", () => {
  const {ctx, list} = load(noon);
  ctx.__d = {items, roster, scope: ["et", "wt"], openConfigs: {}}; vm.runInContext("gradeData = __d", ctx);
  vm.runInContext("gradeView.range='all'; gradeView.status='all'; gradeView.sid=''", ctx);
  vm.runInContext("renderGradeList()", ctx);
  const days = [...list.innerHTML.matchAll(/<details class="gm-day"/g)].length;
  assert.equal(days, 3);
  assert.ok(list.innerHTML.indexOf("Today") < list.innerHTML.indexOf("Yesterday"));
  assert.match(list.innerHTML, /gm-cls">ET</);
  assert.match(list.innerHTML, /gm-cls">WT</);
  assert.match(list.innerHTML, /Needs grading/);
  assert.match(list.innerHTML, /🏅 10\/10/);
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
