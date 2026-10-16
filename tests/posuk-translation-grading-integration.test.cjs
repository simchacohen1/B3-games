'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const indexPath = path.join(__dirname, '../backend/functions/index.js');

function createHarness({ transcript, alternatives, speechError, modelText, modelStatus = 200 }) {
  let handler;
  let anthropicRequest;
  let speechCalls = 0;

  function mockBusboy({ headers }) {
    const emitter = new EventEmitter();
    emitter.end = rawBody => {
      const boundary = /boundary=([^;]+)/i.exec(headers['content-type'])[1];
      const parts = rawBody.toString('utf8').split(`--${boundary}`).slice(1, -1);
      const fileStreams = [];
      for (const part of parts) {
        const item = part.replace(/^\r\n|\r\n$/g, '');
        const splitAt = item.indexOf('\r\n\r\n');
        const partHeaders = item.slice(0, splitAt);
        const value = item.slice(splitAt + 4).replace(/\r\n$/, '');
        const disposition = /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(partHeaders);
        if (!disposition) continue;
        const [, name, filename] = disposition;
        if (filename !== undefined) {
          const stream = Readable.from([Buffer.from(value)]);
          fileStreams.push(stream);
          emitter.emit('file', name, stream, { filename });
        } else {
          emitter.emit('field', name, value, {});
        }
      }
      Promise.all(fileStreams.map(stream => new Promise(resolve => stream.once('end', resolve))))
        .then(() => emitter.emit('finish'));
      for (const stream of fileStreams) stream.resume();
    };
    return emitter;
  }

  const ffmpeg = () => {
    const chain = {
      duration() { return chain; }, audioChannels() { return chain; },
      audioFrequency() { return chain; }, audioCodec() { return chain; },
      format() { return chain; }, on(event, callback) { if (event === 'end') chain.onEnd = callback; return chain; },
      save(outputPath) {
        fs.writeFileSync(outputPath, Buffer.from('mock wav'));
        process.nextTick(() => chain.onEnd && chain.onEnd());
        return chain;
      },
    };
    return chain;
  };
  ffmpeg.setFfmpegPath = () => {};

  const mockRequire = id => {
    if (id === 'firebase-functions/v2/https') return { onRequest: (_options, fn) => fn };
    if (id === 'firebase-functions/params') return { defineSecret: () => ({ value: () => 'test-secret' }) };
    if (id === './paid-api') return { paidHandler: (_name, _category, fn) => fn, ALLOWED_ORIGINS: [] };
    if (id === '@google-cloud/text-to-speech') return { TextToSpeechClient: class {} };
    if (id === '@google-cloud/speech') return { SpeechClient: class { async recognize() {
      speechCalls++;
      if (speechError) throw speechError;
      return [{ results: transcript === '' ? [] : [{ alternatives: alternatives || [{ transcript }] }] }];
    } } };
    if (id === 'busboy') return mockBusboy;
    if (id === 'ffmpeg-static') return 'mock-ffmpeg';
    if (id === 'fluent-ffmpeg') return ffmpeg;
    if (['fs', 'os', 'path'].includes(id)) return require(id);
    if (id.startsWith('./')) return {};
    throw new Error(`Unexpected dependency: ${id}`);
  };

  const module = { exports: {} };
  const source = fs.readFileSync(indexPath, 'utf8');
  const wrapper = vm.runInThisContext('(function (exports, require, module, __filename, __dirname, fetch) {' + source + '\n})', { filename: indexPath });
  const mockFetch = async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    anthropicRequest = JSON.parse(options.body);
    return {
      ok: modelStatus >= 200 && modelStatus < 300,
      status: modelStatus,
      text: async () => 'mock API failure',
      json: async () => ({ content: [{ type: 'text', text: modelText }] }),
    };
  };
  wrapper(module.exports, mockRequire, module, indexPath, path.dirname(indexPath), mockFetch);
  handler = module.exports.gradeTranslationChunk;
  assert.equal(typeof handler, 'function', 'real translation handler was not exported');

  return {
    get speechCalls() { return speechCalls; },
    get anthropicRequest() { return anthropicRequest; },
    async request(fields = {}) {
      const boundary = 'mock-boundary';
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.webm"\r\nContent-Type: audio/webm\r\n\r\nfake audio\r\n`,
        ...Object.entries({
          chunkHebrew: 'וַיֹּאמֶר אֵלָיו',
          acceptedTranslations: JSON.stringify(['and he said to him']),
          ...fields,
        }).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
        `--${boundary}--\r\n`,
      ];
      const req = {
        method: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        rawBody: Buffer.from(parts.join('')), body: {}, ip: '127.0.0.1',
        get: () => '',
      };
      const response = {
        statusCode: 200, headers: {}, headersSent: false,
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; this.headersSent = true; return this; },
        send(value) { this.body = value; this.headersSent = true; return this; },
      };
      await handler(req, response);
      return response;
    },
  };
}

test('mocked recognition and API return a correct translation with the actual transcript', async () => {
  const app = createHarness({ transcript: 'and he said to him', modelText: '{"verdict":"correct","feedback":"You got it!"}' });
  const response = await app.request();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { verdict: 'correct', feedback: 'You got it!', transcript: 'and he said to him' });
  assert.equal(app.speechCalls, 1);
  assert.match(app.anthropicRequest.messages[0].content, /What the student said.*and he said to him/s);
});

test('recognizer alternatives and name hints reach the grader as evidence', async () => {
  const app = createHarness({
    transcript: 'and he said to him',
    alternatives: [{ transcript: 'and he said to him' }, { transcript: 'and Avrohom said to him' }],
    modelText: '{"verdict":"correct","feedback":"Nice work!"}',
  });
  const response = await app.request({ acceptedTranslations: JSON.stringify(['and Avrohom said to him']) });
  assert.equal(response.statusCode, 200);
  const prompt = app.anthropicRequest.messages[0].content;
  assert.match(prompt, /Recognition evidence.*and Avrohom said to him/s);
  assert.match(prompt, /Name vocabulary hints.*Avrohom/s);
});

test('speech-recognition failure returns a retryable service error without an incorrect verdict', async () => {
  const app = createHarness({ transcript: '', speechError: new Error('mock recognizer unavailable'), modelText: '' });
  const response = await app.request();
  assert.equal(response.statusCode, 502);
  assert.match(response.body.error, /Could not understand the recording/);
  assert.equal(response.body.verdict, undefined);
  assert.equal(app.speechCalls, 1);
});

test('empty recognition returns no_speech and does not call the grading API', async () => {
  const app = createHarness({ transcript: '', modelText: '' });
  const response = await app.request();
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { verdict: 'no_speech', transcript: '' });
  assert.equal(app.anthropicRequest, undefined);
});

test('invalid model verdict is rejected instead of being returned as a grade', async () => {
  const app = createHarness({ transcript: 'and he said to him', modelText: '{"verdict":"partial","feedback":"Almost!"}' });
  const response = await app.request();
  assert.equal(response.statusCode, 502);
  assert.match(response.body.error, /Unexpected grading result/);
  assert.equal(response.body.verdict, undefined);
});
