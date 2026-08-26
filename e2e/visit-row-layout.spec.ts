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

test.describe('visit row layout', () => {
  test.skip(
    !creds,
    'needs VITE_SUPABASE_URL plus E2E_EMAIL/E2E_PASSWORD (local Cloud Agent defaults to admin@thera.local)'
  );

  test.use({ viewport: { width: 390, height: 844 } });

  test('today visits card shows amount in header and context line', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { name: /Today's visits?/ })).toBeVisible({ timeout: 15_000 });

    const visitSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /Today's visits?/ }) });
    await expect(visitSection).toBeVisible();
    const firstVisit = visitSection.getByRole('link').first();
    if ((await firstVisit.count()) === 0) {
      test.skip(true, 'no visits logged today in seed data');
    }

    // Bill amount sits in the header row, not duplicated next to the status chip.
    await expect(visitSection.getByText(/₹/).first()).toBeVisible();
    await expect(visitSection.getByText(/₹/)).toHaveCount(1);
    await expect(visitSection.getByText('Therapist', { exact: true }).first()).toBeVisible();
    await expect(visitSection.getByText('Condition', { exact: true }).first()).toBeVisible();
  });
});

test.describe('visit row layout desktop', () => {
  test.skip(
    !creds,
    'needs VITE_SUPABASE_URL plus E2E_EMAIL/E2E_PASSWORD (local Cloud Agent defaults to admin@thera.local)'
  );

  test.use({ viewport: { width: 1024, height: 768 } });

  test('ledger visits table column order', async ({ page }) => {
    await login(page);
    await page.goto('/ledger');
    const headers = page.getByRole('columnheader');
    await expect(headers.filter({ hasText: 'Patient' })).toBeVisible({ timeout: 15_000 });
    const order = await headers.allTextContents();
    const therapistIdx = order.indexOf('Therapist');
    const conditionIdx = order.indexOf('Condition');
    const treatmentIdx = order.indexOf('Treatment');
    const serviceIdx = order.indexOf('Service');
    expect(therapistIdx).toBeGreaterThan(-1);
    expect(therapistIdx).toBeLessThan(conditionIdx);
    expect(conditionIdx).toBeLessThan(treatmentIdx);
    expect(treatmentIdx).toBeLessThan(serviceIdx);
  });
});
