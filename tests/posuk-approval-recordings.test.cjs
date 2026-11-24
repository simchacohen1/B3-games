const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../record_pesukim/grading-queue.js"), "utf8");

test("Posuk approval counts follow the active class rosters and pending grade queue", () => {
  const listeners = new Map();
  const db = {
    ref: path => ({
      on: (event, onValue, onError) => listeners.set(path, {onValue, onError}),
      off: (event, onValue) => {
        assert.equal(listeners.get(path).onValue, onValue);
        listeners.delete(path);
      }
    })
  };
  const emit = (path, value) => listeners.get(path).onValue({val: () => value});
  const window = {};
  vm.runInNewContext(source, {window});
  const queue = window.B3PosukGradingQueue;
  let counts, error;
  const stop = queue.watchClassCounts(db, "fictional-school", (next, failure) => {
    counts = JSON.parse(JSON.stringify(next));
    error = failure;
  }, assert.fail);
  const classesPath = "b3Games/workspaces/fictional-school/classes";
  const studentPath = id => queue.submissionsPath + "/" + id;
  const classes = {
    et: {name: "B3 ET", members: {fictional_et: {}, fictional_shared: {}, fictional_disabled: {active: false}}},
    wt: {name: "B3 WT", members: {fictional_wt: {}, fictional_shared: {}}},
    archived: {active: false, members: {fictional_archived: {}}}
  };
  emit(classesPath, classes);
  assert.equal(listeners.size, 4);
  emit(studentPath("fictional_et"), {
    legacy: {id: "legacy", status: "pending"},
    graded: {id: "graded", status: "gold"},
    retry: {id: "retry", status: "retry"},
    malformed: {status: "pending"}
  });
  emit(studentPath("fictional_shared"), {ready: {id: "ready", status: "pending"}});
  assert.equal(counts, undefined);
  emit(studentPath("fictional_wt"), {});
  assert.deepEqual(counts, {total: 2, classes: [
    {id: "et", name: "ET", count: 2},
    {id: "wt", name: "WT", count: 1}
  ]});

  emit(studentPath("fictional_shared"), {ready: {id: "ready", status: "gold"}});
  assert.deepEqual(counts, {total: 1, classes: [{id: "et", name: "ET", count: 1}]});

  const denied = Error("Fictional read denied");
  listeners.get(studentPath("fictional_wt")).onError(denied);
  assert.equal(error, denied);
  assert.equal(counts.total, 1);
  delete classes.wt;
  emit(classesPath, classes);
  assert.equal(error, undefined);
  assert.equal(listeners.has(studentPath("fictional_wt")), false);
  stop();
  assert.equal(listeners.size, 0);
});

test("Posuk approval counts can be limited to the teacher's own classes (the owner's 'All classes' switch removes the limit)", () => {
  const run = options => {
    const listeners = new Map();
    const db = {ref: path => ({on: (e, onValue) => listeners.set(path, {onValue}), off: () => listeners.delete(path)})};
    const window = {};
    vm.runInNewContext(source, {window});
    const queue = window.B3PosukGradingQueue;
    let counts;
    queue.watchClassCounts(db, "fictional-school", next => { counts = JSON.parse(JSON.stringify(next)); }, assert.fail, options);
    const emit = (path, value) => { if (listeners.has(path)) listeners.get(path).onValue({val: () => value}); };
    emit("b3Games/workspaces/fictional-school/classes", {
      et: {name: "B3 ET", members: {a: {}}},
      wt: {name: "B3 WT", members: {b: {}}},
      afternoon: {name: "B4 WT · Afternoon", members: {c: {}}}
    });
    const pending = n => Object.fromEntries(Array.from({length: n}, (_, i) => ["p" + i, {id: "p" + i, status: "pending"}]));
    emit(queue.submissionsPath + "/a", pending(1));
    emit(queue.submissionsPath + "/b", pending(2));
    emit(queue.submissionsPath + "/c", pending(20));
    return {counts, watched: [...listeners.keys()].filter(path => path.startsWith(queue.submissionsPath))};
  };
  const mine = run({classIds: ["et", "wt"]});
  assert.equal(mine.counts.total, 3, "the other teacher's 20 recordings are not counted");
  assert.deepEqual(mine.counts.classes.map(c => c.id).sort(), ["et", "wt"]);
  assert.equal(mine.watched.length, 2, "boys in other classes are not even listened to");
  const all = run();
  assert.equal(all.counts.total, 23);
  assert.deepEqual(all.counts.classes.map(c => c.id).sort(), ["afternoon", "et", "wt"]);
  assert.equal(run({classIds: []}).counts.total, 0);
});
