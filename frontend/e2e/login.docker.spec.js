const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

const loginAsAdmin = async (page) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@getdefy.co');
  await page.getByLabel('Password').fill('defyadmin');
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL('/');
};

const actionableTransfer = {
  amount: '500',
  asset_dti: '4H95J0R2X',
  created_at: '2026-08-26T00:00:00.000Z',
  direction: 'outbound',
  expires_at: '2026-08-28T00:00:00.000Z',
  id: '11111111-1111-4111-8111-111111111111',
  protocol: 'TRP',
  retention_until: '2026-09-28T00:00:00.000Z',
  state: 'approved',
  updated_at: '2026-08-26T01:00:00.000Z',
};
const actionableTransferDetail = {
  ...actionableTransfer,
  actions: { can_cancel: true, can_confirm: true, can_email: false, can_retry: true },
  email_enabled: false,
  email_fallback_available_at: '2026-08-26T00:30:00.000Z',
  events: [],
};

test('authenticates the local administrator and exercises analytics plus all Travel Rule routes', async ({ page }) => {
  const browserErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await loginAsAdmin(page);
  await expect(page.getByRole('heading', { name: 'Travel Rule Overview' })).toBeVisible();
  // The login page's unauthenticated cookie-session probe intentionally returns 401.
  browserErrors.length = 0;
  for (const label of ['Total Transfers', 'Pending Inquiries', 'Confirmed Rate', 'Failed Messages']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  for (const range of ['7D', '30D', '90D']) {
    await expect(page.getByRole('radio', { name: range })).toBeVisible();
  }
  await page.getByRole('radio', { name: '7D' }).click();
  await expect(page.getByRole('radio', { name: '7D' })).toHaveAttribute('data-state', 'on');
  await expect(page.locator('svg[role="application"]').first()).toBeVisible();

  const routes = [
    ['Transfers', '/travel-rule/transfers', 'Travel Rule transfers'],
    ['Inquiries', '/travel-rule/inquiries', 'TRP inquiry review dashboard'],
    ['Messages', '/travel-rule/messages', 'Travel Rule messages'],
    ['Tokens', '/travel-rule/tokens', 'Travel Rule tokens'],
    ['Events', '/travel-rule/events', 'Travel Rule events'],
  ];
  for (const [link, pathname, region] of routes) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await expect(page).toHaveURL(pathname);
    await expect(page.getByRole('region', { name: region })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Transfers', exact: true }).click();
  await page.getByRole('button', { name: 'Create Travel Address' }).click();
  const addressDialog = page.getByRole('dialog', { name: 'Create Travel Address' });
  await addressDialog.getByLabel('Beneficiary reference').fill(`playwright-${Date.now()}`);
  await addressDialog.getByRole('button', { name: 'Create address' }).click();
  await expect(addressDialog).toBeHidden();

  await page.getByLabel('Direction filter').click();
  await page.getByRole('option', { name: 'Inbound' }).click();
  await page.getByLabel('State filter').click();
  await page.getByRole('option', { name: 'Pending' }).click();
  const viewTransfer = page.getByRole('button', { name: /^View transfer / }).first();
  await expect(viewTransfer).toBeVisible();
  await viewTransfer.click();
  await expect(page.getByRole('dialog', { name: 'Transfer details' })).toBeVisible();
  await page.getByRole('button', { name: 'Close sheet' }).click();

  const travelAddress = await page.evaluate(async () => {
    const csrfCookie = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('defy_csrf='));
    const csrfToken = csrfCookie ? decodeURIComponent(csrfCookie.slice('defy_csrf='.length)) : null;
    if (!csrfToken) throw new Error('CSRF cookie is unavailable while creating the Travel Address fixture.');
    const response = await fetch('/travel-rule/trp/management/travel-addresses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ beneficiary_reference: 'playwright-outbound-peer' }),
    });
    if (response.status !== 201) throw new Error(`Travel Address fixture returned ${response.status}`);
    return (await response.json()).travel_address;
  });
  await page.getByLabel('Direction filter').click();
  await page.getByRole('option', { name: 'All directions' }).click();
  await page.getByLabel('State filter').click();
  await page.getByRole('option', { name: 'All states' }).click();
  await page.getByRole('button', { name: 'New Transfer' }).click();
  const transferDialog = page.getByRole('dialog', { name: 'New Transfer' });
  await transferDialog.getByLabel('Travel Address').fill(travelAddress);
  await transferDialog.getByLabel('Asset DTI').fill('4H95J0R2X');
  await transferDialog.getByLabel('Amount').fill('25');
  await transferDialog.getByRole('button', { name: 'Next' }).click();
  await transferDialog.getByLabel('Originator primary identifier 1').fill('Smith');
  await transferDialog.getByLabel('Originator customer number').fill('123456');
  await transferDialog.getByRole('button', { name: 'Next' }).click();
  await transferDialog.getByLabel('Beneficiary legal name 1').fill('Acme Corp');
  await transferDialog.getByLabel('Beneficiary customer number').fill('789012');
  await transferDialog.getByRole('button', { name: 'Next' }).click();
  await transferDialog.getByRole('button', { name: 'Next' }).click();
  await transferDialog.getByRole('button', { name: 'Create transfer' }).click();
  await expect(transferDialog).toBeHidden();
  expect(browserErrors).toEqual([]);
});

