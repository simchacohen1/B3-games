# Approved question-bank rules

Install the separate locked test dependencies with `npm --prefix tests/rules ci` from the repository root. Use Node 22 and Java 21. Run the exact demo emulator command in `docs/OUTSTANDING-IMPROVEMENTS.md`; it never deploys or connects to production.

These tests verify real Realtime Database rule evaluation, including verified owner/admin and active workspace teachers, revoked/anonymous/student denial, wrong-workspace denial, two-question validation and rejected deletion. The shared banks contain questions/answer phrases only, with no student progress.
