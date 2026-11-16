'use strict';
// Hourly job: sends Student Rewards points to SOLS Tokens. It does nothing unless the owner
// turns it on at b3Private/solsTokensSync/config (enabled: true; optional classNames: [...];
// optional dryRun: true to run every SOLS Tokens check without saving anything there).
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const core = require('./sols-tokens-sync-core.cjs');
if (!admin.apps.length) admin.initializeApp();

const SOLS_TOKENS_KEY = defineSecret('SOLS_TOKENS_KEY');
const SOLS_URL = 'https://solstokens.netlify.app/api/integrations/points';
const CONFIG_PATH = 'b3Private/solsTokensSync/config';
const GAP_MS = 2200; // SOLS Tokens allows 30 requests a minute

const sleep = ms => new Promise(r => setTimeout(r, ms));

// db: firebase-admin database. send: async (batch, dryRun) => {status, body}.
async function runSync({ db, send, classNames = null, dryRun = false, preview = false, log = console, sleepFn = sleep }) {
  const [rootSnap, sentSnap] = await Promise.all([db.ref('studentRewards').get(), db.ref(core.STATE_PATH).get()]);
  const points = core.collectPoints(rootSnap.val() || {}, { classNames });
  const todo = core.pointsToSend(points, sentSnap.val() || {});
  const summary = { found: points.length, toSend: todo.length, batches: 0, applied: 0, unchanged: 0, held: 0, rejected: 0, failedBatches: 0, preview };
  if (preview || !todo.length) return summary;
  for (const batch of core.toBatches(todo)) {
    if (summary.batches) await sleepFn(GAP_MS);
    summary.batches++;
    let res;
    try { res = await send(batch, dryRun); } catch (e) { summary.failedBatches++; log.warn('SOLS Tokens send failed', e.message); continue; }
    if (res.status === 429) { await sleepFn(60000); summary.failedBatches++; continue; }
    if (res.status !== 200 || !res.body?.ok) { summary.failedBatches++; log.warn('SOLS Tokens refused a batch', res.status); if ([401, 403].includes(res.status)) break; continue; }
    const c = res.body.counts || {};
    for (const k of ['applied', 'unchanged', 'held', 'rejected']) summary[k] += Number(c[k]) || 0;
    const { updates, rejected } = core.sentUpdatesFromReply(batch, res.body);
    if (!dryRun && Object.keys(updates).length) await db.ref(core.STATE_PATH).update(updates);
    for (const r of rejected) log.warn('SOLS Tokens rejected a point', r.point_id, JSON.stringify(r.detail));
  }
  return summary;
}

function makeSend(key) {
  return async (points, dryRun) => {
    const resp = await fetch(SOLS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(dryRun ? { points, dry_run: true } : { points }),
    });
    return { status: resp.status, body: await resp.json().catch(() => null) };
  };
}

exports.solsTokensSync = onSchedule({
  schedule: 'every 60 minutes', region: 'us-central1', maxInstances: 1, timeoutSeconds: 540, memory: '512MiB', secrets: [SOLS_TOKENS_KEY],
}, async () => {
  const db = admin.database();
  const cfg = (await db.ref(CONFIG_PATH).get()).val() || {};
  if (cfg.enabled !== true) return;
  const classNames = Array.isArray(cfg.classNames) && cfg.classNames.length ? cfg.classNames : null;
  const summary = await runSync({ db, send: makeSend(SOLS_TOKENS_KEY.value()), classNames, dryRun: cfg.dryRun === true });
  await db.ref(`${CONFIG_PATH}/lastRun`).set({ at: Date.now(), dryRun: cfg.dryRun === true, ...summary });
  console.info('SOLS Tokens sync', JSON.stringify(summary));
});

exports._runSync = runSync;
exports._makeSend = makeSend;