test('renders the API Docs guide and searchable read-only reference', async ({ page }) => {
  const browserErrors = [];

  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await loginAsAdmin(page);
  browserErrors.length = 0;

  await page.getByRole('link', { name: 'Integration Guide', exact: true }).click();
  await expect(page).toHaveURL('/api-docs');
  await expect(page.getByRole('region', { name: 'Travel Rule API documentation' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Protocol-neutral v1' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'Protocol-neutral v1 quickstart' })).toContainText('Idempotency-Key');

  await page.getByRole('tab', { name: 'Direct TRP' }).click();
  await expect(page.getByRole('region', { name: 'Direct TRP quickstart' })).toContainText('Travel Address');

  await page.getByRole('button', { name: 'Copy environment setup' }).click();
  await expect(page.getByText('Copied to clipboard.')).toBeVisible();

  await page.getByRole('link', { name: 'View API Reference' }).first().click();
  await expect(page).toHaveURL('/api-docs/reference');
  await expect(page.getByRole('region', { name: 'Travel Rule API reference' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search endpoints' }).fill('mTLS');
  await expect(page.getByRole('status')).toContainText('3 endpoints');
  await page.getByText('/travel-rule/trp/protocol/confirmations/:token', { exact: true }).click();
  await expect(
    page
      .getByLabel('POST /travel-rule/trp/protocol/confirmations/:token')
      .getByText('mTLS + TRP headers', { exact: true }),
  ).toBeVisible();
  expect(browserErrors).toEqual([]);
});

test('keeps the authenticated shell and transfer detail responsive on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await loginAsAdmin(page);
  await expect(page.getByRole('heading', { name: 'Travel Rule Overview' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Toggle sidebar' }).click();
  await page.getByRole('link', { name: 'Transfers', exact: true }).click();
  await expect(page).toHaveURL('/travel-rule/transfers');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'New Transfer' }).click();
  const createDialog = page.getByRole('dialog', { name: 'New Transfer' });
  await expect(createDialog.getByRole('navigation', { name: 'Transfer creation progress' })).toBeVisible();
  await expect(createDialog.getByText('Step 1 of 5: Transfer')).toBeVisible();
  await expect.poll(() => createDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await createDialog.getByRole('button', { name: 'Cancel' }).click();
  const viewTransfer = page.getByRole('button', { name: /^View transfer / }).first();
  await expect(viewTransfer).toBeVisible();
  await viewTransfer.click();
  await expect(page.getByRole('dialog', { name: 'Transfer details' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('submits supported transfer confirmation, cancellation, and retry actions', async ({ page }) => {
  const submitted = [];

  await loginAsAdmin(page);
  await page.route('**/travel-rule/trp/management/transfers**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const detailPath = `/travel-rule/trp/management/transfers/${actionableTransfer.id}`;

    if (request.method() === 'GET' && url.pathname === '/travel-rule/trp/management/transfers') {
      await route.fulfill({
        body: JSON.stringify({ data: [actionableTransfer], limit: 20, page: 1, total: 1 }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname === detailPath) {
      await route.fulfill({
        body: JSON.stringify(actionableTransferDetail),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `${detailPath}/confirm`) {
      submitted.push({ body: request.postDataJSON(), operation: 'confirm' });
      await route.fulfill({
        body: JSON.stringify({ id: actionableTransfer.id, retryable: false, state: 'confirmed' }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (request.method() === 'POST' && url.pathname === `${detailPath}/retry`) {
      submitted.push({ operation: 'retry' });
      await route.fulfill({
        body: JSON.stringify({ id: actionableTransfer.id, retryable: false }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole('link', { name: 'Transfers', exact: true }).click();
  const openDetails = async () => {
    await page.getByRole('button', { name: `View transfer ${actionableTransfer.id}` }).click();
    return page.getByRole('dialog', { name: 'Transfer details' });
  };

  let details = await openDetails();
  await details.getByRole('button', { name: 'Confirm transfer' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Confirm transfer' });
  await confirm.getByLabel('Transaction ID').fill('tx-playwright-123');
  const confirmResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/travel-rule/trp/management/transfers/${actionableTransfer.id}/confirm`);
  await confirm.getByRole('button', { name: 'Confirm transfer' }).click();
  expect((await confirmResponse).status()).toBe(200);
  await expect(confirm).toBeHidden();
  await expect(details).toBeHidden();

  details = await openDetails();
  await details.getByRole('button', { name: 'Cancel transfer' }).click();
  const cancel = page.getByRole('alertdialog', { name: 'Cancel transfer?' });
  const cancelResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/travel-rule/trp/management/transfers/${actionableTransfer.id}/confirm`);
  await cancel.getByRole('button', { name: 'Confirm cancellation' }).click();
  expect((await cancelResponse).status()).toBe(200);
  await expect(cancel).toBeHidden();
  await expect(details).toBeHidden();

  details = await openDetails();
  await details.getByRole('button', { name: 'Retry delivery' }).click();
  const retry = page.getByRole('alertdialog', { name: 'Retry delivery?' });
  const retryResponse = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === `/travel-rule/trp/management/transfers/${actionableTransfer.id}/retry`);
  await retry.getByRole('button', { name: 'Retry delivery' }).click();
  expect((await retryResponse).status()).toBe(200);
  await expect(retry).toBeHidden();
  await expect(details).toBeHidden();
  expect(submitted).toEqual([
    { body: { txid: 'tx-playwright-123' }, operation: 'confirm' },
    { body: { canceled: null }, operation: 'confirm' },
    { operation: 'retry' },
  ]);
});

test('renders deterministic analytics loading, empty, and error states', async ({ page }) => {
  let mode = 'empty';
  let releaseInitialAnalytics;
  const initialAnalyticsGate = new Promise((resolve) => {
    releaseInitialAnalytics = resolve;
  });
  await page.route('**/travel-rule/trp/management/analytics?range=*', async (route) => {
    if (mode === 'empty') await initialAnalyticsGate;
    if (mode === 'error') {
      await route.fulfill({ body: '{}', contentType: 'application/json', status: 500 });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({
        asset_amounts: [], message_states: [], range_days: 30,
        summary: { confirmed_rate: 0, delivery_rate: 0, pending_inquiries: 0, transfers: 0 },
        transfer_states: [], trends: [],
      }),
      contentType: 'application/json',
      status: 200,
    });
  });
  await loginAsAdmin(page);
  await expect(page.getByRole('status', { name: 'Loading Travel Rule analytics' })).toBeVisible();
  releaseInitialAnalytics();
  await expect(page.getByText('No analytics data for this range.').first()).toBeVisible();
  mode = 'error';
  await page.getByRole('radio', { name: '7D' }).click();
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveText('Could not load Travel Rule analytics.');
  await expect(page.getByText('Analytics unavailable')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry analytics' })).toBeVisible();
  mode = 'empty';
  await page.getByRole('button', { name: 'Retry analytics' }).click();
  await expect(page.getByText('No analytics data for this range.').first()).toBeVisible();
});

test('denies Configuration and mutation controls to the normal user fixture', async ({ page }) => {
  const tokenFile = process.env.PLAYWRIGHT_USER_TOKEN_FILE;
  if (!tokenFile) throw new Error('PLAYWRIGHT_USER_TOKEN_FILE is required for Docker user authorization acceptance.');
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const transferPattern = '**/travel-rule/trp/management/transfers**';
  const transferHandler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const detailPath = `/travel-rule/trp/management/transfers/${actionableTransfer.id}`;

    if (request.method() === 'GET' && url.pathname === '/travel-rule/trp/management/transfers') {
      await route.fulfill({
        body: JSON.stringify({ data: [actionableTransfer], limit: 20, page: 1, total: 1 }),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    if (request.method() === 'GET' && url.pathname === detailPath) {
      await route.fulfill({
        body: JSON.stringify(actionableTransferDetail),
        contentType: 'application/json',
        status: 200,
      });
      return;
    }
    await route.fallback();
  };

  await page.context().addCookies([{
    httpOnly: true,
    name: 'defy_session',
    sameSite: 'Strict',
    secure: true,
    url: 'http://127.0.0.1:3000',
    value: token,
  }]);
  await page.route(transferPattern, transferHandler);
  try {
    await page.goto('/configuration');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Travel Rule Overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /docker-smoke-user@example\.invalid/i }).click();
    const userMenu = page.getByRole('menu');
    await expect(userMenu).toBeVisible();
    await expect(userMenu.getByRole('menuitem', { name: 'Settings', exact: true })).toBeVisible();
    await expect(userMenu.getByRole('menuitem', { name: 'Configuration', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Transfers', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Create Travel Address' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New Transfer' })).toHaveCount(0);
    const viewTransfer = page.getByRole('button', { name: `View transfer ${actionableTransfer.id}` });
    await expect(viewTransfer).toBeVisible();
    await viewTransfer.click();
    const details = page.getByRole('dialog', { name: 'Transfer details' });
    await expect(details).toBeVisible();
    await expect(details.getByRole('button', { name: 'Confirm transfer' })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Cancel transfer' })).toHaveCount(0);
    await expect(details.getByRole('button', { name: 'Retry delivery' })).toHaveCount(0);
  } finally {
    await page.unroute(transferPattern, transferHandler);
  }
});
