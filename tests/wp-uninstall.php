<?php

/** Exercise data cleanup only; never delete plugin files or the source junction. */

use ZionFood\WP\Plugin;
use ZionFood\WP\Settings;

if (!defined('ZIONFOOD_TEST_RUNTIME') || !ZIONFOOD_TEST_RUNTIME || !in_array(wp_parse_url(home_url(), PHP_URL_HOST), ['localhost', '127.0.0.1'], true)) {
    throw new RuntimeException('Disposable local WordPress runtime required.');
}
$fixturePath = getenv('ZF_WP_CONNECTION');
if (!$fixturePath || !is_file($fixturePath)) {
    throw new RuntimeException('Private connection fixture required.');
}
$fixture = json_decode(file_get_contents($fixturePath), true, 32, JSON_THROW_ON_ERROR);
$settings = Settings::get();
$savedConnection = get_option('zionfood_connection');
$count = 0;
$assert = static function (bool $condition, string $label) use (&$count): void {
    if (!$condition) {
        throw new RuntimeException('FAIL: ' . $label);
    }
    $count++;
};
define('WP_UNINSTALL_PLUGIN', 'zionfood/zionfood.php');
global $wpdb;
try {
    update_option(Settings::OPTION, [...$settings, 'delete_on_uninstall' => false]);
    include dirname(__DIR__) . '/uninstall.php';
    $assert(get_option('zionfood_connection') === $savedConnection, 'default uninstall preserves connection');
    update_option(Settings::OPTION, [...$settings, 'delete_on_uninstall' => true]);
    update_option('zionfoodXevent_unrelated_test', 'preserve');
    update_option('_transient_zf_other_plugin_test', 'preserve');
    update_option('zionfood_event_uninstall_test', 1);
    update_option('_transient_zf_menu_uninstall_test', 'remove');
    include dirname(__DIR__) . '/uninstall.php';
    $assert(get_option('zionfood_connection') === false && get_option(Settings::OPTION) === false, 'opt-in removes only plugin configuration');
    $assert(get_option('zionfood_event_uninstall_test') === false && get_option('_transient_zf_menu_uninstall_test') === false, 'plugin event and cache data removed');
    $assert(get_option('zionfoodXevent_unrelated_test') === 'preserve' && get_option('_transient_zf_other_plugin_test') === 'preserve', 'similar unrelated options survive cleanup');
    $assert(!$wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->prefix . 'zionfood_sessions')), 'private session table removed');
    $assert(!wp_next_scheduled('zionfood_sync') && !wp_next_scheduled('zionfood_cleanup'), 'background schedules removed');
} finally {
    Plugin::activate();
    update_option(Settings::OPTION, $settings);
    update_option('zionfood_connection', $savedConnection);
    delete_option('zionfoodXevent_unrelated_test');
    delete_option('_transient_zf_other_plugin_test');
}
echo 'PASS: ' . $count . " uninstall lifecycle checks; plugin files untouched.\n";
