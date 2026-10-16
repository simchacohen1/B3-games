'use strict';

// Small, source-linked calibration across the five books of the Chumash.
// `knowledge` deliberately hides the reference from the model and prints its
// translation next to the reference for human review; it never self-certifies.
// `grade` exercises the actual production grader with source-only, paraphrase,
// and meaning-changing answers for each book.

const fs = require('node:fs');
const path = require('node:path');

const defaultSourcePath = path.resolve(__dirname, '../backend/functions/index.js');
const sourcePath = process.env.TRANSLATION_GRADER_SOURCE || defaultSourcePath;
if (!fs.existsSync(sourcePath)) throw new Error(`Grader source not found: ${sourcePath}`);
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const handlerStart = source.indexOf('exports.gradeTranslationChunk = onRequest(');
const promptStart = source.indexOf('const systemPrompt = `', handlerStart);
const promptEnd = source.indexOf('`;\n\n    const userPrompt', promptStart);
if (handlerStart < 0 || promptStart < 0 || promptEnd < 0) throw new Error('Could not extract the production grader prompt.');
const gradingSystem = source.slice(promptStart + 'const systemPrompt = `'.length, promptEnd);
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is unavailable.');

const anchors = [
  {
    book: 'Genesis', ref: 'Genesis 1:1',
    hebrew: 'בְּרֵאשִׁ֖ית בָּרָ֣א אֱלֹהִ֑ים אֵ֥ת הַשָּׁמַ֖יִם וְאֵ֥ת הָאָֽרֶץ׃',
    sourceTranslation: 'In the beginning God created the heaven and the earth.',
    sourceName: 'JPS 1917', sourceUrl: 'https://www.sefaria.org/Genesis.1.1?with=Translations',
    paraphrase: 'At the beginning, God created the heavens and the earth.',
    wrong: 'At the beginning, the earth created God and the heavens.',
  },
  {
    book: 'Exodus', ref: 'Exodus 3:4',
    hebrew: 'וַיִּקְרָא אֵלָיו אֱלֹהִים מִתּוֹךְ הַסְּנֶה',
    sourceTranslation: 'God called to him out of the bush.',
    sourceName: 'Revised JPS, 2023', sourceUrl: 'https://www.sefaria.org/Exodus.3.4?lang=en',
    paraphrase: 'From the bush, God called to him.',
    wrong: 'He called out to the bush from God.',
  },
  {
    book: 'Leviticus', ref: 'Leviticus 1:1',
    hebrew: 'וַיִּקְרָא אֶל־מֹשֶׁה',
    sourceTranslation: 'The LORD called to Moses.',
    sourceName: 'Revised JPS, 2023', sourceUrl: 'https://www.sefaria.org/Leviticus.1.1?lang=bi&with=Translations',
    paraphrase: 'Hashem called out to Moses.',
    wrong: 'Moses called out to the LORD.',
  },
  {
    book: 'Numbers', ref: 'Numbers 1:1',
    hebrew: 'וַיְדַבֵּר יְהֹוָה אֶל־מֹשֶׁה בְּמִדְבַּר סִינַי',
    sourceTranslation: 'GOD spoke to Moses in the wilderness of Sinai.',
    sourceName: 'Revised JPS, 2023', sourceUrl: 'https://www.sefaria.org/Numbers.1.1?lang=en',
    paraphrase: 'In the Sinai wilderness, Hashem spoke to Moses.',
    wrong: 'Moses spoke to Hashem in the wilderness of Sinai.',
  },
  {
    book: 'Deuteronomy', ref: 'Deuteronomy 1:1',
    hebrew: 'אֵלֶּה הַדְּבָרִים אֲשֶׁר דִּבֶּר מֹשֶׁה אֶל־כָּל־יִשְׂרָאֵל',
    sourceTranslation: 'These are the words which Moses spoke unto all Israel.',
    sourceName: 'JPS 1917', sourceUrl: 'https://www.sefaria.org/Deuteronomy.1.1?lang=en',
    paraphrase: 'These are the words Moses said to all of Israel.',
    wrong: 'All of Israel spoke these words to Moses.',
  },
];

