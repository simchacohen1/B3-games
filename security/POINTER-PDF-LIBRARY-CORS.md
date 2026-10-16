# Cloud Storage CORS for private Class Pointer PDF downloads

The private PDF library saves and lists PDFs with the Firebase Storage SDK; that does **not** establish that a browser may download the file body. The secure PDF opener calls `https://firebasestorage.googleapis.com/v0/b/.../o/...?...alt=media` with the signed-in user's Firebase ID token, so the browser performs a cross-origin request that requires Cloud Storage bucket CORS.

Symptom: the library lists a saved file, but Open shows **Failed to fetch**. This is consistent with missing or incomplete CORS; confirm via browser Network/Console if needed. It does **not** establish that the file is deleted or that Storage owner-access rules are broken.

## One-time setup

1. In the Google Cloud Console for project `b3-games`, open **Cloud Storage → Buckets → b3-games.firebasestorage.app → Configuration → Cross-origin resource sharing**.
2. Check whether the bucket has existing CORS entries. **Preserve any additional origins/methods/response headers already in use**. Add GET for the actual webpage origin `https://funtorahtools.com`. The example in `security/pointer-pdf-library-cors.example.json` also covers the www and GitHub Pages origins.
3. To set the example from Cloud Shell (or local authenticated gcloud CLI), after checking that it safely includes existing CORS settings, run:
   `gcloud storage buckets update gs://b3-games.firebasestorage.app --cors-file=pointer-pdf-library-cors.example.json`
   For current Google Cloud Consoles supporting CORS editing, use the CORS editor instead; add the exact origins with method GET and relevant response headers.
4. Wait for propagation, then reload Class Pointer and use **📚 PDF Library → Open**.
5. Test on a teacher session and verify the PDF loads. Re-check student or another teacher cannot read another teacher's files. CORS does **not** grant permissions: Firebase Storage Security Rules still decide who can access the objects.

**No bucket CORS change can be made by a static GitHub Pages code deployment.** The CORS config is on Google Cloud Storage, not in Firebase Storage Rules.

Source: [Firebase download documentation](https://firebase.google.com/docs/storage/web/download-files#cors_configuration) and [Google Cloud CORS setup](https://docs.cloud.google.com/storage/docs/using-cors).
