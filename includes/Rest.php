<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Rest
{
    public function register(): void
    {
        register_rest_route('zionfood/v1', '/admin/state', ['methods' => 'GET', 'permission_callback' => [self::class, 'admin'], 'callback' => fn () => $this->response(Admin::state())]);
        foreach (['connect', 'disconnect', 'settings', 'sync', 'locale', 'publish', 'callback'] as $operation) {
            register_rest_route('zionfood/v1', '/admin/' . $operation, ['methods' => 'POST', 'permission_callback' => [self::class, 'admin'], 'callback' => fn ($r) => $this->adminAction($operation, $r)]);
        }
        register_rest_route('zionfood/v1', '/guest/session', ['methods' => 'POST', 'permission_callback' => [self::class, 'origin'], 'callback' => function () {
            if (!RateLimit::admit('session', 30, 600)) {
                return $this->limited();
            }
            $row = Sessions::start();
            return is_wp_error($row) ? $row : $this->response(['csrf' => $row['data']['csrf']]);
        }]);
        register_rest_route('zionfood/v1', '/guest/(?P<operation>[a-z_-]+)', ['methods' => 'POST', 'permission_callback' => function ($r) {
            $origin = self::origin($r);
            return is_wp_error($origin) ? $origin : (Sessions::verify($r) ?: new \WP_Error('csrf_failed', I18n::t('session_error'), ['status' => 403]));
        }, 'callback' => [$this, 'guest']]);
        register_rest_route('zionfood/v1', '/webhook', ['methods' => 'POST', 'permission_callback' => '__return_true', 'callback' => [$this, 'webhook']]);
    }

    public static function admin(\WP_REST_Request $r): bool|\WP_Error
    {
        return current_user_can('manage_options') && wp_verify_nonce((string) $r->get_header('x-wp-nonce'), 'wp_rest') ? true : new \WP_Error('forbidden', I18n::t('forbidden'), ['status' => 403]);
    }

    public static function origin(\WP_REST_Request $r): bool|\WP_Error
    {
        if (!Settings::secureSite()) {
            return new \WP_Error('https_required', I18n::t('https_required'), ['status' => 503]);
        }
        $origin = (string) $r->get_header('origin');
        $home = wp_parse_url(home_url());
        $source = $origin ? wp_parse_url($origin) : $home;
        $port = static fn ($parts) => $parts['port'] ?? (($parts['scheme'] ?? '') === 'https' ? 443 : 80);
        if (!$source || strtolower($source['host'] ?? '') !== strtolower($home['host'] ?? '') || ($source['scheme'] ?? '') !== ($home['scheme'] ?? '') || $port($source) !== $port($home) || $r->get_header('sec-fetch-site') === 'cross-site' || !str_contains(strtolower((string) $r->get_header('content-type')), 'application/json')) {
            return new \WP_Error('origin_denied', I18n::t('forbidden'), ['status' => 403]);
        }
        if (strlen($r->get_body()) > 65536) {
            return new \WP_Error('body_limit', I18n::t('invalid_request'), ['status' => 413]);
        }
        return true;
    }

    private function response(array $data, int $status = 200): \WP_REST_Response
    {
        $response = new \WP_REST_Response($data, $status);
        $response->header('Cache-Control', 'private, no-store, max-age=0');
        $response->header('X-Robots-Tag', 'noindex, nofollow');
        return $response;
    }

    private function limited(): \WP_Error
    {
        return new \WP_Error('rate_limited', I18n::t('rate_limited'), ['status' => 429, 'retry_after' => 60]);
    }

    private function adminAction(string $operation, \WP_REST_Request $r): array|\WP_REST_Response|\WP_Error
    {
        if (strlen($r->get_body()) > 16384) {
            return new \WP_Error('body_limit', I18n::t('invalid_request'), ['status' => 413]);
        }
        $input = $r->get_json_params();
        if (!is_array($input)) {
            return new \WP_Error('invalid_body', I18n::t('invalid_request'), ['status' => 422]);
        }
        if (!RateLimit::admit('admin', 30)) {
            return $this->limited();
        }
        $result = match ($operation) {
            'connect' => Settings::connect(is_string($input['api_key'] ?? null) ? trim($input['api_key']) : '', is_string($input['webhook_secret'] ?? null) ? trim($input['webhook_secret']) : ''),
            'settings' => Settings::save($input),
            'sync' => Catalog::sync(),
            'locale' => $this->language($input),
            'publish' => $this->publish(),
            'callback' => $this->callback(),
            'disconnect' => $this->disconnect(),
        };
        return is_wp_error($result) ? $result : $this->response(['state' => Admin::state(), 'result' => $result]);
    }

    private function language(array $input): array
    {
        $locale = I18n::locale(is_string($input['language'] ?? null) ? $input['language'] : 'ro');
        update_user_meta(get_current_user_id(), 'zionfood_language', $locale);
        return ['language' => $locale];
    }

    private function publish(): array|\WP_Error
    {
        if (!current_user_can('publish_pages')) {
            return new \WP_Error('forbidden', I18n::t('forbidden'), ['status' => 403]);
        }
        $settings = Settings::get();
        if ($settings['menu_page_id'] && get_post_status($settings['menu_page_id']) === 'publish') {
            return ['url' => get_permalink($settings['menu_page_id'])];
        }
        $id = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => I18n::t('digital_menu'), 'post_content' => '<!-- wp:shortcode -->[zionfood_menu]<!-- /wp:shortcode -->'], true);
        if (is_wp_error($id)) {
            return $id;
        }
        $settings['menu_page_id'] = $id;
        update_option(Settings::OPTION, $settings, false);
        return ['url' => get_permalink($id)];
    }

    private function disconnect(): array
    {
        if (Settings::has('webhooks:manage')) {
            foreach (array_slice(Settings::locations(), 0, 3) as $location) {
                (new Client())->request('PUT', 'locations/' . $location['public_id'] . '/callback', ['url' => rest_url('zionfood/v1/webhook'), 'enabled' => false, 'events' => ['menu.updated']], wp_generate_uuid4());
            }
        }
        delete_option('zionfood_connection');
        Catalog::invalidate();
        Sessions::clear();
        return ['disconnected' => true];
    }

    private function callback(): array|\WP_Error
    {
        $url = rest_url('zionfood/v1/webhook');
        if (!Settings::secret('webhook_secret') || !Settings::has('webhooks:manage') || !Settings::has('menu:read') || !str_starts_with($url, 'https://') || str_contains($url, '?')) {
            return new \WP_Error('callback_unavailable', I18n::t('webhook_help'), ['status' => 422]);
        }
        $results = [];
        foreach (Settings::get()['visible_locations'] as $location) {
            $result = (new Client())->request('PUT', 'locations/' . $location . '/callback', ['url' => $url, 'enabled' => true, 'events' => ['menu.updated', 'item.updated']], wp_generate_uuid4());
            if (is_wp_error($result)) {
                return $result;
            }
            $results[] = $location;
        }
        return ['locations' => $results];
    }

    public function guest(\WP_REST_Request $r): \WP_REST_Response|\WP_Error
    {
        if (!RateLimit::admit('guest', 120)) {
            return $this->limited();
        }
        $input = $r->get_json_params();
        if (!is_array($input)) {
            return new \WP_Error('invalid_body', I18n::t('invalid_request'), ['status' => 422]);
        }
        $location = is_string($input['location'] ?? null) ? $input['location'] : '';
        if (!Settings::published($location)) {
            return new \WP_Error('unknown_location', I18n::t('choose_location'), ['status' => 404]);
        }
        $lang = I18n::locale(is_string($input['language'] ?? null) ? $input['language'] : Settings::get()['language']);
        $operation = $r['operation'];
        $base = 'locations/' . $location . '/';
        $client = new Client();
        $settings = Settings::get();
        $id = is_string($input['id'] ?? null) && preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/Di', $input['id']) ? $input['id'] : '';
        $key = is_string($input['idempotency_key'] ?? null) ? $input['idempotency_key'] : '';
        $writes = ['checkout', 'reserve', 'reservation_cancel', 'table_connect'];
        if (in_array($operation, $writes, true) && (!RateLimit::admit('guest_writes', 20) || !preg_match('/^[A-Za-z0-9_-]{16,100}$/D', $key))) {
            return new \WP_Error('invalid_mutation', I18n::t('invalid_request', $lang), ['status' => 422]);
        }
        if (in_array($operation, ['quote','checkout','reserve'], true) && ($input['consent'] ?? false) !== true) {
            return new \WP_Error('consent_required', I18n::t('consent_required', $lang), ['status' => 422]);
        }
        $result = null;
        switch ($operation) {
            case 'catalog':
                $result = Catalog::get($location, $lang);
                break;
            case 'availability':
                $result = Catalog::availability($location, $lang);
                break;
            case 'schedule_slots':
            case 'reservation_slots':
                $date = is_string($input['date'] ?? null) ? $input['date'] : '';
                if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $date)) {
                    break;
                }
                if ($operation === 'reservation_slots') {
                    if (!$settings['enable_reservations'] || !Settings::has('reservations:create')) {
                        break;
                    }
                    $party = filter_var($input['party_size'] ?? null, FILTER_VALIDATE_INT);
                    if (!$party || $party < 1 || $party > 100) {
                        break;
                    }
                    $result = $client->request('GET', $base . 'reservation-slots?date=' . $date . '&party_size=' . $party, [], null, $lang);
                } else {
                    if (!$settings['enable_ordering'] || !in_array($input['fulfillment'] ?? '', ['pickup', 'delivery'], true)) {
                        break;
                    }
                    $result = $client->request('GET', $base . 'schedule-slots?date=' . $date . '&fulfillment=' . $input['fulfillment'], [], null, $lang);
                }
                break;
            case 'quote':
            case 'checkout':
                if (!$settings['enable_ordering'] || !Settings::has('checkout:write')) {
                    break;
                }
                $body = $this->checkoutInput($input, $location);
                if (is_wp_error($body)) {
                    return $body;
                }
                $result = $client->request('POST', $base . $operation, $body, $operation === 'checkout' ? $key : null, $lang);
                if ($operation === 'checkout' && !is_wp_error($result)) {
                    $result = $this->rememberResult($result, 'orders', $result['order_id'] ?? '', 'tracking_token', $location, $lang);
                }
                break;
            case 'track':
                $proof = Sessions::proof('orders', $id, $location);
                if (!$proof) {
                    return $this->unknownProof($lang);
                }
                $result = $client->request('POST', $base . 'orders/' . $id . '/track', ['tracking_token' => $proof['token']], null, $lang);
                break;
            case 'reserve':
                if (!$settings['enable_reservations'] || !Settings::has('reservations:create')) {
                    break;
                }
                $body = array_intersect_key($input, array_flip(['guest_name', 'guest_phone', 'guest_email', 'party_size', 'starts_at', 'notes']));
                $result = $client->request('POST', $base . 'reservations', $body, $key, $lang);
                if (!is_wp_error($result)) {
                    $result = $this->rememberResult($result, 'reservations', $result['reservation_id'] ?? '', 'token', $location, $lang);
                }
                break;
            case 'reservation_track':
            case 'reservation_cancel':
                $proof = Sessions::proof('reservations', $id, $location);
                if (!$proof) {
                    return $this->unknownProof($lang);
                }
                $body = ['reservation_token' => $proof['token']];
                if ($operation === 'reservation_cancel') {
                    $body['version'] = $input['version'] ?? null;
                }
                $result = $client->request('POST', $base . 'reservations/' . $id . '/' . ($operation === 'reservation_cancel' ? 'cancel' : 'track'), $body, $operation === 'reservation_cancel' ? $key : null, $lang);
                break;
            case 'receipts':
                $data = Sessions::current()['data'];
                $result = ['orders' => array_keys(array_filter($data['orders'], fn ($p) => $p['location'] === $location)), 'reservations' => array_keys(array_filter($data['reservations'], fn ($p) => $p['location'] === $location))];
                break;
            case 'table_connect':
                if (!$settings['enable_ordering'] || !$id || !is_string($input['qr_token'] ?? null) || strlen($input['qr_token']) !== 64) {
                    break;
                }
                $result = $client->request('POST', $base . 'tables/' . $id . '/connect', ['qr_token' => $input['qr_token']], $key, $lang);
                if (!is_wp_error($result)) {
                    $result = $this->rememberResult($result, 'tables', $id, 'token', $location, $lang);
                }
                break;
            case 'table_availability':
                if (!Sessions::proof('tables', $id, $location)) {
                    return $this->unknownProof($lang);
                }
                $result = $client->request('GET', 'tables/' . $id . '/availability', [], null, $lang, true);
                break;
            case 'table_orders':
                $proof = Sessions::proof('tables', $id, $location);
                if (!$proof) {
                    return $this->unknownProof($lang);
                }
                $result = $client->request('POST', $base . 'tables/' . $id . '/active-orders', ['table_session_token' => $proof['token'], 'cursor' => is_string($input['cursor'] ?? null) ? substr($input['cursor'], 0, 512) : null], null, $lang);
                break;
            case 'address':
                $lat = filter_var($input['latitude'] ?? null, FILTER_VALIDATE_FLOAT);
                $lng = filter_var($input['longitude'] ?? null, FILTER_VALIDATE_FLOAT);
                if ($lat === false || $lng === false || $lat < -85 || $lat > 85 || $lng < -180 || $lng > 180 || !RateLimit::admit('address', 5)) {
                    break;
                }
                $result = $client->request('POST', $base . 'address-from-pin', ['latitude' => $lat, 'longitude' => $lng], null, $lang, true);
                break;
        }
        if ($result === null) {
            return new \WP_Error('unsupported_operation', I18n::t('invalid_request', $lang), ['status' => 422]);
        }
        return is_wp_error($result) ? $result : $this->response($result);
    }

    private function rememberResult(array $result, string $kind, mixed $id, string $tokenField, string $location, string $lang): array|\WP_Error
    {
        $token = $result[$tokenField] ?? null;
        if (!is_string($id) || !preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/Di', $id) || !is_string($token) || strlen($token) < 32 || strlen($token) > 512) {
            return new \WP_Error('invalid_receipt', I18n::t('retry_same_order', $lang), ['status' => 502, 'retryable' => true]);
        }
        if (!Sessions::remember($kind, $id, $location, $token)) {
            return new \WP_Error('receipt_pending', I18n::t('retry_same_order', $lang), ['status' => 503, 'retryable' => true]);
        }
        unset($result[$tokenField]);
        return $result;
    }

    private function checkoutInput(array $input, string $location): array|\WP_Error
    {
        $body = array_intersect_key($input, array_flip(['customer_name', 'customer_phone', 'fulfillment', 'delivery_address', 'postal_code', 'delivery_zone_id', 'delivery_latitude', 'delivery_longitude', 'scheduled_for', 'promotion_code', 'notes', 'items']));
        if (($body['fulfillment'] ?? '') === 'dine_in') {
            if (!empty($input['reservation_id']) && is_string($input['reservation_id'])) {
                $proof = Sessions::proof('reservations', $input['reservation_id'], $location);
                if (!$proof) {
                    return $this->unknownProof('ro');
                }
                $body['reservation_id'] = $input['reservation_id'];
                $body['reservation_token'] = $proof['token'];
            } else {
                $proof = Sessions::proof('tables', is_string($input['table_id'] ?? null) ? $input['table_id'] : '', $location);
                if (!$proof) {
                    return $this->unknownProof('ro');
                }
                $body['table_session_token'] = $proof['token'];
            }
        }
        return $body;
    }

    private function unknownProof(string $lang): \WP_Error
    {
        return new \WP_Error('receipt_not_found', I18n::t('receipt_not_found', $lang), ['status' => 404]);
    }

    public function webhook(\WP_REST_Request $r): \WP_REST_Response|\WP_Error
    {
        $secret = Settings::secret('webhook_secret');
        $timestamp = (string) $r->get_header('x-zionfood-timestamp');
        $id = (string) $r->get_header('x-zionfood-delivery');
        $signature = (string) $r->get_header('x-zionfood-signature');
        if (!$secret || strlen($r->get_body()) > 65536 || !ctype_digit($timestamp) || abs(time() - (int) $timestamp) > 300 || !preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/Di', $id) || !hash_equals('sha256=' . hash_hmac('sha256', $timestamp . '.' . $r->get_body(), $secret), $signature)) {
            return new \WP_Error('invalid_signature', I18n::t('forbidden'), ['status' => 401]);
        }
        $body = json_decode($r->get_body(), true, 16);
        if (!is_array($body) || ($body['id'] ?? '') !== $id || !in_array($body['type'] ?? '', ['menu.updated', 'item.updated'], true) || $r->get_header('x-zionfood-event') !== $body['type']) {
            return new \WP_Error('invalid_event', I18n::t('invalid_request'), ['status' => 422]);
        }
        // Invalidation is idempotent; a durable admission marker makes repeated deliveries observable without replaying work.
        $option = 'zionfood_event_' . strtolower($id);
        if (!get_option($option)) {
            if (!Catalog::invalidate()) {
                return new \WP_Error('cache_write_failed', I18n::t('request_failed'), ['status' => 503]);
            } if (!add_option($option, time(), '', false) && !get_option($option)) {
                return new \WP_Error('admission_failed', I18n::t('request_failed'), ['status' => 503]);
            }
        }
        return $this->response(['accepted' => true]);
    }
}
