import { test, expect } from '@playwright/test';

function e2eCredentials() {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  const url = process.env.VITE_SUPABASE_URL;
  if (!url || !email || !password) return null;
  return { email, password };
}

function syncButton(page: import('@playwright/test').Page, status: RegExp) {
  return page.getByRole('button', { name: status });
}

// White-screen guard: the app must render one of its two legitimate landing
// states (the login page when Supabase is configured, or the setup notice
// when it isn't). Asserting either — rather than guessing which from the
// runner's env — keeps this robust whether or not a local .env is present,
// while still catching a crash-on-boot / blank-page regression.
test('app boots without crashing', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Sign in' }).or(page.getByText('Supabase not configured'))
  ).toBeVisible();
});

test.describe('authenticated flow', () => {
  const creds = e2eCredentials();

  test.skip(
    !creds,
    'needs VITE_SUPABASE_URL plus E2E_EMAIL/E2E_PASSWORD (local Cloud Agent defaults to admin@thera.local)'
  );

  test('login → log visit offline → sync', async ({ page, context }) => {
    test.skip(!creds);
    await page.goto('/');
    await page.getByLabel('Email').fill(creds!.email);
    await page.getByLabel('Password').fill(creds!.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Ledger' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Setup: first week' })).toBeVisible({ timeout: 15_000 });
    await expect(syncButton(page, /^Sync: Synced$/)).toBeVisible({ timeout: 45_000 });

    const patientName = `E2E Patient ${Date.now()}`;

    // Pull catalog while still online so therapist/service selects are populated.
    await page.getByRole('link', { name: '+ New visit' }).click();
    await expect(page.getByRole('heading', { name: 'New visit' })).toBeVisible();
    await expect(page.getByLabel('Therapist *').locator('option', { hasText: 'Therapist One' })).toHaveCount(1, {
      timeout: 30_000,
    });
    await expect(page.getByLabel('Service *').locator('option', { hasText: 'Initial Consultation' })).toHaveCount(1);

    await context.setOffline(true);
    await expect(syncButton(page, /^Sync: Offline/)).toBeVisible();

    await page.getByRole('button', { name: '+ New patient' }).click();
    await page.getByLabel('Name *').fill(patientName);
    await page.getByRole('button', { name: 'Create patient' }).click();
    await expect(page.getByText('No previous visits on record')).toBeVisible();
    await page.getByLabel('Therapist *').selectOption({ label: 'Therapist One' });
    await expect(page.getByLabel('Therapist *')).toHaveValue(/.+/);
    const serviceSelect = page.getByLabel('Service *');
    const initialConsultation = await serviceSelect
      .locator('option', { hasText: 'Initial Consultation' })
      .first()
      .getAttribute('value');
    await serviceSelect.selectOption(initialConsultation!);
    await page.getByRole('button', { name: 'Take payment later', exact: true }).click();
    await page.getByRole('button', { name: 'Save visit' }).click();
    await expect(page.getByRole('heading', { name: 'Visit logged' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('row', { name: new RegExp(patientName) })).toBeVisible();
    await expect(syncButton(page, /^Sync: Offline/)).toBeVisible();

    await context.setOffline(false);
    await expect(syncButton(page, /^Sync: Synced$/)).toBeVisible({ timeout: 60_000 });

    const visitRow = page.getByRole('row', { name: new RegExp(patientName) });
    await visitRow.getByRole('button', { name: 'Edit patient' }).click();
    await page.getByLabel('Phone').fill('9876543210');
    await page.getByLabel('Referral source').selectOption({ label: 'Hospital referral' });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: 'Edit patient' })).toHaveCount(0);
    await expect(syncButton(page, /sync issue/i)).toHaveCount(0);
    await expect(syncButton(page, /^Sync: Synced$/)).toBeVisible({ timeout: 30_000 });

    await visitRow.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Issue invoice' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page.getByText(/Invoice .+ issued for/)).toBeVisible({ timeout: 20_000 });
  });
});
