# Class Pointer saved work: Firebase rules

**HIGH RISK (student data, permissions, rules). NOT DEPLOYED.** Issue #770.
Nothing in this file is live until the owner approves and publishes it. Until then the pages work,
but every save, list and open answers "Saving is not turned on yet. Ask your teacher."

## Which rules files are live

| Service | What is live | In the repo | Edited here? |
|---|---|---|---|
| Realtime Database | `firebase-rules.json` (the file `firebase.json` and `firebase.pointer-additive.json` deploy) | yes | **No.** Block to add is below. When the owner approves it, the new write expression must also be recorded in `security/reviewed-permission-expressions.json` and `scripts/rules-additive-check.cjs`, which is the owner's review step |
| Realtime Database, hardened candidate | not live (`firebase-rules.hardened.json`, `staging/database.rules.json`; open PRs #766 and others edit them) | yes | No. Block to add is below |
| Storage | Published by hand in the Firebase console. `firebase.json` has no `storage` entry on purpose. The closest copy is `security/pointer-pdf-library-merged-storage.rules` (what the owner was given to paste for the PDF Library) | not reliably | **No.** Block to add is below |
| Storage, hardened candidate | not live (`storage-rules.hardened.rules`, used only by `firebase.security-deploy.json` and the emulator tests) | yes | No. Note: this file has **no** `pointerPdfLibrary` rule, so publishing it as it stands would turn off the teacher PDF Library |

## Data layout

| What | Where | Who |
|---|---|---|
| A student's saved whiteboard | Storage `studentFiles/<classId>/<studentId>/<fileId>.json` (optional picture `<fileId>.png`) | only that student, signed in to that class |
| A student's PDF | Storage `studentFiles/<classId>/<studentId>/<fileId>.pdf` | only that student, signed in to that class |
| A teacher's saved lesson whiteboard | Storage `pointerWhiteboards/<teacherUid>/<fileId>.json` (optional `.png`) | only that teacher |
| Class folders | Database `b3Games/workspaces/b3-2026/classes/<classId>/pointerFileFolders` = `{folders:{<id>:{name,parentId?,order,createdAt}},saveTarget?}` | teacher of that class writes; students read |

File details are Storage `customMetadata`: `displayName`, `kind` (`whiteboard` or `pdf`), `folderId`, `lastPage`, `zoom`, `savedAt`, `placeAt`.
File ids are random (`crypto.randomUUID`) and match `[A-Za-z0-9_-]{1,64}`. No student name or id is ever put in a page address.

**Teachers cannot see students' files.** The owner asked for files "private to that student", so there is no teacher read rule and no teacher list. (Anyone with Firebase console access to the project can still see stored files, as with all other data.)

## Storage rules to add

Paste inside `match /b/{bucket}/o { ... }`, beside the existing blocks. Nothing existing changes.

```
    // Class Pointer saved work (issue #770).
    // A student's own saved whiteboards and PDFs. Private to that student, inside their own class.
    match /studentFiles/{classId}/{studentId}/{fileId} {
      function ownStudent() {
        return request.auth != null
          && request.auth.token.b3StudentRole == 'student'
          && request.auth.token.b3StudentId == studentId
          && request.auth.token.b3ClassId == classId;
      }
      allow get, list, delete: if ownStudent();
      allow create, update: if ownStudent() && (
        (fileId.matches('[-A-Za-z0-9_]{1,64}[.]json')
          && request.resource.contentType == 'application/json'
          && request.resource.size <= 3 * 1024 * 1024)
        || (fileId.matches('[-A-Za-z0-9_]{1,64}[.]png')
          && request.resource.contentType == 'image/png'
          && request.resource.size <= 2 * 1024 * 1024)
        || (fileId.matches('[-A-Za-z0-9_]{1,64}[.]pdf')
          && request.resource.contentType == 'application/pdf'
          && request.resource.size <= 25 * 1024 * 1024)
      );
    }

    // A teacher's own saved lesson whiteboards. Same owner-only shape as pointerPdfLibrary.
    match /pointerWhiteboards/{teacherUid}/{fileId} {
      function ownTeacher() {
        return request.auth != null
          && request.auth.uid == teacherUid
          && !('b3StudentRole' in request.auth.token);
      }
      allow get, list, delete: if ownTeacher();
      allow create, update: if ownTeacher() && (
        (fileId.matches('[-A-Za-z0-9_]{1,64}[.]json')
          && request.resource.contentType == 'application/json'
          && request.resource.size <= 10 * 1024 * 1024)
        || (fileId.matches('[-A-Za-z0-9_]{1,64}[.]png')
          && request.resource.contentType == 'image/png'
          && request.resource.size <= 2 * 1024 * 1024)
      );
    }
```

Notes for the reviewer:
- `update` allows new file bytes on purpose: saving a whiteboard again replaces the same file. The size and type limits still apply. PDFs are only ever created once by the page, then only their details change.
- Like `pointerPdfLibrary`, the teacher rule checks ownership by sign-in id, not the teacher role. The page also waits for the class-checked teacher (`ClassPointerDashboard.ready`). Student sign-ins are kept out of this path.
- Rules cannot count files. The page stops a student at 50 files and a teacher at 200 whiteboards. A student who bypassed the page could store more (worst case is bounded only by the per-file limits), so watch Storage use.
- If the hardened Storage rules are published later, these two blocks **and** `pointerPdfLibrary` must be in that file first.

## Database rule (proposal only: NOT in `firebase-rules.json`, not deployed)

Under `b3Games/workspaces/$workspaceId/classes/$classId`:

```json
"pointerFileFolders": {
  ".write": "<exactly the classPointerSessions .write expression: owner, active admin, or an active teacher of this class with Class Pointer>",
  "folders": {
    "$folderId": {
      ".validate": "$folderId.length <= 64 && newData.hasChildren(['name', 'order', 'createdAt'])",
      "name": { ".validate": "newData.isString() && newData.val().length > 0 && newData.val().length <= 40" },
      "parentId": { ".validate": "newData.isString() && newData.val() != $folderId && newData.parent().parent().child(newData.val()).exists() && !newData.parent().parent().child(newData.val()).child('parentId').exists()" },
      "order": { ".validate": "newData.isNumber()" },
      "createdAt": { ".validate": "newData.isNumber()" },
      "$other": { ".validate": false }
    }
  },
  "saveTarget": { ".validate": "newData.isString() && newData.parent().child('folders').child(newData.val()).exists()" },
  "$other": { ".validate": false }
}
```

- No `.read` is added. On the live rules everything under `b3Games/workspaces` is already readable by anyone (`".read": true`), so folder names (for example "Chumash") are public like class names are today. Do not put private words in folder names.
- Depth is held to two levels by the `parentId` rule. The 60-folder limit and control-character cleaning are done by the page.
- Deleting a folder only removes folder rows. Student files are never touched; they show under "Other".

**For the hardened database rules** (when that file is next edited): add the same node with the hardened `classPointerSessions` `.write`, plus a read for the class:

```json
".read": "<the hardened classPointerSessions .read expression: owner, admin, teacher of this class, or a signed-in student whose b3ClassId is this class>"
```

## Before publishing (owner)

1. Database: `node scripts/rules-additive-check.cjs <saved-live-rules.json>` must pass after adding the node above to `firebase-rules.json`, then publish it the usual approved way.
2. Storage: copy the live Storage rules from the console as a backup, add the two blocks above, publish from the console.
3. Bucket CORS: opening a file uses the same signed-in download as the PDF Library, so the existing GET CORS entry for the site origins covers it (`security/POINTER-PDF-LIBRARY-CORS.md`). A staging origin needs its own entry.
4. Check with two test students in one class and one in another: each can save, list, open, rename and delete only their own files; a teacher sign-in cannot list `studentFiles`; a student cannot write `pointerFileFolders` or `pointerWhiteboards`; a teacher of another class cannot change this class's folders.