function buildGradeCases() {
  return anchors.flatMap((item) => [
    { ...item, id: `${item.book.toLowerCase()}-source-answer`, expected: 'correct', answer: item.sourceTranslation, accepted: [] },
    { ...item, id: `${item.book.toLowerCase()}-paraphrase`, expected: 'correct', answer: item.paraphrase, accepted: [item.sourceTranslation] },
    { ...item, id: `${item.book.toLowerCase()}-meaning-change`, expected: 'incorrect', answer: item.wrong, accepted: [item.sourceTranslation] },
  ]);
}

function graderUserPrompt(item) {
  return `Recognition evidence (ranked per consecutive segment; preserve segment order): ${JSON.stringify([[{ transcript: item.answer }]])}\n` +
    `Name vocabulary hints: []\n\nHebrew chunk: ${item.hebrew}\n\n` +
    `Generated accepted translations for this chunk: ${JSON.stringify(item.accepted)}\n\n` +
    `Independent accepted source for this exact Hebrew chunk (${item.sourceName}, ${item.ref}): "${item.sourceTranslation}"\n\n` +
    `What the student said (transcribed from speech): "${item.answer}"`;
}

async function callAnthropic(system, user, maxTokens = 220) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!response.ok) throw new Error(`Anthropic returned HTTP ${response.status}`);
  const data = await response.json();
  return (data.content || []).find((block) => block.type === 'text')?.text?.trim() || '';
}

async function grade(item) {
  const raw = await callAnthropic(gradingSystem, graderUserPrompt(item));
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON verdict returned for ${item.id}`);
  const result = JSON.parse(match[0]);
  return { id: item.id, expected: item.expected, actual: result.verdict, feedback: result.feedback || '', pass: result.verdict === item.expected };
}

async function knowledge(item) {
  const system = 'Translate the supplied Hebrew Torah phrase faithfully into simple English. Preserve who did what, pronouns, number, tense, and negation. Do not add story context or commentary. Return only the translation.';
  const answer = await callAnthropic(system, `Hebrew phrase (${item.ref}): ${item.hebrew}`, 120);
  return { id: `${item.book.toLowerCase()}-blind-translation`, answer, reference: item.sourceTranslation, sourceName: item.sourceName, sourceUrl: item.sourceUrl };
}

async function main() {
  const modeArg = process.argv.indexOf('--mode');
  const mode = modeArg >= 0 ? process.argv[modeArg + 1] : 'all';
  if (!['knowledge', 'grade', 'all'].includes(mode)) throw new Error('Use --mode knowledge, grade, or all.');
  const idsArg = process.argv.indexOf('--ids');
  const requestedIds = idsArg >= 0 ? (process.argv[idsArg + 1] || '').split(',').filter(Boolean) : null;
  const gradeCases = buildGradeCases();
  const selected = requestedIds ? gradeCases.filter((item) => requestedIds.includes(item.id)) : gradeCases;
  if (requestedIds && selected.length !== requestedIds.length) throw new Error('Unknown case id in --ids list.');

  if (mode === 'knowledge' || mode === 'all') {
    const selectedAnchors = requestedIds ? anchors.filter((anchor) => requestedIds.some((id) => id.startsWith(anchor.book.toLowerCase() + '-'))) : anchors;
    for (const item of selectedAnchors) {
      try {
        const result = await knowledge(item);
        console.log(`REVIEW ${result.id}: model="${result.answer}" | ${result.sourceName}="${result.reference}" | ${result.sourceUrl}`);
      } catch (error) {
        console.log(`ERROR ${item.book.toLowerCase()}-blind-translation: ${error.message}`);
        process.exitCode = 1;
      }
    }
    console.log('Knowledge translations are for human comparison against the cited source; they are not automatically marked correct.');
  }

  if (mode === 'grade' || mode === 'all') {
    const results = [];
    for (const item of selected) {
      try { results.push(await grade(item)); }
      catch (error) { results.push({ id: item.id, expected: item.expected, actual: 'ERROR', pass: false, feedback: error.message }); }
    }
    for (const result of results) {
      console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}: expected=${result.expected} actual=${result.actual} — ${result.feedback}`);
    }
    console.log(`GRADE RESULT ${results.filter((item) => item.pass).length}/${results.length} passed; ${results.filter((item) => !item.pass).length} failed.`);
    if (results.some((item) => !item.pass)) process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });

