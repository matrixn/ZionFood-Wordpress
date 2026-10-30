<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Crypto
{
    public static function seal(string $value): string
    {
        $iv = random_bytes(12);
        $cipher = openssl_encrypt($value, 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($cipher === false) {
            throw new \RuntimeException('Encryption unavailable.');
        }
        return 'v1.' . base64_encode($iv . $tag . $cipher);
    }

    public static function open(string $value): string
    {
        $raw = str_starts_with($value, 'v1.') ? base64_decode(substr($value, 3), true) : false;
        if ($raw === false || strlen($raw) < 28) {
            throw new \RuntimeException('Invalid encrypted value.');
        }
        $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', self::key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
        if ($plain === false) {
            throw new \RuntimeException('Cannot decrypt value.');
        }
        return $plain;
    }

    private static function key(): string
    {
        return hash('sha256', wp_salt('auth') . '|zionfood|' . get_current_blog_id(), true);
    }
}
