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

test.describe('mobile list layouts', () => {
  test.skip(
    !creds,
    'needs VITE_SUPABASE_URL plus E2E_EMAIL/E2E_PASSWORD (local Cloud Agent defaults to admin@thera.local)'
  );

  test.use({ viewport: { width: 390, height: 844 } });

  test('workspace today visits and packages use card layout', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { name: /Today's visits?/ })).toBeVisible({ timeout: 15_000 });

    const visitsSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /Today's visits?/ }) });
    const patientLink = visitsSection.getByRole('link').first();
    if ((await patientLink.count()) > 0) {
      await expect(visitsSection.getByText(/₹/).first()).toBeVisible();
      await expect(visitsSection.getByText(/₹/)).toHaveCount(1);
      await expect(visitsSection.getByRole('columnheader', { name: 'Patient' })).toHaveCount(0);
    }

    const packagesSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Packages' }) });
    await packagesSection.scrollIntoViewIfNeeded();
    const packageCard = packagesSection.locator('.rounded-2xl.border').first();
    if ((await packageCard.count()) > 0) {
      await expect(packageCard.getByText(/Log visit/)).toBeVisible();
      await expect(packageCard.getByText(/Open|Stale/)).toBeVisible();
      await expect(packagesSection.getByRole('columnheader', { name: 'Patient' })).toHaveCount(0);
    }
  });

  test('workspace uses table on iPad portrait width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await login(page);
    await expect(page.getByRole('heading', { name: /Today's visits?/ })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('columnheader', { name: 'Patient' })).toBeVisible({ timeout: 15_000 });
  });

  test('patients list uses flat rows with action in footer', async ({ page }) => {
    await login(page);
    await page.goto('/patients');
    await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible({ timeout: 15_000 });

    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'All Patients' }) });
    await expect(section.getByRole('link', { name: '+ Visit' }).first()).toBeVisible({ timeout: 10_000 });
    await expect(section.getByRole('columnheader', { name: 'Name' })).toHaveCount(0);
  });

  test('ledger visits use card layout on phone', async ({ page }) => {
    await login(page);
    await page.goto('/ledger');
    await expect(page.getByRole('link', { name: 'Generate report' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.rounded-2xl.border').first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Patient' })).toHaveCount(0);
  });

  test('ledger uses table on iPad portrait width', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await login(page);
    await page.goto('/ledger');
    await expect(page.getByRole('link', { name: 'Generate report' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('columnheader', { name: 'Patient' })).toBeVisible({ timeout: 15_000 });
  });
});
