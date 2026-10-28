# Live site monitor

Automatic Playwright checks of the **live** website, https://funtorahtools.com.
No AI is involved: GitHub runs the same fixed tests every time.

## When it runs
- **Every day** at 10:30 UTC (6:30 AM New York in summer, 5:30 AM in winter).
- **After every successful website deployment** (GitHub Pages "pages build and deployment"), after a 2-minute wait for the new copy to reach the site.
- **By hand:** GitHub → Actions → "Live site monitor" → Run workflow.
- **When a pull request changes the monitor itself** (to prove the change works; these runs never open issues).

The daily, after-deploy and by-hand triggers start only once this workflow is on `main`.

## Read-only guard: the monitor cannot change the live site
Every browser page in the monitor runs behind `e2e-monitor/read-only-guard.ts`:
- Database writes (save, update, add, points, onDisconnect) are **not sent**. The page receives a normal "ok" so it keeps working, but the live database never sees the change.
- Every other POST/PUT/PATCH/DELETE to another site (server functions, file uploads) is answered with "503 blocked" instead of being sent.
- Only sign-in checks pass through: the student sign-in function for `login` and `verify` (never `choosePin`), and Google's sign-in services (account and token checks).
- Everything blocked is listed in the report under "blocked writes (not sent)", so new saving behavior is visible.

The guard proves itself on every run (`read-only-guard.spec.ts`): it tries a database write and a server call that the live site would refuse anyway, and checks that both were stopped. Without the guard, the live database answers `PERMISSION_DENIED` to that write (checked 2026-10-25), so a broken guard is noticed and still cannot change anything.

## What it checks
| Area | Check |
|---|---|
| Home page | Loads, shows the student sign-in form (also on a phone-size screen), the tool map stays hidden when signed out, no script errors or missing files |
| Sign-in | An empty sign-in is stopped with "Please type your name" (browser-only; no passcode is sent) |
| Navigation | Every tool card on the home page links to a page that exists (at least 10 tools; each of the 12 known tools is still listed) |
| Student tools | Posuk Practice, Chazara, Shorashim, Rashi Letters, Yiddish, Gematria, Halacha, Sefer HaMitzvos, Class Gallery, Student Rewards, Weekly Quiz, Game Show: each page opens with the right title and no script errors or missing files |
| Teacher pages | Teacher Home and Owner Admin show only a sign-in screen to a visitor: no student list, passcodes or delete buttons |
| Privacy | A signed-out visitor gets "401 not allowed" reading `b3Private`, `b3Games` and `b3Games/students` from the database |
| Server | Student sign-in function refuses plain GET requests |
| Test student (when set up) | Fictional test student signs in, the tool map opens, Chazara, Shorashim, Rashi Letters and Gematria open from the map without bouncing back to sign-in, then "Switch student" returns to the sign-in form, clears the saved student details, signs the student out of Firebase, and a fresh sign-in works |

## Test student: one-time setup (owner only)
The signed-in check is **skipped** until these are done. Use a made-up name that no real boy has, for example "Monitor Testbot", in the existing **Testing** class (already separate from ET/WT, all tools granted).
1. Teacher Center (Google sign-in as owner) → class **Testing** → add student "Monitor Testbot" with a new made-up passcode. This creates the account in the live database, so it is your step.
2. Save the two values as GitHub secrets from a terminal on your computer. Each command asks you to type the value, so it never appears on screen or in chat:
   - `gh secret set FTT_TEST_STUDENT_NAME --repo simchacohen1/B3-games`
   - `gh secret set FTT_TEST_STUDENT_PASSCODE --repo simchacohen1/B3-games`
3. Run the monitor once (Actions → Live site monitor → Run workflow) and check the test student line is green.

What a test-student run changes on the live site: only the sign-in check itself, which adds one count to the private sign-in rate limit (`b3Private/studentLoginLimits`) for GitHub's computer, and Google's normal "last sign-in" time for that test account. Nothing else: no progress, points, recordings or answers.

Passcode safety (this repository is public, so run reports can be downloaded by anyone signed in to GitHub): the passcode is put in the box and the button pressed in one step, the box is emptied before any check can fail, step-by-step traces are off for this test, and the password box only ever shows dots in screenshots. A deliberate failing run was searched for the passcode: none of the report, screenshot, video or page-text files contained it. GitHub also hides secret values in its logs.

## When something fails
1. The run turns red on the Actions tab, and GitHub emails the repository owner.
2. An issue named **"Live site check failed"** (label `site-monitor`, assigned to the owner so GitHub notifies him) is opened, or a comment is added if one is already open. It lists which check failed and the error in plain text.
3. Screenshots, a video and (except for the test student) a step-by-step trace of each failed check are attached to the run as `site-monitor-report-<run id>` (kept 30 days). Download, unzip and open `monitor-report/index.html`.
4. The next passing run closes the issue automatically.

Each check (except the test student sign-in) is retried once, so a single slow moment does not open an issue; checks that only passed on the retry are listed as "slow or shaky" in the run summary.

## Effect on the real website
None beyond normal visitor traffic: about 25 page visits a day, plus about the same after each deployment, from GitHub's computers. The monitor does not change any website, backend or database-rules file.

## Run it on your own computer
```
npx playwright test --config playwright.monitor.config.ts
```
`SITE_URL=https://...` tests another copy of the site (for example a hidden test folder).


## Site-wide route inventory (issue #347)
- The monitor now includes `e2e-monitor/issue-347-route-inventory.spec.ts`, a **GET-only HTTP check of all 60 primary page candidates** named in the site-quality audit. It records URL, HTTP status and elapsed time. This is a check of whether each URL serves HTML, **not** a functional, signed-in, security or performance verification.
- Missing candidate routes fail until triaged. Do not simply delete or loosen a failing check without classifying that route in issue #347 (current, internal, legacy, redirect, or retired), recording evidence and deciding whether an existing URL must remain supported.
- The read-only guard now also blocks same-origin POST/PATCH/PUT/DELETE requests and Firebase Realtime Database's long-polling GET fallback, and intercepts both `firebaseio.com` and `firebasedatabase.app` websocket hosts. Only the exact approved student sign-in Cloud Function origin and Google sign-in checks are mutation-method exceptions.
- This expanded monitor must complete its GitHub PR tests before merging. It does **not** enable the optional signed-in student test without separate test-account/secrets setup.

## Not covered yet
- Teacher sign-in: it uses Google, which blocks automated sign-ins. Teacher pages are checked only for the signed-out screen.
- Saving progress for real (Chazara, Posuk recordings, quizzes, Yiddish answers, gallery posts, points). The guard deliberately stops these. Testing them would mean real writes for the test student and needs the owner's approval first.
- Tools that need server calls to load for a signed-in student (Yiddish, Weekly Quiz, Posuk Practice, Class Gallery, Student Rewards) are checked signed-out only, because the guard blocks their server calls.
- Wrong-passcode sign-in (each try adds a sign-in rate-limit count).
- Class records privacy (`b3Games/workspaces/.../classes`) is not checked yet because it is still public until PR 335 is deployed; add it to `access-restrictions.spec.ts` afterwards.
- Firefox/Safari, audio, microphone, Class Pointer live video, Game Show live play.
