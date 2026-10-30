<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Sessions
{
    private const LIFETIME = 90 * DAY_IN_SECONDS;
    public static function cookie(): string
    {
        return 'zionfood_guest_' . get_current_blog_id();
    }
    private static function hash(string $value): string
    {
        return hash_hmac('sha256', $value, wp_salt('secure_auth'));
    }

    public static function current(): ?array
    {
        global $wpdb;
        $cookie = (string) ($_COOKIE[self::cookie()] ?? '');
        if (!preg_match('/^[a-f0-9]{64}$/D', $cookie)) {
            return null;
        }
        $row = $wpdb->get_row($wpdb->prepare('SELECT * FROM ' . $wpdb->prefix . 'zionfood_sessions WHERE session_hash=%s AND expires_at>%d', self::hash($cookie), time()), ARRAY_A);
        if (!$row) {
            return null;
        }
        try {
            $row['data'] = json_decode(Crypto::open($row['payload']), true, 32, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return null;
        }
        return $row;
    }

    public static function start(): array|\WP_Error
    {
        $row = self::current();
        if ($row) {
            return $row;
        }
        global $wpdb;
        $token = bin2hex(random_bytes(32));
        $data = ['csrf' => bin2hex(random_bytes(32)), 'orders' => [], 'reservations' => [], 'tables' => []];
        $expires = time() + self::LIFETIME;
        $result = $wpdb->insert($wpdb->prefix . 'zionfood_sessions', ['session_hash' => self::hash($token), 'payload' => Crypto::seal(wp_json_encode($data)), 'expires_at' => $expires, 'revision' => 1]);
        if (!$result) {
            return new \WP_Error('session_unavailable', I18n::t('session_error'), ['status' => 503]);
        }
        setcookie(self::cookie(), $token, ['expires' => $expires, 'path' => defined('COOKIEPATH') && COOKIEPATH ? COOKIEPATH : '/', 'secure' => is_ssl(), 'httponly' => true, 'samesite' => 'Lax']);
        $_COOKIE[self::cookie()] = $token;
        return self::current() ?? new \WP_Error('session_unavailable', I18n::t('session_error'), ['status' => 503]);
    }

    public static function verify(\WP_REST_Request $request): bool
    {
        $row = self::current();
        return $row && hash_equals($row['data']['csrf'], (string) $request->get_header('x-zionfood-csrf'));
    }

    public static function mutate(callable $callback): bool
    {
        global $wpdb;
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $row = self::current();
            if (!$row) {
                return false;
            }
            $data = $callback($row['data']);
            foreach (['orders', 'reservations', 'tables'] as $kind) {
                $data[$kind] = array_slice($data[$kind] ?? [], -50, null, true);
            }
            $changed = $wpdb->query($wpdb->prepare('UPDATE ' . $wpdb->prefix . 'zionfood_sessions SET payload=%s, revision=revision+1 WHERE session_hash=%s AND revision=%d', Crypto::seal(wp_json_encode($data)), $row['session_hash'], $row['revision']));
            if ($changed === 1) {
                return true;
            }
        }
        return false;
    }

    public static function proof(string $kind, string $id, string $location): ?array
    {
        $proof = self::current()['data'][$kind][$id] ?? null;
        return $proof && hash_equals($proof['location'], $location) ? $proof : null;
    }

    public static function remember(string $kind, string $id, string $location, string $token): bool
    {
        return self::mutate(static function ($data) use ($kind, $id, $location, $token) {
            $data[$kind][$id] = ['location' => $location, 'token' => $token];
            return $data;
        });
    }

    public static function clear(): void
    {
        global $wpdb;
        $wpdb->query('DELETE FROM ' . $wpdb->prefix . 'zionfood_sessions');
    }
}
