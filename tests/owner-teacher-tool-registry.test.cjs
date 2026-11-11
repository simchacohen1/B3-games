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
  const grants = Object.values(registry.tools).filter(tool => tool.classGrant);
  const ids = new Set(grants.map(tool => tool.classGrant));
  assert.equal(ids.size, grants.length, "each class grant appears once in the canonical catalog");
  for (const tool of grants) {
    assert.ok(tool.href, `${tool.title} must have a teacher destination`);
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
  assert.deepEqual(posuk.companions.map(item => item.title), [
    "Chumash חידון", "Mishnayos Practice", "Mishnayos חידון"
  ]);
  assert.ok(!registry.teacherActions.some(action => action.id === "class-dashboard"));
  assert.match(ownerHtml, /shared\/home-tool-registry\.js/);
});
