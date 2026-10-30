<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Settings
{
    public const OPTION = 'zionfood_settings';
    public const DEFAULTS = [
        'location_id' => '', 'visible_locations' => [], 'language' => 'ro', 'language_switcher' => true,
        'accent' => '#7357ed', 'menu_layout' => 'grid', 'show_images' => true, 'show_descriptions' => true,
        'show_nutrition' => true, 'show_allergens' => true, 'show_search' => true,
        'enable_ordering' => true, 'enable_reservations' => true,
        'floating_button' => 'none', 'floating_position' => 'right', 'order_label' => '',
        'menu_page_id' => 0, 'persist_cart' => true, 'remember_customer' => false,
        'cache_ttl' => 60, 'diagnostics_enabled' => true, 'delete_on_uninstall' => false,
    ];

    public static function get(): array
    {
        return array_replace(self::DEFAULTS, array_intersect_key((array) get_option(self::OPTION, []), self::DEFAULTS));
    }
    public static function connection(): array
    {
        return (array) get_option('zionfood_connection', []);
    }
    public static function locations(): array
    {
        return self::connection()['manifest']['locations'] ?? [];
    }
    public static function allowed(string $id): bool
    {
        return in_array($id, array_column(self::locations(), 'public_id'), true);
    }
    public static function published(string $id): bool
    {
        return self::allowed($id) && in_array($id, self::get()['visible_locations'], true);
    }
    public static function has(string $ability): bool
    {
        return in_array($ability, self::connection()['manifest']['abilities'] ?? [], true);
    }
    public static function secret(string $name = 'key'): string
    {
        $encrypted = self::connection()[$name] ?? '';
        if (!$encrypted) {
            return '';
        }
        try {
            return Crypto::open($encrypted);
        } catch (\Throwable) {
            return '';
        }
    }

    public static function save(array $input): array|\WP_Error
    {
        $data = self::get();
        foreach (self::DEFAULTS as $key => $default) {
            if (!array_key_exists($key, $input)) {
                continue;
            }
            if (is_bool($default)) {
                if (!is_bool($input[$key])) {
                    return new \WP_Error('invalid_setting', I18n::t('invalid_settings'), ['status' => 422]);
                }
                $data[$key] = $input[$key];
            } elseif (is_string($default)) {
                if (!is_string($input[$key])) {
                    return new \WP_Error('invalid_setting', I18n::t('invalid_settings'), ['status' => 422]);
                }
                $data[$key] = sanitize_text_field($input[$key]);
            } elseif (is_int($default)) {
                if (filter_var($input[$key], FILTER_VALIDATE_INT) === false) {
                    return new \WP_Error('invalid_setting', I18n::t('invalid_settings'), ['status' => 422]);
                }
                $data[$key] = (int) $input[$key];
            }
        }
        if (isset($input['visible_locations'])) {
            if (!is_array($input['visible_locations']) || count($input['visible_locations']) > 100 || array_filter($input['visible_locations'], static fn ($id) => !is_string($id))) {
                return new \WP_Error('invalid_locations', I18n::t('invalid_settings'), ['status' => 422]);
            }
            $data['visible_locations'] = array_values(array_unique(array_filter($input['visible_locations'], static fn ($id) => is_string($id) && self::allowed($id))));
            if (count($data['visible_locations']) !== count(array_unique($input['visible_locations']))) {
                return new \WP_Error('invalid_locations', I18n::t('invalid_settings'), ['status' => 422]);
            }
        }
        if (!in_array($data['language'], ['ro', 'en'], true) || !in_array($data['menu_layout'], ['grid', 'list'], true) || !in_array($data['floating_button'], ['none', 'order', 'reserve', 'both'], true) || !in_array($data['floating_position'], ['left', 'right'], true) || !preg_match('/^#[a-fA-F0-9]{6}$/D', $data['accent']) || $data['cache_ttl'] < 15 || $data['cache_ttl'] > 300 || mb_strlen($data['order_label']) > 60) {
            return new \WP_Error('invalid_setting', I18n::t('invalid_settings'), ['status' => 422]);
        }
        if (self::locations() && (!self::allowed($data['location_id']) || !in_array($data['location_id'], $data['visible_locations'], true))) {
            return new \WP_Error('invalid_location', I18n::t('choose_location'), ['status' => 422]);
        }
        if ($data['menu_page_id'] && (get_post_type($data['menu_page_id']) !== 'page' || get_post_status($data['menu_page_id']) !== 'publish')) {
            return new \WP_Error('invalid_page', I18n::t('invalid_settings'), ['status' => 422]);
        }
        update_option(self::OPTION, $data, false);
        Catalog::invalidate();
        return $data;
    }

    public static function secureSite(): bool
    {
        $url = wp_parse_url(home_url());
        return ($url['scheme'] ?? '') === 'https' || in_array(strtolower($url['host'] ?? ''), ['localhost', '127.0.0.1', '[::1]', '::1'], true);
    }

    public static function connect(string $key, string $webhookSecret = ''): array|\WP_Error
    {
        if (!preg_match('/^[0-9]+\|[A-Za-z0-9_-]{30,200}$/D', $key) || strlen($webhookSecret) > 128 || ($webhookSecret && !preg_match('/^[A-Za-z0-9_-]{32,128}$/D', $webhookSecret))) {
            return new \WP_Error('invalid_key', I18n::t('invalid_key'), ['status' => 422]);
        }
        if (!self::secureSite()) {
            return new \WP_Error('https_required', I18n::t('https_required'), ['status' => 422]);
        }
        $client = new Client($key);
        $manifest = $client->request('GET', 'bootstrap');
        if (is_wp_error($manifest)) {
            return $manifest;
        }
        if (($manifest['api_version'] ?? '') !== '1' || !is_array($manifest['locations'] ?? null) || !$manifest['locations'] || count($manifest['locations']) > 100 || !is_array($manifest['abilities'] ?? null) || !is_string($manifest['connection_id'] ?? null) || !in_array('storefront:read', $manifest['abilities'], true)) {
            return new \WP_Error('incompatible_api', I18n::t('incompatible_api'), ['status' => 422]);
        }
        foreach ($manifest['locations'] as $location) {
            if (!is_array($location) || !preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/Di', $location['public_id'] ?? '')) {
                return new \WP_Error('incompatible_api', I18n::t('incompatible_api'), ['status' => 422]);
            }
        }
        $first = $manifest['locations'][0]['public_id'];
        $menu = $client->request('GET', 'locations/' . $first . '/menu');
        if (is_wp_error($menu)) {
            return $menu;
        }
        if (!is_array($menu['menus'] ?? null)) {
            return new \WP_Error('invalid_menu', I18n::t('invalid_response'), ['status' => 502]);
        }
        $previous = self::connection();
        $changed = ($previous['manifest']['connection_id'] ?? null) !== ($manifest['connection_id'] ?? null);
        update_option('zionfood_connection', ['key' => Crypto::seal($key), 'webhook_secret' => $webhookSecret ? Crypto::seal($webhookSecret) : (!$changed ? ($previous['webhook_secret'] ?? '') : ''), 'manifest' => $manifest, 'connected_at' => time(), 'last_sync' => time(), 'last_error' => null], false);
        if ($changed) {
            Sessions::clear();
        }
        $settings = self::get();
        $ids = array_column($manifest['locations'], 'public_id');
        $settings['visible_locations'] = $changed ? $ids : array_values(array_intersect($settings['visible_locations'], $ids));
        if (!$settings['visible_locations']) {
            $settings['visible_locations'] = [$first];
        }
        if (!in_array($settings['location_id'], $settings['visible_locations'], true)) {
            $settings['location_id'] = $settings['visible_locations'][0];
        }
        update_option(self::OPTION, $settings, false);
        Catalog::invalidate();
        Catalog::store($first, 'ro', $menu);
        return self::status();
    }

    public static function status(): array
    {
        $c = self::connection();
        return ['connected' => self::secret() !== '', 'manifest' => $c['manifest'] ?? null, 'connected_at' => $c['connected_at'] ?? null, 'last_sync' => $c['last_sync'] ?? null, 'last_error' => $c['last_error'] ?? null, 'has_webhook_secret' => self::secret('webhook_secret') !== '', 'origin' => Client::ORIGIN, 'version' => VERSION];
    }
}
