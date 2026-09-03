B3 WEEKLY QUIZ - FIRST BUILD

FILES
- index.html      = permanent student quiz page
- teacher.html    = teacher dashboard / quiz editor

DESIGNED TO REUSE YOUR EXISTING B3 FIREBASE SETUP
- Same Firebase project/config as the Game Show files you uploaded.
- Same student roster: posukPractice/allowedStudents
- Same shared Class PIN: posukPractice/settings/classPin
- Same saved student login keys used by Posuk Practice / Game Show.
- Honors the B3 master site block and a per-game key named: weekly-quiz

CORE FEATURES IN THIS BUILD
1. Permanent student URL. Each week you create or activate a different saved quiz.
2. Multiple-choice quizzes with 2-4 choices.
3. Fast paste from Google Sheets / Excel:
   Question | Choice A | Choice B | Choice C | Choice D | Correct
   (tab-separated is best)
4. Teacher live grid:
   gray = not answered
   green = correct
   red = incorrect
5. Teacher-paced mode:
   - one question at a time
   - Open / Lock current question
   - Next automatically locks the current question and opens the next one
   - Reveal answer to student screens when you are ready to review
6. Open-test mode:
   - all questions are open
   - students can navigate question numbers
7. Students do NOT see whether they are right/wrong until the teacher reveals the answer.
8. Each answer is locked after submission, but the teacher can click a colored grid cell to clear it and let that student try again.
9. Results stay in Firebase by quiz.
10. Download CSV, or Copy for Google Sheets.

FIREBASE PATHS USED
b3Quiz/settings/activeQuizId
b3Quiz/quizzes/{quizId}
b3Quiz/sessions/{quizId}
b3Quiz/responses/{quizId}/{studentId}/{questionNumber}

GITHUB SUGGESTED LOCATION
Put this folder at:
B3-games/quiz/

Then:
Student: https://simchacohen1.github.io/B3-games/quiz/
Teacher: https://simchacohen1.github.io/B3-games/quiz/teacher.html

IMPORTANT SECURITY NOTE
Like your current Game Show, teacher.html uses a client-side convenience password (currently "class123"). That keeps ordinary students out of the teacher screen, but it is not strong security because a determined person can inspect static page source. For a third-grade classroom this may be sufficient operationally, but Firebase Authentication would be needed for real security.

FIREBASE RULES
This first build assumes your existing Firebase rules allow these b3Quiz paths. If the page says it cannot save/read data, send me your current Firebase Realtime Database rules and I can merge the exact rules needed without disturbing your existing apps.

GOOGLE CLASSROOM / GOOGLE SHEETS
This build stores results directly in Firebase and gives you one-click CSV / Copy for Google Sheets. Directly writing into a Google Sheet or Google Classroom is a separate integration step because it requires Google authorization; it should not be done by putting Google credentials into a public GitHub HTML file.
