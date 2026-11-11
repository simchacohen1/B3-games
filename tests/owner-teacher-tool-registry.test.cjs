"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
require(path.join(root, "shared/home-tool-registry.js"));
const registry = globalThis.B3HomeToolRegistry;
const fs = require("node:fs");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const teacherHtml = fs.readFileSync(path.join(root, "teacher-home.html"), "utf8");
const ownerHtml = fs.readFileSync(path.join(root, "owner-admin.html"), "utf8");

test("both homepages and Owner Admin consume the one shared tool registry", () => {
  assert.match(indexHtml, /shared\/home-tool-registry\.js/);
  assert.match(teacherHtml, /shared\/home-tool-registry\.js/);
  assert.match(ownerHtml, /shared\/home-tool-registry\.js/);
  assert.match(ownerHtml, /Object\.values\(REGISTRY\.tools\)/);
  assert.doesNotMatch(ownerHtml, /const PLATFORM_TOOLS\s*=\s*\[/);
});

test("all Owner Admin class-grant tools have a Teacher Login route and a grant group", () => {
  const grants = [...new Map(Object.values(registry.tools).filter(tool => tool.classGrant).map(tool => [tool.classGrant, tool])).values()];
  const ids = new Set(grants.map(tool => tool.classGrant));
  assert.equal(ids.size, grants.length, "class-gallery alias does not create a second grant entry");
  for (const tool of grants) {
    assert.ok(tool.href || (tool.supportedClasses && tool.supportedClasses.every(id => tool.classHrefs?.[id])),
      `${tool.title} must have a teacher destination`);
    assert.ok(tool.grantGroup, `${tool.title} must have an Owner Admin category`);
  }
  for (const id of [
    "sefer-hamitzvos", "halacha", "yiddish", "posuk-practice-scroll",
    "rashi-letters", "gematria", "shorashim", "chazara", "game-show",
    "student-rewards", "weekly-quiz", "multiplayer-center", "homework",
    "gallery", "tag", "davening", "chavrusa", "name-picker",
    "class-pointer", "sync-to-nigri"
  ]) assert.ok(ids.has(id), `missing shared class grant: ${id}`);
});

test("hardcoded Teacher Tools actions are defined and rendered from the registry", () => {
  assert.ok(Array.isArray(registry.teacherActions));
  for (const id of [
    "act-as-student", "student-report", "vocabulary-progress", "manage-class",
    "follow-teacher", "share-screen"
  ]) assert.ok(registry.teacherActions.some(action => action.id === id), `missing teacher action: ${id}`);
  assert.match(teacherHtml, /REGISTRY\.teacherActions\.map\(actionTile\)/);
  assert.doesNotMatch(teacherHtml, /actionTile\('(?:📈|📚|🎛️|👣|🖥)/);
  const shareScreen = registry.teacherActions.find(action => action.id === "share-screen");
  assert.equal(shareScreen.classGrant, "class-pointer");
  assert.equal(shareScreen.classParam, true);
});

test("companion tiles retain the Posuk grant and private owner dashboard stays excluded", () => {
  const posuk = registry.tools["posuk-practice-scroll"];
  assert.equal(posuk.classGrant, "posuk-practice-scroll");
  assert.equal(posuk.grantGroup, "dual");
  assert.ok(posuk.companions.every(item => item.classGrant === "posuk-practice-scroll" && item.grantGroup === "dual"));
  assert.deepEqual(posuk.companions.map(item => item.title), [
    "Chumash חידון", "Mishnayos Practice", "Mishnayos חידון"
  ]);
  assert.ok(!registry.teacherActions.some(action => action.id === "class-dashboard"));
  assert.match(ownerHtml, /shared\/home-tool-registry\.js/);
});

test("regular homepage hardcoded teacher links are registry-driven and class-scoped", () => {
  assert.match(indexHtml, /registry\.homepageTeacherTools/);
  assert.doesNotMatch(indexHtml, /<a class="teacher-tool-card" href=/);
  const itemIds = new Set(registry.homepageTeacherTools.map(item => item.id));
  for (const id of [
    "student-tool-access", "homework", "daily-points", "class-pointer", "follow-teacher",
    "game-show", "posuk-practice", "mishnayos-practice", "shorashim", "chazara",
    "rashi-letters", "gematria", "student-rewards", "weekly-quiz", "halacha-lesson",
    "halacha-student-work", "chavrusa", "name-picker", "class-dashboard", "student-report",
    "sync-to-nigri", "davening-et", "davening-wt", "vocabulary-progress", "share-screen"
  ]) assert.ok(itemIds.has(id), `missing homepage teacher catalog entry: ${id}`);
  const davening = registry.tools.davening;
  assert.deepEqual(davening.supportedClasses, ["et", "wt"]);
  assert.equal(davening.classHrefs.et, "davening_student_app_et/index.html");
  assert.equal(davening.classHrefs.wt, "davening_student_app_wt/index.html");
  assert.equal(registry.tools["class-dashboard"].ownerOnly, true);
});
