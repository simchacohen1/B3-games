'use strict';
/**
 * Service adapters for the Chazara AI Practice pipeline. No paid AI services.
 * Loaded only by the deployed Cloud Function and the offline evaluation script;
 * unit tests inject fakes instead.
 *
 *  - decode:    ffmpeg (bundled ffmpeg-static) -> 16 kHz mono 16-bit PCM, in memory
 *  - recognize: open-source Whisper running locally inside the function
 *               (transformers.js + ONNX Runtime). No per-request fee; the model is
 *               downloaded once per function instance and kept in memory.
 * Audio is never written to Storage or the database.
 */
const { spawn } = require('node:child_process');
const { pcmFromBuffer } = require('./audio-signal.cjs');

const MAX_SEGMENT_SECONDS = 62;
// Multilingual Whisper "small" (Hebrew + Yiddish capable), 8-bit quantised for CPU.
// Change without a code edit via environment variables, e.g. Xenova/whisper-base for speed.
const WHISPER_MODEL = process.env.CHAZARA_AI_WHISPER_MODEL || 'Xenova/whisper-small';
const WHISPER_DTYPE = process.env.CHAZARA_AI_WHISPER_DTYPE || 'q8';
const LANGUAGES = { he: 'hebrew', en: 'english', yi: 'yiddish' };

// Phrases Whisper is known to invent on near-silent or noisy audio (from its subtitle training data).
const HALLUCINATIONS = [/תודה רבה\.?$/u, /תודה שצפיתם/u, /כתוביות/u, /thanks? for watching/i, /subtitles? by/i, /^\s*\.+\s*$/];

function cleanTranscript(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  for (const re of HALLUCINATIONS) t = t.replace(re, '').trim();
  return t;
}

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

/**
 * Local Whisper recognizer. `loadPipeline` is injectable for tests; by default it
 * lazily imports transformers.js (ESM) and builds the pipeline once per instance.
 */
function whisperRecognizer({ model = WHISPER_MODEL, dtype = WHISPER_DTYPE, cacheDir = process.env.CHAZARA_AI_MODEL_CACHE || '/tmp/chazara-ai-models', loadPipeline } = {}) {
  let asrPromise = null;
  const load = loadPipeline || (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = cacheDir;
    return pipeline('automatic-speech-recognition', model, { dtype });
  });
  return async ({ pcm, sampleRate, language }) => {
    if (sampleRate !== 16000) throw new Error('Whisper needs 16 kHz audio');
    if (!asrPromise) asrPromise = load().catch(e => { asrPromise = null; throw e; });
    const asr = await asrPromise;
    const audio = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) audio[i] = pcm[i] / 32768;
    const out = await asr(audio, { language: LANGUAGES[language] || 'hebrew', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    return { transcript: cleanTranscript(Array.isArray(out) ? out.map(o => o.text).join(' ') : out && out.text) };
  };
}

module.exports = { decodeWithFfmpeg, whisperRecognizer, cleanTranscript, MAX_SEGMENT_SECONDS, WHISPER_MODEL, WHISPER_DTYPE };
