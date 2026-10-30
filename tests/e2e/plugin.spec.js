import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const account = JSON.parse(readFileSync(process.env.ZF_WP_ACCOUNT || '.local/account.json', 'utf8'));
const connection = JSON.parse(readFileSync(process.env.ZF_WP_CONNECTION || '.local/connection.json', 'utf8'));

async function login(page) {
    await page.goto('/wp-login.php');
    await page.locator('#user_login').fill(account.username);
    await page.locator('#user_pass').fill(account.password);
    await page.locator('#wp-submit').click();
    await page.waitForURL(/wp-admin/);
    await page.goto('/wp-admin/admin.php?page=zionfood');
    await expect(page.locator('.zf-admin')).toBeVisible();
}
async function menuUrl(page) {
    await login(page);
    const config = await page.locator('#zionfood-admin-config').textContent();
    const data = JSON.parse(config);
    if (data.state.menu_url) return data.state.menu_url;
    const result = await page.request.post(data.root + 'admin/publish', {
        headers: { 'X-WP-Nonce': data.nonce },
        data: {},
    });
    expect(result.ok()).toBe(true);
    return (await result.json()).state.menu_url;
}
async function images(page) {
    await page.route('https://food.zion3d.ro/storage/wordpress-plugin-fixture/*', async (route) => {
        const name = route.request().url().split('/').pop();
        await route.fulfill({
            path: 'C:/Workspace/ZionFood/storage/app/public/wordpress-plugin-fixture/' + name,
            contentType: 'image/jpeg',
        });
    });
}
async function consent(dialog) {
    await dialog.getByRole('checkbox', { name: /Sunt de acord/ }).check();
}

test('administrator connects, saves functional settings and publishes; guest orders in the inline menu', async ({
    page,
}) => {
    const errors = [];
    const browserApi = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
        if (r.url().startsWith('https://food.zion3d.ro/api/')) browserApi.push(r.url());
    });
    await images(page);
    await login(page);
    await page.locator('.zf-nav [data-go="connect"]').click();
    await page.getByLabel('Cheia API WordPress', { exact: true }).fill(connection.token);
    await page.getByRole('button', { name: 'Înlocuiește conexiunea', exact: true }).click();
    await expect(
        page.getByRole('status').filter({ hasText: 'Gata! Modificările au fost salvate.' }).last()
    ).toBeVisible();
    await expect(page.getByText('Conexiune activă', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
    await page.locator('.zf-nav [data-go="settings"]').click();
    await page.getByLabel('Oferă memorarea datelor clientului', { exact: true }).check();
    await page.getByLabel('Butoane flotante', { exact: true }).selectOption('both');
    await page.getByRole('button', { name: 'Salvează experiența', exact: true }).click();
    await expect(
        page.getByRole('status').filter({ hasText: 'Gata! Modificările au fost salvate.' }).last()
    ).toBeVisible();
    await page.locator('.zf-nav [data-go="publish"]').click();
    if ((await page.locator('[data-action="publish"]').textContent()) !== 'Deschide pagina de meniu') {
        await page.locator('[data-action="publish"]').click();
        await expect(page.locator('[data-action="publish"]')).toHaveText('Deschide pagina de meniu');
    }
    await page.locator('[data-action="publish"]').click();
    await expect(page.locator('.zf-product-card')).toHaveCount(2);
    await expect(page.locator('.zf-floating')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/menu-desktop.png', fullPage: true });
    await page.getByRole('button', { name: 'Vezi preparatul Feta Saganaki', exact: true }).click();
    let dialog = page.getByRole('dialog').last();
    await expect(dialog.locator('.zf-product-hero')).toBeVisible();
    await dialog.getByRole('button', { name: 'Adaugă în coș', exact: true }).click();
    await page.locator('.zf-cart-bar button').click();
    dialog = page.getByRole('dialog').last();
    await expect(dialog.locator('.zf-cart-item img')).toBeVisible();
    await dialog.getByRole('button', { name: 'Continuă spre finalizare', exact: true }).click();
    dialog = page.getByRole('dialog').last();
    await dialog.getByLabel('Numele tău', { exact: true }).fill('Client browser');
    await dialog.getByLabel('Număr de telefon', { exact: true }).fill('0712345678');
    await consent(dialog);
    await dialog.getByRole('checkbox', { name: /Ține minte datele/ }).check();
    await dialog.getByRole('button', { name: 'Verifică totalul', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /Trimite comanda/ })).toBeVisible();
    const placed = page.waitForResponse((r) => r.url().endsWith('/guest/checkout'));
    await dialog.getByRole('button', { name: /Trimite comanda/ }).click();
    const payload = await (await placed).json();
    expect(payload.tracking_token).toBeUndefined();
    await expect(page.getByText('Comanda a ajuns la restaurant.', { exact: true })).toBeVisible();
    expect(browserApi).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: 'test-results/order-receipt.png', fullPage: true });
});

