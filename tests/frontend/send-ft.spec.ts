import { expect, test } from '@playwright/test';

const MOCK_API_BASE = 'http://localhost:4000';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('Send FT demo UI', () => {
  test('submits a transfer request and surfaces the response', async ({ page }) => {
    await page.route('**/send-ft', async (route) => {
      const request = route.request();
      const payload = request.postDataJSON() as Record<string, unknown>;

      expect(payload).toMatchObject({
        receiverId: 'receiver.testnet',
        amount: '1000',
        memo: 'Test memo',
      });

      await wait(50);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'success',
          transactionHashes: ['mock-transaction-hash'],
        }),
      });
    });

    await page.goto('/');

    await expect(page.locator('h1')).toHaveText('NEAR FT Send Demo');

    await page.fill('#apiBase', MOCK_API_BASE);
    await page.fill('#receiverId', 'receiver.testnet');
    await page.fill('#amount', '1000');
    await page.fill('#memo', 'Test memo');

    const submitButton = page.locator('#submit-btn');
    await submitButton.click();

    await expect(submitButton).toBeDisabled();

  const responsePanel = page.locator('#response');
  await expect(responsePanel).toContainText('Transfer request accepted');
  await expect(responsePanel).toContainText('Receiver: receiver.testnet');
  await expect(responsePanel).not.toHaveAttribute('data-state', 'error');

  const rawDetails = page.locator('#raw-response');
  await expect(rawDetails).toBeVisible();
  await rawDetails.locator('summary').click();
  await expect(page.locator('#raw-response-body')).toContainText('mock-transaction-hash');

    await expect(submitButton).toBeEnabled();

    const latestLogEntry = page.locator('#log li').first();
    await expect(latestLogEntry).toContainText('POST /send-ft → 200');
  });

  test('performs a health check and displays status', async ({ page }) => {
    await page.route('**/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          timestamp: '2024-01-01T00:00:00Z',
        }),
      });
    });

    await page.goto('/');
    await page.fill('#apiBase', MOCK_API_BASE);

    const healthButton = page.locator('#health-btn');
    await healthButton.click();

  const responsePanel = page.locator('#response');
  await expect(responsePanel).toContainText('Health: ok');

  const rawDetails = page.locator('#raw-response');
  await expect(rawDetails).toBeVisible();
  await rawDetails.locator('summary').click();
  await expect(page.locator('#raw-response-body')).toContainText('"status": "ok"');

    const latestLogEntry = page.locator('#log li').first();
    await expect(latestLogEntry).toContainText('GET /health → 200');
  });
});
