/* Read-only Nigri HTTP diagnostic. Sends no student records or marks. */
(function () {
  'use strict';
  const button = document.getElementById('httpProbe');
  const status = document.getElementById('httpProbeStatus');
  if (!button || !status) return;

  const messages = {
    hybrid_marks_found: 'Success: Nigri was accessed using a brief browser sign-in followed by HTTP. The browser was closed before School Marks was read. No grades were changed.',
    hybrid_marks_unconfirmed: 'The browser sign-in completed, but the HTTP marks page was not confirmed. No grades were changed.',
    hybrid_starting_browser_stopped: 'The browser could not start safely. No grades were changed.',
    hybrid_browser_signin_stopped: 'The short browser sign-in failed or stopped safely. No grades were changed.',
    hybrid_http_marks_stopped: 'The short browser sign-in completed, but the HTTP marks check stopped. No grades were changed.',
    hybrid_stopped_by_memory_guard: 'Render stopped the read-only test to protect memory. No grades were changed.',
    credentials_missing: 'Nigri credentials are not configured on the server.'
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Checking a short Nigri browser login, then HTTP…';
    try {
      if (!window.NigriAuth || !(await window.NigriAuth.getToken())) {
        status.textContent = 'Sign in to your owner account first.';
        return;
      }
      const {response} = await window.NigriAuth.request('/classtime/nigri-hybrid-probe', {method: 'POST'});
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        status.textContent = 'Owner Google sign-in was refused.';
      } else if (!response.ok) {
        status.textContent = 'Nigri check unavailable (HTTP ' + response.status + '). No marks were changed.';
      } else {
        const base = messages[data.status] || 'Nigri check returned: ' + String(data.status || 'unknown') + '. No grades were changed.';
        status.textContent = base;
        if (data.status === 'hybrid_marks_unconfirmed') {
          status.textContent += data.cookies_sent_to_marks
            ? ' The login cookies were sent, but School Marks did not show the expected controls.'
            : ' The browser login did not produce cookies usable for the HTTP marks page.';
        }
      }
    } catch (error) {
      status.textContent = 'Could not contact the NigriSync server. No marks were changed.';
    } finally {
      button.disabled = false;
    }
  });
})();
