import { test, expect } from '@playwright/test';

// Mirrors smoke.spec.ts: without a configured Supabase URL and credentials
// the app renders the "not configured" notice instead of a login form, so
// these authenticated specs must skip rather than sit on a login field that
// will never appear.
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

test.describe('settings mobile navigation', () => {
  test.skip(
    !creds,
    'needs VITE_SUPABASE_URL plus E2E_EMAIL/E2E_PASSWORD (local Cloud Agent defaults to admin@thera.local)'
  );

  test.use({ viewport: { width: 390, height: 844 } });

  test('shows tap chips instead of a dropdown on phone', async ({ page }) => {
    await login(page);
    await page.goto('/settings');

    await expect(page.getByRole('navigation', { name: 'Settings sections' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Clinic profile/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Data & maintenance/ })).toBeVisible();

    await page.getByRole('button', { name: /Billing & invoicing/ }).click();
    await expect(page.getByRole('heading', { name: 'Billing & invoicing' })).toBeVisible();
    expect(page.url()).toContain('tab=billing');

    await page.getByRole('button', { name: /^Team/ }).click();
    await expect(page.getByRole('heading', { name: 'Therapists & team' })).toBeVisible();
    expect(page.url()).toContain('tab=team');
  });
});
