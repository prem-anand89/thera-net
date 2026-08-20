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

test.describe('mobile list layouts', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('workspace today visits and packages use card layout', async ({ page }) => {
    await login(page);
    await expect(page.getByRole('heading', { name: /Today's visits?/ })).toBeVisible({ timeout: 15_000 });

    const visitsSection = page.locator('section').filter({ has: page.getByRole('heading', { name: /Today's visits?/ }) });
    const patientLink = visitsSection.getByRole('link').first();
    if ((await patientLink.count()) > 0) {
      await expect(visitsSection.getByText(/₹/).first()).toBeVisible();
      await expect(visitsSection.getByText(/₹/)).toHaveCount(1);
    }

    const packagesSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Packages' }) });
    await packagesSection.scrollIntoViewIfNeeded();
    const packageCard = packagesSection.locator('.rounded-2xl.border').first();
    if ((await packageCard.count()) > 0) {
      await expect(packageCard.getByText(/Log visit/)).toBeVisible();
      await expect(packageCard.getByText(/Open|Stale/)).toBeVisible();
    }
  });

  test('patients list uses card layout with bill in header', async ({ page }) => {
    await login(page);
    await page.goto('/patients');
    await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible({ timeout: 15_000 });

    const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'All Patients' }) });
    const card = section.locator('.rounded-2xl.border').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.getByRole('link', { name: '+ Visit' }).first()).toBeVisible();
  });

  test('ledger visits use card layout on phone', async ({ page }) => {
    await login(page);
    await page.goto('/ledger');
    await expect(page.getByRole('link', { name: 'Generate report' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.rounded-2xl.border').first()).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Patient' })).toHaveCount(0);
  });
});
