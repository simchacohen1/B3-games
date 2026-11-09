'use strict';
exports.funTorahStudentAuth = require('./student-auth').funTorahStudentAuth;
exports.funTorahTeacherClaim = require('./teacher-claim').funTorahTeacherClaim;
exports.funTorahManageStudents = require('./student-management').funTorahManageStudents;
exports.weeklyQuizStudent = require('./weekly-quiz-student').weeklyQuizStudent;
exports.studentRewardsAutoAward = require('./student-rewards-auto-award').studentRewardsAutoAward;
// Staging only (#710). Never add this to the production backend/functions codebase.
exports.stagingOwnerSignIn = require('./staging-owner-signin').stagingOwnerSignIn;
exports.multiplayerGameAction =require('./multiplayer-games').multiplayerGameAction;
