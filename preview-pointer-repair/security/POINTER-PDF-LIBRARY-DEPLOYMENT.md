# Class Pointer PDF Library — Firebase Storage rollout

**Status (October 16, 2026):** The original private PDF Library was published, and the user confirmed saving/reopening and restoring the last page. They also published its Storage rules. The 500 MB upgrade requires the one-line Storage Rules update documented in `POINTER-PDF-LIBRARY-500MB.md`; the code and updated source-control rules candidate are being prepared separately.

## User-provided baseline and proposed replacement

The complete copy/paste candidate is `security/pointer-pdf-library-merged-storage.rules`. It preserves these three existing match paths and their permission expressions **exactly**:
- `/posukPractice/{studentId}/{fileName}`: `allow read, write: if true`
- `/classGallery/{postId}/{fileName}`: `allow read, write: if true`
- `/shorashim-recordings/{studentId}/{date}/{fileName}`: `allow read, write: if true`

A fourth match applies solely to `/pointerPdfLibrary/{teacherUid}/{fileId}`. It requires Firebase Auth UID equal to the folder's `teacherUid` for get/list/delete, limits creates to PDF content type and 500 MB, and limits updates to unchanged file bytes. No broad public read/write permission overlaps the PDF path in the **provided** baseline.

**Important existing vulnerability:** each of the three existing paths has public read and write (`if true`). These are not private and can be abused if their paths are known. Do not quietly harden them in this PDF feature PR because that could break existing class activities; schedule an independent security migration with teacher/student authorization and regression coverage. The newly added PDF rule is owner-isolated; its `request.auth.uid == teacherUid` does **not**, by itself, certify a user has the teacher role. Student users with Firebase Auth could create a separate personal prefix, but cannot read teacher-owned prefixes. The Classroom UI additionally awaits `ClassPointerDashboard.ready` for an authorized teacher.

## Controlled steps (no automatic Storage deployment)

1. Open Firebase project `b3-games` → Storage → Rules. Copy the existing live rules as a backup before changing anything. Compare against the baseline above: if production rules have changed since the user's message, **stop and re-merge**, never paste over new permissions.
2. Paste `pointer-pdf-library-merged-storage.rules` into Storage → Rules and use Firebase's syntax validation. Publish **only** the Storage rules using Firebase Console with the user's permission/credentials; this feature has not published rules automatically.
3. Verify on the real bucket: signed-in teacher A can create/list/get/rename/delete within A's UID folder; teacher B cannot list/get/change A's files; anonymous and student accounts cannot read teacher folders. Verify the actual authenticated `GET` request from the Class Pointer page and bucket CORS for the live website origin.
4. After Storage verification, merge/publish PR #99 and check a real teacher browser can Save, Open, Rename, Delete, preserve page position, and present an opened saved file. Re-test existing Chazara, Posuk Practice, Class Gallery, and Shorashim Storage operations.
5. Keep a copy of the previously deployed Storage rules. If a regression occurs, roll back to that exact ruleset first; revert PR #99 UI only if needed.

This repository intentionally does **not** set `firebase.json.storage.rules` to the proposed file. Deploying unrelated Firebase changes must never overwrite live Storage rules.
