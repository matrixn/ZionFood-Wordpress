import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { esc, effectiveGroups, validChoices, orderLines, imageUrl } from '../assets/src/shared.js';

test('all static labels and setting help are translated in both languages', () => {
    const ro = JSON.parse(readFileSync('languages/ro.json'));
    const en = JSON.parse(readFileSync('languages/en.json'));
    assert.deepEqual(Object.keys(ro).sort(), Object.keys(en).sort());
    for (const file of readdirSync('assets/src').filter((f) => f.endsWith('.js'))) {
        const source = readFileSync('assets/src/' + file, 'utf8');
        for (const match of source.matchAll(/\bt\('([a-z_]+)'\)/g))
            assert.ok(ro[match[1]], file + ': ' + match[1]);
    }
    const settings = readFileSync('includes/Settings.php', 'utf8')
        .split('public const DEFAULTS = [')[1]
        .split('];')[0];
    for (const key of settings.matchAll(/'([a-z_]+)'\s*=>/g)) {
        assert.ok(ro['setting_' + key[1]], key[1]);
        assert.ok(ro['help_' + key[1]], key[1]);
    }
    assert.ok(!JSON.stringify(ro).match(/Ã|Â|\uFFFD/));
});
test('product customization enforces distinct choices, defaults and quantity rules', () => {
    const group = {
        id: 1,
        is_required: true,
        min_choices: 1,
        max_choices: 2,
        allow_quantity: true,
        options: [
            { id: 10, max_quantity: 3 },
            { id: 11, max_quantity: 2 },
        ],
    };
    assert.equal(validChoices([group], {}), false);
    assert.equal(validChoices([group], { 10: 3 }), true);
    assert.equal(validChoices([group], { 10: 4 }), false);
    assert.equal(validChoices([group], { 10: 1.5 }), false);
    assert.equal(validChoices([{ ...group, allow_quantity: false }], { 10: 2 }), false);
    assert.equal(validChoices([{ ...group, is_required: false }], {}), true);
    assert.equal(
        effectiveGroups(
            { modifier_groups: [group] },
            { modifier_groups: [group] },
            { modifier_groups: [{ ...group, id: 2 }] }
        ).length,
        2
    );
});
test('order payloads exclude client prices, food metadata and credentials', () => {
    assert.deepEqual(
        orderLines([
            {
                product_id: 'product',
                variant_id: 2,
                quantity: 3,
                modifiers: { 10: 2, 11: 0 },
                price: 1,
                total: 1,
                api_key: 'private',
                item: { name: 'Dish' },
            },
        ]),
        [{ product_id: 'product', variant_id: 2, quantity: 3, modifiers: [{ id: 10, quantity: 2 }] }]
    );
});
test('remote text is escaped and images remain on the fixed public origin', () => {
    assert.equal(esc('<img onerror="alert(1)">'), '&lt;img onerror=&quot;alert(1)&quot;&gt;');
    assert.equal(imageUrl('../private', 'https://food.zion3d.ro'), '');
    assert.equal(imageUrl('https://attacker.test/x', 'https://food.zion3d.ro'), '');
    assert.equal(
        imageUrl('menu/1/a.webp', 'https://food.zion3d.ro'),
        'https://food.zion3d.ro/storage/menu/1/a.webp'
    );
});
