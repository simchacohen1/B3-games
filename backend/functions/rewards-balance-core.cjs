'use strict';
// The one safe way to change a student's Student Rewards point balance.
//
// Why this exists: several places used `transaction(cur => Number(cur || 0) + amount)`. A transaction can
// start from a value the server has not sent yet (shown as null). Treating that as 0 and committing it
// wrote a wrong balance (for example 122 points became -5 after a -5 charge on 2026-11-26).
//
// change() therefore:
//   1. reads the balance from the server first (`known`);
//   2. if the transaction starts from null while the server has a real number, it returns null so the database
//      retries with the real value (it never computes from a guess);
//   3. reports before / after / applied, so callers can save `balanceBefore` on the history record and any
//      mismatch is visible and logged (BALANCE_ANOMALY);
//   4. keeps the "do not take a balance below zero" rule without the old bug where a Math.max(0, ...) clamp
//      RAISED a negative balance (it handed out free points: -15 + 3 became 0, a +15 credit).
//
// `ref` is a Firebase Realtime Database reference; `adapter` form is {get(), tx(fn)} for code that wraps the
// database (tests, the cancel and teacher cores).
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function fromRef(ref) {
  return { get: async () => (await ref.get()).val(), tx: fn => ref.transaction(fn) };
}

// opts.clamp  : a NEGATIVE change never takes the balance below 0 (and never below where it already was if
//               it was already negative). Positive changes always add in full.
// opts.guard  : (oldBalance) => boolean. Return false to refuse (nothing is written); result.refused is true.
async function changeWith(adapter, delta, opts = {}) {
  delta = num(delta);
  const known = await adapter.get();
  let before = null, after = null, applied = 0, refused = false;
  const tx = await adapter.tx(cur => {
    if (cur === null && known !== null && known !== undefined) return null; // not loaded yet: retry with the real value
    const old = num(cur);
    if (opts.guard && !opts.guard(old)) { refused = true; return undefined; }
    let next = old + delta;
    if (opts.clamp && delta < 0) next = Math.max(Math.min(old, 0), next);
    before = old; after = next; applied = next - old; refused = false;
    return next;
  });
  const committed = !!(tx && tx.committed) && !refused;
  const value = tx && tx.snapshot && typeof tx.snapshot.val === 'function' ? tx.snapshot.val() : null;
  const finalAfter = committed ? num(value) : null;
  const knownNum = known === null || known === undefined ? null : num(known);
  // The server value we saw first and the value the change started from should agree unless someone else
  // changed the balance in between. A drop to 0 from a real balance is the signature of the old bug.
  const anomaly = committed && knownNum !== null && before !== null && before === 0 && knownNum > 0;
  if (anomaly) console.error('BALANCE_ANOMALY', JSON.stringify({ known: knownNum, before, delta, after: finalAfter }));
  return {
    committed, refused, before, applied, known: knownNum, anomaly,
    snapshot: { val: () => (committed ? finalAfter : value) },
    balanceAfter: finalAfter
  };
}

const change = (ref, delta, opts) => changeWith(fromRef(ref), delta, opts);

module.exports = { change, changeWith, fromRef };
