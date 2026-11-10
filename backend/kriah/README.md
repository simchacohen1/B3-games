# Kriah Assessment Center — Production Backend

This is the production Cloud Function for the Kriah Assessment Center on Fun Torah Tools.

## One-time setup before first deploy

1. Create a private GCS bucket named `fun-torah-tools-kriah-private` in the `fun-torah-tools` project.
   - Enable **Uniform bucket-level access**
   - Enable **Public access prevention** (enforced)
   - Grant the Cloud Functions service account `roles/storage.objectAdmin` on the bucket.

2. In Firebase Realtime Database rules, add a rule so that the path `b3Private/kriahAssessmentCenter/` is only readable/writable by authenticated Cloud Functions (not by clients directly).

## Deploy

From the **repo root** (not this folder):

```powershell
cd backend/kriah
npm install
cd ../..
firebase deploy --only functions:kriahAssessment --project fun-torah-tools
```

## Enabling Kriah for a class

In Firebase RTDB, set:
```
b3Games/workspaces/b3-2026/classes/<classId>/toolGrants/kriah-assessment = true
```

Then the class will appear in the teacher's Kriah Assessment Center dropdown.
