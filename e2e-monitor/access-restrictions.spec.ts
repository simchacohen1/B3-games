import { test, expect } from '@playwright/test';
import { DATABASE_URL, FUNCTIONS_URL } from './helpers';

// Confirms private data stays private to a visitor with no sign-in.
// Only reads (GET) are sent; GET requests cannot change the database.
// Only areas already locked on the live site are listed here, so these
// tests pass today and fail loudly if a rules change ever reopens them.

const PRIVATE_DATABASE_PATHS = [
  'b3Private',                 // passcodes and sign-in limits
  'b3Games',                   // whole game area (locked at the top since PR 334)
  'b3Games/students',          // student records (PR 334)
];

test.describe('Database privacy for signed-out visitors', () => {
  for (const path of PRIVATE_DATABASE_PATHS) {
    test(`${path} cannot be read`, async ({ request }) => {
      const response = await request.get(`${DATABASE_URL}/${path}.json?shallow=true`);
      expect(response.status(), `${path} should be private`).toBe(401);
    });
  }
});

test.describe('Server functions refuse visitors', () => {
  test('student sign-in only accepts POST', async ({ request }) => {
    const response = await request.get(`${FUNCTIONS_URL}/funTorahStudentAuth`);
    expect(response.status()).toBe(405);
  });
});
