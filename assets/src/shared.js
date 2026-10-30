export const esc = (value = '') =>
    String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
export const money = (value, currency = 'RON', language = 'ro') =>
    new Intl.NumberFormat(language === 'en' ? 'en-GB' : 'ro-RO', { style: 'currency', currency }).format(
        Number(value || 0) / 100
    );
export const uuid = () =>
    globalThis.crypto.randomUUID?.() ??
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) => n.toString(16).padStart(2, '0')).join('');
export const icon = (name, size = 20) => {
    const shapes = {
        arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
        check: '<path d="m5 12 4 4L19 6"/>',
        close: '<path d="m6 6 12 12M6 18 18 6"/>',
        link: '<path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5m10 3 2-2a4 4 0 0 1 6 6l-5 5"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
        settings:
            '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c6 5 6 13 0 18-6-5-6-13 0-18Z"/>',
        pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
        bag: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/>',
        search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        minus: '<path d="M5 12h14"/>',
        info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
        refresh:
            '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2"/>',
        copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
        pin: '<path d="M19 10c0 6-7 11-7 11S5 16 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
        heart: '<path d="M20 5c-3-3-7-1-8 1-1-2-5-4-8-1-5 5 8 15 8 15S25 10 20 5Z"/>',
        spark: '<path d="m12 3 2 6 6 3-6 2-2 7-2-7-7-2 7-3 2-6Z"/>',
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.info}</svg>`;
};
export function notify(message, error = false) {
    let host = document.querySelector('.zf-toasts');
    if (!host) {
        host = document.createElement('div');
        host.className = 'zf-toasts';
        host.setAttribute('aria-live', 'polite');
        document.body.append(host);
    }
    const toast = document.createElement('div');
    toast.className = `zf-toast ${error ? 'is-error' : ''}`;
    toast.setAttribute('role', error ? 'alert' : 'status');
    toast.innerHTML = `${icon(error ? 'info' : 'check')}<span>${esc(message)}</span><button type="button" aria-label="Închide / Close">${icon('close', 16)}</button>`;
    host.append(toast);
    toast.querySelector('button').onclick = () => toast.remove();
    if (!error) setTimeout(() => toast.remove(), 5000);
}
export function help(label, text) {
    return `<span class="zf-help"><button type="button" class="zf-help-trigger" aria-label="${esc(label)} — info">${icon('info', 16)}</button><span role="tooltip">${esc(text)}</span></span>`;
}
export function modal(title, content, footer = '') {
    const dialog = document.createElement('dialog');
    dialog.className = 'zf-dialog';
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" class="zf-icon-button" aria-label="Închide / Close">${icon('close')}</button></header><div class="zf-dialog-body">${content}</div>${footer ? `<footer>${footer}</footer>` : ''}`;
    document.body.append(dialog);
    const prior = document.activeElement;
    dialog.querySelector('header button').onclick = () => dialog.close();
    dialog.addEventListener(
        'close',
        () => {
            dialog.remove();
            prior?.focus?.();
        },
        { once: true }
    );
    dialog.addEventListener('click', (e) => {
        if (e.target === dialog) {
            const r = dialog.getBoundingClientRect();
            if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
                dialog.close();
        }
    });
    dialog.showModal();
    return dialog;
}
export function effectiveGroups(category, product, variant) {
    return [
        ...new Map(
            [
                ...(category.modifier_groups || []),
                ...(product.modifier_groups || []),
                ...(variant?.modifier_groups || []),
            ].map((g) => [g.id, g])
        ).values(),
    ];
}
export function validChoices(groups, quantities) {
    return groups.every((g) => {
        const selected = g.options.filter((o) => (quantities[o.id] || 0) > 0);
        const required = g.is_required ?? g.min_choices > 0;
        return (
            ((!required && !selected.length) ||
                (selected.length >= Math.max(required ? 1 : 0, g.min_choices) &&
                    selected.length <= g.max_choices)) &&
            selected.every(
                (o) =>
                    Number.isInteger(quantities[o.id]) &&
                    quantities[o.id] >= 1 &&
                    quantities[o.id] <= (g.allow_quantity ? o.max_quantity || 1 : 1)
            )
        );
    });
}
export function orderLines(cart) {
    return cart.map((line) => ({
        product_id: line.product_id,
        quantity: line.quantity,
        ...(line.variant_id ? { variant_id: line.variant_id } : {}),
        modifiers: Object.entries(line.modifiers || {})
            .filter(([, quantity]) => quantity > 0)
            .map(([id, quantity]) => ({ id: Number(id), quantity })),
    }));
}
export function imageUrl(path, origin) {
    return typeof path === 'string' && /^[A-Za-z0-9/_\-.]+$/.test(path) && !path.includes('..')
        ? origin + '/storage/' + path
        : '';
}
