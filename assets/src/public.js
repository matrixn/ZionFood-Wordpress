import './public.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import {
    esc,
    icon,
    help,
    notify,
    modal,
    money,
    uuid,
    effectiveGroups,
    validChoices,
    orderLines,
    imageUrl,
} from './shared.js';

let sessionPromise;
const carts = new Map();
class Storefront {
    constructor(root) {
        this.root = root;
        this.config = JSON.parse(root.querySelector('[data-zf-config]').textContent);
        this.location = this.config.location;
        this.locale = this.config.settings.language;
        this.settings = this.config.settings;
        this.cart = [];
        this.table = null;
        this.preorder = null;
        this.activeCategory = 'all';
        this.search = '';
        this.busy = false;
        this.origin = this.config.origin;
        this.receiptIds = { orders: [], reservations: [] };
        root.style.setProperty('--zf-accent', this.settings.accent);
        if (this.config.mode === 'order' || this.config.mode === 'reservations') {
            root.querySelector('[data-zf-launch]').onclick = () => this.launch();
        } else {
            this.load().catch((e) => this.failure(e));
        }
        this.onCart = () => this.updateCartButtons();
        window.addEventListener('zf-cart', this.onCart);
    }
    t(key) {
        return this.config.dictionaries[this.locale][key] ?? key;
    }
    format(value) {
        return money(value, this.data?.location?.currency || 'RON', this.locale);
    }
    async session() {
        sessionPromise ??= fetch(this.config.root + 'guest/session', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        })
            .then(async (r) => {
                const d = await r.json();
                if (!r.ok) throw new Error(d.message || this.t('session_error'));
                return d.csrf;
            })
            .catch((e) => {
                sessionPromise = null;
                throw e;
            });
        return sessionPromise;
    }
    async api(operation, data = {}, retry = true) {
        const csrf = await this.session();
        const response = await fetch(this.config.root + 'guest/' + operation, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-ZionFood-CSRF': csrf },
            body: JSON.stringify({ location: this.location, language: this.locale, ...data }),
        });
        const result = await response.json();
        if (!response.ok) {
            if (result.code === 'csrf_failed' && retry) {
                sessionPromise = null;
                return this.api(operation, data, false);
            }
            const error = new Error(result.message || this.t('request_failed'));
            error.status = response.status;
            error.retryable = !!result.data?.retryable;
            throw error;
        }
        return result;
    }
    async mutate(operation, data) {
        const canonical = JSON.stringify(data);
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
        const hash = Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('');
        const storageKey = 'zf_pending_' + this.location + '_' + operation;
        let pending;
        try {
            pending = JSON.parse(sessionStorage.getItem(storageKey));
        } catch {
            /* unavailable storage falls back to this instance */
        }
        pending ??= this.pending?.[operation];
        if (!pending || pending.hash !== hash) pending = { hash, key: uuid() };
        this.pending ??= {};
        this.pending[operation] = pending;
        try {
            sessionStorage.setItem(storageKey, JSON.stringify(pending));
        } catch {}
        const result = await this.api(operation, { ...data, idempotency_key: pending.key });
        try {
            sessionStorage.removeItem(storageKey);
        } catch {}
        delete this.pending[operation];
        return result;
    }
    async load() {
        this.data = await this.api('catalog');
        this.items = this.flatten();
        this.availability = this.data.orderingAvailability;
        this.restoreCart();
        if (['menu', 'order'].includes(this.config.mode)) {
            await this.detectTable();
        }
        this.render();
        this.refreshReceipts();
        this.poll();
        return this.data;
    }
    poll() {
        clearInterval(this.timer);
        this.timer = setInterval(() => {
            if (!document.hidden) {
                this.refreshAvailability();
                this.refreshReceipts();
            }
        }, 30000);
    }
    flatten() {
        const result = [];
        for (const menu of this.data.menus || [])
            for (const category of menu.categories || [])
                for (const item of category.items || []) result.push({ item, category, menu });
        return result;
    }
    translated(item, key) {
        return item.content?.translations?.[this.locale]?.[key] || item[key] || '';
    }
    title(item) {
        return this.translated(item, 'name').replace(/\s*\*+\s*$/, '');
    }
    async detectTable() {
        const params = new URL(location.href).searchParams;
        const table = params.get('zf_table');
        const token = new URLSearchParams(location.hash.slice(1)).get('token');
        if (table && token) {
            try {
                await this.mutate('table_connect', { id: table, qr_token: token });
                this.table = table;
                this.availability = await this.api('table_availability', { id: table });
                try {
                    sessionStorage.setItem('zf_table_' + this.location, table);
                } catch {}
                history.replaceState(null, '', location.pathname + location.search);
            } catch (e) {
                this.tableError = e.message;
            }
        } else {
            try {
                this.table = sessionStorage.getItem('zf_table_' + this.location);
                if (this.table) this.availability = await this.api('table_availability', { id: this.table });
            } catch (e) {
                if (this.table) this.tableError = e.message;
            }
        }
    }
    restoreCart() {
        if (carts.has(this.location)) {
            this.cart = carts.get(this.location);
            return;
        }
        let saved = [];
        try {
            if (this.settings.persist_cart)
                saved = JSON.parse(localStorage.getItem('zf_cart_' + this.location) || '[]');
            else localStorage.removeItem('zf_cart_' + this.location);
        } catch {}
        this.cart = Array.isArray(saved)
            ? saved
                  .slice(0, 50)
                  .map((line) => this.hydrate(line))
                  .filter(Boolean)
            : [];
        carts.set(this.location, this.cart);
    }
    hydrate(line) {
        const found = this.items.find((x) => x.item.public_id === line.product_id);
        if (!found || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50)
            return null;
        const variant = line.variant_id ? found.item.variants?.find((v) => v.id === line.variant_id) : null;
        if (line.variant_id && !variant) return null;
        const groups = effectiveGroups(found.category, found.item, variant);
        const allowed = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
        const modifiers = Object.fromEntries(
            Object.entries(line.modifiers || {}).filter(
                ([id, q]) => allowed.has(Number(id)) && Number.isInteger(q) && q > 0 && q <= 50
            )
        );
        return { ...line, ...found, variant, groups, modifiers };
    }
    persist() {
        carts.set(this.location, this.cart);
        try {
            if (this.settings.persist_cart)
                localStorage.setItem(
                    'zf_cart_' + this.location,
                    JSON.stringify(
                        this.cart.map((l) => ({
                            product_id: l.product_id,
                            variant_id: l.variant_id,
                            quantity: l.quantity,
                            modifiers: l.modifiers,
                        }))
                    )
                );
        } catch {}
        window.dispatchEvent(new Event('zf-cart'));
    }
    presentationPrice(line) {
        return (
            (line.variant?.price ?? line.item.price) +
            line.groups.reduce(
                (sum, g) =>
                    sum + g.options.reduce((s, o) => s + (o.price || 0) * (line.modifiers[o.id] || 0), 0),
                0
            )
        );
    }
    subtotal() {
        return this.cart.reduce((sum, line) => sum + this.presentationPrice(line) * line.quantity, 0);
    }
    quantity() {
        return this.cart.reduce((sum, l) => sum + l.quantity, 0);
    }
    updateCartButtons() {
        this.cart = carts.get(this.location) || this.cart;
        (this.host || this.root).querySelectorAll('[data-zf-cart]').forEach((b) => {
            b.innerHTML = `${icon('bag', 18)}${this.t('your_cart')} <span>${this.quantity()}</span>${this.quantity() ? `<strong>${this.format(this.subtotal())}</strong>` : ''}`;
        });
    }
    availabilityText() {
        if (this.tableError) return this.tableError;
        const a = this.availability;
        if (!a) return '';
        if (!a.can_order) return this.t('availability_' + a.reason);
        const deadline = a.deadline_at || a.schedule?.closes_at;
        const remaining = deadline ? Math.ceil((new Date(deadline) - Date.now()) / 60000) : 0;
        return remaining > 0 && remaining <= 60
            ? this.t('closing_soon').replace('{minutes}', String(remaining))
            : this.t('open_now');
    }
    async refreshAvailability() {
        try {
            this.availability = this.table
                ? await this.api('table_availability', { id: this.table })
                : await this.api('availability');
            const text = (this.host || this.root).querySelector('[data-zf-availability]');
            if (text) {
                text.textContent = this.availabilityText();
                text.classList.toggle('is-closed', !this.availability.can_order);
            }
        } catch {
            /* keep the last known presentation; checkout always verifies server state */
        }
    }
    canAdd() {
        return (
            this.settings.enable_ordering &&
            (this.table
                ? !this.tableError && this.availability?.can_add_to_cart
                : this.availability?.can_add_to_cart ||
                  (this.data?.location?.commerce_settings?.scheduled_orders_enabled &&
                      ['outside_hours', 'no_open_tables', 'closed'].includes(this.availability?.reason)) ||
                  this.preorder)
        );
    }
    productCard(entry) {
        const { item } = entry;
        const img = this.settings.show_images ? imageUrl(item.image_path, this.origin) : '';
        return `<article class="zf-product-card">${img ? `<img src="${esc(img)}" alt="${esc(this.title(item))}" loading="lazy" width="320" height="220">` : ''}<div class="zf-product-copy"><div><h3>${esc(this.title(item))}</h3>${item.portion_size ? `<span class="zf-portion">${this.t('portion')} · ${esc(item.portion_size)}</span>` : ''}</div>${this.settings.show_descriptions ? `<p>${esc(this.translated(item, 'description'))}</p>` : ''}<div class="zf-product-bottom"><strong>${this.format(item.variants?.length ? Math.min(...item.variants.map((v) => v.price)) : item.price)}</strong><button type="button" data-product="${esc(item.public_id)}" aria-label="${esc(this.t('view_product') + ' ' + this.title(item))}">${icon(this.canAdd() ? 'plus' : 'info', 18)}</button></div></div></article>`;
    }
    render() {
        if (!this.data) return;
        const mode = this.config.mode;
        if (mode === 'hours') {
            this.content().innerHTML = `<div class="zf-hours"><h2>${this.t('opening_hours')}</h2><p class="zf-availability" data-zf-availability>${esc(this.availabilityText())}</p>${(this.data.hours || []).map((row) => `<div><span>${this.t('day_' + row.weekday)}</span><strong>${esc(row.opens_at.slice(0, 5))}–${esc(row.closes_at.slice(0, 5))}</strong></div>`).join('')}</div>`;
            return;
        }
        if (mode === 'promotions') {
            this.content().innerHTML = `<div class="zf-promotions"><h2>${this.t('promotions')}</h2>${(this.data.promotions || []).map((p) => `<article>${icon('spark', 23)}<div><h3>${esc(p.name)}</h3><p>${esc(this.promotionText(p))}</p></div></article>`).join('') || `<p>${this.t('no_promotions')}</p>`}</div>`;
            return;
        }
        const categories = [...new Map(this.items.map((x) => [x.category.id, x.category])).values()];
        const brand = this.data.restaurant || {};
        const logo = imageUrl(brand.logo_path, this.origin);
        const html = `<header class="zf-store-header"><div class="zf-store-brand">${logo ? `<img src="${esc(logo)}" alt="" width="52" height="52">` : ''}<div><span class="zf-kicker">${this.t('digital_menu')}</span><h2>${esc(brand.name || 'ZionFood')}</h2></div></div><div class="zf-store-controls">${this.config.locations.length > 1 ? `<label class="zf-compact-select"><span class="zf-sr-only">${this.t('location')}</span><select data-zf-location aria-label="${this.t('location')}">${this.config.locations.map((l) => `<option value="${esc(l.public_id)}" ${l.public_id === this.location ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>` : ''}${this.settings.language_switcher ? `<select data-zf-language aria-label="${this.t('language')}"><option value="ro" ${this.locale === 'ro' ? 'selected' : ''}>🇷🇴 Română</option><option value="en" ${this.locale === 'en' ? 'selected' : ''}>🇬🇧 English</option></select>` : ''}</div></header><section class="zf-store-welcome"><div><span class="zf-kicker">${this.t('made_for_you')}</span><h2>${this.t('menu_headline')}</h2><p>${esc(brand.tagline || brand.description || this.t('menu_intro'))}</p><p class="zf-availability ${!this.availability?.can_order ? 'is-closed' : ''}" data-zf-availability>${esc(this.availabilityText())}</p></div><div class="zf-store-welcome-mark" aria-hidden="true">${icon('heart', 55)}<span>${this.t('fresh_daily')}</span></div></section><div class="zf-menu-toolbar"><nav aria-label="${this.t('categories')}" class="zf-categories"><button data-category="all" class="${this.activeCategory === 'all' ? 'active' : ''}">${this.t('all_products')}</button>${categories.map((c) => `<button data-category="${c.id}" class="${String(c.id) === String(this.activeCategory) ? 'active' : ''}">${esc(c.name)}</button>`).join('')}</nav>${this.settings.show_search ? `<label class="zf-search">${icon('search', 17)}<input type="search" data-zf-search aria-label="${this.t('search_menu')}" placeholder="${this.t('search_menu')}" value="${esc(this.search)}"></label>` : ''}</div><div class="zf-products zf-products-${this.settings.menu_layout}" data-zf-products></div><div class="zf-store-bottom-actions">${this.settings.enable_reservations && this.data.fulfillment?.reservations_enabled ? `<button type="button" class="zf-text-button" data-reserve>${icon('calendar', 17)}${this.t('reserve_table')}</button>` : ''}<button type="button" class="zf-text-button" data-receipts>${icon('clock', 17)}${this.t('my_activity')}</button></div>${this.settings.show_allergens ? `<details class="zf-food-note"><summary>${icon('info', 14)}${this.t('food_information')}</summary><p>${this.t('food_notice')}</p></details>` : ''}${this.settings.enable_ordering ? `<div class="zf-cart-bar"><button type="button" data-zf-cart>${icon('bag', 18)}${this.t('your_cart')}<span>${this.quantity()}</span></button></div>` : ''}`;
        this.content().innerHTML = html;
        this.renderProducts();
        this.bind();
        this.updateCartButtons();
    }
    content() {
        return this.host || this.root.querySelector('[data-zf-content]') || this.root;
    }
    renderProducts() {
        const content = this.content().querySelector('[data-zf-products]');
        if (!content) return;
        const selected = this.items.filter(
            (x) =>
                (this.activeCategory === 'all' || String(x.category.id) === String(this.activeCategory)) &&
                (!this.search ||
                    this.title(x.item).toLocaleLowerCase().includes(this.search.toLocaleLowerCase()))
        );
        content.innerHTML =
            selected.map((x) => this.productCard(x)).join('') ||
            `<p class="zf-empty">${this.t('no_products')}</p>`;
        content
            .querySelectorAll('[data-product]')
            .forEach((button) => (button.onclick = () => this.product(button.dataset.product)));
    }
    bind() {
        const host = this.content();
        host.querySelectorAll('[data-category]').forEach(
            (b) =>
                (b.onclick = () => {
                    this.activeCategory = b.dataset.category;
                    host.querySelectorAll('[data-category]').forEach((x) =>
                        x.classList.toggle('active', x === b)
                    );
                    this.renderProducts();
                })
        );
        host.querySelector('[data-zf-search]')?.addEventListener('input', (e) => {
            this.search = e.target.value;
            this.renderProducts();
        });
        host.querySelector('[data-zf-language]')?.addEventListener('change', (e) => {
            this.locale = e.target.value;
            this.render();
        });
        host.querySelector('[data-zf-location]')?.addEventListener('change', async (e) => {
            this.location = e.target.value;
            this.activeCategory = 'all';
            this.search = '';
            this.preorder = null;
            this.table = null;
            await this.load().catch((error) => this.failure(error));
        });
        host.querySelectorAll('[data-zf-cart]').forEach((b) => (b.onclick = () => this.openCart()));
        host.querySelector('[data-reserve]')?.addEventListener('click', () => this.reserve());
        host.querySelector('[data-receipts]')?.addEventListener('click', () => this.activity());
    }
    async launch() {
        try {
            if (!this.data) await this.loadForButton();
            if (this.config.mode === 'reservations') {
                this.reserve();
                return;
            }
            this.launchDialog = modal(this.t('digital_menu'), '<div data-zf-popup></div>');
            this.launchDialog.classList.add('zf-menu-dialog');
            this.launchDialog.style.setProperty('--zf-accent', this.settings.accent);
            this.host = this.launchDialog.querySelector('[data-zf-popup]');
            this.host.classList.add('zf-widget');
            this.render();
            this.poll();
            this.launchDialog.addEventListener('close', () => {
                clearInterval(this.timer);
                this.host = null;
            });
        } catch (e) {
            this.failure(e);
        }
    }
    async loadForButton() {
        this.data = await this.api('catalog');
        this.items = this.flatten();
        this.availability = this.data.orderingAvailability;
        this.restoreCart();
        this.refreshReceipts();
    }
    failure(error) {
        notify(error.message || this.t('request_failed'), true);
    }
    dialog(title, content, footer = '') {
        const d = modal(title, content, footer);
        d.style.setProperty('--zf-accent', this.settings.accent);
        return d;
    }
    ingredients(item) {
        return (
            item.content?.translations?.[this.locale]?.ingredients_text ||
            (item.ingredients || [])
                .map((i) => (this.locale === 'en' && i.name_en ? i.name_en : i.name))
                .join(', ')
        );
    }
    product(id) {
        const found = this.items.find((x) => x.item.public_id === id);
        if (!found) return;
        const { item, category } = found;
        let variant = item.variants?.find((v) => v.is_default) || item.variants?.[0] || null;
        let quantities = {};
        let count = 1;
        const defaults = () => {
            quantities = {};
            for (const g of effectiveGroups(category, item, variant))
                for (const option of g.options) if (option.is_default) quantities[option.id] = 1;
        };
        defaults();
        const img = this.settings.show_images ? imageUrl(item.image_path, this.origin) : '';
        const dialog = this.dialog(
            this.title(item),
            `${img ? `<img class="zf-product-hero" src="${esc(img)}" alt="${esc(this.title(item))}">` : ''}${item.portion_size ? `<span class="zf-pill">${this.t('portion')} · ${esc(item.portion_size)}</span>` : ''}${this.settings.show_descriptions ? `<p class="zf-product-description">${esc(this.translated(item, 'description'))}</p>` : ''}${this.ingredients(item) ? `<p class="zf-ingredients">(${esc(this.ingredients(item))})</p>` : ''}${this.food(item)}<div data-options></div>`,
            `<div class="zf-order-footer"><div class="zf-quantity"><button type="button" data-minus aria-label="${this.t('decrease')}">${icon('minus', 14)}</button><strong data-count>1</strong><button type="button" data-plus aria-label="${this.t('increase')}">${icon('plus', 14)}</button></div><strong data-total></strong></div><button type="button" class="zf-primary zf-full" data-add>${icon('bag', 17)}${this.t('add_to_cart')}</button>`
        );
        const groups = () => effectiveGroups(category, item, variant);
        const update = () => {
            const presentation = { ...found, variant, groups: groups(), modifiers: quantities };
            dialog.querySelector('[data-total]').textContent = this.format(
                this.presentationPrice(presentation) * count
            );
            dialog.querySelector('[data-count]').textContent = count;
            dialog.querySelector('[data-add]').disabled =
                !this.canAdd() || !validChoices(groups(), quantities);
            dialog.querySelector('[data-add]').title = this.canAdd()
                ? ''
                : this.availabilityText() || this.t('ordering_disabled');
        };
        const renderOptions = () => {
            dialog.querySelector('[data-options]').innerHTML =
                `${item.variants?.length ? `<div class="zf-choice-group"><div class="zf-choice-heading"><strong>${this.t('choose_variant')}</strong></div>${item.variants.map((v) => `<label class="zf-option"><input type="radio" name="variant" value="${v.id}" ${variant?.id === v.id ? 'checked' : ''}><span>${esc(v.name)}</span><strong>${this.format(v.price)}</strong></label>`).join('')}</div>` : ''}${groups()
                    .map(
                        (g) =>
                            `<div class="zf-choice-group"><div class="zf-choice-heading"><strong>${esc(g.name)} ${help(g.name, this.t('choices_help').replace('{min}', String(g.min_choices)).replace('{max}', String(g.max_choices)))}</strong><span class="zf-pill">${g.is_required || g.min_choices > 0 ? this.t('required') : this.t('optional')}</span></div>${g.options.map((o) => `<label class="zf-option"><input type="${g.max_choices === 1 ? 'radio' : 'checkbox'}" name="group-${g.id}" data-group="${g.id}" data-option="${o.id}" ${quantities[o.id] ? 'checked' : ''}><span>${esc(o.name)}</span><small>${o.price ? '+' + this.format(o.price) : this.t('included')}</small>${g.allow_quantity ? `<input aria-label="${esc(this.t('quantity') + ' ' + o.name)}" type="number" data-option-quantity="${o.id}" min="1" max="${o.max_quantity || 1}" value="${quantities[o.id] || 1}" ${!quantities[o.id] ? 'disabled' : ''} style="width:70px">` : ''}</label>`).join('')}</div>`
                    )
                    .join('')}`;
            for (const group of groups()) {
                if (group.max_choices !== 1 || group.is_required || group.min_choices > 0) continue;
                const container = dialog
                    .querySelector(`[data-group="${group.id}"]`)
                    ?.closest('.zf-choice-group');
                if (!container) continue;
                const clear = document.createElement('button');
                clear.type = 'button';
                clear.className = 'zf-secondary';
                clear.textContent = this.t('clear_selection');
                clear.title = this.t('clear_selection_help');
                clear.disabled = !group.options.some((option) => quantities[option.id]);
                clear.onclick = () => {
                    group.options.forEach((option) => delete quantities[option.id]);
                    renderOptions();
                };
                container.append(clear);
            }
            dialog.querySelectorAll('[name="variant"]').forEach(
                (input) =>
                    (input.onchange = () => {
                        variant = item.variants.find((v) => v.id === Number(input.value));
                        defaults();
                        renderOptions();
                    })
            );
            dialog.querySelectorAll('[data-option]').forEach(
                (input) =>
                    (input.onchange = () => {
                        const g = groups().find((x) => x.id === Number(input.dataset.group));
                        if (g.max_choices === 1) g.options.forEach((o) => delete quantities[o.id]);
                        if (input.checked) quantities[input.dataset.option] = 1;
                        else delete quantities[input.dataset.option];
                        renderOptions();
                    })
            );
            dialog.querySelectorAll('[data-option-quantity]').forEach(
                (input) =>
                    (input.oninput = () => {
                        quantities[input.dataset.optionQuantity] = Math.max(
                            1,
                            Math.min(Number(input.max), Number(input.value) || 1)
                        );
                        update();
                    })
            );
            update();
        };
        renderOptions();
        dialog.querySelector('[data-minus]').onclick = () => {
            count = Math.max(1, count - 1);
            update();
        };
        dialog.querySelector('[data-plus]').onclick = () => {
            count = Math.min(50, count + 1);
            update();
        };
        dialog.querySelector('[data-add]').onclick = () => {
            if (!this.canAdd() || !validChoices(groups(), quantities) || this.cart.length >= 50) return;
            this.cart.push({
                ...found,
                product_id: id,
                variant_id: variant?.id || null,
                variant,
                groups: groups(),
                modifiers: { ...quantities },
                quantity: count,
            });
            this.persist();
            dialog.close();
            notify(this.t('added_to_cart'));
        };
    }
    food(item) {
        let html = (item.content?.labels || [])
            .map((label) => `<span class="zf-pill">${esc(this.t('food_label_' + label))}</span>`)
            .join(' ');
        if (this.settings.show_allergens && item.from_frozen) {
            html += `<p class="zf-ingredients">${this.t('frozen_notice')}</p>`;
        }
        if (this.settings.show_allergens && (item.contains_allergens || item.content?.allergens?.length)) {
            html += `<details class="zf-food-details"><summary>${this.t('contains_allergens')}</summary><p>${esc((item.content?.allergens || []).map((a) => this.t('allergen_' + a)).join(', ') || this.t('ask_staff'))}</p></details>`;
        }
        if (this.settings.show_allergens && item.content?.may_contain?.length) {
            html += `<details class="zf-food-details"><summary>${this.t('may_contain')}</summary><p>${esc(item.content.may_contain.map((a) => this.t('allergen_' + a)).join(', '))}</p></details>`;
        }
        if (this.settings.show_nutrition && item.content?.nutrition) {
            const n = item.content.nutrition;
            html += `<details class="zf-food-details"><summary>${this.t('nutrition')}${n.estimated ? ' · ' + this.t('estimated') : ''}</summary><p>${n.basis === 'per_serving' || n.per_serving ? this.t('per_portion') : this.t('per_100g')}</p><div class="zf-nutrients">${Object.entries(
                n.per_serving || n.values || {}
            )
                .filter(([, v]) => v !== null)
                .map(([k, v]) => `<span>${esc(this.t('nutrient_' + k))}<strong>${esc(v)}</strong></span>`)
                .join('')}</div></details>`;
        }
        return html;
    }
    openCart() {
        if (!this.cart.length) {
            notify(this.t('cart_empty'));
            return;
        }
        const dialog = this.dialog(
            this.t('your_cart'),
            '<div data-lines></div>',
            `<div class="zf-totals"><div class="zf-grand-total"><span>${this.t('subtotal')}</span><strong data-subtotal></strong></div></div><p class="zf-muted">${this.t('final_price_notice')}</p><button class="zf-primary zf-full" type="button" data-checkout>${this.t('continue_checkout')}${icon('arrow', 17)}</button>`
        );
        const draw = () => {
            dialog.querySelector('[data-lines]').innerHTML = this.cart
                .map((line, index) => {
                    const img = this.settings.show_images ? imageUrl(line.item.image_path, this.origin) : '';
                    return `<article class="zf-cart-item">${img ? `<img src="${esc(img)}" alt="">` : ''}<div><h3>${esc(this.title(line.item))}</h3><small>${esc(line.variant?.name || '')}</small><div class="zf-quantity"><button type="button" data-adjust="-1" data-index="${index}" aria-label="${this.t('decrease')}">${icon('minus', 12)}</button><span>${line.quantity}</span><button type="button" data-adjust="1" data-index="${index}" aria-label="${this.t('increase')}">${icon('plus', 12)}</button></div></div><strong>${this.format(this.presentationPrice(line) * line.quantity)}</strong><button class="zf-icon-button" type="button" data-remove="${index}" aria-label="${this.t('remove')}">${icon('close', 15)}</button></article>`;
                })
                .join('');
            dialog.querySelector('[data-subtotal]').textContent = this.format(this.subtotal());
            dialog.querySelector('[data-checkout]').disabled = !this.cart.length;
            dialog.querySelectorAll('[data-adjust]').forEach(
                (b) =>
                    (b.onclick = () => {
                        const i = Number(b.dataset.index);
                        this.cart[i].quantity = Math.min(
                            50,
                            this.cart[i].quantity + Number(b.dataset.adjust)
                        );
                        if (this.cart[i].quantity < 1) this.cart.splice(i, 1);
                        this.persist();
                        draw();
                    })
            );
            dialog.querySelectorAll('[data-remove]').forEach(
                (b) =>
                    (b.onclick = () => {
                        this.cart.splice(Number(b.dataset.remove), 1);
                        this.persist();
                        draw();
                    })
            );
        };
        draw();
        dialog.querySelector('[data-checkout]').onclick = () => {
            dialog.close();
            this.checkout();
        };
    }
    formField(name, label, type = 'text', required = false, value = '') {
        return `<label class="zf-form-field"><span>${esc(this.t(label))}${help(this.t(label), this.t(label + '_help'))}</span><input name="${name}" aria-label="${esc(this.t(label))}" type="${type}" ${required ? 'required' : ''} value="${esc(value)}" ${name.includes('phone') ? 'maxlength="30"' : name.includes('name') ? 'maxlength="150"' : ''}></label>`;
    }
    async checkout() {
        if (!this.cart.length) return;
        let remembered = {};
        try {
            if (this.settings.remember_customer)
                remembered = JSON.parse(localStorage.getItem('zf_contact_' + this.location) || '{}');
        } catch {}
        const methods =
            this.table || this.preorder
                ? ['dine_in']
                : ['pickup', 'delivery'].filter((s) => this.data.fulfillment?.[s + '_enabled']);
        if (!methods.length) {
            notify(this.t('no_services'), true);
            return;
        }
        const commerce = this.data.location?.commerce_settings || {};
        const dialog = this.dialog(
            this.t(this.preorder ? 'reservation_preorder' : 'checkout_title'),
            `<p class="zf-step-label"><span>1</span>${this.t('checkout_intro')}</p><form id="zf-checkout-${uuid()}" data-checkout-form><div class="zf-form-row">${this.formField('customer_name', 'your_name', 'text', true, remembered.customer_name)}${this.formField('customer_phone', 'phone', 'tel', true, remembered.customer_phone)}</div><label class="zf-form-field"><span>${this.t('fulfillment')}${help(this.t('fulfillment'), this.t('fulfillment_help'))}</span><select aria-label="${esc(this.t('fulfillment'))}" name="fulfillment">${methods.map((m) => `<option value="${m}">${this.t('service_' + m)}</option>`).join('')}</select></label><div data-delivery hidden>${this.formField('delivery_address', 'delivery_address', 'text', true, remembered.delivery_address)}<div data-postal>${this.formField('postal_code', 'postal_code', 'text', false)}<label class="zf-form-field"><span>${this.t('delivery_zone')}${help(this.t('delivery_zone'), this.t('delivery_zone_help'))}</span><select aria-label="${esc(this.t('delivery_zone'))}" name="delivery_zone_id">${(this.data.zones || []).map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}</select></label></div><div data-map-block hidden><p class="zf-muted">${this.t('delivery_map_help')}</p><div class="zf-map" data-map></div></div></div>${commerce.scheduled_orders_enabled && !this.table && !this.preorder ? `<label class="zf-form-field"><span>${this.t('when_order')}${help(this.t('when_order'), this.t('when_order_help'))}</span><select aria-label="${esc(this.t('when_order'))}" name="timing"><option value="now">${this.t('as_soon_as_possible')}</option><option value="later">${this.t('scheduled_order')}</option></select></label><div data-scheduling hidden><div class="zf-form-row">${this.formField('schedule_date', 'date', 'date', false)}<label class="zf-form-field"><span>${this.t('time')}${help(this.t('time'), this.t('time_help'))}</span><select aria-label="${esc(this.t('time'))}" name="scheduled_for"><option value="">${this.t('choose_time')}</option></select></label></div></div>` : ''}${this.formField('promotion_code', 'coupon', 'text', false)}<label class="zf-form-field"><span>${this.t('order_notes')}${help(this.t('order_notes'), this.t('order_notes_help'))}</span><textarea aria-label="${esc(this.t('order_notes'))}" name="notes" maxlength="1000" rows="2"></textarea></label><label class="zf-consent"><input type="checkbox" name="consent" aria-label="${esc(this.t('privacy_consent'))}" required><span>${this.t('privacy_consent')}${this.config.privacy_url ? ` <a href="${esc(this.config.privacy_url)}" target="_blank" rel="noopener">${this.t('privacy_policy')}</a>` : ''}${help(this.t('privacy_consent'), this.t('privacy_consent_help'))}</span></label>${this.settings.remember_customer ? `<label class="zf-consent"><input type="checkbox" name="remember" aria-label="${esc(this.t('remember_me'))}" ${remembered.customer_name ? 'checked' : ''}><span>${this.t('remember_me')}${help(this.t('remember_me'), this.t('remember_me_help'))}</span></label>` : ''}<p data-error role="alert" class="zf-error" hidden></p></form>`,
            `<div data-totals class="zf-totals"><div class="zf-grand-total"><span>${this.t('total')}</span><strong>${this.format(this.subtotal())}</strong></div></div><button class="zf-primary zf-full" type="button" data-submit>${this.t('check_order')}${icon('arrow', 17)}</button><p class="zf-muted">${this.t('no_online_payment')}</p>`
        );
        const form = dialog.querySelector('[data-checkout-form]');
        let quote = null;
        let pending = false;
        let map = null;
        let marker = null;
        let pin = null;
        let quotePayload = '';
        let slotsRequest = 0;
        const error = (message) => {
            const p = form.querySelector('[data-error]');
            p.textContent = message;
            p.hidden = !message;
        };
        const reset = () => {
            quote = null;
            dialog.querySelector('[data-submit]').textContent = this.t('check_order');
        };
        const payload = () => {
            const values = Object.fromEntries(new FormData(form));
            const body = {
                customer_name: values.customer_name,
                customer_phone: values.customer_phone,
                fulfillment: values.fulfillment,
                consent: values.consent === 'on',
                items: orderLines(this.cart),
                notes: values.notes || null,
                promotion_code: values.promotion_code || null,
            };
            if (values.fulfillment === 'delivery') {
                body.delivery_address = values.delivery_address;
                body.postal_code = values.postal_code || null;
                body.delivery_zone_id = Number(values.delivery_zone_id) || null;
                if (pin) {
                    body.delivery_latitude = pin.lat;
                    body.delivery_longitude = pin.lng;
                }
            }
            if (values.timing === 'later' && values.scheduled_for) body.scheduled_for = values.scheduled_for;
            if (this.table) body.table_id = this.table;
            if (this.preorder) body.reservation_id = this.preorder;
            return body;
        };
        const loadSlots = async () => {
            if (!form.elements.schedule_date?.value) return;
            const seq = ++slotsRequest;
            const select = form.elements.scheduled_for;
            select.innerHTML = `<option value="">${this.t('loading')}</option>`;
            try {
                const result = await this.api('schedule_slots', {
                    date: form.elements.schedule_date.value,
                    fulfillment: form.elements.fulfillment.value,
                });
                if (seq !== slotsRequest) return;
                select.innerHTML =
                    `<option value="">${this.t('choose_time')}</option>` +
                    result.slots
                        .map(
                            (slot) =>
                                `<option value="${esc(slot)}">${esc(new Date(slot).toLocaleTimeString(this.locale === 'ro' ? 'ro-RO' : 'en-GB', { hour: '2-digit', minute: '2-digit', timeZone: result.timezone }))}</option>`
                        )
                        .join('');
                if (!result.slots.length) error(this.t('no_slots'));
            } catch (e) {
                error(e.message);
            }
        };
        const configure = () => {
            const delivery = form.elements.fulfillment.value === 'delivery';
            const polygon = (this.data.zones || []).some((z) => z.geometry);
            form.querySelector('[data-delivery]').hidden = !delivery;
            form.elements.delivery_address.required = delivery;
            form.querySelector('[data-postal]').hidden = polygon;
            form.elements.postal_code.required = delivery && !polygon;
            form.querySelector('[data-map-block]').hidden = !delivery || !polygon;
            if (delivery && polygon && !map) {
                map = L.map(form.querySelector('[data-map]'), { scrollWheelZoom: false }).setView(
                    this.data.mapCenter || [44.4268, 26.1025],
                    14
                );
                L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                    maxZoom: 19,
                }).addTo(map);
                for (const zone of this.data.zones || [])
                    if (zone.geometry)
                        L.geoJSON(zone.geometry, {
                            style: { color: this.settings.accent, weight: 2, fillOpacity: 0.06 },
                        }).addTo(map);
                const move = async (latlng) => {
                    pin = { lat: latlng.lat, lng: latlng.lng };
                    reset();
                    if (!marker) {
                        marker = L.marker(latlng, {
                            draggable: true,
                            icon: L.divIcon({
                                className: 'zf-pin',
                                iconSize: [22, 22],
                                iconAnchor: [11, 22],
                            }),
                        }).addTo(map);
                        marker.on('dragend', () => move(marker.getLatLng()));
                    } else marker.setLatLng(latlng);
                    const original = form.elements.delivery_address.value;
                    const selected = JSON.stringify(pin);
                    try {
                        const result = await this.api('address', { latitude: pin.lat, longitude: pin.lng });
                        if (
                            JSON.stringify(pin) === selected &&
                            form.elements.delivery_address.value === original
                        ) {
                            form.elements.delivery_address.value =
                                result.address || result.formatted_address || '';
                        }
                    } catch (e) {
                        error(e.message);
                    }
                };
                map.on('click', (e) => move(e.latlng));
            }
            if (map) setTimeout(() => map.invalidateSize(), 50);
            if (form.elements.timing) {
                const later = form.elements.timing.value === 'later';
                form.querySelector('[data-scheduling]').hidden = !later;
                form.elements.schedule_date.required = later;
                form.elements.scheduled_for.required = later;
            }
            reset();
        };
        form.elements.fulfillment.onchange = () => {
            configure();
            if (form.elements.timing?.value === 'later') loadSlots();
        };
        if (form.elements.timing) form.elements.timing.onchange = configure;
        if (form.elements.schedule_date)
            form.elements.schedule_date.onchange = () => {
                reset();
                loadSlots();
            };
        form.addEventListener('input', reset);
        form.addEventListener('change', reset);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            submit();
        });
        configure();
        dialog.addEventListener(
            'close',
            () => {
                slotsRequest++;
                map?.remove();
            },
            { once: true }
        );
        const submit = async () => {
            if (pending || !form.reportValidity()) return;
            const data = payload();
            if (form.elements.timing?.value === 'later' && !data.scheduled_for) {
                error(this.t('choose_time'));
                return;
            }
            const deliveryPolygon =
                data.fulfillment === 'delivery' && (this.data.zones || []).some((z) => z.geometry);
            if (deliveryPolygon && !pin) {
                error(this.t('select_delivery_pin'));
                return;
            }
            pending = true;
            const button = dialog.querySelector('[data-submit]');
            button.disabled = true;
            error('');
            try {
                if (!quote || quotePayload !== JSON.stringify(data)) {
                    quote = await this.api('quote', data);
                    quotePayload = JSON.stringify(data);
                    dialog.querySelector('[data-totals]').innerHTML =
                        `<div><span>${this.t('subtotal')}</span><strong>${this.format(quote.subtotal)}</strong></div><div><span>${this.t('delivery_fee')}</span><strong>${this.format(quote.delivery_fee)}</strong></div>${quote.discount ? `<div><span>${this.t('discount')}</span><strong>−${this.format(quote.discount)}</strong></div>` : ''}<div class="zf-grand-total"><span>${this.t('total')}</span><strong>${this.format(quote.total)}</strong></div>`;
                    button.textContent = this.t('place_order') + ' · ' + this.format(quote.total);
                    notify(this.t('quote_ready'));
                } else {
                    const result = await this.mutate('checkout', data);
                    if (this.settings.remember_customer) {
                        try {
                            if (form.elements.remember.checked)
                                localStorage.setItem(
                                    'zf_contact_' + this.location,
                                    JSON.stringify({
                                        customer_name: data.customer_name,
                                        customer_phone: data.customer_phone,
                                        delivery_address: data.delivery_address || '',
                                    })
                                );
                            else localStorage.removeItem('zf_contact_' + this.location);
                        } catch {}
                    }
                    this.cart = [];
                    this.persist();
                    this.preorder = null;
                    dialog.close();
                    this.receiptIds.orders.push(result.order_id);
                    this.showOrder(result.order_id);
                }
            } catch (e) {
                error(e.message || this.t('request_failed'));
            } finally {
                pending = false;
                button.disabled = false;
            }
        };
        dialog.querySelector('[data-submit]').onclick = submit;
    }
    async refreshReceipts() {
        try {
            this.receiptIds = await this.api('receipts');
        } catch {}
        if (this.table) {
            try {
                this.tableOrders = await this.api('table_orders', { id: this.table });
            } catch {}
        }
    }
    async activity() {
        await this.refreshReceipts();
        const dialog = this.dialog(
            this.t('my_activity'),
            `${this.tableOrders?.orders?.length ? `<h3>${this.t('table_orders')}</h3>${this.tableOrders.orders.map((o) => `<button class="zf-secondary zf-full" data-order="${o.public_id}">#${esc(o.public_id.slice(-6))} · ${this.t('status_' + o.status)} · ${this.format(o.total)}</button>`).join('')}` : ''}<h3>${this.t('orders')}</h3>${
                this.receiptIds.orders
                    .slice(-10)
                    .reverse()
                    .map(
                        (id) =>
                            `<p><button type="button" class="zf-secondary zf-full" data-order="${id}">#${esc(id.slice(-8))}${icon('arrow', 16)}</button></p>`
                    )
                    .join('') || `<p class="zf-muted">${this.t('no_orders')}</p>`
            }<h3>${this.t('reservations')}</h3>${
                this.receiptIds.reservations
                    .slice(-10)
                    .reverse()
                    .map(
                        (id) =>
                            `<p><button type="button" class="zf-secondary zf-full" data-booking="${id}">#${esc(id.slice(-8))}${icon('arrow', 16)}</button></p>`
                    )
                    .join('') || `<p class="zf-muted">${this.t('no_reservations')}</p>`
            }`
        );
        dialog
            .querySelectorAll('[data-order]')
            .forEach((b) => (b.onclick = () => this.showOrder(b.dataset.order)));
        dialog
            .querySelectorAll('[data-booking]')
            .forEach((b) => (b.onclick = () => this.showReservation(b.dataset.booking)));
    }
    showOrder(id) {
        const dialog = this.dialog(
            this.t('order_status'),
            `<div class="zf-loading">${this.t('loading')}</div>`,
            `<button class="zf-secondary zf-full" data-close>${this.t('back_to_menu')}</button>`
        );
        dialog.querySelector('[data-close]').onclick = () => dialog.close();
        let timer;
        const refresh = async () => {
            if (!dialog.isConnected) return;
            try {
                let order;
                const shared = this.tableOrders?.orders?.find((o) => o.public_id === id);
                try {
                    order = await this.api('track', { id });
                } catch (e) {
                    if (shared) {
                        await this.refreshReceipts();
                        order = this.tableOrders?.orders?.find((o) => o.public_id === id);
                        if (!order) {
                            dialog.querySelector('.zf-dialog-body').innerHTML =
                                `<p>${this.t('table_order_finished')}</p>`;
                            return;
                        }
                    } else throw e;
                }
                dialog.querySelector('.zf-dialog-body').innerHTML =
                    `<div class="zf-success-message"><div class="zf-success-circle">${icon('check', 30)}</div><h3>${this.t('order_received')}</h3><p>#${esc(id.slice(-8))}</p><span class="zf-receipt-status">${this.t('status_' + order.status)}</span>${order.scheduled_for ? `<p>${this.t('scheduled_order')}: ${esc(new Date(order.scheduled_for).toLocaleString(this.locale === 'ro' ? 'ro-RO' : 'en-GB'))}</p>` : ''}</div>${(order.items || []).map((item) => `<article class="zf-receipt-item"><div><strong>${item.quantity} × ${esc(item.name)}</strong><span>${this.format(item.total)}</span></div><small>${esc(item.variant_name || '')}${(item.modifiers || []).map((m) => ' · ' + esc(m.name)).join('')}</small></article>`).join('')}<hr><div class="zf-order-footer"><strong>${this.t('total')}</strong><strong>${this.format(order.total)}</strong></div>`;
                if (!['completed', 'rejected', 'cancelled'].includes(order.status))
                    timer = setTimeout(refresh, 10000);
            } catch (e) {
                dialog.querySelector('.zf-dialog-body').innerHTML =
                    `<p class="zf-error">${esc(e.message)}</p>`;
            }
        };
        refresh();
        dialog.addEventListener('close', () => clearTimeout(timer), { once: true });
    }
    reserve() {
        if (!this.settings.enable_reservations || !this.data.fulfillment?.reservations_enabled) {
            notify(this.t('reservations_unavailable'), true);
            return;
        }
        const dialog = this.dialog(
            this.t('reserve_table'),
            `<form data-reservation><p class="zf-muted">${this.t('reservation_intro')}</p><div class="zf-form-row">${this.formField('date', 'date', 'date', true)}${this.formField('party_size', 'party_size', 'number', true, '2')}</div><div data-slots></div><div class="zf-form-row">${this.formField('guest_name', 'your_name', 'text', true)}${this.formField('guest_phone', 'phone', 'tel', true)}</div>${this.formField('guest_email', 'email', 'email', false)}<label class="zf-form-field"><span>${this.t('order_notes')}${help(this.t('order_notes'), this.t('order_notes_help'))}</span><textarea aria-label="${esc(this.t('order_notes'))}" name="notes" maxlength="1000"></textarea></label><label class="zf-consent"><input type="checkbox" aria-label="${esc(this.t('privacy_consent'))}" required><span>${this.t('privacy_consent')}${help(this.t('privacy_consent'), this.t('privacy_consent_help'))}</span></label><p data-error role="alert" class="zf-error" hidden></p></form>`,
            `<button class="zf-primary zf-full" data-reserve-submit type="button">${this.t('confirm_reservation')}${icon('calendar', 17)}</button>`
        );
        const form = dialog.querySelector('form');
        form.elements.party_size.min = 1;
        form.elements.party_size.max = 100;
        let seq = 0;
        let submitting = false;
        const slots = async () => {
            if (!form.elements.date.value) return;
            const current = ++seq;
            form.querySelector('[data-slots]').innerHTML = `<p class="zf-muted">${this.t('loading')}</p>`;
            try {
                const result = await this.api('reservation_slots', {
                    date: form.elements.date.value,
                    party_size: Number(form.elements.party_size.value),
                });
                if (current !== seq || !dialog.isConnected) return;
                form.querySelector('[data-slots]').innerHTML =
                    `<label class="zf-form-field"><span>${this.t('time')}${help(this.t('time'), this.t('time_help'))}</span><select aria-label="${esc(this.t('time'))}" name="starts_at" required><option value="">${this.t('choose_time')}</option>${result.slots.map((s) => `<option value="${esc(s)}">${esc(s.slice(11, 16))}</option>`).join('')}</select></label>${!result.slots.length ? `<p class="zf-warning">${this.t('no_slots')}</p>` : ''}`;
            } catch (e) {
                form.querySelector('[data-slots]').innerHTML = `<p class="zf-error">${esc(e.message)}</p>`;
            }
        };
        form.elements.date.onchange = slots;
        form.elements.party_size.onchange = slots;
        const submit = async () => {
            if (submitting || !form.reportValidity() || !form.elements.starts_at?.value) return;
            submitting = true;
            const b = dialog.querySelector('[data-reserve-submit]');
            b.disabled = true;
            try {
                const values = Object.fromEntries(new FormData(form));
                const result = await this.mutate('reserve', {
                    guest_name: values.guest_name,
                    guest_phone: values.guest_phone,
                    guest_email: values.guest_email || null,
                    party_size: Number(values.party_size),
                    consent: true,
                    starts_at: values.starts_at,
                    notes: values.notes || null,
                });
                dialog.close();
                this.receiptIds.reservations.push(result.reservation_id);
                this.showReservation(result.reservation_id);
            } catch (e) {
                form.querySelector('[data-error]').hidden = false;
                form.querySelector('[data-error]').textContent = e.message;
            } finally {
                submitting = false;
                b.disabled = false;
            }
        };
        form.onsubmit = (e) => {
            e.preventDefault();
            submit();
        };
        dialog.querySelector('[data-reserve-submit]').onclick = submit;
        dialog.addEventListener('close', () => seq++, { once: true });
    }
    showReservation(id) {
        const dialog = this.dialog(
            this.t('reservation_details'),
            `<div class="zf-loading">${this.t('loading')}</div>`,
            `<button class="zf-secondary zf-full" data-close>${this.t('back_to_menu')}</button>`
        );
        dialog.querySelector('[data-close]').onclick = () => dialog.close();
        let timer;
        const refresh = async () => {
            if (!dialog.isConnected) return;
            try {
                const booking = await this.api('reservation_track', { id });
                dialog.querySelector('.zf-dialog-body').innerHTML =
                    `<div class="zf-success-message"><div class="zf-success-circle">${icon('calendar', 28)}</div><h3>${this.t('reservation_received')}</h3><span class="zf-receipt-status">${this.t('status_' + booking.status)}</span><p>${esc(new Date(booking.starts_at).toLocaleString(this.locale === 'ro' ? 'ro-RO' : 'en-GB', { timeZone: booking.timezone }))}</p><p>${booking.party_size} ${this.t('guests')}</p></div><div class="zf-receipt-actions">${booking.status === 'confirmed' && this.settings.enable_ordering && this.data.location?.commerce_settings?.reservation_preorders_enabled ? `<button type="button" class="zf-primary" data-preorder>${this.t('reservation_preorder')}</button>` : ''}${['pending', 'confirmed'].includes(booking.status) ? `<button type="button" class="zf-secondary" data-cancel>${this.t('cancel_reservation')}</button>` : ''}</div>`;
                dialog.querySelector('[data-preorder]')?.addEventListener('click', () => {
                    this.preorder = id;
                    dialog.close();
                    if (this.config.mode === 'reservations') {
                        this.config.mode = 'order';
                        this.launch();
                    } else {
                        notify(this.t('preorder_started'));
                    }
                });
                dialog.querySelector('[data-cancel]')?.addEventListener('click', async (e) => {
                    if (!confirm(this.t('cancel_reservation_confirm'))) return;
                    e.target.disabled = true;
                    try {
                        await this.mutate('reservation_cancel', { id, version: booking.version });
                        refresh();
                    } catch (error) {
                        notify(error.message, true);
                        e.target.disabled = false;
                    }
                });
                if (booking.status === 'pending') timer = setTimeout(refresh, 12000);
            } catch (e) {
                dialog.querySelector('.zf-dialog-body').innerHTML =
                    `<p class="zf-error">${esc(e.message)}</p>`;
            }
        };
        refresh();
        dialog.addEventListener('close', () => clearTimeout(timer), { once: true });
    }
    promotionText(p) {
        if (p.kind === 'percent') return `${p.value / 100}% · ${this.t('automatic_promotion')}`;
        if (p.kind === 'fixed') return this.format(p.value) + ' · ' + this.t('automatic_promotion');
        if (p.kind === 'free_delivery') return this.t('free_delivery');
        return this.t('buy_x_get_y').replace('{x}', p.buy_quantity).replace('{y}', p.reward_quantity);
    }
}
document.querySelectorAll('[data-zf-widget]').forEach((root) => new Storefront(root));
