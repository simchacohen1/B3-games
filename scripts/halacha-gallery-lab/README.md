# Halacha → Class Gallery lab

End-to-end check of the Halacha "Send to Class Gallery" flow with **synthetic students only**.
Nothing here contacts the production Firebase project.

What is real and what is simulated:

- **Real:** the Halacha page and every script it loads (served from this checkout), and the Cloud Function handlers
  `classGallerySubmit`, `classGalleryRead` and `funTorahStudentAuth` from `backend/functions`.
- **Simulated:** `firebase-admin` (in-memory database and Storage), the browser Firebase SDK
  (`mock-firebase-compat.js`), and Realtime Database rules, which are evaluated with
  [targaryen](https://www.npmjs.com/package/targaryen) against the rules file you choose.

## Run

```sh
npm i --no-save targaryen@3 @sparticuz/chromium   # or set CHROMIUM_PATH to any Chromium
node scripts/halacha-gallery-lab/run.cjs                                   # hardened rules (default)
node scripts/halacha-gallery-lab/run.cjs --rules path/to/production-rules-snapshot.json
node scripts/halacha-gallery-lab/run.cjs --baseline --only BASELINE        # run on an unfixed checkout
```

Pictures that the fake Storage received, plus screenshots, are written to `--out` (default: the OS temp folder).

## Scenarios

ET, WT and custom-class submissions (with ET/WT routing and pending status); both scrapbook pages,
coloring, drawings, photos and text in the picture; impersonation and class spoofing refused; rate
limit and offline messages; the site-wide "Add to Gallery" button; teacher-only visibility until approval;
no button in teacher preview; existing posts and saved Halacha work unchanged.

The CI-friendly subset (no browser) is `tests/halacha-gallery-submit.test.cjs`.
