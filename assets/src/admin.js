import './admin.css';
import { esc, icon, help, notify, money } from './shared.js';

const element = document.getElementById('zionfood-admin-config');
if (element) {
    const config = JSON.parse(element.textContent);
    let state = config.state;
    let language = config.language;
    const root = document.getElementById('zionfood-admin');
    let tab = (new URL(location.href).searchParams.get('page') || 'zionfood').replace('zionfood-', '');
    if (tab === 'zionfood') tab = 'dashboard';
    const t = (key) => config.dictionaries[language][key] ?? key;
    const busy = new Set();
    async function api(operation, data = {}) {
        const response = await fetch(config.root + 'admin/' + operation, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce },
            body: JSON.stringify(data),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || t('request_failed'));
        if (result.state) state = result.state;
        return result;
    }
    async function action(name, callback) {
        if (busy.has(name)) return;
        busy.add(name);
        const button = root.querySelector(`[data-action="${name}"]`);
        if (button) button.disabled = true;
        try {
            await callback();
            render();
            notify(t('saved'));
        } catch (e) {
            notify(e.message, true);
        } finally {
            busy.delete(name);
            if (button?.isConnected) button.disabled = false;
        }
    }
    const date = (value) =>
        value ? new Date(value * 1000).toLocaleString(language === 'ro' ? 'ro-RO' : 'en-GB') : '—';
    function field(key, type = 'checkbox', options = []) {
        const id = 'zf-' + key;
        const value = state.settings[key];
        let input;
        if (type === 'checkbox') {
            input = `<label class="zf-switch"><input id="${id}" aria-label="${esc(t('setting_' + key))}" name="${key}" type="checkbox" ${value ? 'checked' : ''}><span></span></label>`;
        } else if (type === 'select') {
            input = `<select id="${id}" aria-label="${esc(t('setting_' + key))}" name="${key}">${options.map((o) => `<option value="${esc(o.value)}" ${String(value) === String(o.value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        } else if (type === 'locations') {
            input = `<div class="zf-location-checks">${state.connection.manifest?.locations.map((l) => `<label><input type="checkbox" name="visible_locations" value="${esc(l.public_id)}" ${value.includes(l.public_id) ? 'checked' : ''}>${esc(l.name)}</label>`).join('') || ''}</div>`;
        } else {
            input = `<input id="${id}" aria-label="${esc(t('setting_' + key))}" name="${key}" type="${type}" value="${esc(value)}" ${key === 'cache_ttl' ? 'min="15" max="300" step="1"' : key === 'order_label' ? 'maxlength="60"' : ''}>`;
        }
        return `<div class="zf-setting ${type === 'checkbox' ? 'zf-setting-switch' : ''}"><div><label for="${id}">${esc(t('setting_' + key))}</label>${help(t('setting_' + key), t('help_' + key))}</div>${input}</div>`;
    }
    function connection() {
        return `<section class="zf-card"><div class="zf-card-heading"><span class="zf-icon-tile">${icon('link')}</span><div><h2>${t('connect_title')}</h2><p>${t('connect_intro')}</p></div></div><form id="zf-connect"><div class="zf-field"><label for="zf-api-key">${t('api_key')}${help(t('api_key'), t('api_key_help'))}</label><input type="password" id="zf-api-key" aria-label="${esc(t('api_key'))}" name="api_key" autocomplete="new-password" required placeholder="${esc(state.connection.connected ? t('key_saved') : t('paste_key'))}" maxlength="255"></div><details class="zf-advanced"><summary>${t('instant_updates')}</summary><div class="zf-field"><label for="zf-webhook-secret">${t('webhook_secret')}${help(t('webhook_secret'), t('webhook_help'))}</label><input type="password" id="zf-webhook-secret" aria-label="${esc(t('webhook_secret'))}" name="webhook_secret" autocomplete="new-password" maxlength="128"></div></details><div class="zf-actions"><button class="zf-primary" type="submit" data-action="connect">${icon('link', 18)}${t(state.connection.connected ? 'replace_key' : 'connect')}</button><a class="zf-text-link" href="https://food.zion3d.ro/app" target="_blank" rel="noopener noreferrer">${t('get_key')}${icon('arrow', 16)}</a></div></form></section>`;
    }
    function dashboard() {
        const c = state.connection;
        const status = c.last_error ? 'connection_attention' : c.connected ? 'connected' : 'not_connected';
        const a = state.metrics.analytics?.orders;
        return `<section class="zf-hero"><div><span class="zf-eyebrow">ZIONFOOD / WORDPRESS</span><h1>${t('hero_title')}</h1><p>${t('hero_intro')}</p><div class="zf-actions"><button class="zf-primary" data-go="${c.connected ? 'publish' : 'connect'}">${t(c.connected ? 'publish_menu' : 'start_connection')}${icon('arrow', 18)}</button>${c.connected ? `<button class="zf-secondary" data-action="sync">${icon('refresh', 17)}${t('sync_now')}</button>` : ''}</div></div><div class="zf-connection-orbit"><div class="zf-orbit-core"><img src="${esc(config.logo)}" width="56" height="56" alt=""><span>ZionFood</span></div><span class="zf-orbit-line"></span><div class="zf-orbit-destination">W<span>WordPress</span></div><span class="zf-orbit-status ${c.connected && !c.last_error ? 'good' : ''}">${icon(c.connected && !c.last_error ? 'check' : 'info', 15)}${t(status)}</span></div></section><div class="zf-metrics">${[
            ['grid', 'products', state.metrics.products],
            ['globe', 'locations', state.metrics.locations],
            ['calendar', 'categories', state.metrics.categories],
            ['pulse', 'last_sync', c.last_sync ? date(c.last_sync) : '—'],
        ]
            .map(
                ([i, k, v]) =>
                    `<article class="zf-metric">${icon(i)}<p>${t(k)}</p><strong>${esc(v)}</strong></article>`
            )
            .join(
                ''
            )}</div><div class="zf-dashboard-grid"><div>${c.connected ? `<section class="zf-card"><div class="zf-card-heading"><span class="zf-icon-tile">${icon('check')}</span><div><h2>${esc(state.metrics.restaurant || 'ZionFood')}</h2><p>${t('restaurant_ready')}</p></div></div><div class="zf-service-tags">${['pickup', 'delivery', 'dine_in', 'reservations'].map((s) => `<span class="${state.metrics.services[s + '_enabled'] ? 'is-on' : ''}">${icon(state.metrics.services[s + '_enabled'] ? 'check' : 'close', 14)}${t('service_' + s)}</span>`).join('')}</div><p class="zf-muted">${t('last_sync')}: ${date(c.last_sync)}</p><p class="zf-muted">API v${esc(c.manifest?.api_version || '1')} · ${t('server')}: ${esc(c.origin)}</p><div class="zf-actions"><a class="zf-secondary" href="https://food.zion3d.ro/app" target="_blank" rel="noopener noreferrer">${t('open_restaurant')}${icon('arrow', 16)}</a><button class="zf-danger-text" data-action="disconnect">${t('disconnect')}</button></div></section>` : connection()}${a ? `<section class="zf-card"><h2>${t('last_seven_days')}</h2><div class="zf-mini-metrics"><div><strong>${a.count}</strong><span>${t('orders')}</span></div><div><strong>${money(a.value, 'RON', language)}</strong><span>${t('completed_value')}</span></div></div><p class="zf-muted">${t('analytics_definition')}</p></section>` : ''}</div><section class="zf-card zf-next-steps"><span class="zf-eyebrow">${t('your_next_steps')}</span>${[
            [c.connected, 'step_connect', 'step_connect_help', 'connect'],
            [!!state.settings.location_id, 'step_style', 'step_style_help', 'settings'],
            [!!state.menu_url, 'step_publish', 'step_publish_help', 'publish'],
        ]
            .map(
                ([done, title, description, target], i) =>
                    `<button class="zf-step" data-go="${target}"><span class="zf-step-number ${done ? 'done' : ''}">${done ? icon('check', 18) : i + 1}</span><span><strong>${t(title)}</strong><small>${t(description)}</small></span>${icon('arrow', 17)}</button>`
            )
            .join('')}</section></div>`;
    }
    function settings() {
        const locs = (state.connection.manifest?.locations || []).map((l) => ({
            value: l.public_id,
            label: l.name,
        }));
        return `<div class="zf-page-title"><span class="zf-eyebrow">${t('settings')}</span><h1>${t('settings_title')}</h1><p>${t('settings_intro')}</p></div><form id="zf-settings"><div class="zf-settings-grid"><section class="zf-card"><h2>${t('section_locations')}</h2>${field('visible_locations', 'locations')}${field('location_id', 'select', locs)}${field('menu_page_id', 'select', [{ value: 0, label: t('no_page') }, ...state.pages.map((p) => ({ value: p.id, label: p.title }))])}${field('enable_ordering')}${field('enable_reservations')}</section><section class="zf-card"><h2>${t('section_presentation')}</h2>${field(
            'language',
            'select',
            [
                { value: 'ro', label: '🇷🇴 Română' },
                { value: 'en', label: '🇬🇧 English' },
            ]
        )}${field('language_switcher')}${field('accent', 'color')}${field('menu_layout', 'select', [
            { value: 'grid', label: t('layout_grid') },
            { value: 'list', label: t('layout_list') },
        ])}${['show_images', 'show_descriptions', 'show_search', 'show_allergens', 'show_nutrition'].map((k) => field(k)).join('')}</section><section class="zf-card"><h2>${t('section_conversion')}</h2>${field(
            'floating_button',
            'select',
            ['none', 'order', 'reserve', 'both'].map((v) => ({ value: v, label: t('float_' + v) }))
        )}${field(
            'floating_position',
            'select',
            ['right', 'left'].map((v) => ({ value: v, label: t(v) }))
        )}${field('order_label', 'text')}${field('persist_cart')}${field('remember_customer')}</section><section class="zf-card"><h2>${t('section_technical')}</h2>${field('cache_ttl', 'number')}${field('diagnostics_enabled')}${field('delete_on_uninstall')}<p class="zf-note">${icon('info', 18)}${t('server_fixed')}</p></section></div><div class="zf-save-bar"><span>${t('settings_save_hint')}</span><button type="submit" class="zf-primary" data-action="settings">${icon('check', 18)}${t('save_settings')}</button></div></form>`;
    }
    function publish() {
        return `<div class="zf-page-title"><span class="zf-eyebrow">${t('publish')}</span><h1>${t('publish_title')}</h1><p>${t('publish_intro')}</p></div><section class="zf-card zf-publish-card"><div><span class="zf-icon-tile">${icon('globe', 26)}</span><h2>${t('create_page')}</h2><p>${t('create_page_help')}</p><button class="zf-primary" data-action="publish">${icon('plus', 18)}${t(state.menu_url ? 'open_menu_page' : 'create_menu_page')}</button></div><div class="zf-browser-preview"><span class="zf-browser-dots">● ● ●</span><p>${esc(state.metrics.restaurant || t('digital_menu'))}</p><div class="zf-preview-line long"></div><div class="zf-preview-grid">${Array.from({ length: 4 }, () => '<span></span>').join('')}</div><span class="zf-preview-cta">${t('order_now')}${icon('arrow', 16)}</span></div></section><div class="zf-shortcode-grid">${['menu', 'order', 'reservations', 'hours', 'promotions'].map((type) => `<section class="zf-card"><span class="zf-eyebrow">${t('shortcode_' + type)}</span><h3>${t('shortcode_' + type + '_title')}</h3><p>${t('shortcode_' + type + '_help')}</p><div class="zf-code"><code>[zionfood_${type}]</code><button class="zf-icon-button" data-copy="[zionfood_${type}]" aria-label="${t('copy')}">${icon('copy', 17)}</button></div></section>`).join('')}</div><section class="zf-card"><h2>${t('gutenberg_title')}</h2><p>${t('gutenberg_help')}</p></section>`;
    }
    function diagnostics() {
        return `<div class="zf-page-title"><span class="zf-eyebrow">${t('diagnostics')}</span><h1>${t('diagnostics_title')}</h1><p>${t('diagnostics_intro')}</p></div><section class="zf-card"><div class="zf-actions"><button class="zf-primary" data-action="sync">${icon('refresh', 17)}${t('test_connection')}</button><button class="zf-secondary" data-action="callback">${icon('pulse', 17)}${t('activate_webhook')}</button>${help(t('activate_webhook'), t('webhook_help'))}</div><p class="zf-muted">${t('webhook_endpoint')}: <code>${esc(state.webhook_url)}</code></p></section><section class="zf-card zf-log-table"><table><thead><tr>${['time', 'operation', 'status', 'duration', 'request_id'].map((k) => `<th>${t(k)}</th>`).join('')}</tr></thead><tbody>${state.logs.map((l) => `<tr><td>${date(l.created_at)}</td><td><code>${esc(l.method)} ${esc(l.operation)}</code></td><td><span class="zf-badge ${l.http_status >= 200 && l.http_status < 300 ? 'good' : 'bad'}">${l.http_status || t('network_error')}</span></td><td>${l.duration_ms} ms</td><td><code>${esc(l.request_id || '—')}</code></td></tr>`).join('')}</tbody></table>${!state.logs.length ? `<p class="zf-muted">${t('no_logs')}</p>` : ''}</section>`;
    }
    function render() {
        const nav = [
            ['dashboard', 'grid'],
            ['connect', 'link'],
            ['settings', 'settings'],
            ['publish', 'globe'],
            ...(state.settings.diagnostics_enabled ? [['diagnostics', 'pulse']] : []),
        ];
        root.innerHTML = `<header class="zf-topbar"><a href="?page=zionfood" class="zf-brand"><img src="${esc(config.logo)}" width="42" height="42" alt=""><span>Zion<span>Food</span><small>WORDPRESS / ${esc(state.connection.version)}</small></span></a><div class="zf-topbar-right"><span class="zf-badge ${state.connection.connected && !state.connection.last_error ? 'good' : 'neutral'}">${icon('pulse', 14)}${t(state.connection.connected && !state.connection.last_error ? 'connected' : 'connection_attention')}</span><select aria-label="${t('language')}" data-admin-language><option value="ro" ${language === 'ro' ? 'selected' : ''}>🇷🇴 Română</option><option value="en" ${language === 'en' ? 'selected' : ''}>🇬🇧 English</option></select></div></header><nav class="zf-nav" aria-label="ZionFood">${nav.map(([key, i]) => `<button class="${tab === key ? 'active' : ''}" data-go="${key}">${icon(i, 18)}${t(key)}</button>`).join('')}</nav><main>${({ dashboard, connect: () => `<div class="zf-page-title"><h1>${t('connect_title')}</h1><p>${t('connect_intro')}</p></div>${connection()}`, settings, publish, diagnostics }[tab] || dashboard)()}</main><footer class="zf-admin-footer"><span>ZionFood · ${t('footer_note')}</span><a href="https://food.zion3d.ro" target="_blank" rel="noopener noreferrer">food.zion3d.ro ↗</a></footer>`;
        root.querySelectorAll('[data-go]').forEach(
            (button) =>
                (button.onclick = () => {
                    tab = button.dataset.go;
                    render();
                })
        );
        root.querySelector('[data-admin-language]').onchange = async (e) => {
            const next = e.target.value;
            try {
                await api('locale', { language: next });
                language = next;
                render();
            } catch (error) {
                notify(error.message, true);
            }
        };
        root.querySelector('#zf-connect')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = Object.fromEntries(new FormData(form));
            action('connect', async () => {
                await api('connect', data);
                tab = 'dashboard';
            });
        });
        root.querySelector('#zf-settings')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const values = {};
            Object.keys(state.settings).forEach((k) => {
                const controls = form.querySelectorAll(`[name="${k}"]`);
                if (!controls.length) return;
                if (k === 'visible_locations') {
                    values[k] = [...controls].filter((c) => c.checked).map((c) => c.value);
                } else {
                    const c = controls[0];
                    values[k] =
                        c.type === 'checkbox'
                            ? c.checked
                            : ['number', 'menu_page_id'].includes(c.type) || k === 'menu_page_id'
                              ? Number(c.value)
                              : c.value;
                }
            });
            action('settings', async () => {
                await api('settings', values);
            });
        });
        root.querySelectorAll('[data-action="sync"]').forEach(
            (button) =>
                (button.onclick = () =>
                    action('sync', async () => {
                        await api('sync');
                    }))
        );
        root.querySelector('[data-action="disconnect"]')?.addEventListener('click', () => {
            if (confirm(t('disconnect_confirm')))
                action('disconnect', async () => {
                    await api('disconnect');
                });
        });
        root.querySelector('[data-action="callback"]')?.addEventListener('click', () =>
            action('callback', async () => {
                await api('callback');
            })
        );
        root.querySelector('[data-action="publish"]')?.addEventListener('click', () =>
            action('publish', async () => {
                if (state.menu_url) {
                    location.assign(state.menu_url);
                    return;
                }
                await api('publish');
            })
        );
        root.querySelectorAll('[data-copy]').forEach(
            (button) =>
                (button.onclick = async () => {
                    try {
                        await navigator.clipboard.writeText(button.dataset.copy);
                        notify(t('copied'));
                    } catch {
                        notify(t('copy_manual'), true);
                    }
                })
        );
    }
    render();
    if (state.connection.connected && Date.now() / 1000 - (state.connection.last_sync || 0) > 120) {
        api('sync')
            .then(() => render())
            .catch((e) => notify(e.message, true));
    }
}
