import { expect, test } from '@playwright/test';

test('auth form validates by mode and submits login without a name field', async ({ page }) => {
  let loginPayload: unknown;
  let loginRequests = 0;
  let registrationRequests = 0;
  await page.route('**/api/v1/auth/login', async (route) => {
    loginRequests += 1;
    loginPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' }),
    });
  });
  await page.route('**/api/v1/auth/register', async (route) => {
    registrationRequests += 1;
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Diagnostic registration request intercepted.' }),
    });
  });

  await page.goto('/auth');
  await page.getByLabel('Email address').fill('invalid-email');
  await page.getByLabel('Password').fill('short');
  await page.locator('form.form-grid button.primary-btn').click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(page.getByText('Password must be at least 12 characters.')).toBeVisible();
  expect(loginRequests).toBe(0);

  await page.getByLabel('Email address').fill('diagnostic@example.test');
  await page.getByLabel('Password').fill('valid-length-diagnostic-password');
  await page.locator('form.form-grid button.primary-btn').click();
  await expect(page.getByRole('alert')).toContainText('We could not verify those details.');
  expect(loginRequests).toBe(1);
  expect(loginPayload).toEqual({
    email: 'diagnostic@example.test',
    password: 'valid-length-diagnostic-password',
  });

  await page.getByRole('tablist', { name: 'Account options' }).getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Email address').fill('diagnostic@example.test');
  await page.getByLabel('Password').fill('valid-length-diagnostic-password');
  await page.locator('form.form-grid button.primary-btn').click();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  expect(registrationRequests).toBe(0);

  await page.getByLabel('Full name').fill('D');
  await page.locator('form.form-grid button.primary-btn').click();
  await expect(page.getByText('Enter your name.')).toBeVisible();
  expect(registrationRequests).toBe(0);

  await page.getByLabel('Full name').fill('Diagnostic User');
  await page.getByLabel('Phone number (optional)').fill('1'.repeat(31));
  await page.locator('form.form-grid button.primary-btn').click();
  await expect(page.locator('label.field').filter({ hasText: 'Phone number' }).locator('.field-error')).toBeVisible();
  expect(registrationRequests).toBe(0);
});

test('route navigation scrolls to top, including browser history, without resetting on query changes', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Explore the catalogue' }).click();
  await expect(page).toHaveURL(/\/catalog$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  const sort = page.getByLabel('Sort by');
  await sort.waitFor();
  await page.evaluate(() => {
    const filter = document.querySelectorAll('select')[1];
    if (!filter) throw new Error('Catalog sort filter was not rendered.');
    window.scrollTo({ top: filter.getBoundingClientRect().top + window.scrollY - 80, behavior: 'instant' });
  });
  const positionBeforeFilter = await page.evaluate(() => window.scrollY);
  await sort.selectOption('price-asc');
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(positionBeforeFilter);

  await page.getByRole('link', { name: 'MONOPRIX' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/catalog\?sort=price-asc$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('customer registration, login, shopping, checkout, and staff order management', async ({ page }) => {
  const customerEmail = `e2e-${Date.now()}@example.test`;
  const customerPassword = 'Test-only-marketplace-2026!';

  await page.goto('/catalog');
  await page.getByText('E2E Phase 2 Test Product').first().waitFor();
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await expect(page.getByRole('status')).toContainText('added to cart');

  await page.goto('/auth');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Full name').fill('E2E Customer');
  await page.getByLabel('Email address').fill(customerEmail);
  await page.getByLabel('Password').fill(customerPassword);
  await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
  await expect(page).toHaveURL(/\/cart$/);

  await page.getByRole('link', { name: 'Continue to checkout' }).click();
  await page.getByLabel('Recipient name').fill('E2E Customer');
  await page.getByLabel('Phone number').fill('+23276000000');
  await page.getByLabel('Delivery address').fill('1 Automated Test Street');
  await page.getByLabel('Area or neighbourhood').fill('Freetown');
  await page.getByRole('button', { name: 'Place demonstration order' }).click();
  await expect(page.getByText('Order placed. Cash is due on delivery; no online payment was taken.')).toBeVisible();
  await page.getByRole('link', { name: 'View my orders' }).click();
  await expect(page.getByRole('heading', { name: 'Your orders' })).toBeVisible();
  await expect(page.getByText('E2E Phase 2 Test Product')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/auth');
  await page.getByLabel('Email address').fill(customerEmail);
  await page.getByLabel('Password').fill(customerPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page).toHaveURL(/\/cart$/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/auth');
  await page.getByLabel('Email address').fill(process.env.E2E_STAFF_EMAIL!);
  await page.getByLabel('Password').fill(process.env.E2E_STAFF_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  const status = page.getByRole('combobox', { name: /Update status for order/ }).first();
  await status.selectOption('CONFIRMED');
  await expect(status).toHaveValue('CONFIRMED');
});
