"use strict";

// Issue #823: Class Access must wait for the remembered teacher login before
// asking for Google again, and Sign out on the Homework and Student Rewards
// teacher pages must also clear the login remembered for new tabs.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function classAccessHarness({ restoredAccess }) {
  const html = read("admin.html");
  const start = html.indexOf("let teacherAuthWait=null;");
  const end = html.indexOf("// ---- Owner Control page");
  assert.ok(start > 0 && end > start, "admin.html keeps the teacher access block");
  const source = html.slice(start, end);

  const panel = { innerHTML: "", style: {} };
  const ownerPanel = { style: {} };
  const signInButton = {};
  const calls = { showTab: 0, ownerControl: 0 };
  let access = { authorized: false };
  let listener = null;
  const auth = { currentUser: null }; // compat build: no authStateReady()
  const w = {
    firebase: { database: () => ({}), auth: () => auth },
    B3SiteSettings: {
      workspaceId: "test-workspace",
      getCurrentAccess: () => access,
      onAuthStateChanged(callback) { listener = callback; return () => { listener = null; }; },
      signInWithGoogle: async () => {}
    }
  };
  w.firebase.auth = Object.assign(() => auth, {});
  const context = vm.createContext({
    frame: { contentWindow: w },
    document: {
      getElementById(id) {
        if (id === "teacherAccessPanel") return panel;
        if (id === "ownerControlPanel") return ownerPanel;
        if (id === "taSignIn") return signInButton;
        return { textContent: "", style: {} };
      },
      createElement: () => ({ textContent: "", innerHTML: "" })
    },
    currentTab: "access",
    showTab() { calls.showTab++; },
    applyRoleView() {},
    isOwnerNow: () => false,
    startOwnerControl() { calls.ownerControl++; },
    setTimeout, clearTimeout, console
  });
  vm.runInContext(source, context, { filename: "admin.html#teacher-access" });

  return {
    panel, calls,
    render: () => vm.runInContext("renderTeacherAccess()", context),
    hasListener: () => typeof listener === "function",
    // What site-settings.js does once the remembered login has been restored
    // (or once it has confirmed nobody is signed in).
    finishSharedCheck() {
      if (restoredAccess) {
        auth.currentUser = { uid: "fictional-teacher" };
        access = restoredAccess;
        listener(auth.currentUser, true, access);
      } else {
        listener(null, false, { authorized: false });
      }
    }
  };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test("Class Access in a new tab waits for the remembered teacher instead of asking for Google again", async () => {
  const page = classAccessHarness({ restoredAccess: { authorized: true, role: "teacher", classIds: ["fictional-class"] } });
  const rendering = page.render();
  await tick();
  assert.ok(page.hasListener(), "the page waits on the shared sign-in check even with no Firebase user yet");
  assert.doesNotMatch(page.panel.innerHTML, /Sign in with Google/, "no Google prompt while the login is being restored");
  page.finishSharedCheck();
  await rendering;
  assert.equal(page.calls.showTab, 1, "the page continues to the class controls");
  assert.doesNotMatch(page.panel.innerHTML, /Sign in with Google/);
});

test("Class Access still asks a signed-out visitor to sign in", async () => {
  const page = classAccessHarness({ restoredAccess: null });
  const rendering = page.render();
  await tick();
  page.finishSharedCheck();
  await rendering;
  assert.match(page.panel.innerHTML, /Sign in with Google/);
  assert.equal(page.calls.showTab, 0);
  assert.equal(page.calls.ownerControl, 0);
});

function signOutHarness(file, { remembered, rememberedFails }) {
  const source = read(file);
  const match = source.match(/function signOutTeacherEverywhere\(\)\{[\s\S]*?\n\}/);
  assert.ok(match, `${file} defines signOutTeacherEverywhere`);
  const order = [];
  const savedApp = {
    auth: () => ({
      signOut() {
        order.push("remembered");
        return rememberedFails ? Promise.reject(new Error("offline")) : Promise.resolve();
      }
    })
  };
  const created = [];
  const defaultOptions = { projectId: "fictional-project" };
  const firebase = {
    app(name) {
      if (name === undefined) return { options: defaultOptions };
      if (name === "FTTRememberedTeacher" && remembered) return savedApp;
      throw new Error("No Firebase App");
    },
    initializeApp(options, name) { created.push({ options, name }); return savedApp; }
  };
  const auth = { signOut() { order.push("default"); return Promise.resolve(); } };
  const context = vm.createContext({ firebase, auth });
  vm.runInContext(match[0], context, { filename: file });
  return { run: () => vm.runInContext("signOutTeacherEverywhere()", context), order, created, defaultOptions, source };
}

for (const file of ["assignment-center/teacher.html", "student-rewards/teacher.js"]) {
  test(`${file}: Sign out clears the remembered teacher login, then this tab`, async () => {
    const page = signOutHarness(file, { remembered: true });
    await page.run();
    assert.deepEqual(page.order, ["remembered", "default"]);
    assert.equal(page.created.length, 0);
  });

  test(`${file}: Sign out opens the remembered-login store when this page has not used it yet`, async () => {
    const page = signOutHarness(file, { remembered: false });
    await page.run();
    assert.deepEqual(page.created, [{ options: page.defaultOptions, name: "FTTRememberedTeacher" }]);
    assert.deepEqual(page.order, ["remembered", "default"]);
  });

  test(`${file}: Sign out still signs this tab out when the remembered login cannot be cleared`, async () => {
    const page = signOutHarness(file, { remembered: true, rememberedFails: true });
    await page.run();
    assert.deepEqual(page.order, ["remembered", "default"]);
  });

  test(`${file}: the Sign out button no longer signs out this tab only`, () => {
    const source = read(file);
    assert.doesNotMatch(source, /onclick=(?:function\(\)\{|\(\)=>)auth\.signOut\(\)/);
    assert.match(source, /onclick=(?:function\(\)\{|\(\)=>)signOutTeacherEverywhere\(\)/);
  });
}
