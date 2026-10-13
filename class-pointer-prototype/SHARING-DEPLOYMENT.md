# Classroom Pointer activity screen sharing — deployment and acceptance

Source: `simchacohen1/B3-games`. Firebase project: `b3-games`.
This feature uses GitHub Pages for HTML/JS and a separately deployed Firebase Cloud Function for short-lived, class-scoped sharing authorizations.

## Deploy the backend (teacher/owner action on a computer with Firebase CLI)

In a **current checkout** of the repository, using PowerShell:
```powershell
git pull --ff-only
.\deploy-class-pointer.ps1
```
If the CLI asks you to authenticate, run `firebase login` and rerun the script. The script runs Node syntax checks and the Classroom Pointer tests, installs locked dependencies and deploys **only** `functions:classPointerShareAuth` to Firebase project `b3-games`. It does not deploy database rules, change other functions, or modify student progress. Keep credentials out of GitHub.

## Live teacher + student acceptance

1. Open Teacher Tools > Class Pointer, select the correct class, and confirm the teaching area opens within the Edge window without hiding tabs or address bar.
2. Open **Student Screens** in **Screens** mode. The classroom's `studentScreenSharing` flag should become true.
3. Have a signed-in student open Shorashim (or Chumash recording). **Share My Screen** should appear *in that activity*, without another login. Click it and choose the activity tab in the browser permission dialog.
4. The teacher should see a video titled with the student’s verified name. The boy can continue working in his original activity.
5. Click **Stop Sharing** in the activity. The teacher view should stop.
6. Disable Student Screens or switch to Whiteboards. The Share My Screen button should disappear and any active activity stream should close.
7. Have a boy assigned to a different class try to access this session; he must not receive sharing permission.
8. Re-enable sharing and verify pointer, highlighting, pen, eraser, spotlight, PDF, webpage, whiteboard, student permission toggles, existing board work and session end still work.

Browser permission prompts cannot be skipped. Screen sharing is live only; the new feature does not save video.

## Troubleshooting

- No Share My Screen button: Check the boy is signed in, his class matches the teacher's active class, and Student Screens is in Screens mode.
- Authorization error: Confirm `classPointerShareAuth` was deployed successfully and the teacher is still authenticated.
- Screen not appearing: Check school WebRTC/PeerJS network access and that browser screen sharing is permitted. Do not bypass Firebase rules or publish student passcodes.
- GitHub commit does **not** deploy a Firebase Function. Do not mark rollout completed before a real teacher/student test.