test('product variants, modifier quantities, delivery and responsive sticky checkout work', async ({
    page,
}) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await images(page);
    const url = await menuUrl(page);
    await page.goto(url);
    await expect(page.locator('.zf-product-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Vezi preparatul Burger Zion', exact: true }).click();
    let dialog = page.getByRole('dialog').last();
    await dialog.getByRole('radio', { name: /Dublu/ }).check();
    await dialog.getByRole('checkbox', { name: /Cheddar/ }).check();
    await dialog.getByLabel('Cantitate Cheddar', { exact: true }).fill('2');
    await dialog.getByRole('button', { name: 'Adaugă în coș', exact: true }).click();
    await page.locator('.zf-cart-bar button').click();
    await page.getByRole('button', { name: 'Continuă spre finalizare', exact: true }).click();
    dialog = page.getByRole('dialog').last();
    await dialog.getByLabel('Numele tău', { exact: true }).fill('Delivery guest');
    await dialog.getByLabel('Număr de telefon', { exact: true }).fill('0712345678');
    await dialog.getByLabel('Cum dorești să primești comanda?', { exact: true }).selectOption('delivery');
    await dialog.getByLabel('Adresă de livrare', { exact: true }).fill('Strada Test, 10, București');
    await dialog.getByLabel('Cod poștal', { exact: true }).fill('010000');
    await consent(dialog);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByRole('button', { name: 'Verifică totalul', exact: true })).toBeVisible();
    expect((await dialog.boundingBox()).width).toBeLessThanOrEqual(370);
    const footer = await dialog.locator('footer').boundingBox();
    expect(footer.y + footer.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: 'test-results/checkout-mobile.png' });
    await dialog.getByRole('button', { name: 'Verifică totalul', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /Trimite comanda.*58/ })).toBeVisible();
    await dialog.getByRole('button', { name: /Trimite comanda/ }).click();
    await expect(page.getByText('Comanda a ajuns la restaurant.', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    expect(errors).toEqual([]);
});

test('reservations support a confirmed preorder and a return to the menu', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await images(page);
    const url = await menuUrl(page);
    await page.goto(url);
    await page.getByRole('button', { name: 'Rezervă o masă', exact: true }).click();
    let dialog = page.getByRole('dialog').last();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await dialog.getByLabel('Data', { exact: true }).fill(tomorrow);
    await dialog.getByLabel('Număr de persoane', { exact: true }).fill('2');
    await expect(dialog.locator('select[name="starts_at"] option')).not.toHaveCount(0);
    await expect(dialog.locator('select[name="starts_at"] option')).not.toHaveCount(1);
    const slot = await dialog.locator('select[name="starts_at"] option').nth(1).getAttribute('value');
    await dialog.locator('select[name="starts_at"]').selectOption(slot);
    await dialog.getByLabel('Numele tău', { exact: true }).fill('Reservation guest');
    await dialog.getByLabel('Număr de telefon', { exact: true }).fill('0712345678');
    await consent(dialog);
    await dialog.getByRole('button', { name: 'Solicită rezervarea', exact: true }).click();
    await expect(page.getByText('Te așteptăm la masă.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Precomandă pentru rezervare', exact: true }).click();
    await page.getByRole('button', { name: 'Vezi preparatul Feta Saganaki', exact: true }).click();
    await page.getByRole('button', { name: 'Adaugă în coș', exact: true }).click();
    await page.locator('.zf-cart-bar button').click();
    await page.getByRole('button', { name: 'Continuă spre finalizare', exact: true }).click();
    dialog = page.getByRole('dialog').last();
    await dialog.getByLabel('Numele tău', { exact: true }).fill('Reservation guest');
    await dialog.getByLabel('Număr de telefon', { exact: true }).fill('0712345678');
    await consent(dialog);
    await dialog.getByRole('button', { name: 'Verifică totalul', exact: true }).click();
    await dialog.getByRole('button', { name: /Trimite comanda/ }).click();
    await expect(page.getByText('Comanda a ajuns la restaurant.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Înapoi la meniu', exact: true }).click();
    await expect(page.locator('.zf-product-card')).toHaveCount(2);
    expect(errors).toEqual([]);
});

test('scheduled pickup uses a real server slot', async ({ page }) => {
    await images(page);
    const url = await menuUrl(page);
    await page.goto(url);
    await page.getByRole('button', { name: 'Vezi preparatul Feta Saganaki', exact: true }).click();
    await page.getByRole('button', { name: 'Adaugă în coș', exact: true }).click();
    await page.locator('.zf-cart-bar button').click();
    await page.getByRole('button', { name: 'Continuă spre finalizare', exact: true }).click();
    const dialog = page.getByRole('dialog').last();
    await dialog.getByLabel('Numele tău', { exact: true }).fill('Scheduled guest');
    await dialog.getByLabel('Număr de telefon', { exact: true }).fill('0712345678');
    await dialog.getByLabel('Când dorești comanda?', { exact: true }).selectOption('later');
    await dialog
        .getByLabel('Data', { exact: true })
        .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    const slots = dialog.locator('select[name="scheduled_for"] option');
    await expect(slots).not.toHaveCount(1);
    const slot = await slots.nth(1).getAttribute('value');
    await dialog.locator('select[name="scheduled_for"]').selectOption(slot);
    await consent(dialog);
    await dialog.getByRole('button', { name: 'Verifică totalul', exact: true }).click();
    await expect(dialog.getByRole('button', { name: /Trimite comanda/ })).toBeVisible();
    const placed = page.waitForResponse((r) => r.url().endsWith('/guest/checkout'));
    await dialog.getByRole('button', { name: /Trimite comanda/ }).click();
    const body = await (await placed).json();
    expect(body.scheduled_for).toBeTruthy();
    expect(body.tracking_token).toBeUndefined();
    await expect(page.getByText('Comanda a ajuns la restaurant.', { exact: true })).toBeVisible();
});

