'use strict';
/**
 * OpenAI speech-to-text adapter for Chazara AI Practice (gpt-4o-mini-transcribe).
 * Loaded by the deployed Cloud Function and the offline evaluation script; unit
 * tests inject a fake instead. The audio clip is sent once and not stored.
 */
const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TRANSCRIBE_MODEL = process.env.CHAZARA_AI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const EXT = { webm: 'webm', ogg: 'ogg', mp4: 'mp4', 'x-m4a': 'm4a', aac: 'm4a', mpeg: 'mp3', wav: 'wav', 'x-wav': 'wav' };

function extFor(mimeType) {
  const sub = String(mimeType || '').toLowerCase().split(';')[0].split('/')[1] || 'webm';
  return EXT[sub] || 'webm';
}

/**
 * @param {object} opts
 * @param {() => string} opts.apiKey   read lazily (Secret Manager value)
 * @param {typeof fetch} [opts.fetchImpl]
 */
function openaiTranscriber({ apiKey, fetchImpl = fetch, model = TRANSCRIBE_MODEL, timeoutMs = 30000 } = {}) {
  return async ({ buffer, mimeType }) => {
    const form = new FormData();
    form.append('model', model);
    form.append('response_format', 'json');
    // No language is set: children mix Hebrew, English and Yiddish, and any real words count.
    form.append('file', new Blob([buffer], { type: String(mimeType || 'audio/webm').split(';')[0] }), 'pasuk.' + extFor(mimeType));
    const res = await fetchImpl(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey() },
      body: form,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(new Error('Transcription failed (HTTP ' + res.status + ')'), { code: 'transcribe_failed', status: res.status, detail: detail.slice(0, 200) });
    }
    const data = await res.json();
    const usage = data && data.usage;
    return { text: String((data && data.text) || ''), seconds: usage && usage.type === 'duration' && typeof usage.seconds === 'number' ? usage.seconds : undefined };
  };
}

module.exports = { openaiTranscriber, extFor, TRANSCRIBE_URL, TRANSCRIBE_MODEL };
