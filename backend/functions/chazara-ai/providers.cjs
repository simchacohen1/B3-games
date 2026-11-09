'use strict';
/**
 * Real service adapters for the Chazara AI Practice pipeline.
 * Loaded only by the deployed Cloud Function; unit tests inject fakes instead.
 *
 *  - decode:    ffmpeg (bundled ffmpeg-static) -> 16 kHz mono 16-bit PCM, in memory
 *  - recognize: Google Cloud Speech-to-Text v1 (same service Posuk Practice uses)
 *  - judge:     Claude Haiku 5.5 via the official Anthropic SDK (key from Secret Manager)
 * Audio is never written to Storage or the database.
 */
const { spawn } = require('node:child_process');
const { pcmFromBuffer } = require('./audio-signal.cjs');

const MAX_SEGMENT_SECONDS = 62;
// Claude Haiku 5.5: low cost for a short, structured judging task. Effort 'high' for
// strict instruction following (thinking is adaptive and on by default).
const JUDGE_MODEL = process.env.CHAZARA_AI_JUDGE_MODEL || 'claude-haiku-5-5';
const JUDGE_EFFORT = process.env.CHAZARA_AI_JUDGE_EFFORT || 'high';

function decodeWithFfmpeg(ffmpegPath) {
  return (buffer, _mime) => new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-t', String(MAX_SEGMENT_SECONDS),
      '-ac', '1', '-ar', '16000', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'];
    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(Object.assign(new Error('Audio decode timed out'), { code: 'decode_timeout' })); }, 20000);
    proc.stdout.on('data', c => out.push(c));
    proc.stderr.on('data', c => { if (err.length < 20) err.push(c); });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(Object.assign(new Error('This recording could not be opened.'), { code: 'decode_failed', detail: Buffer.concat(err).toString().slice(0, 300) }));
      resolve(pcmFromBuffer(Buffer.concat(out)));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(buffer);
  });
}

function googleRecognizer(speechClient, { timeoutMs = 25000 } = {}) {
  return async ({ pcm, sampleRate, language, hints }) => {
    const content = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64');
    const config = {
      encoding: 'LINEAR16',
      sampleRateHertz: sampleRate,
      languageCode: language === 'he-IL' ? 'iw-IL' : 'en-US',
      enableAutomaticPunctuation: false,
      profanityFilter: true,
      model: 'default'
    };
    // Moderate boost only: enough for close calls, not enough to force the
    // expected words onto unrelated audio. A second unboosted pass confirms.
    if (hints && hints.length) config.speechContexts = [{ phrases: hints.filter(h => h.length <= 100).slice(0, 80), boost: 8 }];
    const [response] = await speechClient.recognize({ audio: { content }, config }, { timeout: timeoutMs });
    const results = response.results || [];
    const transcript = results.map(r => r.alternatives?.[0]?.transcript || '').join(' ').trim();
    const conf = results.map(r => r.alternatives?.[0]?.confidence).filter(v => typeof v === 'number' && v > 0);
    return { transcript, confidence: conf.length ? conf.reduce((a, b) => a + b, 0) / conf.length : undefined };
  };
}

function claudeJudge(anthropicClient, { model = JUDGE_MODEL, effort = JUDGE_EFFORT, timeoutMs = 30000 } = {}) {
  return async ({ system, user, schema }) => {
    // Haiku 5.5 has no server-side refusal fallback, so no `fallbacks` parameter;
    // a refusal is handled below as "checker unavailable" (the child is never blamed).
    const response = await anthropicClient.messages.create({
      model,
      max_tokens: 8000, // thinking counts toward this; leave room before the JSON answer
      output_config: { effort, format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }]
    }, { timeout: timeoutMs, maxRetries: 1 });
    if (response.stop_reason === 'refusal') throw Object.assign(new Error('Checker declined'), { code: 'judge_refusal' });
    if (response.stop_reason === 'max_tokens') throw Object.assign(new Error('Checker ran out of room'), { code: 'judge_invalid' });
    // Read text blocks by type: the response can start with thinking blocks.
    const text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let json;
    try { json = JSON.parse(text); } catch (_) { throw Object.assign(new Error('Checker returned unreadable output'), { code: 'judge_invalid' }); }
    return { json, usage: { inputTokens: response.usage?.input_tokens || 0, outputTokens: response.usage?.output_tokens || 0 } };
  };
}

module.exports = { decodeWithFfmpeg, googleRecognizer, claudeJudge, MAX_SEGMENT_SECONDS, JUDGE_MODEL, JUDGE_EFFORT };
