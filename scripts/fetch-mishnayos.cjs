#!/usr/bin/env node
/*
 * One-time download of a Maseches from Sefaria for Mishnayos Practice.
 *
 *   node scripts/fetch-mishnayos.cjs berachos
 *
 * Writes two files:
 *   record-mishnayos/data/<key>.he.json
 *       Public. Hebrew (Torat Emet 357, public domain) split into display
 *       lines for the Mishnah Seduras layout.
 *   backend/functions/_answer-key/mishnayos/<key>.en.json
 *       Teacher answer key ONLY. Rabbi Shraga Silverstein translation
 *       (CC-BY). Lives with the Cloud Functions, never on the public site
 *       (GitHub Pages skips folders starting with _), so students cannot
 *       download it.
 *
 * Re-run only when the text needs refreshing. Students never call Sefaria.
 */
const fs = require('fs');
const path = require('path');

const MASECHTOS = {
  berachos: { sefaria: 'Mishnah Berakhot', hebrew: 'ברכות', english: 'Berachos', seder: 'זרעים' }
};
const HE_VERSION = 'Torat Emet 357';
const EN_VERSION = 'The Mishna with Obadiah Bartenura by Rabbi Shraga Silverstein';
const ROOT = path.resolve(__dirname, '..');

function stripTags(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Shaimos: show the four-letter Name (if present) as ה׳, same as Posuk Practice.
function abbreviateShaimos(text) {
  const P = '[\\u0591-\\u05C7]*';
  return text.replace(new RegExp('י' + P + 'ה' + P + 'ו' + P + 'ה' + P, 'g'), 'ה׳');
}

// Remove Bartenura's bracketed explanations so only the plain translation of
// the Mishnah remains. Handles nested brackets.
function stripBrackets(text) {
  let out = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '[') { depth++; continue; }
    if (ch === ']') { depth = Math.max(0, depth - 1); continue; }
    if (!depth) out += ch;
  }
  return out
    .replace(/\s+([,.;:?!])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/([.?!:;]),/g, '$1')
    .replace(/,([.?!:;])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Split one Mishnah into display lines the way a Mishnah book reads: a new
   line at the end of each statement (period / colon / question). Very long
   statements are then broken at a comma so no line runs on too long. */
function splitLines(text) {
  const words = text.split(' ').filter(Boolean);
  const lines = [];
  let cur = [];
  const MAX = 12;
  words.forEach((w, i) => {
    cur.push(w);
    const last = i === words.length - 1;
    const endsStatement = /[.:?!]$/.test(w);
    const endsClause = /[,;]$/.test(w);
    if (last || endsStatement || (endsClause && cur.length >= 7) || cur.length >= MAX + 4) {
      lines.push(cur.join(' '));
      cur = [];
    }
  });
  if (cur.length) lines.push(cur.join(' '));
  return lines;
}

/* Group a Mishnah's lines into practice sections. A short Mishnah is one
   section; a long one is cut at the end of a statement so each section is
   about the length of a long posuk (one comfortable recording). Returned as
   [startLine, endLineExclusive] pairs. */
const SECTION_TARGET_WORDS = 30;
const SECTION_MAX_WORDS = 42;
function splitSections(lines) {
  const counts = lines.map(l => l.split(' ').filter(Boolean).length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= SECTION_MAX_WORDS) return [[0, lines.length]];
  const sections = [];
  let start = 0, words = 0;
  for (let i = 0; i < lines.length; i++) {
    words += counts[i];
    const endsStatement = /[.:?!]$/.test(lines[i]);
    const nextWords = i + 1 < lines.length ? counts[i + 1] : 0;
    const remaining = counts.slice(i + 1).reduce((a, b) => a + b, 0);
    const wouldOverflow = words + nextWords > SECTION_MAX_WORDS;
    if (i === lines.length - 1) break;
    // Never leave a tiny tail section on its own.
    if (remaining < 8) continue;
    if ((words >= SECTION_TARGET_WORDS && endsStatement) || wouldOverflow) {
      sections.push([start, i + 1]);
      start = i + 1;
      words = 0;
    }
  }
  sections.push([start, lines.length]);
  return sections;
}

// Traditional perek names for Berachos (shown in the Mishnah heading).
const PEREK_NAMES = {
  berachos: ['מאימתי', 'היה קורא', 'מי שמתו', 'תפלת השחר', 'אין עומדין', 'כיצד מברכין', 'שלשה שאכלו', 'אלו דברים', 'הרואה']
};

async function getJson(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
      return await res.json();
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

async function main() {
  const key = (process.argv[2] || 'berachos').toLowerCase();
  const m = MASECHTOS[key];
  if (!m) throw new Error('Unknown maseches: ' + key + '. Known: ' + Object.keys(MASECHTOS).join(', '));

  const index = await getJson('https://www.sefaria.org/api/v2/index/' + encodeURIComponent(m.sefaria));
  const perakimCount = (index.schema && index.schema.lengths && index.schema.lengths[0]) || 0;
  if (!perakimCount) throw new Error('Could not read perek count from Sefaria index');

  const he = { maseches: key, hebrew: m.hebrew, english: m.english, seder: m.seder,
    source: { hebrew: HE_VERSION + ' (Sefaria, public domain)' }, perakim: [] };
  const en = { maseches: key, english: m.english,
    source: { english: 'Rabbi Shraga Silverstein, "' + EN_VERSION + '" (Sefaria, CC-BY)' }, perakim: [] };

  for (let p = 1; p <= perakimCount; p++) {
    const ref = m.sefaria + ' ' + p;
    const url = 'https://www.sefaria.org/api/v3/texts/' + encodeURIComponent(ref) +
      '?version=' + encodeURIComponent('hebrew|' + HE_VERSION) +
      '&version=' + encodeURIComponent('english|' + EN_VERSION);
    const data = await getJson(url);
    const heV = (data.versions || []).find(v => v.language === 'he' || v.versionTitle === HE_VERSION);
    const enV = (data.versions || []).find(v => v.versionTitle === EN_VERSION);
    if (!heV || !enV) throw new Error('Missing a version for ' + ref);
    const heArr = heV.text || [];
    const enArr = enV.text || [];
    if (heArr.length !== enArr.length) {
      console.warn('Warning: ' + ref + ' has ' + heArr.length + ' Hebrew and ' + enArr.length + ' English mishnayos');
    }
    const heMishnayos = heArr.map((raw, i) => {
      const text = abbreviateShaimos(stripTags(raw));
      const lines = splitLines(text);
      return { mishnah: i + 1, text, lines, sections: splitSections(lines) };
    });
    he.perakim.push({ perek: p, name: (PEREK_NAMES[key] || [])[p - 1] || '', mishnayos: heMishnayos });
    // The server copy also carries the Hebrew sections so grading and
    // question generation work from exactly the words the student sees.
    en.perakim.push({ perek: p, mishnayos: enArr.map((raw, i) => {
      const full = stripTags(raw);
      const h = heMishnayos[i] || { lines: [], sections: [] };
      return {
        mishnah: i + 1,
        translation: stripBrackets(full),
        withBartenura: full,
        sections: h.sections.map(([a, b]) => h.lines.slice(a, b).join(' '))
      };
    }) });
    console.log(ref + ': ' + heArr.length + ' mishnayos');
    await new Promise(r => setTimeout(r, 300));
  }

  const heOut = path.join(ROOT, 'record-mishnayos', 'data', key + '.he.json');
  const enOut = path.join(ROOT, 'backend', 'functions', '_answer-key', 'mishnayos', key + '.en.json');
  fs.mkdirSync(path.dirname(heOut), { recursive: true });
  fs.mkdirSync(path.dirname(enOut), { recursive: true });
  fs.writeFileSync(heOut, JSON.stringify(he, null, 1) + '\n');
  fs.writeFileSync(enOut, JSON.stringify(en, null, 1) + '\n');
  console.log('Wrote ' + path.relative(ROOT, heOut));
  console.log('Wrote ' + path.relative(ROOT, enOut));
}

main().catch(err => { console.error(err); process.exit(1); });
