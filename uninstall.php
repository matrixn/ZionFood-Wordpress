<?php

declare(strict_types=1);
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
$settings = (array) get_option('zionfood_settings', []);
if (empty($settings['delete_on_uninstall'])) {
    return;
}
global $wpdb;
foreach (['sessions', 'rate_limits', 'logs'] as $table) {
    $wpdb->query('DROP TABLE IF EXISTS ' . $wpdb->prefix . 'zionfood_' . $table);
}
foreach (['zionfood_settings', 'zionfood_connection', 'zionfood_cache_revision'] as $option) {
    delete_option($option);
}
delete_metadata('user', 0, 'zionfood_language', '', true);
foreach (['zionfood_event_', '_transient_zf_menu_', '_transient_timeout_zf_menu_', '_transient_zf_availability_', '_transient_timeout_zf_availability_', '_transient_zf_admin_analytics_', '_transient_timeout_zf_admin_analytics_'] as $prefix) {
    $names = $wpdb->get_col($wpdb->prepare("SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like($prefix) . '%'));
    foreach ($names as $name) {
        delete_option($name);
    }
}
wp_clear_scheduled_hook('zionfood_sync');
wp_clear_scheduled_hook('zionfood_cleanup');
