<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class I18n
{
    public static function dictionaries(): array
    {
        static $data;
        if (!$data) {
            $data = [];
            foreach (['ro', 'en'] as $lang) {
                $data[$lang] = json_decode((string) file_get_contents(DIR . '/languages/' . $lang . '.json'), true, 32, JSON_THROW_ON_ERROR);
            }
        }
        return $data;
    }

    public static function locale(?string $value = null): string
    {
        $value ??= (string) (get_user_meta(get_current_user_id(), 'zionfood_language', true) ?: Settings::get()['language']);
        return $value === 'en' ? 'en' : 'ro';
    }

    public static function t(string $key, ?string $lang = null): string
    {
        return self::dictionaries()[self::locale($lang)][$key] ?? $key;
    }
}
