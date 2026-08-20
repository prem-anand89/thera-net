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

test.describe('reports navigation', () => {
  test('insights tab=monthly shows monthly statement', async ({ page }) => {
    await login(page);
    await page.goto('/insights?tab=monthly');
    await expect(page.getByRole('heading', { name: 'Monthly statement' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Monthly statement' })).toHaveClass(/bg-\[var\(--teal\)\]/);
  });

  test('monthly print route opens print preview page', async ({ page }) => {
    await login(page);
    await page.goto('/insights/print?year=2026&month=8');
    await expect(page.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('/insights/print');
  });

  test('legacy /reports/print redirects to insights print', async ({ page }) => {
    await login(page);
    await page.goto('/reports/print?year=2026&month=8');
    await expect(page.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('/insights/print');
  });

  test('export as PDF from monthly statement', async ({ page }) => {
    await login(page);
    await page.goto('/insights?tab=monthly');
    await expect(page.getByRole('link', { name: 'Export as PDF' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'Export as PDF' }).click();
    await expect(page.getByRole('button', { name: 'Print / Save PDF' })).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('/insights/print');
  });

  test('generate report from ledger visits', async ({ page }) => {
    await login(page);
    await page.goto('/ledger');
    await expect(page.getByRole('link', { name: 'Generate report' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('link', { name: 'Generate report' }).click();
    await expect(page.getByRole('heading', { name: 'Monthly statement' })).toBeVisible({ timeout: 10_000 });
    expect(page.url()).toContain('tab=monthly');
  });
});
