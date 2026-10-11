# Shared computer: Teacher and Student (DRAFT)

Status: GitHub draft only; not enabled on the live website.

## Teacher hands the computer to a student

Teacher Center now has a green **Switch to Student** button, separate from
the gray **Preview Student (teacher stays signed in)** button.
For a real child using the device, use Switch to Student, never Preview.

1. Warn the teacher to close other open teacher tabs before handing over.
2. Firebase Authentication must successfully sign the teacher out FIRST.
   If sign-out fails, navigation is blocked and an error is shown.
3. Clear the tab's previous student identity, PIN, impersonation/demo state,
   teacher login hints and pending email-link address.
4. Show the normal student sign-in with the child's own name and passcode.
5. Never preserve a teacher Firebase login for student use.

## Student gives the computer back

The student clicks **Switch to Teacher**, which signs out any residual Firebase
account, clears tab student data and opens Teacher Center. Teacher Center
requires the teacher to authenticate again.

A six-digit PIN alone is NOT a secure substitute for teacher sign-in.
A future quick PIN would need server-side brute-force protection, expiry
and a independently authenticated trusted-device credential. No PIN-only
bypass has been implemented.

## Teachers without Gmail

Teacher Center offers **Continue with Google** or **Email me a sign-in link**.
This supports Outlook, Yahoo and any school email. The email address
must match a verified active teacher invitation, not merely be typed in.
The app does not place the email address in URL parameters and removes
one-time links from browser history after successful use.

Firebase project configuration (the owner enabled passwordless email links and\nconfirmed the authorized domains in the console on 2026-10-11; actual link\ndelivery and return path still require a real end-to-end test):

1. In Authentication > Sign-in method, enable Email/Password and
   Email link (passwordless).
2. In Authentication > Settings > Authorized domains, authorize the
   intended site domain (funtorahtools.com) and any staging origin.
3. Verify the link returns to the correct teacher-home.html action URL.
4. Test non-Gmail invitations, expired links, another-device link opens,
   disabled accounts, already-claimed accounts, and browser sign-out.
5. Complete the database/teacher tool class isolation audit before release.

## Security tests and pending blockers

Node unit tests include sign-out sequencing, failure safety, stale session\nremoval, matching verified email addresses, denial of unverified or unassigned\naccounts, race protection for delayed sign-outs, and acceptance of verified\nGoogle or email-link Firebase ID tokens.
Run:

node --test backend/functions/billing.test.cjs tests/shared-device-switch.test.cjs tests/email-link-auth.test.cjs tests/teacher-dashboard.test.cjs

These are not substitutes for real browser and Firebase emulator tests.
The legacy site currently has other pending class-isolation and migration
test failures. Do not merge or deploy the PR before fixing those issues.

Keep billing disabled and do not disturb live B3 ET/WT classes.
