<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Plugin
{
    public function boot(): void
    {
        add_filter('rest_post_dispatch', static function ($response, $server, $request) {
            if ($response instanceof \WP_REST_Response && str_starts_with($request->get_route(), '/zionfood/v1/')) {
                $response->header('Cache-Control', 'private, no-store, max-age=0');
                $response->header('X-Robots-Tag', 'noindex, nofollow');
            } return $response;
        }, 10, 3);
        add_action('rest_api_init', [new Rest(), 'register']);
        add_action('admin_menu', [new Admin(), 'menu']);
        add_action('admin_enqueue_scripts', [new Admin(), 'assets']);
        add_action('init', [new Publishing(), 'register']);
        add_action('wp_footer', [new Publishing(), 'floating']);
        add_filter('cron_schedules', static function (array $schedules): array {
            $schedules['zionfood_five_minutes'] = ['interval' => 300, 'display' => 'ZionFood synchronization'];
            return $schedules;
        });
        add_action('zionfood_sync', static function (): void {
            if (Settings::secret()) {
                Catalog::sync();
            }
        });
        add_action('zionfood_cleanup', [self::class, 'cleanup']);
        add_filter('plugin_action_links_' . plugin_basename(FILE), static function (array $links): array {
            array_unshift($links, '<a href="' . esc_url(admin_url('admin.php?page=zionfood')) . '">ZionFood</a>');
            return $links;
        });
        add_action('admin_init', static function (): void {
            if (function_exists('wp_add_privacy_policy_content')) {
                wp_add_privacy_policy_content('ZionFood', '<p>Restaurant ordering and reservations are processed by the configured ZionFood service at food.zion3d.ro. Contact and order details are sent when a visitor submits a request. A first-party HttpOnly cookie stores an opaque guest-session identifier for up to 90 days; private receipts are encrypted on this WordPress server. Optional remembered contact details remain on the visitor device only after explicit selection. Delivery maps load OpenStreetMap tiles, which receive the visitor IP. Configure your restaurant privacy policy accordingly.</p>');
            }
        });
    }

    public static function activate(): void
    {
        add_filter('cron_schedules', static function (array $schedules): array {
            $schedules['zionfood_five_minutes'] = ['interval' => 300, 'display' => 'ZionFood synchronization'];
            return $schedules;
        });
        if (!extension_loaded('openssl') || !in_array('aes-256-gcm', openssl_get_cipher_methods(), true)) {
            wp_die('ZionFood requires PHP OpenSSL with AES-256-GCM support.');
        }
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        $charset = $wpdb->get_charset_collate();
        dbDelta("CREATE TABLE {$wpdb->prefix}zionfood_sessions (
            session_hash varchar(64) NOT NULL,
            payload longtext NOT NULL,
            expires_at bigint unsigned NOT NULL,
            revision bigint unsigned NOT NULL DEFAULT 1,
            PRIMARY KEY  (session_hash),
            KEY expires_at (expires_at)
        ) $charset;");
        dbDelta("CREATE TABLE {$wpdb->prefix}zionfood_rate_limits (
            bucket varchar(64) NOT NULL,
            hits int unsigned NOT NULL DEFAULT 1,
            expires_at bigint unsigned NOT NULL,
            PRIMARY KEY  (bucket),
            KEY expires_at (expires_at)
        ) $charset;");
        dbDelta("CREATE TABLE {$wpdb->prefix}zionfood_logs (
            id bigint unsigned NOT NULL AUTO_INCREMENT,
            method varchar(8) NOT NULL,
            operation varchar(150) NOT NULL,
            http_status smallint unsigned NOT NULL DEFAULT 0,
            duration_ms int unsigned NOT NULL DEFAULT 0,
            request_id varchar(36) NOT NULL DEFAULT '',
            created_at bigint unsigned NOT NULL,
            PRIMARY KEY  (id),
            KEY created_at (created_at)
        ) $charset;");
        if (!wp_next_scheduled('zionfood_sync')) {
            wp_schedule_event(time() + 300, 'zionfood_five_minutes', 'zionfood_sync');
        }
        if (!wp_next_scheduled('zionfood_cleanup')) {
            wp_schedule_event(time() + 3600, 'daily', 'zionfood_cleanup');
        }
    }

    public static function deactivate(): void
    {
        wp_clear_scheduled_hook('zionfood_sync');
        wp_clear_scheduled_hook('zionfood_cleanup');
    }
    public static function cleanup(): void
    {
        global $wpdb;
        foreach (['sessions', 'rate_limits'] as $table) {
            $wpdb->query($wpdb->prepare('DELETE FROM ' . $wpdb->prefix . 'zionfood_' . $table . ' WHERE expires_at<%d', time()));
        }
        $wpdb->query($wpdb->prepare('DELETE FROM ' . $wpdb->prefix . 'zionfood_logs WHERE created_at<%d', time() - 7 * DAY_IN_SECONDS));
        $oldEvents = $wpdb->get_col($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s AND option_value<%d LIMIT 1000", $wpdb->esc_like('zionfood_event_') . '%', time() - 7 * DAY_IN_SECONDS));
        foreach ($oldEvents as $option) {
            delete_option($option);
        }
    }
}
