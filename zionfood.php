<?php

/**
 * Plugin Name: ZionFood
 * Plugin URI: https://food.zion3d.ro/
 * Description: Meniu digital, comenzi și rezervări conectate la restaurantul tău ZionFood.
 * Version: 0.0.1
 * Requires at least: 6.6
 * Requires PHP: 8.1
 * Update URI: https://food.zion3d.ro/wordpress
 * Author: Zion Digital
 * License: GPL-2.0-or-later
 * Text Domain: zionfood
 */

declare(strict_types=1);

namespace ZionFood\WP;

if (!defined('ABSPATH')) {
    exit;
}

const VERSION = '0.0.1';
const FILE = __FILE__;
const DIR = __DIR__;

spl_autoload_register(static function (string $class): void {
    $prefix = __NAMESPACE__ . '\\';
    if (str_starts_with($class, $prefix)) {
        $name = substr($class, strlen($prefix));
        if (preg_match('/^[A-Za-z][A-Za-z0-9]*$/D', $name) && is_file(DIR . '/includes/' . $name . '.php')) {
            require_once DIR . '/includes/' . $name . '.php';
        }
    }
});

register_activation_hook(FILE, [Plugin::class, 'activate']);
register_deactivation_hook(FILE, [Plugin::class, 'deactivate']);
add_action('plugins_loaded', static function (): void {
    (new Plugin())->boot();
});
