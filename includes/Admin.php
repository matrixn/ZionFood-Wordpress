<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Admin
{
    public function menu(): void
    {
        add_menu_page('ZionFood', 'ZionFood', 'manage_options', 'zionfood', [self::class, 'render'], 'dashicons-food', 26);
        foreach (['dashboard' => 'dashboard', 'settings' => 'settings', 'publish' => 'publish', 'diagnostics' => 'diagnostics'] as $key => $label) {
            if ($key === 'diagnostics' && !Settings::get()['diagnostics_enabled']) {
                continue;
            }
            add_submenu_page('zionfood', I18n::t($label), I18n::t($label), 'manage_options', $key === 'dashboard' ? 'zionfood' : 'zionfood-' . $key, [self::class, 'render']);
        }
    }

    public function assets(string $hook): void
    {
        if (!str_contains($hook, 'zionfood')) {
            return;
        }
        wp_enqueue_style('zionfood-admin', plugins_url('assets/dist/admin.css', FILE), [], VERSION);
        wp_enqueue_script('zionfood-admin', plugins_url('assets/dist/admin.js', FILE), [], VERSION, true);
    }

    public static function state(): array
    {
        $settings = Settings::get();
        $menu = $settings['location_id'] && Settings::allowed($settings['location_id']) ? Catalog::get($settings['location_id']) : [];
        $metrics = ['products' => 0, 'categories' => 0, 'locations' => count(Settings::locations()), 'services' => [], 'analytics' => null];
        if (!is_wp_error($menu)) {
            foreach ($menu['menus'] ?? [] as $entry) {
                foreach ($entry['categories'] ?? [] as $category) {
                    $metrics['categories']++;
                    $metrics['products'] += count($category['items'] ?? []);
                }
            }
            $metrics['services'] = $menu['fulfillment'] ?? [];
            $metrics['availability'] = $menu['orderingAvailability'] ?? null;
            $metrics['restaurant'] = $menu['restaurant']['name'] ?? '';
        }
        if ($settings['location_id'] && Settings::has('analytics:read')) {
            $cache = 'zf_admin_analytics_' . $settings['location_id'];
            $analytics = get_transient($cache);
            if (!$analytics) {
                $analytics = (new Client())->request('GET', 'locations/' . $settings['location_id'] . '/analytics?days=7');
                if (!is_wp_error($analytics)) {
                    set_transient($cache, $analytics, 60);
                }
            }
            if (!is_wp_error($analytics)) {
                $metrics['analytics'] = $analytics;
            }
        }
        $pages = get_posts(['post_type' => 'page', 'post_status' => 'publish', 'numberposts' => 100, 'orderby' => 'title', 'order' => 'ASC']);
        return ['connection' => Settings::status(), 'settings' => $settings, 'metrics' => $metrics, 'logs' => $settings['diagnostics_enabled'] ? Journal::recent() : [], 'pages' => array_map(static fn ($p) => ['id' => $p->ID, 'title' => $p->post_title, 'url' => get_permalink($p)], $pages), 'menu_url' => $settings['menu_page_id'] ? get_permalink($settings['menu_page_id']) : null, 'webhook_url' => rest_url('zionfood/v1/webhook')];
    }

    public static function render(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html(I18n::t('forbidden')));
        }
        $config = ['root' => rest_url('zionfood/v1/'), 'nonce' => wp_create_nonce('wp_rest'), 'language' => I18n::locale(), 'dictionaries' => I18n::dictionaries(), 'logo' => plugins_url('assets/images/zionfood.png', FILE), 'state' => self::state()];
        echo '<div id="zionfood-admin" class="zf-admin"><div class="zf-loading" role="status">' . esc_html(I18n::t('loading')) . '</div></div>';
        echo '<script type="application/json" id="zionfood-admin-config">' . wp_json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . '</script>';
    }
}
