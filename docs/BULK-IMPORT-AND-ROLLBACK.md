# Bulk import, one account per student, and import rollback (Issue #706)

## What went wrong
The old Owner Admin importer sent one `funTorahManageStudents` `create` call per
CSV student row. Its only duplicate check was "same name already in this class",
so a child listed in *B2 ET Morning* and *B2 ET Afternoon* got two accounts with
the same name and passcode. Sign-in then matches two accounts and refuses with
"More than one student…". Teachers listed for several classes only received the
first class (later rows were skipped as "already exists").

The data model was never the problem. It already supports one student in many
classes:

| Record | Path |
|---|---|
| Student identity (stable id, name) | `b3Games/students/<id>/profile` |
| Passcode (server-only) | `b3Private/passcodes/<id>` |
| Memberships (one per class) | `b3Games/students/<id>/memberships/b3-2026_<classId>` |
| Class roster row (mirrors membership) | `b3Games/workspaces/b3-2026/classes/<classId>/members/<id>` |

Sign-in (`funTorahStudentAuth`) already returns every active class as
`classChoices`; the homepage shows a big-button "Choose your class" screen when
there are several, and a switcher afterwards. Switching asks the server for a new
class-scoped token; a student can never get a token for a class they are not an
active member of.

## New CSV format
One row per person; classes separated by semicolons.

```
Type,Name,Email,Passcode,Classes,Student ID
Class,B2 ET Morning,,,,
Class,B2 ET Afternoon,,,,
Teacher,Rabbi Example,teacher@example.com,,B2 ET Morning; B2 ET Afternoon,
Student,Moshe Example,,482731,B2 ET Morning; B2 ET Afternoon,
```

* Student passcodes must be exactly 6 digits.
* `Student ID` is optional: your own roster number. It is stored as
  `profile.rosterId` and is how a student is recognised in later files. It may
  also be an existing internal id (for example `arik_traxler`) when the name matches.
* Old files (header `class`, one row per class) still work. Rows with the same
  name **and** passcode become one student; the same name with a different
  passcode stays two students and is listed as a warning.
* Class names are matched ignoring case, spaces and the `·` character. A name that
  matches two classes on the site is refused until one is renamed or removed.
* `scripts/convert-legacy-roster.cjs old.csv new.csv review.csv` converts an old
  roster (e.g. the SOLS Master Import tab downloaded as CSV) to the new format.

## Import workflow (Owner Admin → Bulk Upload)
1. **Check file** – the browser parses and validates (`bulk-roster.js`).
2. **Server preview** (`importPreview`) – classes to create, teachers to create or
   give classes, new students, existing students getting classes, already-done
   rows, and conflicts. Nothing is written.
3. **Conflicts** – a row whose name already has an account is never merged or
   duplicated silently. The owner picks "same child (this account)" or "a
   different child". "Different" is refused when the passcode is also the same.
4. **Import** (`importApply`) – must quote the preview's `planHash`; if the site
   changed, nothing is written. Each student is one atomic multi-path update that
   also writes its entry in the batch record, so there is never half a student.
5. **Results** – counts, failures, skipped conflicts, downloadable results CSV.

The batch id is a hash of the file, so running the same file again resumes the
same batch: students it already created are recognised and nothing is
duplicated. Batch records live in `b3Private/importBatches/<batchId>` (server
only) and keep, for every existing account that was changed, the previous value
of each membership and class roster row.

## Undo CSV Import (Owner Admin, its own card)
1. **Undo CSV Import** lists every import: tracked batches, and older "import runs" found from the server audit entries.
2. Tick one or more imports and press **Review**. Nothing is written. The review shows the accounts that will be removed, existing students whose classes are put back, anything kept for review, how many other accounts are untouched, and a table of every class it touches (students now, leaving, after, and whether the class had students before the import). Classes and teachers are never deleted.
3. Download the backup, type `UNDO n` (n = total across the ticked imports) and press **Undo import**. The page then runs the server rollback for each ticked import with the hash of the review; if anything changed, the server refuses and nothing is removed.
4. **Earlier removals → Put them back** restores from the private server backup.

## Rollback and Bulk Management (Owner Admin → Students → Bulk Management)
* Filter by class, import, creation date or name; preview shows each account's
  audit history, every place its id appears in student-data trees, and whether it
  existed before the chosen import.
* **Delete** only accounts with no student work, after a backup download and
  typing `DELETE n`. The server re-checks everything.
* **Undo an import**: for new imports, from the batch record; for imports made
  before batch records existed, from the per-class `managementAudit` entries the
  server wrote at the moment each account was created (grouped into "import
  runs": 10+ creates by one account with no gap over 10 minutes). Every candidate
  must match its audit entry (creator, time within 5 s, one class, importer-style
  id), have no other keys in its student record, and have no data in any of the
  trees in `LINK_TREES`. Anything else is kept and listed for review.
* Execution must quote the preview's `manifestHash` and the typed confirmation.
  Each account is backed up (including passcode, under `b3Private`) in the same
  atomic write that removes it; a retry continues where it stopped; "Put them
  back" restores from that backup.
* Classes, teachers and all other records are never deleted.
* Audit log: `b3Private/studentAudit`.

All of these are `funTorahManageStudents` actions that require the owner account
or an active site administrator (`b3Games/admins/<uid>`), checked on the server.

## Data that hangs off a student id (Part 6 audit)
Rewards and coins (`studentRewards/*`), Weekly Quiz (`b3Quiz/*`), Shorashim and
Posuk/Mishnayos practice and Chazara (`posukPractice/*`), Rashi Letters
(`rashiLetters/progress`), Homework (`assignmentCenter/*`), Class Gallery and Tag
(`classGallery*`, `b3Games/classGallery*`), Multiplayer (`multiplayerCenter`,
`b3Private/multiplayerGames`), Halacha (inside `b3Games/students/<id>`), parent
dashboard and Yiddish private data. All are keyed by the student id and, where
class-specific, by class id. This change never changes or merges ids, so every
existing record stays with the same child; adding a membership does not move or
combine any scores. The rollback refuses to remove an account that has an entry
in any of these places. Firebase Storage recordings are referenced from these
trees, so they are covered by the same check.

## Tests
`tests/bulk-import-706.test.cjs` (import, sign-in, rollback, bulk delete; also run
against `backend/functions-staging` with `STUDENT_FUNCTIONS_DIR`),
`tests/owner-admin-bulk-upload.test.cjs` (the real page block driving the real
server code in memory).

## Duplicate safety added for Issue #51 (Student Management & Class Membership)

- **Same name and same passcode = the same student.** When exactly one existing account has the row's name and passcode, the import reuses it and only adds the missing classes. This makes an edited copy of an earlier file safe to import again. Same name with a different passcode, or more than one matching account, still stops for the owner to decide.
- **Adding one student by hand** (Class management) now checks first: a name already in that class is refused; a name that exists in another class needs a deliberate confirmation; a second account with the same name and passcode is always refused.
- **Changing a passcode** is refused if another student with the same name already uses it.
- **Find possible duplicates** (Owner Admin, Students, Bulk Management) lists same-name accounts, same-name classes and class-list entries without an account. It is read-only: nothing is deleted, merged or renamed, and no passcode is shown.
- **Blocked / Enabled** in Class management applies to the chosen class only, for the owner as well as for teachers. A student in both ET and WT can be blocked in one and stay enabled in the other.
