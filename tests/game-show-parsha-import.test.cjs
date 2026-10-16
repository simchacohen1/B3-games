'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadPaste() {
  const window = {};
  vm.runInNewContext(fs.readFileSync('game-show/paste-import.js', 'utf8'), { window });
  return window.GameShowPasteImport;
}
function loadGenerator(fetch) {
  const window = {};
  const document = {
    readyState: 'loading', addEventListener() {},
    createElement() {
      let value = '';
      return {
        set innerHTML(x) { value = String(x); },
        get textContent() { return value.replace(/<[^>]*>/g, ''); },
        querySelectorAll() { return []; }
      };
    }
  };
  vm.runInNewContext(
    fs.readFileSync('game-show/question-generator-grade3-v4.js', 'utf8'),
    { window, document, fetch, setTimeout() {}, clearTimeout() {} }
  );
  return window.FunTorahSefariaGeneratorCore;
}
const normalize = rows => JSON.parse(JSON.stringify(rows));

test('six-column spreadsheet paste imports correct color, answers and indexes', () => {
  const { parsePastedText } = loadPaste();
  const tsv = [
    'Question\tRed\tBlue\tGreen\tYellow\tCorrect',
    'How many malochim came to Avrohom?\tTwo\tFour\tThree\tFive\tGreen',
    'Who welcomed the guests?\tLot\tAvrohom\tYitzchok\tYaakov\tBlue',
    'What did Sarah bake?\tBread\tFruit\tWater\tCakes\t4'
  ].join('\r\n');
  const result = normalize(parsePastedText(tsv));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.rows[0], {
    q: 'How many malochim came to Avrohom?', ans: 'Three',
    choices: ['Two', 'Four', 'Three', 'Five'], correctIndex: 2
  });
  assert.equal(result.rows[1].correctIndex, 1);
  assert.equal(result.rows[2].ans, 'Cakes');
});

test('CSV handles commas in quoted questions and accepts correct answer text', () => {
  const { parsePastedText } = loadPaste();
  const result = normalize(parsePastedText(
    'Question,Red,Blue,Green,Yellow,Correct\n' +
    '"Who said, ""Where is Sarah?""",Lot,Avrohom,Sarah,The malochim,The malochim'
  ));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0].q, 'Who said, "Where is Sarah?"');
  assert.equal(result.rows[0].correctIndex, 3);
  assert.equal(result.rows[0].ans, 'The malochim');
});

test('legacy two-column pastes and headerless inputs remain supported', () => {
  const { parsePastedText } = loadPaste();
  const a = normalize(parsePastedText('Question\tAnswer\nWhat is Shabbos?\tA holy day'));
  assert.deepEqual(a.rows, [{ q: 'What is Shabbos?', ans: 'A holy day' }]);
  const b = normalize(parsePastedText('Where did Lot live?,In Sedom, near the gate'));
  assert.deepEqual(b.rows, [{ q: 'Where did Lot live?', ans: 'In Sedom,near the gate' }]);
});

test('incomplete six-column imports report actionable errors instead of guessing correct answer', () => {
  const { parsePastedText } = loadPaste();
  const x = parsePastedText('Question\tRed\tBlue\tGreen\tYellow\tCorrect\nWho?\tA\tB\tC\tD\tPurple');
  assert.equal(x.rows.length, 0);
  assert.match(x.errors[0], /Row 2.*Correct must/);
  const y = parsePastedText('Who?\tA\tA\tC\tD\tBlue');
  assert.match(y.errors[0], /different/);
  const z = parsePastedText('Who?\tA\tB\tC\t\tBlue');
  assert.match(z.errors[0], /all four/);
});

test('Parsha metadata uses Sefaria canonical start and end, including chapter-spanning Vayera', () => {
  const core = loadGenerator(() => { throw new Error('No network in this test'); });
  const result = normalize(core.parshaRangesFromIndex('Genesis', {
    alt_structs: { Parasha: { nodes: [
      { sharedTitle: 'Vayera', wholeRef: 'Genesis 18:1-22:24' },
      { sharedTitle: 'Chayei Sara', wholeRef: 'Genesis 23:1-25:18' },
      { sharedTitle: 'Bad', wholeRef: 'Exodus 1:1-2:2' }
    ] } }
  }));
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    name: 'Vayera', book: 'Genesis', fromChapter: 18, fromVerse: 1,
    toChapter: 22, toVerse: 24, ref: 'Genesis 18:1-22:24'
  });
});

test('whole Parsha loads every perek, keeps first and last pasuk and spans boundaries', async () => {
  const fetched = [];
  async function fakeFetch(url) {
    const path = decodeURIComponent(String(url));
    fetched.push(path);
    if (path.includes('/api/v2/raw/index/Genesis')) {
      return {
        ok: true, async json() {
          return {
            schema: { lengths: [50,1533] },
            alt_structs: { Parasha: { nodes: [
              { sharedTitle: 'Vayera', wholeRef: 'Genesis 18:1-22:24' }
            ] } }
          };
        }
      };
    }
    const chapter = Number(path.match(/Genesis (\d+)/)?.[1]);
    if (chapter >= 18 && chapter <= 22) {
      return { ok: true, async json() {
        return { versions: [{ language: 'en', text:
          Array.from({ length: 25 }, (_, i) => 'And Avrohom saw the guests at place ' + chapter + ':' + (i + 1)) }] };
      } };
    }
    throw new Error('Unexpected chapter ' + chapter + ' on ' + path);
  }
  const core = loadGenerator(fakeFetch);
  const status = { textContent: '' };
  const form = {
    book: { value: 'Genesis' }, range: { value: 'parsha' },
    parsha: { value: 'Vayera' }, rashi: { checked: false }
  };
  const sources = await core.chumashSources(form, status, 20);
  assert.equal(sources.baseSourceCount, 124);
  assert.equal(sources[0].ref, 'Genesis 18:1');
  assert.equal(sources[sources.length - 1].ref, 'Genesis 22:24');
  assert.equal(sources.some(x => x.ref === 'Genesis 19:1'), true);
  assert.equal(sources.some(x => x.ref === 'Genesis 21:25'), true);
  assert.equal(sources.some(x => x.ref === 'Genesis 22:25'), false);
  assert.match(sources.rangeLabel, /Vayera/);
  assert.equal(fetched.filter(x => x.includes('/api/v3/texts/Genesis')).length, 5);
});
