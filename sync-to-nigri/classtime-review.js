(() => {
  'use strict';
  const base = 'https://nigrisync.onrender.com';
  const $ = id => document.getElementById(id);
  const auth = firebase.initializeApp(window.B3_FIREBASE_CONFIG).auth();
  let user = null, loading = false, generation = 0;
  const urls = [];
  function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
  function clearReview() { urls.splice(0).forEach(URL.revokeObjectURL); $('review').hidden = true; $('students').replaceChildren(); }
  async function api(path, options = {}) {
    if (!user) throw new Error('Please sign in with your owner account.');
    const response = await fetch(base + path, { ...options, headers: { 'Authorization': 'Bearer ' + await user.getIdToken(), ...(options.body ? {'Content-Type': 'application/json'} : {}) }, cache: 'no-store' });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('This review is available only to the Fun Torah Tools owner account.');
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Could not load the review. Please try again.');
    }
    return response;
  }
  function cell(row, text, className) { const td = document.createElement('td'); td.textContent = text; if (className) td.className = className; row.append(td); return td; }
  function render(result, id) {
    $('title').textContent = result.session_name;
    $('identity').textContent = `Session ${result.session_code} · ${result.class_section} · Retrieved ${new Date(result.retrieved_at).toLocaleString()}`;
    const mapped = result.students.filter(s => s.nigri).length;
    const verified = result.students.filter(s => s.pdf_status === 'verified').length;
    $('summary').replaceChildren();
    [`${result.students.length} students`, `${mapped}/${result.students.length} matched`, `${verified}/${result.students.length} PDFs verified`].forEach(text => { const e = document.createElement('span'); e.className = 'pill'; e.textContent = text; $('summary').append(e); });
    for (const student of result.students) {
      const row = document.createElement('tr');
      cell(row, student.classtime_name);
      cell(row, student.nigri ? `${student.nigri.name} · ${student.nigri.class_section}` : 'Needs matching', student.nigri ? 'good' : 'warn');
      cell(row, student.points === null ? 'No score shown' : `${student.points} / ${student.maximum_points}`);
      cell(row, student.percentage === null ? '—' : `${student.percentage}%`);
      const pdf = cell(row, student.pdf_status === 'verified' ? 'Verified · ' : (student.pdf_detail || 'Report unavailable'), student.pdf_status === 'verified' ? 'good' : 'warn');
      if (student.pdf_status === 'verified') {
        const button = document.createElement('button'); button.textContent = 'View PDF'; button.className = 'small';
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const response = await api(`/classtime/reviews/${id}/pdfs/${student.pdf_id}`);
            const url = URL.createObjectURL(await response.blob()); urls.push(url);
            const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Open PDF';
            pdf.append(' ', link); link.click(); button.remove();
          } catch (error) { status(error.message, true); button.disabled = false; }
        }); pdf.append(button);
      }
      $('students').append(row);
    }
    $('review').hidden = false;
    status(verified === result.students.length && mapped === result.students.length ? 'Review ready. All student matches and PDF identities verified.' : 'Review loaded. Check any students with missing matches or reports.');
  }
  auth.onAuthStateChanged(current => {
    user = current; generation++; clearReview();
    $('login').hidden = Boolean(current); $('load').disabled = !current || loading;
    status(current ? 'Signed in. Load the session to review its grades and PDFs.' : 'Sign in with your Fun Torah Tools owner account.');
  });
  $('login').addEventListener('click', () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(error => status(error.message, true)));
  $('load').addEventListener('click', async () => {
    const code = $('session').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { status('Enter a six-character Classtime session code.', true); return; }
    loading = true; $('load').disabled = true; $('cls').disabled = true; $('session').disabled = true; clearReview(); const current = generation;
    try {
      status('Retrieving grades and student reports… This can take a few minutes.');
      const {review_id: id} = await (await api('/classtime/reviews', {method: 'POST', body: JSON.stringify({session_code: code, class_section: $('cls').value})})).json();
      for (let i = 0; i < 120; i++) {
        if (generation !== current) return;
        const job = await (await api(`/classtime/reviews/${id}`)).json();
        if (job.status === 'ready') { render(job.result, id); return; }
        if (job.status === 'error') throw new Error(job.detail);
        status(job.detail || 'Retrieving student reports…');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      throw new Error('Report retrieval is taking too long. Please reload the review.');
    } catch (error) { status(error.message, true); }
    finally { loading = false; $('load').disabled = !user; $('cls').disabled = false; $('session').disabled = false; }
  });
  window.addEventListener('beforeunload', () => urls.forEach(URL.revokeObjectURL));
})();
