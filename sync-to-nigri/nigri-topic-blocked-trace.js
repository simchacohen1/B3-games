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
      if ((data.status === 'requests_blocked_and_class_change_inspected' ||
           data.status === 'no_class_change_requests_observed') &&
          data.all_change_requests_blocked === true && data.nigri_writes === false) {
        const observed = Number(data.attempted_request_count_capped || 0);
        const methods = Array.isArray(data.attempted_methods)
          ? data.attempted_methods.filter(x => ['GET', 'POST', 'OTHER'].includes(x)) : [];
        const yesNo = flag => flag === true ? 'yes' : 'no';
        const before = Number(data.topic_options_initial_count || 0);
        const after = Number(data.topic_options_after_count || 0);
        let message = observed
          ? 'Blocked trace: ' + observed + ' attempted requests cancelled. Methods: ' +
             methods.join(' and ') + '. '
          : 'No class-change network requests were observed. GET versus POST is still unknown. ';
        message += 'Class-change event observed: ' + yesNo(data.change_event_observed) +
          '; B3 ET selected afterward: ' + yesNo(data.b3_et_selected_after) +
          '; Shoroshim remains in the local dropdown: ' +
          yesNo(data.shoroshim_present_after_blocked_change) +
          '; topic options before/after: ' + before + '/' + after +
          '; scripts blocked while opening form: ' +
          Number(data.blocked_scripts_before_change || 0) +
          '; script errors observed: ' + Number(data.script_errors_seen_capped || 0) +
          '. The server-refreshed Shoroshim list is NOT verified. No grades were changed.';
        status.textContent = message;
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