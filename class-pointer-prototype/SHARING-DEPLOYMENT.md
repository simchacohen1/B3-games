# Classroom Pointer activity screen sharing — deployment and acceptance

Source: `simchacohen1/B3-games`. Firebase project: `b3-games`.
This feature uses GitHub Pages for HTML/JS and separately deployed Firebase Cloud Functions for short-lived, class-scoped sharing authorizations and scheduled expiry cleanup.

## Deploy the backend (teacher/owner action on a computer with Firebase CLI)

In a **current checkout** of the repository, using PowerShell:
```powershell
git pull --ff-only
.\deploy-class-pointer.ps1
```
If the CLI asks you to authenticate, run `firebase login` and rerun the script. The script runs Node syntax and Class Pointer security checks, installs locked dependencies and deploys **only** `functions:classPointerShareAuth` and `functions:cleanupClassPointerShareTickets` to Firebase project `b3-games`. It does not deploy database rules, change other functions, or modify student progress. Keep credentials out of GitHub.

The `firebase-rules.json` change must be reviewed against the currently deployed rules and deployed separately with `firebase deploy --only database --project b3-games`. This updates the complete Realtime Database ruleset, so review the full diff and run the security-rules emulator suite before doing so. The new rule grants session writes only to the bootstrap owner, an active administrator, or a teacher whose active workspace record explicitly assigns the exact class. ET and WT remain separate class paths. The `b3Private/classPointerShareTickets` data remains unreadable and unwritable from clients; the expiry index is only for the Admin SDK cleanup query.

## Live teacher + student acceptance

1. Open Teacher Tools > Class Pointer, select the correct class, and confirm the teaching area opens within the Edge window without hiding tabs or address bar.
2. Open **Student Screens** in **Screens** mode. The classroom's `studentScreenSharing` flag should become true.
3. Have a signed-in student open Shorashim (or Chumash recording). **Share My Screen** should appear *in that activity*, without another login. Click that button directly and choose **Entire Screen** in the browser's permission dialog; there is no separate invitation popup or share tab.
4. The teacher should see a video titled with the student’s verified name. The boy can continue working in his original activity.
5. Click **Stop Sharing** in the activity. The teacher view should stop.
6. Switch from **Student Screens** to **Student Whiteboards**: the student's whiteboard should appear above his current activity without opening another tab. The approved screen capture may continue, but its video is shown to the teacher only in Student Screens. Switching views alone must not require a new consent click. An explicit sharing disable, Stop Sharing, or class end stops capture.
7. Have a boy assigned to a different class try to access this session; he must not receive sharing permission.
8. Re-enable sharing and verify pointer, highlighting, pen, eraser, spotlight, PDF, webpage, whiteboard, student permission toggles, existing board work and session end still work.

Browser permission prompts cannot be skipped. Screen sharing is live only; the new feature does not save video.

## Troubleshooting

- No Share My Screen button: Check the boy is signed in, his class matches the teacher's active class, and Student Screens is in Screens mode.
- Authorization error: Confirm `classPointerShareAuth` was deployed successfully and the teacher is still authenticated.
- Screen not appearing: Check school WebRTC/PeerJS network access and that browser screen sharing is permitted. Do not bypass Firebase rules or publish student passcodes.
- GitHub commit does **not** deploy a Firebase Function. Do not mark rollout completed before a real teacher/student test.
