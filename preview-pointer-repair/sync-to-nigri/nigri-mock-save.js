/* Entirely offline fictional save rehearsal. Never transmits student data to Nigri. */
(function () {
  'use strict';
  const button = document.getElementById('mockSaveSimulation');
  const status = document.getElementById('mockSaveSimulationStatus');
  if (!button || !status) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Preparing fictional score and PDF request bodies offline…';
    try {
      if (!window.NigriAuth || !(await window.NigriAuth.getToken())) {
        status.textContent = 'Sign in to the Fun Torah Tools owner account first.';
        return;
      }
      const {response} = await window.NigriAuth.request('/classtime/mock-save-simulation', {
        method: 'POST'
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        status.textContent = 'Owner sign-in was refused.';
      } else if (!response.ok) {
        status.textContent = 'Offline rehearsal unavailable (HTTP ' + response.status + ').';
      } else if (data.status === 'simulated_ok' &&
                 data.offline_only === true && data.nigri_contacted === false &&
                 data.nigri_writes === false && data.requests_sent === 0) {
        status.textContent = 'Mock rehearsal passed: ' + Number(data.simulated_students) +
          ' fictional students, ' + Number(data.simulated_scores) + ' scores, ' +
          Number(data.simulated_pdf_attachments) + ' generated PDFs; ' +
          Number(data.mock_request_bodies) + ' request bodies prepared, 0 requests sent. ' +
          'The live Nigri POST requirements are not verified. Grade saving remains disabled.';
      } else {
        status.textContent = 'The mock test did not provide an expected safe result. No Nigri grades were changed.';
      }
    } catch (_) {
      status.textContent = 'Could not reach the mock simulation endpoint.';
    } finally {
      button.disabled = false;
    }
  });
})();
