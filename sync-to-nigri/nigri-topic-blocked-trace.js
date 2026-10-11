(function () {
  'use strict';
  const button = document.getElementById('blockedTopicTrace');
  const status = document.getElementById('blockedTopicTraceStatus');
  if (!button || !status) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Inspecting the class-change request with all refresh traffic blocked…';
    try {
      if (!window.NigriAuth || !(await window.NigriAuth.getToken())) {
        status.textContent = 'Please sign in to the Fun Torah Tools owner account.';
        return;
      }
      const {response} = await window.NigriAuth.request(
        '/classtime/nigri-topic-blocked-trace', {method:'POST'}
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        status.textContent = 'Blocked trace unavailable (HTTP ' + response.status + ').';
        return;
      }
      if (data.status === 'requests_blocked_and_class_change_inspected' &&
          data.all_change_requests_blocked === true &&
          data.nigri_writes === false) {
        const kinds = Array.isArray(data.attempted_methods)
          ? data.attempted_methods.filter(x => ['GET', 'POST', 'OTHER'].includes(x)) : [];
        const methodText = kinds.length ? kinds.join(' and ') : 'none observed';
        status.textContent = 'Safety trace complete: ' +
          Number(data.attempted_request_count_capped || 0) +
          ' request attempts intercepted; methods ' + methodText + '; ' +
          (data.post_blocked ? 'a POST was blocked; ' : '') +
          (data.attempted_xhr_or_fetch ? 'AJAX/fetch detected; ' : '') +
          'every class-change request was blocked. No mark created or saved. ' +
          'Shoroshim after an actual refresh is STILL unverified.';
      } else if (data.status === 'insufficient_memory' ||
                 data.status === 'insufficient_memory_after_login' ||
                 data.status === 'insufficient_memory_after_form' ||
                 data.status === 'trace_stopped_by_memory_guard_or_timeout') {
        status.textContent = 'The trace stopped to protect Render memory. Do not retry repeatedly. No grades changed.';
      } else {
        status.textContent = 'Trace stopped safely (' + String(data.status || 'unknown') +
          '). No grades changed, and the refreshed topic remains unverified.';
      }
    } catch (_) {
      status.textContent = 'Blocked trace could not be completed. No grades changed.';
    } finally {
      button.disabled = false;
    }
  });
})();