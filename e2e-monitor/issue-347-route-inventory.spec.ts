import { test, expect } from './fixtures';

/**
 * Issue #347 inventory: check that all 60 candidate pages exist on the live
 * site. These are GET-only requests: no page scripts, sign-in, or database
 * calls execute. A 200 does NOT mean the classroom feature is functional or
 * access-controlled. Those require separate browser/authenticated journeys.
 * Keep all candidate routes here until individually classified in #347.
 */
const PAGE_GROUPS: Record<string, string[]> = {
  "Home and administration": [
    "admin.html",
    "all-pages.html",
    "chossid-lamdan.html",
    "class-dashboard/index.html",
    "index.html",
    "owner-admin.html",
    "student-report/index.html",
    "teacher-home.html",
    "teacher-preview-tool.html",
    "teacher-student-split.html"
  ],
  "Chumash and quizzes": [
    "chazara/index.html",
    "chazara/teacher.html",
    "rashi-letters/student.html",
    "rashi-letters/teacher.html",
    "record_pesukim/progress.html",
    "record_pesukim/student.html",
    "record_pesukim/teacher.html",
    "shorashim/index.html",
    "shorashim/teacher.html",
    "weekly-quiz/B3SchoolMarksBridge.html",
    "weekly-quiz/chossid-lamdan.html",
    "weekly-quiz/index.html",
    "weekly-quiz/practice.html",
    "weekly-quiz/teacher.html"
  ],
  "Other learning tools": [
    "gematria/index.html",
    "gematria/teacher.html",
    "halacha/index.html",
    "halacha/teacher.html",
    "hebrew-reading-validation/index.html",
    "sefer-hamitzvos/index.html",
    "word-bank/index.html",
    "word-bank/teacher.html",
    "yiddish/index-library.html",
    "yiddish/index.html",
    "yiddish/story.html",
    "yiddish/sync.html",
    "yiddish/teacher.html"
  ],
  "Classroom and rewards": [
    "chavrusa/index.html",
    "class-gallery/index.html",
    "class-pointer-prototype/classroom.html",
    "class-pointer-prototype/dashboard.html",
    "class-pointer-prototype/index.html",
    "class-pointer-prototype/student-share-window.html",
    "class-pointer-prototype/student-view.html",
    "davening_student_app_et/index.html",
    "davening_student_app_wt/index.html",
    "follow-teacher/teacher.html",
    "game-show/player.html",
    "game-show/teacher.html",
    "name-picker/index.html",
    "student-rewards/index.html",
    "student-rewards/student.html",
    "student-rewards/teacher.html"
  ],
  "Teacher utilities": [
    "comment-log/b3-comment-log.html",
    "sync-to-nigri/chossid-lamdan.html",
    "sync-to-nigri/classtime.html",
    "sync-to-nigri/index.html",
    "sync-to-nigri/school-marks.html",
    "work-timer/index.html",
    "work_timer_v4/index.html"
  ]
};

test.describe('Issue 347: all 60 live HTML routes respond', () => {
  for (const [group, paths] of Object.entries(PAGE_GROUPS)) {
    for (const path of paths) {
      test(`${group} / ${path}`, async ({ request, baseURL }) => {
        const url = new URL(path, baseURL!);
        const started = Date.now();
        const response = await request.get(url.toString(), { failOnStatusCode: false });
        test.info().annotations.push({
          type: 'GET-only route audit; NOT a functional pass',
          description: `${path} | HTTP ${response.status()} | ${Date.now() - started} ms | ${url.toString()}`,
        });
        expect(response.status(), `${path} did not serve an HTML page; classify before excluding it from #347`).toBe(200);
        expect(response.headers()['content-type'] || '', `${path}: unexpected Content-Type`).toMatch(/text\/html/i);
      });
    }
  }
});
