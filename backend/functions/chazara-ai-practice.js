'use strict';
// Chazara AI Practice endpoint (production project). Not deployed until the owner approves.
// The service is OFF until the owner sets b3Private/chazaraAiPractice/config/enabled = true.
// No paid AI services: speech is recognised by an open-source Whisper model running
// inside this function. No API keys or secrets are needed.
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { ALLOWED_ORIGINS } = require('./paid-api');
const { createHandler } = require('./chazara-ai/http.cjs');
const { decodeWithFfmpeg, whisperRecognizer } = require('./chazara-ai/providers.cjs');

if (!admin.apps.length) admin.initializeApp();

let providers = null; // one Whisper model per instance, loaded on first use
const handler = createHandler({
  admin,
  allowedOrigin: origin => ALLOWED_ORIGINS.includes(origin),
  getProviders: () => providers || (providers = {
    decode: decodeWithFfmpeg(require('ffmpeg-static')),
    recognize: whisperRecognizer()
  })
});

// Whisper is CPU-bound: one check per instance at a time, 2 vCPU, room for the model in memory.
exports.chazaraAiPractice = onRequest({
  region: 'us-central1', memory: '4GiB', cpu: 2, timeoutSeconds: 300, maxInstances: 5, concurrency: 1
}, handler);
