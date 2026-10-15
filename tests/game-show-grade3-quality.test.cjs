"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadCore(randomValues = []) {
  const window = {};
  const document = {
    readyState: "loading",
    addEventListener() {},
    createElement() {
      let html = "";
      return {
        set innerHTML(value) { html = String(value); },
        get textContent() { return html.replace(/<[^>]*>/g, ""); },
        querySelectorAll() { return []; }
      };
    }
  };
  let randomIndex = 0;
  const math = Object.create(Math);
  math.random = () => randomValues.length ? randomValues[randomIndex++ % randomValues.length] : 0.37;
  vm.runInNewContext(
    fs.readFileSync("game-show/question-generator-grade3-v4.js", "utf8"),
    { window, document, Math: math, fetch() { throw new Error("Unexpected fetch in pure builder test"); } }
  );
  return window.FunTorahSefariaGeneratorCore;
}

test("multiple-choice options move the correct answer and keep correctIndex accurate", () => {
  const core = loadCore([0.1, 0.6, 0.9, 0.3, 0.7, 0.2]);
  const sources = [
    { ref: "Genesis 1:1", text: "And God created the heaven and the earth." },
    { ref: "Genesis 1:3", text: "And God said, Let there be light." },
    { ref: "Genesis 1:4", text: "And God saw the light, that it was good; and God divided the light from the darkness." },
    { ref: "Genesis 1:5", text: "And God called the light Day, and the darkness He called Night." }
  ];
  const items = core.makeItems(sources, "mc", "", sources.length, sources);
  assert.equal(items.length, sources.length);
  for (const item of items) {
    const source = sources.find(row => core.questionAndAnswer(row, "").q === item.q);
    assert.ok(source, "each generated question should match a source");
    const answer = core.questionAndAnswer(source, "").answer;
    assert.equal(item.choices[item.correctIndex], core.localizeText(core.shortChoice(answer)));
  }
  assert.ok(items.some(item => item.correctIndex !== 0), "correct answers should not all remain in the first position");
  assert.ok(items.every(item => item.choices.length === 4));
});

test("generator skips questions without clear context instead of asking confusing quote-completion prompts", () => {
  const core = loadCore();
  assert.equal(core.questionAndAnswer({ ref: "Genesis 18:2", text: "He said, Let us bring some water." }, ""), null);
  assert.equal(core.questionAndAnswer({ ref: "Rashi on Genesis 18:1", text: "A long explanation without a clear question.", isRashi: true }, ""), null);
});

test("creation questions use short, direct wording for children", () => {
  const core = loadCore();
  const [item] = core.makeItems([
    { ref: "Genesis 1:4", displayRef: "Bereishis 1:4", text: "And God saw the light, that it was good; and God divided the light from the darkness." }
  ], "open", "", 1);
  assert.equal(item.q, "What did Hashem see on day one?");
});


test("believable distractors match the question's answer type", () => {
  const core = loadCore();
  const people = core.plausibleOptions({ q: "Who visited Avrohom?", answer: "Lot" }, []);
  assert.equal(people.length, 4);
  assert.equal(people.filter(row => row.correct).length, 1);
  assert.ok(people.every(row => ["Lot", "Avrohom", "Yitzchok", "Yaakov", "Sarah", "Rivkah", "Eliezer", "Yosef"].includes(row.excerpt)));
  const animals = core.plausibleOptions({ q: "What animal did Avrohom choose?", answer: "A calf" }, []);
  assert.equal(animals.length, 4);
  assert.ok(animals.every(row => /calf|lamb|goat|sheep|donkey/i.test(row.excerpt)));
  const unrelated = core.plausibleOptions({ q: "What did Avrohom do?", answer: "He hurried" },
    [{ q: "What animal did he choose?", answer: "A goat" }]);
  assert.equal(unrelated.length, 0, "do not invent unrelated answers to fill four slots");
});
