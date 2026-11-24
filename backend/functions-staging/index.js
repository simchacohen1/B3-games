'use strict';
exports.funTorahStudentAuth = require('./student-auth').funTorahStudentAuth;
exports.funTorahTeacherClaim = require('./teacher-claim').funTorahTeacherClaim;
exports.funTorahManageStudents = require('./student-management').funTorahManageStudents;
exports.weeklyQuizStudent = require('./weekly-quiz-student').weeklyQuizStudent;
exports.studentRewardsAutoAward = require('./student-rewards-auto-award').studentRewardsAutoAward;
exports.multiplayerGameAction = require('./multiplayer-games').multiplayerGameAction;
exports.privateMediaUrl = require('./private-media-url').privateMediaUrl;
exports.teacherStudentFiles = require('./teacher-student-files').teacherStudentFiles;
exports.classWorksheets = require('./class-worksheets').classWorksheets;
exports.studentRewardsTeacher = require('./rewards-teacher').studentRewardsTeacher;
exports.studentLocks = require('./student-locks').studentLocks;
exports.studentRewardsLogin = require('./student-rewards-functions').studentRewardsLogin;
exports.studentRewardsRedeem = require('./student-rewards-functions').studentRewardsRedeem;
exports.studentRewardsCancel = require('./student-rewards-functions').studentRewardsCancel;
// Staging-only functions that were deployed from other branches. Kept here so a staging deploy of this codebase does not delete them.
exports.classGalleryRead = require('./class-gallery-read').classGalleryRead;
exports.stagingOwnerSignIn = require('./staging-owner-signin').stagingOwnerSignIn;
exports.funTorahClassAccess = require('./class-access').funTorahClassAccess;
