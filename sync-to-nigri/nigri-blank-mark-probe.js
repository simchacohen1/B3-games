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
      } else if (result.link_diagnostics) {
        const d = result.link_diagnostics;
        const flags = [];
        if (d.link_kind) flags.push('Link type: ' + d.link_kind);
        if (typeof d.expected_asp_path === 'boolean') flags.push('Expected page: ' + (d.expected_asp_path ? 'yes' : 'no'));
        if (typeof d.section_is_teachers === 'boolean') flags.push('Teacher section: ' + (d.section_is_teachers ? 'yes' : 'no'));
        if (typeof d.tests_section_present === 'boolean') flags.push('Tests section: ' + (d.tests_section_present ? 'yes' : 'no'));
        if (Array.isArray(d.recognized_query_keys)) flags.push('Recognized parameters: ' + (d.recognized_query_keys.join(', ') || 'none'));
        if (typeof d.unknown_query_key_count === 'number') flags.push('Unrecognized parameters: ' + d.unknown_query_key_count);
        const safeNames = Array.isArray(d.safe_unknown_parameter_names) ? d.safe_unknown_parameter_names : [];
        if (safeNames.length) flags.push('Extra parameter names (values hidden): ' + safeNames.join(', '));
        if (d.redacted_parameter_name_count) flags.push('Other parameter names hidden: ' + d.redacted_parameter_name_count);
        if (typeof d.unsupported_action_key_count === 'number') flags.push('Unsafe/unknown actions: ' + d.unsupported_action_key_count);
        status.textContent = 'The New Mark link was not opened for safety. ' + flags.join('; ') + '. No marks changed.';
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
