<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Client
{
    public const ORIGIN = 'https://food.zion3d.ro';
    public const BASE = self::ORIGIN . '/api/v1/wordpress/';
    public function __construct(private ?string $key = null)
    {
    }

    public function request(string $method, string $path, array $body = [], ?string $idempotency = null, string $locale = 'ro', bool $public = false): array|\WP_Error
    {
        if (!preg_match('~^[A-Za-z0-9_/?=&.%-]+$~D', $path) || str_contains($path, '..') || str_starts_with($path, '/') || str_contains($path, '//')) {
            return new \WP_Error('invalid_path', I18n::t('invalid_request'), ['status' => 400]);
        }
        $token = $this->key ?? Settings::secret();
        if (!$public && !$token) {
            return new \WP_Error('not_connected', I18n::t('not_connected'), ['status' => 503]);
        }
        $headers = ['Accept' => 'application/json', 'Accept-Language' => I18n::locale($locale), 'Content-Type' => 'application/json'];
        if (!$public) {
            $headers['Authorization'] = 'Bearer ' . $token;
        }
        if ($idempotency) {
            $headers['Idempotency-Key'] = $idempotency;
        }
        $url = $public ? self::ORIGIN . '/api/v1/public/' . $path : self::BASE . $path;
        $started = microtime(true);
        $response = wp_safe_remote_request($url, ['method' => $method, 'headers' => $headers, 'body' => $method === 'GET' ? null : wp_json_encode($body), 'timeout' => 15, 'redirection' => 0, 'sslverify' => true, 'limit_response_size' => 2097153, 'user-agent' => 'ZionFood-WordPress/' . VERSION]);
        $status = is_wp_error($response) ? 0 : wp_remote_retrieve_response_code($response);
        $requestId = is_wp_error($response) ? '' : (string) wp_remote_retrieve_header($response, 'x-zionfood-request-id');
        $retryAfter = is_wp_error($response) ? 0 : min(86400, max(0, (int) wp_remote_retrieve_header($response, 'retry-after')));
        Journal::write($method, $path, $status, (int) ((microtime(true) - $started) * 1000), $requestId);
        if (is_wp_error($response)) {
            return new \WP_Error('transport_error', I18n::t('transport_error', $locale), ['status' => 503, 'retryable' => true]);
        }
        $raw = wp_remote_retrieve_body($response);
        if (strlen($raw) > 2097152) {
            return new \WP_Error('response_limit', I18n::t('invalid_response', $locale), ['status' => 502]);
        }
        $data = json_decode($raw, true, 64);
        if ($status >= 200 && $status < 300 && is_array($data)) {
            return $data;
        }
        if ($status === 204) {
            return [];
        }
        $message = match ($status) {
            401, 403 => I18n::t('connection_denied', $locale), 429 => I18n::t('rate_limited', $locale), default => I18n::t('request_failed', $locale)
        };
        if (is_array($data) && in_array($status, [409, 422], true)) {
            $errors = [];
            foreach ((array) ($data['errors'] ?? []) as $messages) {
                foreach ((array) $messages as $entry) {
                    if (is_string($entry)) {
                        $errors[] = wp_strip_all_tags($entry);
                    }
                }
            }
            $message = mb_substr(implode(' ', $errors) ?: wp_strip_all_tags((string) ($data['message'] ?? $message)), 0, 600);
        }
        return new \WP_Error('upstream_' . $status, $message, ['status' => $status === 429 ? 429 : ($status >= 400 && $status < 500 ? $status : 502), 'retryable' => $status === 429 || $status >= 500, 'retry_after' => $retryAfter, 'request_id' => preg_match('/^[a-f0-9-]{36}$/Di', $requestId) ? $requestId : '']);
    }
}
