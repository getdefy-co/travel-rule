const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const transferId = '11111111-1111-4111-8111-111111111111';
const createdAt = '2026-09-08T10:00:00.000Z';
const fixtures = {
  inquiries: { id: transferId, state: 'pending', asset_dti: '4H95J0R2X', amount: '500', expires_at: null, created_at: createdAt, updated_at: createdAt },
  messages: {
    id: '22222222-2222-4222-8222-222222222222', transfer_id: transferId, phase: 'inquiry', direction: 'inbound',
    logical_identifier: '33333333-3333-4333-8333-333333333333', request_identifier: '44444444-4444-4444-8444-444444444444',
    delivery_state: 'received', status_code: 200, error_code: null, superseded_by: null, created_at: createdAt, delivered_at: null,
  },
  tokens: { id: '55555555-5555-4555-8555-555555555555', transfer_id: transferId, purpose: 'inquiry', expires_at: '2030-01-01T00:00:00.000Z', consumed_at: null, created_at: createdAt },
  events: { id: '9223372036854775807', transfer_id: transferId, event_type: 'manual_approval', from_state: 'pending', to_state: 'approved', actor_user_id: '9007199254740992', actor_role: 'user', created_at: createdAt },
};

test.beforeEach(async ({ page }) => {
  await page.route('**/auth/me', (route) => route.fulfill({ json: { code: 0, message: 'OK', data: { email: 'operator@example.test', role: 'user', created_at: createdAt } } }));
  await page.route('**/travel-rule/trp/**', async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split('/').at(-1);
    const item = fixtures[resource];
    if (!item) throw new Error(`Unexpected fixture request: ${url.pathname}`);
    const limit = Number(url.searchParams.get('limit'));
    const total = url.searchParams.has('search') ? 1 : 51;
    await route.fulfill({ json: { data: limit === 1 ? [] : [item], page: Number(url.searchParams.get('page')), limit, total } });
  });
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 844 }]) {
  test(`searches and combines filters on all four pages at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const cases = [
      ['inquiries', [['Status filter', 'Pending', 'status', 'pending']]],
      ['messages', [['Direction filter', 'Inbound', 'direction', 'inbound'], ['Phase filter', 'Inquiry', 'phase', 'inquiry'], ['Delivery state filter', 'Received', 'delivery_state', 'received']]],
      ['tokens', [['Purpose filter', 'Inquiry', 'purpose', 'inquiry'], ['Token status filter', 'Active', 'status', 'active']]],
      ['events', [['Event type filter', 'Manual approval', 'event_type', 'manual_approval'], ['Previous state filter', 'Pending', 'from_state', 'pending'], ['Next state filter', 'Approved', 'to_state', 'approved']]],
    ];
    for (const [resource, selections] of cases) {
      await page.goto(`/travel-rule/${resource}`);
      const search = page.getByRole('textbox', { name: `Search ${resource}` });
      await expect(search).toBeVisible();
      await page.getByRole('button', { name: resource === 'inquiries' ? 'Next page' : 'Next', exact: true }).click();
      const searched = page.waitForRequest((request) => {
        const url = new URL(request.url());
        return url.pathname.endsWith(`/${resource}`) && url.searchParams.get('search') === 'outside' && url.searchParams.get('page') === '1';
      });
      await search.fill('outside');
      await searched;
      const expected = { search: 'outside', page: '1' };
      for (const [label, option, key, value] of selections) {
        expected[key] = value;
        const filtered = page.waitForRequest((request) => {
          const url = new URL(request.url());
          return url.pathname.endsWith(`/${resource}`) && Object.entries(expected).every(([name, match]) => url.searchParams.get(name) === match);
        });
        await page.getByRole('combobox', { name: label, exact: true }).click();
        await page.getByRole('option', { name: option, exact: true }).click();
        await filtered;
      }
      await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test(`submits Update under the gateway CSP without credentials at ${viewport.width}px`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    const nginx = fs.readFileSync(path.join(__dirname, '../../docker/nginx/nginx.conf'), 'utf8');
    const csp = nginx.match(/add_header Content-Security-Policy "([^"]+)" always;/)[1];
    await page.route('**/travel-rule/tokens', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    });
    // A separate upstream cookie must not be sent by the public contact client.
    await context.addCookies([{ name: 'upstream_session', value: 'test-only-cookie', domain: 'api.getdefy.co', path: '/', secure: true }]);
    await page.route('https://api.getdefy.co/**', async (route) => {
      expect(route.request().url()).toBe('https://api.getdefy.co/contact/create');
      await route.fulfill({ json: { code: 0, message: 'OK', data: null }, headers: { 'access-control-allow-origin': '*' } });
    });
    await page.goto('/travel-rule/tokens');
    await expect(page.getByRole('textbox', { name: 'Search tokens' })).toBeVisible();
    if (viewport.width < 768) await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await page.getByRole('button', { name: /operator@example.test/ }).click();
    await page.getByRole('menuitem', { name: 'Update', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Project updates' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Email')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    const validationToast = page.locator('[data-sonner-toast][data-type="error"]');
    await expect(validationToast).toContainText('Enter a valid email address.');
    await expect(dialog.getByLabel('Email')).toBeFocused();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await validationToast.getByRole('button', { name: 'Close notification (Alt+Escape)' }).click();
    await expect(validationToast).not.toBeVisible();
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(validationToast).toBeVisible();
    await page.keyboard.press('Alt+Escape');
    await expect(validationToast).not.toBeVisible();
    await expect(dialog.getByLabel('Email')).toBeFocused();
    await dialog.getByLabel('Email').fill('updates@example.test');
    const sent = page.waitForRequest('https://api.getdefy.co/contact/create');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    const request = await sent;
    expect(request.postDataJSON()).toEqual({ email: 'updates@example.test', subject: 'Travel Rule Playground updates', message: 'I would like to receive updates about Travel Rule Playground at this email address.' });
    const headers = await request.allHeaders();
    for (const name of ['authorization', 'cookie', 'x-csrf-token']) expect(headers[name]).toBeUndefined();
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toContainText('Your request has been received.');
    await expect(dialog).not.toBeVisible();
    if (viewport.width < 768) {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.keyboard.press('Alt+KeyT');
    const closeToast = page.getByRole('button', { name: 'Close notification (Alt+Escape)' });
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-sonner-toast][data-type="success"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeToast).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(closeToast).not.toBeVisible();
  });
}
