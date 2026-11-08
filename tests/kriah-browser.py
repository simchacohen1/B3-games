"""Fictional local browser journey; no Firebase, real accounts or recordings.
Run: python tests/kriah-browser.py (requires Playwright + Chromium).
"""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results' / 'kriah'
OUT.mkdir(parents=True, exist_ok=True)
PORT = 8876
URL = f'http://127.0.0.1:{PORT}/kriah-assessment/index.html?fixture=1'
server = subprocess.Popen(['node', 'scripts/kriah-fixture.cjs'], cwd=ROOT, env={**os.environ, 'KRIAH_FIXTURE_PORT': str(PORT)}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
errors = []
try:
    for _ in range(50):
        try:
            urllib.request.urlopen(URL, timeout=1)
            break
        except Exception:
            time.sleep(.1)
    with sync_playwright() as p:
        args = ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
        launch = {'headless': True, 'args': args}
        if os.environ.get('KRIAH_CHROMIUM_PATH'):
            launch['executable_path'] = os.environ['KRIAH_CHROMIUM_PATH']
        browser = p.chromium.launch(**launch)
        context = browser.new_context(permissions=['microphone'], viewport={'width': 1280, 'height': 900})
        context.route('https://www.gstatic.com/**', lambda route: route.fulfill(status=200, body='/* Firebase is intentionally absent in local fixture mode. */'))
        def page():
            result = context.new_page()
            result.on('pageerror', lambda error: errors.append(str(error)))
            result.on('dialog', lambda dialog: dialog.accept())
            result.goto(URL)
            expect(result.locator('#classSelect')).to_have_value('kriah-test-et')
            expect(result.locator('#status')).to_contain_text('Loaded')
            return result
        teacher = page()
        teacher.get_by_role('button', name='Library & assignments', exact=True).click()
        teacher.locator('.card').get_by_role('button', name='Assign', exact=True).click()
        teacher.locator('#assignStudents input').check()
        teacher.get_by_role('button', name='Assign to selected students', exact=True).click()
        expect(teacher.locator('#status')).to_contain_text('Assigned to 1')
        # Editable library: explicit custom levels and Unicode text.
        teacher.get_by_role('button', name='+ New exercise', exact=True).click()
        teacher.locator('#title').fill('Fictional syllable check')
        teacher.locator('#level').fill('Our class stage 2')
        teacher.locator('#type').select_option('Syllables')
        teacher.locator('#unitType').select_option('nekudah')
        teacher.locator('#hebrew').fill('בְּ בָּ מֶלֶךְ׃')
        teacher.get_by_role('button', name='Save exercise', exact=True).click()
        expect(teacher.locator('#status')).to_contain_text('Exercise saved')
        expect(teacher.locator('.card')).to_have_count(2)
        student = page()
        student.locator('#actor').select_option('studentA')
        expect(student.locator('#studentLabel')).to_be_hidden()
        student.get_by_role('button', name='Open assessment', exact=True).click()
        student.locator('#assessment input[type=checkbox]').check()
        student.get_by_role('button', name='Record reading', exact=True).click()
        expect(student.locator('#recordTimer')).to_contain_text('Recording')
        student.wait_for_timeout(1400)  # Real fake-device samples, not fabricated audio bytes.
        student.get_by_role('button', name='Stop recording', exact=True).click()
        expect(student.locator('#status')).to_contain_text('saved on this device')
        # Page interruption: recover original Blob from IndexedDB.
        student.reload()
        student.locator('#actor').select_option('studentA')
        student.get_by_role('button', name='Open assessment', exact=True).click()
        expect(student.locator('#recordTimer')).to_contain_text('Recovered an unsent recording')
        student.locator('#assessment input[type=checkbox]').check()
        failed = [False]
        def upload_outage(route):
            body = route.request.post_data_json
            if body.get('action') == 'submit' and not failed[0]:
                failed[0] = True
                route.fulfill(status=503, content_type='application/json', body=json.dumps({'error': 'Fictional upload outage. Retry.'}))
            else:
                route.continue_()
        student.route('**/api/kriah', upload_outage)
        student.get_by_role('button', name='Submit recording', exact=True).click()
        expect(student.locator('#status')).to_contain_text('Fictional upload outage')
        student.get_by_role('button', name='Submit recording', exact=True).click()
        expect(student.locator('#status')).to_contain_text('Recording submitted')
        teacher.get_by_role('button', name='Refresh', exact=True).click()
        teacher.get_by_role('button', name='Open assessment', exact=True).click()
        teacher.get_by_role('button', name='Load original recording', exact=True).click()
        expect(teacher.locator('#status')).to_contain_text('Original recording loaded')
        teacher.locator('[data-cluster="0"]').click()
        teacher.locator('#markTarget').select_option('n:0:1464')
        teacher.locator('#category').select_option('wrong-vowel')
        teacher.locator('#markNote').fill('Fictional kamatz observation')
        teacher.get_by_role('button', name='Apply mark to selected unit(s)', exact=True).click()
        expect(teacher.locator('#markList')).to_contain_text('Kamatz')
        # A span crosses logical positions in RTL; mark two letters then undo.
        teacher.locator('[data-cluster="1"]').click(modifiers=['Shift'])
        teacher.locator('#markTarget').select_option('span:letter')
        teacher.locator('#category').select_option('correct')
        teacher.get_by_role('button', name='Apply mark to selected unit(s)', exact=True).click()
        expect(teacher.locator('#markList li')).to_have_count(3)
        teacher.get_by_role('button', name='Undo last marking change', exact=True).click()
        expect(teacher.locator('#markList li')).to_have_count(1)
        teacher.locator('#markTarget').select_option('span:letter')
        teacher.get_by_role('button', name='Apply mark to selected unit(s)', exact=True).click()
        teacher.locator('#feedback').fill('Listen again to this kamatz.')
        teacher.locator('#recommendation').fill('Practise the two marked syllables.')
        teacher.locator('#shareFeedback').check()
        teacher.get_by_role('button', name='Save draft', exact=True).click()
        expect(teacher.locator('#status')).to_contain_text('draft saved to the server')
        teacher.get_by_role('button', name='Finalize assessment', exact=True).click()
        expect(teacher.locator('#status')).to_contain_text('Final assessment saved')
        teacher.screenshot(path=str(OUT / 'teacher-marking.png'), full_page=True)
        teacher.get_by_role('button', name='Progress reports', exact=True).click()
        expect(teacher.locator('#reportBody')).to_contain_text('Kamatz')
        expect(teacher.locator('#reportBody')).to_contain_text('Needs practice')
        expect(teacher.locator('#reportBody')).to_contain_text('Not assessed')
        teacher.get_by_role('button', name='Load class summary (latest 25 per student)', exact=True).click()
        expect(teacher.locator('#reportBody')).to_contain_text('Student Alef (fictional)')
        teacher.screenshot(path=str(OUT / 'progress-report.png'), full_page=True)
        teacher.set_viewport_size({'width': 390, 'height': 844})
        assert teacher.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Page overflows phone width'
        teacher.screenshot(path=str(OUT / 'mobile-report.png'), full_page=True)
        teacher.pdf(path=str(OUT / 'fictional-report.pdf'), print_background=True)
        student.get_by_role('button', name='Refresh', exact=True).click()
        student.get_by_role('button', name='Open assessment', exact=True).click()
        expect(student.locator('#assessment')).to_contain_text('Listen again to this kamatz.')
        student.get_by_role('button', name='Start a new attempt', exact=True).click()
        expect(student.locator('#recordTimer')).to_be_visible()
        # Mic denial remains recoverable, with no uploaded data.
        student.evaluate("navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error('Denied'), {name:'NotAllowedError'}); }")
        student.locator('#assessment input[type=checkbox]').check()
        student.get_by_role('button', name='Record reading', exact=True).click()
        expect(student.locator('#status')).to_contain_text('Microphone permission was denied')
        expect(student.get_by_role('button', name='Record reading', exact=True)).to_be_enabled()
        # Server privacy is checked through direct calls, not hidden UI controls.
        listed = context.request.post(f'http://127.0.0.1:{PORT}/api/kriah', headers={'X-Kriah-Fixture-Actor': 'studentA'}, data={'action': 'list', 'classId': 'kriah-test-et', 'studentId': 'fictional-alef'}).json()
        rid = listed['records'][0]['id']
        for actor in ['teacherB', 'studentB']:
            response = context.request.post(f'http://127.0.0.1:{PORT}/api/kriah', headers={'X-Kriah-Fixture-Actor': actor}, data={'action': 'get', 'classId': 'kriah-test-et', 'studentId': 'fictional-alef', 'id': rid})
            assert response.status == 403
        teacher.locator('#actor').select_option('teacherB')
        expect(teacher.locator('#classSelect')).to_have_value('kriah-test-wt')
        expect(teacher.locator('#attemptList')).to_contain_text('No assessments assigned yet')
        assert not errors, errors
        browser.close()
        print('PASS: assign, edit library, record fake microphone, IndexedDB recovery, failed upload retry, original playback, letter/nekudah/span marks, undo, save/finalize, student feedback, reports, mobile layout, PDF, mic denial, direct cross-class denial.')
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
