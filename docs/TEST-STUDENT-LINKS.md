# Quick sign-in links for test students (issue #619)

A link that opens Fun Torah Tools already signed in as a **fictional test student**.
Put it in a `.bat` file and double-click to open the student window.

## How it works
- Link: `https://funtorahtools.com/#ftt-test=<token>`. The token is the test student's
  name and passcode, encoded (not encrypted). Without it, nothing happens.
- The part after `#` is never sent to any server. The home page removes it from the
  address bar as soon as it loads.
- Sign-in still goes through the normal server passcode check, so a link gives no more
  access than typing that name and passcode. A wrong or changed passcode shows the normal
  "Check your name and passcode" message.
- **Test accounts only:** the page refuses the link unless every class the student is in
  is a test class (a word in the class id or name starts with "test", e.g. "Testing",
  "Test Class Alef"; "Contest" does not count).
- If a teacher is already signed in in that browser, the link does not replace the teacher;
  it asks for a private window. The `.bat` files open Chrome incognito for this reason.

## Making links
```
node scripts/make-test-login-link.cjs --name "Monitor Testbot" --passcode 123456
node scripts/make-test-login-link.cjs --name "Test Student A1" --passcode 123456 --site https://fun-torah-tools-staging.web.app/
node scripts/make-test-login-link.cjs --from staging/test-credentials.local.json --bat staging/test-students.local.bat
```
The links contain the passcode. Keep them and the `.bat` file on your own computer;
`*.local.bat` is ignored by git. Never put a real student's passcode in a link (the page
would refuse it anyway). Changing the test student's passcode in Teacher Center turns off
every old link for that student.
