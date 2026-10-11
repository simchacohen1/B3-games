(function () {
  'use strict';
  const button = document.getElementById('blankMarkProbe');
  const status = document.getElementById('blankMarkProbeStatus');
  if (!button || !status) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Inspecting New Mark form without saving…';
    try {
      if (!window.NigriAuth || !(await window.NigriAuth.getToken())) {
        status.textContent = 'Sign in to your Fun Torah Tools owner account first.';
        return;
      }
      const {response} = await window.NigriAuth.request('/classtime/nigri-blank-mark-probe', {method:'POST'});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        status.textContent = 'Read-only inspection unavailable (HTTP ' + response.status + ').';
        return;
      }
      const result = data.blank_form || {};
      if (result.status === 'blank_form_found') {
        status.textContent = 'New Mark form located. Fields: ' +
          (result.field_names || []).join(', ') + '. No mark created or saved.';
      } else if (result.status === 'blank_form_unconfirmed') {
        status.textContent = 'The page opened but a blank New Mark form could not be confirmed. No marks changed.';
      } else if (result.status === 'blank_form_get_not_200') {
        status.textContent = 'The form request returned HTTP ' + result.http_status + '. Redirects were not followed.';
      } else {
        status.textContent = 'Inspection stopped safely (' + String(result.status || data.status || 'unknown') + '). No marks changed.';
      }
    } catch (_) {
      status.textContent = 'Could not complete the read-only inspection.';
    } finally {
      button.disabled = false;
    }
  });
})();
