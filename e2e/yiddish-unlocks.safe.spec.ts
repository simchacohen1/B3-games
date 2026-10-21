import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Offline regression guard for the ET/WT unlock controls.
// This checks wiring, not end-to-end Firebase persistence.
const root = path.resolve(__dirname, '..');
const teacher = fs.readFileSync(path.join(root, 'yiddish/teacher.js'), 'utf8');
const student = fs.readFileSync(path.join(root, 'yiddish/app.js'), 'utf8');

test('Yiddish teacher saves each class unlock count separately', async () => {
  expect(teacher).toContain('draft.unlockedSteps[t]=n');
  expect(teacher).toContain('draft.unlocked[t]=sectionsFor(n)');
  expect(teacher).toContain("call('teacherSave',{config:draft})");
  expect(teacher).toContain('config=r.config');
});
test('Yiddish students use their own class unlock setting', async () => {
  expect(student).toContain('config.unlocked[student.classId]');
  expect(student).toContain('config.unlockedSteps[student.classId]');
  expect(student).toContain('stepNumber(g,p)<=n');
});
test('Yiddish teacher exposes ET and WT controls', async () => {
  expect(teacher).toContain("['et','wt']");
  expect(teacher).toContain("['et','wt'].includes(t)?t:'et'");
});
