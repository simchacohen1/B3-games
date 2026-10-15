# Private Class Pointer PDF Library — deployment gate

**Status: source-only / not deployed.** This branch must remain draft until cloud security is validated.

1. Fetch the **currently deployed Firebase Storage rules** from the project **b3-games**. There are existing storage-dependent activities (Chazara, Posuk Practice, Class Gallery), but no verified source-controlled live Storage rules. **Never deploy a replacement ruleset from this PR**.
2. Compare every existing `match`/allow rule (including permissive ancestor/recurse matches) to the proposed block in `pointer-pdf-library.rules.example`. Merge only the owner-scoped match and retain all unrelated rules. Firebase rules with multiple matching `allow` blocks are ORed: a broad public permission will defeat owner-only restrictions.
3. Strict teacher-only write privileges require verifying teacher identity server-side. Current rule enforces **per-authentication-UID ownership**, which protects teachers from one another; a student with his own Firebase user could write an empty personal namespace if he calls Storage directly. The Class Pointer UI awaits teacher-class authorization and does not initialize for students.
4. Deploy the merged rules only with controlled Firebase project credentials and an independently reviewed diff.
5. Test using two real teacher accounts A and B and a student. A can upload/list/get/update/delete A files; B cannot list/get/change A files (and vice versa); anonymous access is denied. The student must not see or retrieve teacher PDFs. Confirm a public token-bearing download URL is never created by client reopening code. Test authenticated download including browser CORS and Auth expiry, class switches, deletion, and 50 MB limit.
6. Test saving, navigating away and back, restoring remembered page, rename/delete, large document refusal, student viewing only when a teacher presents the PDF. Run `node --test tests/class-pointer*.test.cjs` and browser suite. Check signed-in production manually before merging/publishing.

Cloud Storage direct authenticated downloads require GET/OPTIONS CORS configuration for the site's origin; confirm with actual browser test. Existing bucket CORS must be preserved.

**Rollback:** do not modify existing storage rules blindly. Keep a backup of the retrieved live rules, revert only the newly added match on error, and disable the UI via reverting the PR if live acceptance fails.
