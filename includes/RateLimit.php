<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class RateLimit
{
    public static function admit(string $operation, int $limit, int $window = 60): bool
    {
        global $wpdb;
        $bucket = hash_hmac('sha256', $operation . '|' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown') . '|' . intdiv(time(), $window), wp_salt('nonce'));
        $table = $wpdb->prefix . 'zionfood_rate_limits';
        $result = $wpdb->query($wpdb->prepare("INSERT INTO $table (bucket,hits,expires_at) VALUES (%s,1,%d) ON DUPLICATE KEY UPDATE hits=hits+1", $bucket, time() + $window));
        return $result !== false && (int) $wpdb->get_var($wpdb->prepare("SELECT hits FROM $table WHERE bucket=%s", $bucket)) <= $limit;
    }
}
