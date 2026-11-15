'use strict';
// RTDB may call the update function first with an uncached null, even when
// the record exists remotely. Return that unchanged value to let the server
// compare hashes and retry with authoritative data. Confirm semantic errors
// only after that comparison; never abort an existing-record update on the
// provisional null. No-op returns cannot overwrite a changed server record.
module.exports = async function change(ref, update) {
  let failure = null;
  const result = await ref.transaction(value => {
    failure = null;
    try { return update(value); }
    catch (error) { failure = error; return value; }
  }, undefined, false);
  if (failure) throw failure;
  if (!result.committed) throw Object.assign(new Error('Assessment changed. Try again.'), { code: 409 });
  return result.snapshot.val();
};
