#!/usr/bin/env node
'use strict';
/**
 * Chazara AI Practice — real-audio evaluation harness (#688).
 *
 *   node scripts/chazara-ai-audio-eval.cjs <manifest.json> (--silence-only | --full) [--out report.json]
 *
 * --silence-only  Free. Decodes each file with ffmpeg and runs the same instant
 *                 silence check the browser runs (chazara/ai-practice-check.js).
 * --full          Also sends clips that pass the silence check to OpenAI
 *                 gpt-4o-mini-transcribe (~$0.003 per audio minute) and applies the
 *                 real-words check. Needs OPENAI_API_KEY. Run only with the owner's approval.
 *
 * Manifest (keep recordings and the manifest OUT of git; use only authorised,
 * consented or synthetic recordings):
 * { "cases": [ { "name": "reads-and-translates", "files": ["a1.webm", ...one per pasuk],
 *                "expect": "excellent" | "almost" | "try_again" | "unclear" } ] }
 * For --silence-only, "expect" may instead be "pass" (sent on) or "unclear" (stopped instantly).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Check = require('../chazara/ai-practice-check.js');
const { checkTranscript } = require('../backend/functions/chazara-ai/transcript-check.cjs');
const { decide } = require('../backend/functions/chazara-ai/decide.cjs');
const { openaiTranscriber } = require('../backend/functions/chazara-ai/providers.cjs');
const { PRICES } = require('../backend/functions/chazara-ai/service.cjs');

function args() {
  const a = process.argv.slice(2);
  const opt = { manifest: a.find(x => !x.startsWith('--')), full: a.includes('--full'), silenceOnly: a.includes('--silence-only'),
    out: a.includes('--out') ? a[a.indexOf('--out') + 1] : null };
  if (!opt.manifest || opt.full === opt.silenceOnly) {
    console.error('Usage: node scripts/chazara-ai-audio-eval.cjs <manifest.json> (--silence-only | --full) [--out report.json]');
    process.exit(2);
  }
  return opt;
}

function ffmpegPath() { try { return require('ffmpeg-static'); } catch (_) { return 'ffmpeg'; } }

/** Decode to 16 kHz mono and take ~10 ms level readings, like the browser's meter. */
function measureFile(file) {
  const raw = execFileSync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { maxBuffer: 64 * 1024 * 1024 });
  const pcm = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  const n = 160, frames = [];
  for (let i = 0; i + n <= pcm.length; i += n) {
    let sum = 0;
    for (let j = i; j < i + n; j++) { const v = pcm[j] / 32768; sum += v * v; }
    frames.push({ rms: Math.sqrt(sum / n), ms: 10 });
  }
  const durationMs = Math.round(pcm.length / 16);
  return { durationMs, ...Check.measure(frames) };
}

const mimeOf = f => ({ '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.mp4': 'audio/mp4', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' })[path.extname(f).toLowerCase()] || 'audio/webm';

async function main() {
  const opt = args();
  const dir = path.dirname(path.resolve(opt.manifest));
  const manifest = JSON.parse(fs.readFileSync(opt.manifest, 'utf8'));
  let transcribe = null;
  if (opt.full) {
    if (!process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY for --full.');
    transcribe = openaiTranscriber({ apiKey: () => process.env.OPENAI_API_KEY });
  }
  const rows = [];
  for (const c of manifest.cases) {
    const files = c.files.map(f => path.resolve(dir, f));
    const t0 = Date.now();
    const level = files.map(measureFile);
    const verdicts = level.map(m => Check.assess(m));
    let got, transcripts = null, seconds = 0;
    if (verdicts.some(v => !v.ok)) got = 'unclear';                       // stopped in the browser, nothing sent
    else if (opt.silenceOnly) got = 'pass';
    else {
      const heard = await Promise.all(files.map(f => transcribe({ buffer: fs.readFileSync(f), mimeType: mimeOf(f) })));
      transcripts = heard.map(h => h.text);
      seconds = level.reduce((s, m) => s + m.durationMs / 1000, 0);
      got = decide(heard.map((h, i) => ({ id: String(i), label: String(i), passes: checkTranscript(h.text).passes }))).outcome;
    }
    const row = { name: c.name, expect: c.expect, got, ms: Date.now() - t0, costUsd: Math.round(seconds / 60 * PRICES.transcribePerMinute * 100000) / 100000,
      level: level.map((m, i) => ({ ...m, peakRms: Math.round(m.peakRms * 10000) / 10000, verdict: verdicts[i].reason || 'ok' })), transcripts };
    rows.push(row);
    console.log(c.name.padEnd(42), 'expect', String(c.expect).padEnd(10), 'got', got.padEnd(10), row.ms + 'ms', opt.full ? '$' + row.costUsd : '');
  }
  const match = rows.filter(r => r.got === r.expect).length;
  const summary = {
    cases: rows.length, asExpected: match,
    wronglyStopped: rows.filter(r => r.got === 'unclear' && r.expect !== 'unclear').map(r => r.name),
    wronglyPassed: rows.filter(r => r.expect === 'unclear' && r.got !== 'unclear').map(r => r.name),
    ...(opt.full ? {
      falseExcellent: rows.filter(r => r.got === 'excellent' && r.expect !== 'excellent').map(r => r.name),
      averageMs: Math.round(rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, rows.length)),
      averageCostUsd: Math.round(rows.reduce((a, r) => a + r.costUsd, 0) / Math.max(1, rows.length) * 100000) / 100000
    } : {})
  };
  console.log('\n' + JSON.stringify(summary, null, 2));
  if (opt.out) fs.writeFileSync(opt.out, JSON.stringify({ summary, rows }, null, 2));
  if (match !== rows.length) process.exitCode = 1;
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
