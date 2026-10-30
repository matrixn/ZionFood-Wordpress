<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Catalog
{
    private static function key(string $location, string $lang): string
    {
        return 'zf_menu_' . get_option('zionfood_cache_revision', '1') . '_' . $location . '_' . $lang;
    }
    public static function invalidate(): bool
    {
        return update_option('zionfood_cache_revision', wp_generate_uuid4(), false);
    }
    public static function store(string $location, string $lang, array $data): void
    {
        set_transient(self::key($location, $lang), $data, Settings::get()['cache_ttl']);
    }
    public static function get(string $location, string $lang = 'ro', bool $force = false): array|\WP_Error
    {
        if (!Settings::allowed($location)) {
            return new \WP_Error('unknown_location', I18n::t('choose_location', $lang), ['status' => 404]);
        }
        $cached = $force ? false : get_transient(self::key($location, $lang));
        if (is_array($cached)) {
            return $cached;
        }
        $result = (new Client())->request('GET', 'locations/' . $location . '/menu', [], null, $lang);
        if (!is_wp_error($result)) {
            self::store($location, $lang, $result);
        }
        return $result;
    }

    public static function availability(string $location, string $lang): array|\WP_Error
    {
        $key = 'zf_availability_' . get_option('zionfood_cache_revision', '1') . '_' . $location . '_' . $lang;
        $cached = get_transient($key);
        if (is_array($cached)) {
            return $cached;
        }
        $data = (new Client())->request('GET', 'locations/' . $location . '/availability', [], null, $lang);
        if (!is_wp_error($data)) {
            set_transient($key, $data, 10);
        }
        return $data;
    }

    public static function sync(): array|\WP_Error
    {
        $manifest = (new Client())->request('GET', 'bootstrap');
        $connection = Settings::connection();
        if (is_wp_error($manifest)) {
            $connection['last_error'] = ['code' => $manifest->get_error_code(), 'time' => time()];
            update_option('zionfood_connection', $connection, false);
            return $manifest;
        }
        if (($manifest['connection_id'] ?? '') !== ($connection['manifest']['connection_id'] ?? '') || !is_array($manifest['locations'] ?? null)) {
            return new \WP_Error('invalid_response', I18n::t('invalid_response'), ['status' => 502]);
        }
        $connection['manifest'] = $manifest;
        $connection['last_sync'] = time();
        $connection['last_error'] = null;
        update_option('zionfood_connection', $connection, false);
        self::invalidate();
        $settings = Settings::get();
        $ids = array_column($manifest['locations'], 'public_id');
        $settings['visible_locations'] = array_values(array_intersect($settings['visible_locations'], $ids));
        if (!in_array($settings['location_id'], $settings['visible_locations'], true)) {
            $settings['location_id'] = $settings['visible_locations'][0] ?? '';
        }
        update_option(Settings::OPTION, $settings, false);
        return Settings::status();
    }
}
