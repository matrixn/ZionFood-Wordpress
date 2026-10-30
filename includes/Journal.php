<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Journal
{
    public static function write(string $method, string $path, int $status, int $duration, string $requestId = ''): void
    {
        if (!Settings::get()['diagnostics_enabled']) {
            return;
        }
        global $wpdb;
        $route = preg_replace('/[0-9A-HJKMNP-TV-Z]{26}/i', '{id}', explode('?', $path, 2)[0]);
        $wpdb->insert($wpdb->prefix . 'zionfood_logs', ['method' => substr($method, 0, 8), 'operation' => substr($route, 0, 150), 'http_status' => $status, 'duration_ms' => max(0, $duration), 'request_id' => preg_match('/^[a-f0-9-]{36}$/Di', $requestId) ? $requestId : '', 'created_at' => time()]);
    }

    public static function recent(): array
    {
        global $wpdb;
        return $wpdb->get_results('SELECT method,operation,http_status,duration_ms,request_id,created_at FROM ' . $wpdb->prefix . 'zionfood_logs ORDER BY id DESC LIMIT 50', ARRAY_A) ?: [];
    }
}
