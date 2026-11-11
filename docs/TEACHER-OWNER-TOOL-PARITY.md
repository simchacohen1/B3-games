# Owner/Admin and Teacher Login tool comparison

This inventory compares the Owner Admin class tool-grant catalog, the signed-in Teacher Tools links on `index.html`, and the class-scoped Teacher Login in `teacher-home.html` / `admin.html`.

## Shared class tool catalog

These 20 class grants are represented by `shared/home-tool-registry.js`. Owner Admin derives its per-class grant checkboxes from that metadata, while Teacher Login renders enabled entries for each active class assigned to the signed-in teacher. The Owner Admin catalog includes the compatible `sync-to-nigri` addition from PR #742. An owner enabling a grant changes only that selected class; a classroom teacher's class controls are enforced by `funTorahClassAccess` against the authenticated teacher's current assignment.

| Tool / grant | Teacher Login | Owner/Admin | Notes |
|---|---|---|---|
| Sefer HaMitzvos | Available when granted | Per-class grant | Learning tool |
| Halacha | Available when granted | Per-class grant | Lesson and student-work routes remain distinct |
| Yiddish | Available when granted | Per-class grant | School/story gates continue to apply |
| Posuk Practice | Available when granted | Per-class grant | Also controls the Chumash quiz and Mishnayos companion tiles |
| Chumash חידון | Available with Posuk Practice | In same grant | Student quiz destination; same permission as the primary Posuk tool |
| Mishnayos Practice | Available with Posuk Practice | In same grant | Teacher practice dashboard destination |
| Mishnayos חידון | Available with Posuk Practice | In same grant | Student quiz destination |
| Rashi Letters | Available when granted | Per-class grant | Learning tool |
| Gematria | Available when granted | Per-class grant | Learning tool |
| Shorashim | Available when granted | Per-class grant | Teacher dashboard |
| Chazara | Available when granted | Per-class grant | Teacher dashboard |
| Game Show | Available when granted | Per-class grant | Host controls remain teacher-side |
| Student Rewards | Available when granted | Per-class grant | Includes the Daily Points teacher view |
| Weekly Quiz | Available when granted | Per-class grant | Teacher and student routes remain distinct |
| Multiplayer Arcade | Available when granted | Per-class grant | Existing access rules remain in effect |
| Homework & Assignments | Available when granted | Per-class grant | Teacher assignment center |
| Gallery | Available when granted | Per-class grant | Existing gallery review/access checks remain |
| Tag Game | Available when granted | Per-class grant | Uses the class gallery destination |
| Davening Player | Available when granted | Per-class grant | Existing ET/WT-specific student content is preserved |
| Chavrusa of the Day | Available when granted | Per-class grant | Existing roster/class checks remain |
| Name Picker | Available when granted | Per-class grant | Existing roster/class checks remain |
| Class Pointer | Available when granted | Per-class grant | Includes PDF presentation, screen sharing, and whiteboard mode |
| Sync to Nigri | Available only when granted and the school's Nigri gate allows it | Per-class grant | Retains the existing school/server gate from PR #742 |

## Teacher-only actions from the regular homepage

The hardcoded Teacher Tools actions are now defined in the shared registry and rendered from that metadata in Teacher Login.

| Action | Teacher Login | Access boundary |
|---|---|---|
| Student Report | Available per assigned class | Authenticated Teacher Center access and class chooser use assigned classes |
| Vocabulary Progress | Available per assigned class | Carries the selected class context |
| Manage Class / Student tool access | Available | Opens Teacher Center roster and student tools for the selected assigned class |
| Follow the Teacher | Available per assigned class | Carries class context; destination keeps its existing teacher/class gate |
| Send Everyone to Share Screen | Available when Class Pointer is granted | Class Pointer grant required; opens the selected class |
| Sign in as a Student | Available as a teacher action | Existing student-mode behavior; does not grant owner/admin access |

## Owner/Admin controls available in Teacher Login

- **Class Access:** open or lock a selected assigned class; manage supported class schedules, game availability, starred-game exceptions, and tool grants through the authenticated class-access endpoint.
- **Students:** see and manage the assigned class roster, passcodes, and each student's available tools through the scoped Student tab.
- **Student progress and reports:** Student Report and Vocabulary Progress are class-context actions. The report page's class selection is constrained by the signed-in teacher's current class assignments.
- **Activities:** teachers can manage availability for their selected class. The platform-wide Active/Inactive catalog remains owner-only.
- **PDF and whiteboard teaching:** available inside Class Pointer; these are not separate class grants.

## Intentionally restricted or excluded

| Owner/Admin capability | Teacher Login treatment | Reason |
|---|---|---|
| Create or move schools; school-wide sync configuration | Excluded | Platform-wide administration |
| Add/remove teachers or principals; assign staff or supervision | Excluded | Changes account roles and class membership |
| Create classes or move a class between schools | Excluded | Owner/school administration |
| School-wide student roster moves, bulk upload, import undo, bulk delete, exports, and audit log | Excluded | Cross-class or school-wide identity/data administration; teachers use the scoped roster instead |
| Emergency lock and platform-wide site/activity controls | Excluded | Affects every class; teachers retain per-class controls |
| Copy the owner's private Shorashim catalog, Posuk window, or Yiddish story into another class | Excluded | Distributes owner-owned resources; teachers manage their class resources inside their own tools |
| Private Class Dashboard with imported family/location details | Excluded | Its current data source is owner-private and is not class-scoped |
| Nigri grade selection and school connection settings | Excluded | School-level integration settings; the granted Sync to Nigri page still applies its existing school/server authorization |
| Owner preview of another teacher; owner Teacher View switch | Excluded from regular teachers | Owner-only preview/navigation controls |

## Regression coverage

`tests/owner-teacher-tool-registry.test.cjs` asserts that Owner Admin, the regular homepage, and Teacher Login consume the shared registry; every class grant has a teacher destination and owner category; teacher actions are registry-driven and class-aware; and owner-only Class Dashboard stays out of the teacher action list. Existing ET/WT browser journeys cover class-specific rendering, destination links, class switching, and assigned-class permissions.
