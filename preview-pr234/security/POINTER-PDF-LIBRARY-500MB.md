# Private PDF Library — 500 MB upgrade

The user confirmed the current PDF Library saves/reopens workbooks and remembers their place. The original library limit was 50 MB. A ~263 MB Children's Chumash Vayeira Teacher View PDF needs the new maximum **500 MiB (524,288,000 bytes)**, consistent with Class Pointer's existing large-PDF viewer. The browser may take longer and use substantial memory for large PDFs.

## Firebase Console rule adjustment (user action required)

Open **Firebase Console → Storage → Rules** in the B3 Games Firebase project. Back up the current rules first. In the existing private PDF folder match ONLY:

```
match /pointerPdfLibrary/{teacherUid}/{fileId} {
  ...
  allow create: if request.auth != null
    && request.auth.uid == teacherUid
    && fileId.matches('[-a-zA-Z0-9]+[.]pdf')
    && request.resource.size <= 50 * 1024 * 1024
    && request.resource.contentType == 'application/pdf';
  ...
}
```

Change **just the numeric size condition** to:

```
    && request.resource.size <= 500 * 1024 * 1024
```

Keep owner UID checks, content-type checks, rename metadata safeguards, other storage paths, and CORS settings **unchanged**. Click **Publish**, then reopen the rules page and verify the new limit persisted. This is a rule change to `/pointerPdfLibrary` only; do not broaden other permissions.

The full proposed ruleset is in `security/pointer-pdf-library-merged-storage.rules` for comparison, but the one-line change is safest if other live rules have changed.

## Website

The teacher PDF Library UI rejects files over 500 MiB and uses Firebase Storage resumable upload tasks with a visible percentage and progress in MB. Save is disabled while uploading, and status is retained after completing. Firebase Storage rules must be updated for files over 50 MiB to upload.

## Verify

1. Open the 263 MB Children's Chumash in Class Pointer.
2. Open **📚 PDF Library → Save current PDF**, choose a name, watch progress move from 0 to 100%.
3. Confirm the library lists the new file, and click **Open**. A large download may take some time.
4. Move to a page, close and reopen the file, confirm page restore.
5. Verify existing smaller PDFs and the other programs' Storage uploads still work.

Do not claim private teacher-vs-teacher access has been live-tested merely from this upload test.
