import { test, expect } from '@playwright/test';

function e2eCredentials() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const url = process.env.VITE_SUPABASE_URL;
  if (!url || !email || !password) return null;
  return { email, password };
}

const creds = e2eCredentials();

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(creds!.email);
  await page.getByLabel('Password').fill(creds!.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible({ timeout: 30_000 });
}

const ROUTES = ['/workspace', '/schedule?tab=feedback', '/ledger', '/patients', '/settings?tab=team'];

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test.describe(`nav highlights the current page (${viewport.name})`, () => {
    test.skip(!creds, 'needs VITE_SUPABASE_URL plus E2E_EMAIL/E2E_PASSWORD');
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('exactly one visible nav item is marked current on each main route', async ({ page }) => {
      await login(page);
      for (const route of ROUTES) {
        await page.goto(route);
        const current = page.locator('[aria-current="page"]:visible');
        // Settings has no header item on desktop (it lives in the account menu).
        const expected = viewport.name === 'desktop' && route.startsWith('/settings') ? 0 : 1;
        await expect(current, route).toHaveCount(expected);
      }
    });
  });
}
