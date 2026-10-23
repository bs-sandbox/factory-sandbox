import { test, expect } from '@playwright/test';

test('LIV-44 S3 throwaway: deliberately failing test', () => {
  expect(1).toBe(2);
});
