'use strict';

// Deployment settings for the Davening endpoints (Chazzan and Chayus).
// Production: the ET and WT pages use the classes with those exact ids, and
// teachers must use verified Google sign-in.
// staging/build-davening-functions.cjs replaces this file in the staging-only
// codebase so the fictional staging classes and test teachers can be used.
module.exports = Object.freeze({
  classMap: Object.freeze({ et: 'et', wt: 'wt' }),
  stagingPasswordTeachers: false,
  cors: Object.freeze(['https://funtorahtools.com', 'https://www.funtorahtools.com',
    'https://simchacohen1.github.io', 'https://fun-torah-tools-staging.web.app'])
});
