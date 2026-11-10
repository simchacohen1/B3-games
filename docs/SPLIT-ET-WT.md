# Splitting ET and WT into morning and afternoon classes (Issue #728)

Owner Admin has a card, **Split ET and WT into morning and afternoon**. It makes
four classes and enrolls the students who are in ET and WT now:

| From | New classes |
| --- | --- |
| ET | B3 ET morning, B3 ET afternoon |
| WT | B3 WT morning, B3 WT afternoon |

## How to use it

1. **Check ET and WT.** Read only. Shows the classes and the students.
2. **Create the new classes.** They are made in the same school as ET and WT.
   If a class with the same name is already on the site (see Issue #665), you
   choose whether to use that one or make a new one. An existing class is only
   pointed at, never changed.
3. **Give each new class a teacher and its tools** (steps 3 and 4 on the page).
   A new class starts with none.
4. **Enroll.** Every student starts ticked for both sessions. Untick the session
   a student does not attend, then press Enroll. You can run it again later; a
   session you left unticked stays unticked.
5. **Later: retire ET / WT.** Only once the new classes are working. Type
   `RETIRE ET`. You can bring the class back from the same card.

## What it changes, and what it never changes

Enrolling writes, for each ticked student and class:
- the student's row in the new class roster (`classes/<new>/members/<id>`),
- the student's membership (`b3Games/students/<id>/memberships/b3-2026_<new>`),
- an audit line on the new class, and the owner panel's own copy of the
  student's classes if that student already has one.

It never writes anything under `classes/et` or `classes/wt`, never touches
homework, records, rewards, passcodes or profiles, and never removes a student
from any class.

One extra write protects ET and WT: an old account with **no** membership
records reaches ET/WT through a fallback that every access check switches off
as soon as the account has any membership record. For those students the ET/WT
membership they already rely on is written down first, so ET/WT keeps opening
for them exactly as before.

Retiring writes only `active: false`, `retiredAt` and `retiredBy` on the legacy
class. Every existing check already treats a class with `active: false` as
closed, so no access check is changed. Students, homework, records and
passcodes stay saved. Restoring puts the class back exactly as it was.

Retiring is refused while any student would be left with no other class, unless
you tick "Retire anyway".

The tool's own notes (which classes it made, who it enrolled, retirement) are
kept in `b3Private/classSplits/`, which browsers cannot read, and each action is
added to the Bulk Management audit log.

## Things to know before enrolling

- After enrolling, a student is in ET (or WT) **and** the new classes. At
  sign-in the site usually starts them in a new class; they can switch to ET or
  WT from the class menu. This comes from the existing sign-in code, which is
  not changed.
- Students left out, with the reason, are listed under "Not included": blocked
  in ET/WT, account turned off, taken out of ET/WT, or an old-list name that has
  never signed in on the new sign-in (no account to enroll yet).
