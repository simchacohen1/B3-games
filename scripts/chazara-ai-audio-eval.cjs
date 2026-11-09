#!/usr/bin/env node
'use strict';
/**
 * Chazara AI Practice — REAL-AUDIO evaluation harness (#688).
 *
 * Runs labelled recordings through the same pipeline the Cloud Function uses and
 * reports false approvals, false rejections, uncertain results, timing and cost.
 *
 *   node scripts/chazara-ai-audio-eval.cjs <manifest.json> [--signal-only] [--paid] [--out report.json]
 *
 * --signal-only  Free. Only decodes the audio and runs step 1 (audio validity).
 * --paid         Calls Google Speech-to-Text and Claude. Costs money. Requires
 *                GOOGLE_APPLICATION_CREDENTIALS (a project with Speech-to-Text enabled)
 *                and ANTHROPIC_API_KEY. Only run with the owner's approval.
 *
 * Manifest (keep recordings and the manifest OUT of git; use only authorised,
 * consented or synthetic recordings — never real students without permission):
 * {
 *   "items": { "18_1": { "label": "פרק יח · פסוק א", "hebrew": "…", "meaning": "…" }, ... },
 *   "cases": [
 *     { "name": "adult-reads-correct-english", "pesukim": ["18_1"], "files": ["audio/a1.webm"],
 *       "expect": "excellent" | "almost" | "try_again" | "unclear" | "not_excellent",
 *       "tags": ["child-like", "yiddish"] }
 *   ]
 * }
 */
const fs = require('node:fs');
const path = require('node:path');
const { analyzePcm, classifyAudio } = require('../backend/functions/chazara-ai/audio-signal.cjs');
const { evaluateAttempt, makeJudge } = require('../backend/functions/chazara-ai/pipeline.cjs');
const { PRICES } = require('../backend/functions/chazara-ai/service.cjs');
const { decodeWithFfmpeg, googleRecognizer, claudeJudge } = require('../backend/functions/chazara-ai/providers.cjs');

function args() {
  const a = process.argv.slice(2);
  const opt = { manifest: a.find(x => !x.startsWith('--')), signalOnly: a.includes('--signal-only'), paid: a.includes('--paid'),
    out: a.includes('--out') ? a[a.indexOf('--out') + 1] : null };
  if (!opt.manifest || (!opt.signalOnly && !opt.paid)) {
    console.error('Usage: node scripts/chazara-ai-audio-eval.cjs <manifest.json> (--signal-only | --paid) [--out report.json]');
    process.exit(2);
  }
  return opt;
}

function ffmpegPath() {
  try { return require('ffmpeg-static'); } catch (_) { return 'ffmpeg'; }
}

function costOf(usage) {
  return usage.speechSeconds / 60 * PRICES.speechPerMinute + usage.inputTokens / 1e6 * PRICES.inputPerMTok + usage.outputTokens / 1e6 * PRICES.outputPerMTok;
}

async function main() {
  const opt = args();
  const manifestPath = path.resolve(opt.manifest), dir = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const decode = decodeWithFfmpeg(ffmpegPath());
  let providers = null;
  if (opt.paid) {
    if (!process.env.ANTHROPIC_API_KEY || !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Set ANTHROPIC_API_KEY and GOOGLE_APPLICATION_CREDENTIALS for --paid.');
    const speech = require('@google-cloud/speech');
    const Anthropic = require('@anthropic-ai/sdk');
    providers = { decode, recognize: googleRecognizer(new speech.SpeechClient()), judge: makeJudge(claudeJudge(new Anthropic())) };
  }
  const rows = [];
  for (const c of manifest.cases) {
    const buffers = c.files.map(f => fs.readFileSync(path.resolve(dir, f)));
    if (opt.signalOnly) {
      const audio = [];
      for (const b of buffers) { const m = analyzePcm(await decode(b)); audio.push({ status: classifyAudio(m), ...m }); }
      rows.push({ name: c.name, expect: c.expect, tags: c.tags || [], audio });
      console.log(c.name.padEnd(40), audio.map(a => a.status).join(','), 'expect', c.expect);
      continue;
    }
    const items = c.pesukim.map(id => ({ id, ...manifest.items[id] }));
    const t0 = Date.now();
    let out, error = null;
    try { out = await evaluateAttempt({ items, segments: buffers, providers }); }
    catch (e) { error = e.code || e.message; }
    const got = out ? out.decision.outcome : 'error';
    const row = { name: c.name, expect: c.expect, got, tags: c.tags || [], ms: Date.now() - t0,
      costUsd: out ? Math.round(costOf(out.usage) * 10000) / 10000 : 0, error,
      diagnostics: out ? out.diagnostics.map(d => ({ id: d.id, audio: d.audioStatus, reading: d.readingLevel, meaning: d.meaningLevel, readingCoverage: d.readingCoverage, unboostedCoverage: d.unboostedCoverage, transcripts: d.transcripts })) : null };
    rows.push(row);
    console.log(c.name.padEnd(40), 'expect', String(c.expect).padEnd(14), 'got', got.padEnd(10), row.ms + 'ms', '$' + row.costUsd);
  }

  if (!opt.signalOnly) {
    const shouldPass = r => r.expect === 'excellent';
    const falseApprovals = rows.filter(r => !shouldPass(r) && r.got === 'excellent');
    const falseRejections = rows.filter(r => shouldPass(r) && ['try_again', 'almost'].includes(r.got));
    const uncertain = rows.filter(r => r.got === 'unclear' || r.got === 'unavailable' || r.got === 'error');
    const exact = rows.filter(r => r.got === r.expect || (r.expect === 'not_excellent' && r.got !== 'excellent'));
    const summary = {
      cases: rows.length,
      exactMatches: exact.length,
      falseApprovals: falseApprovals.length, falseApprovalRate: rows.filter(r => !shouldPass(r)).length ? falseApprovals.length / rows.filter(r => !shouldPass(r)).length : null,
      falseRejections: falseRejections.length, falseRejectionRate: rows.filter(shouldPass).length ? falseRejections.length / rows.filter(shouldPass).length : null,
      uncertain: uncertain.length,
      averageMs: Math.round(rows.reduce((a, r) => a + r.ms, 0) / Math.max(1, rows.length)),
      averageCostUsd: Math.round(rows.reduce((a, r) => a + r.costUsd, 0) / Math.max(1, rows.length) * 10000) / 10000,
      falseApprovalCases: falseApprovals.map(r => r.name), falseRejectionCases: falseRejections.map(r => r.name)
    };
    console.log('\n' + JSON.stringify(summary, null, 2));
    if (opt.out) fs.writeFileSync(opt.out, JSON.stringify({ summary, rows }, null, 2));
  } else if (opt.out) fs.writeFileSync(opt.out, JSON.stringify({ rows }, null, 2));
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
