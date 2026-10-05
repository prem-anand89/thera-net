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

  test('shows six section chips and switches tabs', async ({ page }) => {
    await login(page);
    await page.goto('/settings');

    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav).toBeVisible();
    for (const label of ['General', 'Team', 'Services', 'Booking', 'Billing', 'Account']) {
      await expect(nav.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
    }

    await nav.getByRole('button', { name: /^Billing/ }).click();
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    expect(page.url()).toContain('tab=billing');

    await nav.getByRole('button', { name: /^Team/ }).click();
    await expect(page.getByRole('heading', { name: 'Therapists & team' })).toBeVisible();
    expect(page.url()).toContain('tab=team');
  });

  test('old tab links land on the new section', async ({ page }) => {
    await login(page);
    await page.goto('/settings?tab=partner');
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    await page.goto('/settings?tab=patientComms');
    await expect(page.getByRole('heading', { name: 'Booking', exact: true })).toBeVisible();
  });
});

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'ipad-portrait', width: 744, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
]) {
  test.describe(`settings has no sideways scroll (${viewport.name})`, () => {
    test.skip(!creds, 'needs VITE_SUPABASE_URL plus E2E_EMAIL/E2E_PASSWORD');
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('every tab fits the screen width', async ({ page }) => {
      await login(page);
      for (const tab of ['general', 'team', 'services', 'booking', 'billing', 'account']) {
        await page.goto(`/settings?tab=${tab}`);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${tab} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
      }
    });
  });
}
