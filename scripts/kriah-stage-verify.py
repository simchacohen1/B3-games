"""Authenticated staging test with private, fictional-only credentials.
No traces, request headers, passwords or tokens are written to evidence.
"""
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request
import urllib.error
from playwright.sync_api import sync_playwright, expect

PROJECT = 'fun-torah-tools-staging'
if os.environ.get('GCLOUD_PROJECT') != PROJECT:
    raise RuntimeError('Explicit staging project required')
url = os.environ['KRIAH_PREVIEW_URL'].rstrip('/') + '/kriah-assessment/index.html'
if not url.startswith('https://fun-torah-tools-staging--kriah-624-') or '.web.app/' not in url:
    raise RuntimeError('Kriah staging preview required')
accounts = json.loads(Path(os.environ['KRIAH_CREDENTIALS_FILE']).read_text())
if accounts['projectId'] != PROJECT:
    raise RuntimeError('Wrong fixture project')
out = Path('.kriah-evidence')
out.mkdir(exist_ok=True)
endpoint = 'https://us-central1-' + PROJECT + '.cloudfunctions.net/kriahAssessment'
errors = []
traffic = []
assignment = {}

def admin_change(code):
    preamble = "const admin=require('./backend/kriah-staging/node_modules/firebase-admin');admin.initializeApp({projectId:'fun-torah-tools-staging',databaseURL:'https://fun-torah-tools-staging-default-rtdb.firebaseio.com'});"
    result = subprocess.run(['node', '-e', preamble + '(async()=>{' + code + ';await admin.app().delete()})().catch(e=>{console.error(e.code||e.message);process.exit(1)})'], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Synthetic fixture administration failed: ' + result.stderr[-500:])

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'])
    contexts = []
    def login(prefix):
        account = next(a for a in accounts['accounts'] if a['uid'] == prefix)
        context = browser.new_context(permissions=['microphone'], viewport={'width': 1280, 'height': 900})
        contexts.append(context)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('dialog', lambda d: d.accept())
        def response(r):
            if r.url != endpoint:
                return
            try:
                action = r.request.post_data_json.get('action')
                body = r.json()
                traffic.append({'action': action, 'status': r.status, 'bytes': len(r.body())})
                if action == 'assign' and r.status == 200:
                    assignment.update(body['assigned'][0])
            except Exception:
                pass
        page.on('response', response)
        page.goto(url)
        expect(page.locator('#fixtureLogin')).to_be_visible(timeout=30000)
        page.locator('#fixtureEmail').fill(account['email'])
        page.locator('#fixturePassword').fill(account['password'])
        page.get_by_role('button', name='Sign in to staging fixture', exact=True).click()
        expect(page.locator('#status')).to_contain_text('Loaded', timeout=45000)
        return page
    def direct(page, body):
        return page.evaluate("async body => {try {await KriahClient.call(body);return 200;}catch(e){return e.status||0;}}", body)

    teacher = login('kriah-fixture-teacher-et')
    expect(teacher.locator('#classSelect')).to_have_value('kriah-test-et')
    teacher.get_by_role('button', name='Library & assignments', exact=True).click()
    teacher.locator('.card').filter(has=teacher.get_by_role('heading', name='Standard nekudos and dots', exact=True)).get_by_role('button', name='Assign', exact=True).click()
    teacher.locator('#assignStudents input').check()
    teacher.get_by_role('button', name='Assign to selected students', exact=True).click()
    expect(teacher.locator('#status')).to_contain_text('Assigned to 1', timeout=45000)

    student = login('kriah-fixture-auth-et')
    student.get_by_role('button', name='Open assessment', exact=True).first.click()
    student.locator('#assessment input[type=checkbox]').check()
    student.get_by_role('button', name='Record reading', exact=True).click()
    expect(student.locator('#recordTimer')).to_contain_text('Recording')
    student.wait_for_timeout(1800)
    student.get_by_role('button', name='Stop recording', exact=True).click()
    expect(student.locator('#status')).to_contain_text('saved on this device')
    student.get_by_role('button', name='Submit recording', exact=True).click()
    expect(student.locator('#status')).to_contain_text('Recording submitted', timeout=60000)

    teacher.get_by_role('button', name='Refresh', exact=True).click()
    teacher.get_by_role('button', name='Open assessment', exact=True).first.click()
    assert not any(r['action'] == 'audioRead' for r in traffic), 'Audio downloaded without explicit playback'
    teacher.get_by_role('button', name='Load original recording', exact=True).click()
    expect(teacher.locator('#status')).to_contain_text('Original recording loaded', timeout=45000)
    teacher.locator('[data-cluster="0"]').click()
    teacher.locator('#markTarget').select_option('n:0:1464')
    teacher.locator('#category').select_option('wrong-vowel')
    teacher.locator('#markNote').fill('Fictional staging observation')
    teacher.get_by_role('button', name='Apply mark to selected unit(s)', exact=True).click()
    teacher.locator('#feedback').fill('Fictional feedback: practise kamatz.')
    teacher.locator('#recommendation').fill('Read the marked syllable again.')
    teacher.locator('#shareFeedback').check()
    teacher.get_by_role('button', name='Finalize assessment', exact=True).click()
    expect(teacher.locator('#status')).to_contain_text('Final assessment saved', timeout=45000)
    teacher.screenshot(path=str(out / 'authenticated-teacher.png'), full_page=True)
    teacher.get_by_role('button', name='Progress reports', exact=True).click()
    expect(teacher.locator('#reportBody')).to_contain_text('Needs practice')
    teacher.screenshot(path=str(out / 'authenticated-report.png'), full_page=True)
    teacher.set_viewport_size({'width': 390, 'height': 844})
    assert teacher.evaluate('document.documentElement.scrollWidth <= innerWidth')
    teacher.screenshot(path=str(out / 'authenticated-mobile.png'), full_page=True)

    student.get_by_role('button', name='Refresh', exact=True).click()
    student.get_by_role('button', name='Open assessment', exact=True).first.click()
    expect(student.locator('#assessment')).to_contain_text('Fictional feedback: practise kamatz.')
    target = {'action': 'get', 'classId': 'kriah-test-et', 'studentId': assignment['studentId'], 'id': assignment['id']}
    other_teacher = login('kriah-fixture-teacher-wt')
    other_student = login('kriah-fixture-auth-wt')
    assert direct(other_teacher, target) == 403
    assert direct(other_student, target) == 403
    assert direct(other_student, {**target, 'action': 'audioRead'}) == 403
    teacher_path = 'b3Games/workspaces/b3-2026/teachers/kriah-fixture-teacher-et/active'
    admin_change("await admin.database().ref('" + teacher_path + "').set(false)")
    try:
        assert direct(teacher, target) == 403
    finally:
        admin_change("await admin.database().ref('" + teacher_path + "').set(true)")
    membership = 'b3Games/students/kriah_fixture_student_et/memberships/kriah624/active'
    admin_change("await admin.database().ref('" + membership + "').set(false)")
    try:
        assert direct(student, target) == 403
    finally:
        admin_change("await admin.database().ref('" + membership + "').set(true)")
    time.sleep(1.1)
    admin_change("await admin.auth().revokeRefreshTokens('kriah-fixture-teacher-wt')")
    assert direct(other_teacher, {'action': 'classes'}) == 401

    # Direct client RTDB access must remain denied even to this valid student.
    token = student.evaluate('() => firebase.auth().currentUser.getIdToken()')
    private_url = 'https://' + PROJECT + '-default-rtdb.firebaseio.com/b3Private/kriahAssessmentCenter/classes/kriah-test-et.json?auth=' + token
    try:
        urllib.request.urlopen(private_url, timeout=20)
        raise AssertionError('Private RTDB data was client-readable')
    except urllib.error.HTTPError as e:
        assert e.code in (401, 403)
    object_url = 'https://storage.googleapis.com/' + PROJECT + '-kriah-private/kriah/kriah-test-et/' + assignment['studentId'] + '/' + assignment['id']
    try:
        urllib.request.urlopen(object_url, timeout=20)
        raise AssertionError('Original audio was publicly readable')
    except urllib.error.HTTPError as e:
        assert e.code in (401, 403)
    assert not errors, errors
    result = {'passed': True, 'preview': url, 'accounts': '2 fictional teachers, 2 fictional students', 'checks': ['actual Firebase sign-in', 'assign-record-mark-report', 'private original playback', 'shared feedback', 'mobile', 'teacher and student isolation', 'teacher/member revocation', 'token revocation', 'direct private RTDB denial', 'public audio denial'], 'apiRequests': len(traffic), 'apiResponseBytes': sum(r['bytes'] for r in traffic), 'audioReadRequests': sum(r['action'] == 'audioRead' for r in traffic)}
    (out / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
    browser.close()