test('Romanian and English menus expose readable food details and translated help', async ({ page }) => {
    await images(page);
    const url = await menuUrl(page);
    await page.goto(url);
    await page.getByRole('combobox', { name: 'Limba', exact: true }).selectOption('en');
    await expect(
        page.getByRole('searchbox', { name: 'Find something delicious…', exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'View dish Feta Saganaki', exact: true }).click();
    const dialog = page.getByRole('dialog').last();
    await expect(
        dialog.getByText('Baked feta with tomatoes, olives and oregano.', { exact: true })
    ).toBeVisible();
    await dialog.locator('summary').filter({ hasText: 'Nutrition' }).click();
    await expect(dialog.getByText('Values per serving', { exact: true })).toBeVisible();
    await expect(dialog.locator('.zf-nutrients span').filter({ hasText: 'Saturates (g)' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Închide / Close', exact: true }).click();
    await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('ro');
    await page.getByRole('button', { name: 'Vezi preparatul Feta Saganaki', exact: true }).click();
    await page.getByRole('button', { name: 'Adaugă în coș', exact: true }).click();
    await page.locator('.zf-cart-bar button').click();
    await page.getByRole('button', { name: 'Continuă spre finalizare', exact: true }).click();
    const help = page.getByRole('button', { name: 'Numele tău — info', exact: true });
    await help.focus();
    await expect(help.locator('..').getByRole('tooltip')).toBeVisible();
});

test('delivery map fills an editable address and keeps actions inside the mobile viewport', async ({
    page,
}) => {
    test.skip(!process.env.ZF_WP_POLYGON_FIXTURE, 'Requires a disposable backend map fixture');
    const fixture = process.env.ZF_WP_POLYGON_FIXTURE;
    execFileSync('php', [fixture, 'enable']);
    try {
        await images(page);
        await page.route('https://tile.openstreetmap.org/**', (route) =>
            route.fulfill({
                contentType: 'image/svg+xml',
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#f2f4ed"/><path d="M0 80H256M120 0V256" stroke="white" stroke-width="14"/></svg>',
            })
        );
        await login(page);
        let config = JSON.parse(await page.locator('#zionfood-admin-config').textContent());
        await page.request.post(config.root + 'admin/sync', {
            headers: { 'X-WP-Nonce': config.nonce },
            data: {},
        });
        await page.goto(config.state.menu_url);
        await page.getByRole('button', { name: 'Vezi preparatul Feta Saganaki', exact: true }).click();
        await page.getByRole('button', { name: 'Adaugă în coș', exact: true }).click();
        await page.locator('.zf-cart-bar button').click();
        await page.getByRole('button', { name: 'Continuă spre finalizare', exact: true }).click();
        const dialog = page.getByRole('dialog').last();
        await dialog.getByLabel('Numele tău', { exact: true }).fill('Map guest');
        await dialog.getByLabel('Număr de telefon', { exact: true }).fill('0712345678');
        await dialog.getByLabel('Cum dorești să primești comanda?', { exact: true }).selectOption('delivery');
        await dialog.locator('[data-map]').click({ position: { x: 200, y: 130 } });
        await expect(dialog.getByLabel('Adresă de livrare', { exact: true })).toHaveValue(
            'Strada Test, 10, București'
        );
        await dialog.getByLabel('Adresă de livrare', { exact: true }).fill('Strada Test, 12, București');
        await consent(dialog);
        await page.setViewportSize({ width: 390, height: 844 });
        const footer = await dialog.locator('footer').boundingBox();
        expect(footer.y + footer.height).toBeLessThanOrEqual(844);
        await page.screenshot({ path: 'test-results/delivery-map-mobile.png' });
        await dialog.getByRole('button', { name: 'Verifică totalul', exact: true }).click();
        await expect(dialog.getByRole('button', { name: /Trimite comanda.*32/ })).toBeVisible();
        await dialog.getByRole('button', { name: /Trimite comanda/ }).click();
        await expect(page.getByText('Comanda a ajuns la restaurant.', { exact: true })).toBeVisible();
    } finally {
        execFileSync('php', [fixture, 'restore']);
    }
});
