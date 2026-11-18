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
