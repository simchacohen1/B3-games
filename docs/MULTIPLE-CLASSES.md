# Multiple classes, subjects and homework (#662)

All of this is in the Firebase **Realtime Database** (not Firestore). Workspace: `b3-2026`.

## Classes, teachers, students (unchanged, already multi-class)

| What | Where | Notes |
|---|---|---|
| Class | `b3Games/workspaces/b3-2026/classes/<classId>` | `name`, `active`, `toolGrants`, `members/<studentId>`, `teacherIds/<uid>` |
| Teacher | `b3Games/workspaces/b3-2026/teachers/<uid>` | `classIds/<classId>: true`. A teacher can run many classes. |
| Student | `b3Games/students/<studentId>/memberships/<id>` | `{workspaceId, classId, active}`. A student can be in many classes. |

A class can have several teachers (`teacherIds`). They all have the same rights; there is no lead teacher.
Games and screen sharing keep working per class, as they did before.

## New: per-class subjects (server-only)

`assignmentCenter/workspaces/b3-2026/classes/<classId>/settings`

```
subjects/<subjectId>:        { name, createdAt, createdBy, updatedAt, updatedBy }
teacherSubjects/<uid>/<subjectId>: true
```

The `homeworkPortal` function is the only reader and writer. Browsers have no rules for this tree,
so no database rules change. Any teacher of the class (or the owner) can add, rename or remove
subjects and change who teaches what (`addSubject`, `renameSubject`, `removeSubject`, `setTeacherSubjects`).

## Homework

- Each homework definition can have `subjectId` (from the class list) plus `subject` (the name when it was saved).
- A teacher can only choose subjects they are linked to. A teacher with no links can choose any subject in the class.
- **Who sees what:** a teacher sees homework they posted plus every homework with no subject. The owner/admin sees everything.
  Hidden homework cannot be changed through any action.
- Students see all homework for the class they choose in the class switcher. They can filter by subject,
  teacher, due today, due this week, done and not done.

## Migration

Nothing has to move. Existing classes, teachers, students and homework stay where they are:
- A class with no subject list works exactly as before.
- Older homework has no subject, so every teacher of the class still sees it.
- Older typed-in subjects (from #650) still count as a subject and are kept when editing.

Putting everyone into one "default class" would merge ET and WT and break per-class rosters, so it is not done.
