'use strict';

const fs = require('node:fs');
const path = require('node:path');

const relativeSourcePath = path.resolve(__dirname, '..', 'backend', 'functions', 'index.js');
const sourcePath = process.env.TRANSLATION_GRADER_SOURCE ||
  (fs.existsSync(relativeSourcePath) ? relativeSourcePath : 'C:/Users/simch/GitHub/B3-games-posuk-translation-pr121/backend/functions/index.js');
const source = fs.readFileSync(sourcePath, 'utf8').replace(/\r\n/g, '\n');
const handlerStart = source.indexOf('exports.gradeTranslationChunk = onRequest(');
const promptStart = source.indexOf('const systemPrompt = `', handlerStart);
const promptEnd = source.indexOf('`;\n\n    const userPrompt', promptStart);
if (handlerStart < 0 || promptStart < 0 || promptEnd < 0) throw new Error('Could not extract the grader system prompt.');
const system = source.slice(promptStart + 'const systemPrompt = `'.length, promptEnd);
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is unavailable.');

const cases = [
  { id: '01-exact', expected: 'correct', hebrew: 'וַיֹּאמֶר אֵלָיו', accepted: ['and he said to him'], answer: 'And he said to him.' },
  { id: '02-synonym', expected: 'correct', hebrew: 'וַיֹּאמֶר אֵלָיו', accepted: ['and he said to him'], answer: 'He told him.' },
  { id: '03-word-order', expected: 'correct', hebrew: 'וַיֹּאמֶר אֵלָיו', accepted: ['and he said to him'], answer: 'To him he said.' },
  { id: '04-pronoun-to-name', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אֵלָיו', accepted: ['and he said to him'], answer: 'He said to Avrohom.' },
  { id: '05-wrong-agent', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אֵלָיו', accepted: ['and he said to him'], answer: 'She said to him.' },
  { id: '06-wrong-tense', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אֵלָיו', accepted: ['and he said to him'], answer: 'He will say to him.' },
  { id: '07-missing-recipient', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אֵלָיו', accepted: ['and he said to him'], answer: 'He said.' },
  { id: '08-wrong-negation', expected: 'incorrect', hebrew: 'לֹא הָלַךְ', accepted: ['he did not go'], answer: 'He went.' },
  { id: '09-wrong-number', expected: 'incorrect', hebrew: 'וַיָּבֹאוּ הַמַּלְאָכִים', accepted: ['and the angels came'], answer: 'The angel came.' },
  { id: '10-reversed-roles', expected: 'incorrect', hebrew: 'וַתֹּאמֶר שָׂרָה אֶל־אַבְרָהָם', accepted: ['and Sarah said to Abraham'], answer: 'Abraham said to Sarah.' },
  { id: '11-name-spelling', expected: 'correct', hebrew: 'וַיֹּאמֶר אַבְרָם', accepted: ['and Avram said'], answer: 'Avrohom said.', nameHints: ['Avram', 'Avrohom'] },
  { id: '12-different-name', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אַבְרָם', accepted: ['and Avram said'], answer: 'Yitzchok said.', nameHints: ['Avram', 'Avrohom', 'Yitzchok'] },
  { id: '13-missing-name', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אַבְרָם', accepted: ['and Avram said'], answer: 'He said.', nameHints: ['Avram'] },
  { id: '14-alternative-resolves-name', expected: 'correct', hebrew: 'וַיָּבֹאוּ לִסְדֹם', accepted: ['and they came to Sodom'], answer: 'And they came to Saddam.', nameHints: ['Sodom'], alternatives: ['and they came to Saddam.', 'and they came to Sodom'] },
  { id: '15-name-slot-no-name', expected: 'incorrect', hebrew: 'וַיָּבֹאוּ לִסְדֹם', accepted: ['and they came to Sodom'], answer: 'And they came in the evening.', nameHints: ['Sodom'] },
  { id: '15a-avrohom-recognized-as-a-ram-with-name-alternative', expected: 'correct', hebrew: 'וַיֹּאמֶר אַבְרָהָם', accepted: ['Avrohom said'], answer: 'A ram said.', nameHints: ['Avrohom'], alternatives: ['A ram said.', 'Avrohom said'] },
  { id: '15b-avrohom-mishearing-without-supporting-alternative', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אַבְרָהָם', accepted: ['Avrohom said'], answer: 'A ram said.', nameHints: ['Avrohom'] },
  { id: '15c-avrohom-garbled-phonetic-transcript', expected: 'correct', hebrew: 'וַיֹּאמֶר אַבְרָהָם', accepted: ['Avrohom said'], answer: 'A bro ham said.', nameHints: ['Avrohom'] },
  { id: '15d-a-ram-is-literal-different-content', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אַבְרָהָם', accepted: ['Avrohom said'], answer: 'A ram said.', nameHints: ['Avrohom'], alternatives: ['A ram said.'] },
  { id: '15e-name-alternative-does-not-fix-wrong-verb', expected: 'incorrect', hebrew: 'וַיֹּאמֶר אַבְרָהָם', accepted: ['Avrohom said'], answer: 'A ram will leave.', nameHints: ['Avrohom'], alternatives: ['A ram will leave.', 'Avrohom will leave'] },
  { id: '16-literal-place-name', expected: 'correct', hebrew: 'בְּאֵלֹנֵי מַמְרֵא', accepted: ['in the plains of Mamre'], answer: 'By the oaks of Mamre.', nameHints: ['Mamre'] },
  { id: '17-unrelated-name-hint', expected: 'incorrect', hebrew: 'בְּאֵלֹנֵי מַמְרֵא', accepted: ['in the plains of Mamre'], answer: 'He went to the city.', nameHints: ['Mamre'] },
  { id: '18-split-answer', expected: 'correct', hebrew: 'וַיֹּאמֶר אֵלָיו יְהוָה', accepted: ['and Hashem said to him'], answer: 'And he said to him. Hashem.' },
  { id: '19-independent-kehot', expected: 'correct', hebrew: 'עֶדְנָה', accepted: ['pleasure', 'enjoyment'], answer: 'My skin will become smooth.', kehot: 'My skin will become smooth.' },
  { id: '20-independent-umesorah', expected: 'correct', hebrew: 'עֶדְנָה', accepted: ['pleasure', 'enjoyment'], answer: 'I will have freshness.', torahUmesorah: 'After I am worn-out, shall I have a freshness?' },
  { id: '21-wrong-phrase-from-same-verse', expected: 'incorrect', hebrew: 'וְהִשָּׁעֲנוּ תַּחַת הָעֵץ', accepted: ['and recline under the tree'], answer: 'Wash your feet.', torahUmesorah: 'Let there be taken now a little water and wash your feet and recline under the tree.', feedbackMustContain: ['recline'], feedbackMustNotContain: ['wash your feet is correct'] },
  { id: '22-mixed-sources', expected: 'incorrect', hebrew: 'עֶדְנָה', accepted: ['pleasure'], answer: 'The city became smooth and he laughed.', kehot: 'My skin will become smooth.', torahUmesorah: 'Shall I have freshness?' },
  { id: '23-omitted-essential-action', expected: 'incorrect', hebrew: 'וַיִּקַּח אֶת־הַמַּטֶּה', accepted: ['and he took the staff'], answer: 'The staff.' },
  { id: '24-different-object', expected: 'incorrect', hebrew: 'וַיִּקַּח אֶת־הַמַּטֶּה', accepted: ['and he took the staff'], answer: 'He took the sword.' },
  { id: '25-hashem-classroom-name', expected: 'correct', hebrew: 'וַיֹּאמֶר אֱלֹהִים', accepted: ['and God said'], answer: 'And Hashem said.' },
  { id: '26-place-vs-transliteration', expected: 'correct', hebrew: 'בְּאֵלֹנֵי מַמְרֵא', accepted: ['by Elonei Mamre'], answer: 'By the terebinths of Mamre.' },
  { id: '27-valid-pronoun', expected: 'correct', hebrew: 'וַיֹּאמֶר אֵלָיו', accepted: ['and he said to him'], answer: 'And he spoke to him.' },
  { id: '28-incomplete-vague', expected: 'incorrect', hebrew: 'וַיָּבֹאוּ לִסְדֹם', accepted: ['and they came to Sodom'], answer: 'They did something there.' },
];

function makeUserPrompt(item) {
  const segments = item.alternatives
    ? [item.alternatives.map(transcript => ({ transcript }))]
    : [[{ transcript: item.answer }]];
  return `Recognition evidence (ranked per consecutive segment; preserve segment order): ${JSON.stringify(segments)}\n` +
    `Name vocabulary hints: ${JSON.stringify(item.nameHints || [])}\n\n` +
    `Hebrew chunk: ${item.hebrew}\n\n` +
    `Generated accepted translations for this chunk: ${JSON.stringify(item.accepted)}` +
    (item.torahUmesorah ? `\n\nThe Torah Umesorah classroom-reference translation of the whole posuk (INDEPENDENT ACCEPTED SOURCE; use the wording corresponding to this Hebrew chunk, and accept natural spoken word-order variants): "${item.torahUmesorah}"` : '') +
    (item.kehot ? `\n\nThe Kehot Chumash translation of the whole posuk (INDEPENDENT ACCEPTED SOURCE; use the wording corresponding to this Hebrew chunk, and accept natural spoken word-order variants): "${item.kehot}"` : '') +
    `\n\nWhat the student said (transcribed from speech): "${item.answer}"`;
}

async function grade(item) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001', max_tokens: 250, system,
      messages: [{ role: 'user', content: makeUserPrompt(item) }],
    }),
  });
  if (!response.ok) throw new Error(`Anthropic returned HTTP ${response.status} for ${item.id}`);
  const data = await response.json();
  const text = (data.content || []).find(block => block.type === 'text')?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON verdict returned for ${item.id}`);
  const result = JSON.parse(match[0]);
  const feedback = String(result.feedback || '');
  const lowerFeedback = feedback.toLowerCase();
  const feedbackIssues = [
    ...(item.feedbackMustContain || []).filter(phrase => !lowerFeedback.includes(phrase.toLowerCase())).map(phrase => `feedback omitted “${phrase}”`),
    ...(item.feedbackMustNotContain || []).filter(phrase => lowerFeedback.includes(phrase.toLowerCase())).map(phrase => `feedback wrongly included “${phrase}”`),
  ];
  return { id: item.id, expected: item.expected, actual: result.verdict, pass: result.verdict === item.expected && !feedbackIssues.length, feedbackIssues, feedback };
}

async function main() {
  const idsIndex = process.argv.indexOf('--ids');
  const requestedIds = idsIndex >= 0 ? (process.argv[idsIndex + 1] || '').split(',').filter(Boolean) : null;
  const selectedCases = requestedIds ? cases.filter(item => requestedIds.includes(item.id)) : cases;
  if (requestedIds && selectedCases.length !== requestedIds.length) throw new Error('Unknown case id in --ids list.');
  const results = [];
  for (const item of selectedCases) {
    try { results.push(await grade(item)); }
    catch (error) { results.push({ id: item.id, expected: item.expected, error: error.message, pass: false }); }
  }
  const passed = results.filter(result => result.pass).length;
  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id}: expected=${result.expected} actual=${result.actual || 'ERROR'}${result.error ? ` (${result.error})` : ''}${result.feedbackIssues?.length ? ` [${result.feedbackIssues.join('; ')}]` : ''}${result.feedback ? ` — ${result.feedback}` : ''}`);
  }
  console.log(`RESULT ${passed}/${results.length} passed; ${results.length - passed} failed.`);
  if (passed !== results.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

