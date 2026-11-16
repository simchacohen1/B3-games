PR #838 isolated Google sign-in test — source 2b9e0a1c

Requires Python 3. Extract this ZIP first. Open a terminal in the extracted folder.
Windows: py -3 start.py
Mac/Linux: python3 start.py
Then visit http://localhost:8838/ in your regular Chrome or Edge browser.

Click Sign in with Google. Use your own existing account only in Google's popup.
Observe whether the popup identifies auth.sols.tools, then returns to a PASS
message on this local page. Click Sign out of this test, then sign in again.
Report only PASS or the error code, and whether you saw auth.sols.tools.
Never send passwords, tokens, browser storage or a network capture.
Stop the server using Ctrl+C in the terminal when finished.

The files contain public Firebase configuration and the vendored Firebase Auth
SDK from PR #838. There are no credentials or student records in this package.
It uses auth.sols.tools and the existing b3-games Auth project and Google client.
Localhost is already an authorized domain. No Firebase setting needs changing.

Only authentication is tested. No database SDK, application pages, role queries,
student records or application write paths are loaded. Credentials remain in
memory; this page does not change your sols.tools browser session.
A real Google sign-in contacts production Firebase Authentication and may update
normal last-sign-in metadata (and creates a Firebase Auth user if this Google
account has never been used there). Use your existing sols.tools Google account.
This does not deploy or change production/staging configuration or application data.

A PASS does not prove full-site roles, persisted sessions, Pointer/Class Access
navigation or mobile redirect recovery. Those still need separate verification.
