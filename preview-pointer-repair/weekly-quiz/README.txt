B3 WEEKLY QUIZ - UPDATED BUILD

FILES
- index.html                     = permanent student quiz page
- teacher.html                   = teacher dashboard, quiz generator, launches, results, progress
- weekly-quiz-cloud-function.js  = secure AI generator backend to merge into Firebase Functions

WHAT CHANGED
1. BUILT-IN QUIZ GENERATOR
   - Default workflow is ONE quiz type at a time.
   - Shoreshim
   - Words & Phrases from the pesukim
   - Comprehension
   - Optional Mixed mode
   - 3 choices is the default; 4 choices is optional.
   - Paste the pesukim/source text, choose count, then Generate.
   - Generated items are all selected by default. Uncheck any you do not want.
   - Shoreshim: extracts useful roots represented in the pasted pesukim.
   - Words & Phrases: prioritizes primary / important lashon haposuk instead of testing every word.
   - Comprehension: drafts concrete source-based questions.
   - The generator ONLY drafts into the editor. You review before saving or launching.

2. ET AND WT ARE INDEPENDENT
   - A saved quiz no longer belongs to a class.
   - Save the question set once.
   - Launch it separately to East Track or West Track.
   - Each launch has its own date, answers, live session, and results.
   - Launching to one class has no effect on the other class.

3. LAUNCH HISTORY IS PRESERVED
   - Each administration is stored as a separate launch.
   - Historical launches are not overwritten when you launch the same quiz again.
   - Each launch stores a SNAPSHOT of the quiz questions, so editing the saved quiz later does not change old results.

4. RETAKES
   - Results page has a Retake button for each student.
   - A retake is launched only to that student and does not affect the rest of the class.
   - attemptGroupId, attemptNumber, and retakeOf are stored automatically.
   - Current skill averages use the newest attempt in a retake chain, while the teacher history keeps every attempt.

5. ADJUSTMENTS / AUDIT TRAIL
   - Click a colored answer cell in Live or Results.
   - Teacher may Mark Correct, Mark Incorrect, or Clear for Retry.
   - Adjustments and cleared answers are written to a teacher audit trail.
   - Parent-facing summary uses only the FINAL result, not adjustment details.

6. LONG-TERM STUDENT PROGRESS
   - Student Progress tab calculates Shoreshim, Words & Phrases, and Comprehension separately.
   - Retakes replace the earlier attempt for CURRENT averages.
   - Full assessment history remains visible to the teacher.
   - A parent-friendly summary can be copied. It uses final adjusted results only.

7. MANUAL PASTE BOX FIX
   - The teacher page no longer shows literal \\t characters as if you should type them.
   - Copying rows from Google Sheets / Excel inserts real tabs automatically.

FIREBASE DATA PATHS USED
b3Quiz/quizzes/{quizId}
b3Quiz/launches/{launchId}
b3Quiz/responses/{launchId}/{studentId}/{questionNumber}
b3Quiz/completions/{launchId}/{studentId}
b3Quiz/audit/{launchId}/{studentId}/{auditEventId}
b3Quiz/settings/activeLaunchByClass/et
b3Quiz/settings/activeLaunchByClass/wt
b3Quiz/settings/studentActiveLaunch/{studentId}

GITHUB LOCATION
Put these in:
B3-games/quiz/

Student:
https://simchacohen1.github.io/B3-games/quiz/

Teacher:
https://simchacohen1.github.io/B3-games/quiz/teacher.html

AI QUIZ GENERATOR - IMPORTANT
The public teacher.html must NOT contain an AI API key.
The teacher page calls this secure Firebase Cloud Function URL:
https://us-central1-b3-games.cloudfunctions.net/generateWeeklyQuiz

Use weekly-quiz-cloud-function.js in your existing Firebase Functions project.
It expects the Firebase secret ANTHROPIC_API_KEY.

Typical setup/deploy commands from your existing Firebase project:
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase deploy --only functions:generateWeeklyQuiz

If your existing functions/index.js already has exports and imports, MERGE the generateWeeklyQuiz export into that file rather than replacing your whole functions project.

The function's model can be changed with WEEKLY_QUIZ_MODEL / ANTHROPIC_MODEL if your existing project already manages the model name another way.

SECURITY NOTE
teacher.html still uses the same simple client-side convenience password pattern as the original first build (currently class123). That is fine as a classroom convenience lock, but it is not strong authentication because static HTML source is public. Firebase Authentication is the proper upgrade if you want true teacher-only security later.

FIREBASE RULES
This build assumes your existing rules permit the new b3Quiz paths above. If Firebase says Permission denied, send the current Realtime Database rules and merge only the needed b3Quiz rules rather than replacing your working Posuk Practice / B3 Games rules.
