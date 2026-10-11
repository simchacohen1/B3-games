/* Read-only Nigri HTTP diagnostic. Sends no student records or marks. */
(function () {
  'use strict';
  const button = document.getElementById('httpProbe');
  const status = document.getElementById('httpProbeStatus');
  if (!button || !status) return;

  const messages = {
    marks_listing_found: 'Browser-free Nigri sign-in worked, and the marks listing was found. No marks were changed.',
    marks_page_unconfirmed: 'Nigri replied, but its marks listing could not yet be identified. No marks were changed.',
    login_not_accepted: 'Nigri did not accept the browser-free login. No marks were changed.',
    login_form_not_found: 'Nigri’s login form has a different structure than expected. No marks were changed.',
    unsupported_login_method: 'Nigri uses an unexpected login method. No marks were changed.',
    credentials_missing: 'Nigri credentials are not configured on the server.',
    probe_stopped: 'The read-only check stopped safely. No marks were changed.'
  };

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Checking Nigri using HTTP (no browser)…';
    try {
      if (!window.NigriAuth || !(await window.NigriAuth.getToken())) {
        status.textContent = 'Sign in to your owner account first.';
        return;
      }
      const {response} = await window.NigriAuth.request('/classtime/nigri-http-probe', {method: 'POST'});
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        status.textContent = 'Owner Google sign-in was refused.';
      } else if (!response.ok) {
        status.textContent = 'Nigri check unavailable (HTTP ' + response.status + '). No marks were changed.';
      } else {
        status.textContent = messages[data.status] || 'Nigri reported: ' + String(data.status || 'unknown') + '. No marks were changed.';
      }
    } catch (error) {
      status.textContent = 'Could not contact the NigriSync server. No marks were changed.';
    } finally {
      button.disabled = false;
    }
  });
})();
