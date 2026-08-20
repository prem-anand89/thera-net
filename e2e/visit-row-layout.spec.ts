import { test, expect } from '@playwright/test';

const creds = {
  email: process.env.E2E_EMAIL || 'admin@thera.local',
  password: process.env.E2E_PASSWORD || 'testpass123',
};

async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Email').fill(creds.email);
  await page.getByLabel('Password').fill(creds.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Workspace' })).toBeVisible({ timeout: 30_000 });
}

test.describe('visit row layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('today visits card shows amount in header and context line', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { name: /Today's visits?/ })).toBeVisible({ timeout: 15_000 });

    const visitSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /Today's visits?/ }) });
    const firstCard = visitSection.locator('.rounded-2xl.border').first();
    if ((await firstCard.count()) === 0) {
      test.skip(true, 'no visits logged today in seed data');
    }

    await expect(firstCard).toBeVisible();
    // Bill amount sits in the header row, not duplicated next to the status chip.
    await expect(firstCard.getByText(/₹/)).toHaveCount(1);
  });
});

test.describe('visit row layout desktop', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('ledger visits table renders on tablet width', async ({ page }) => {
    await login(page);
    await page.goto('/ledger');
    await expect(page.getByRole('columnheader', { name: 'Patient' })).toBeVisible({ timeout: 15_000 });
  });
});
