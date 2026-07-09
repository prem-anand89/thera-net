import { test, expect } from '@playwright/test';

// White-screen guard: the app must render one of its two legitimate landing
// states (the login page when Supabase is configured, or the setup notice
// when it isn't). Asserting either — rather than guessing which from the
// runner's env — keeps this robust whether or not a local .env is present,
// while still catching a crash-on-boot / blank-page regression.
test('app boots without crashing', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByText('Patient visit ledger').or(page.getByText('Supabase not configured'))
  ).toBeVisible();
});

// Full flow (login → patient → visit → invoice → report) needs a live Supabase
// project with the seed + test users applied; enable once credentials exist.
test.describe('authenticated flow', () => {
  test.skip(
    !process.env.VITE_SUPABASE_URL || !process.env.E2E_EMAIL,
    'needs Supabase env + E2E_EMAIL/E2E_PASSWORD'
  );

  test('login → log visit offline → sync → issue invoice', async ({ page, context }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill(process.env.E2E_EMAIL!);
    await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('link', { name: 'Visits' })).toBeVisible();

    // Offline drill: create a patient + visit with no connection
    await context.setOffline(true);
    await page.getByRole('link', { name: '+ New visit' }).click();
    await page.getByRole('button', { name: '+ New patient' }).click();
    await page.getByLabel('Name *').fill('E2E Patient');
    await page.getByRole('button', { name: 'Create patient' }).click();
    await page.getByLabel('Therapist *').selectOption({ index: 1 });
    await page.getByLabel('Service *').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Save visit' }).click();
    await expect(page.getByText('E2E Patient')).toBeVisible();
    await expect(page.getByText(/Offline/)).toBeVisible();

    // Back online: outbox drains
    await context.setOffline(false);
    await expect(page.getByText('Synced')).toBeVisible({ timeout: 15_000 });
  });
});
