<?php

/** Run only in the explicitly marked disposable WordPress runtime. */

use ZionFood\WP\Client;
use ZionFood\WP\Crypto;
use ZionFood\WP\RateLimit;
use ZionFood\WP\Sessions;
use ZionFood\WP\Settings;

if (!defined('ZIONFOOD_TEST_RUNTIME') || !ZIONFOOD_TEST_RUNTIME || !in_array(wp_parse_url(home_url(), PHP_URL_HOST), ['localhost', '127.0.0.1'], true)) {
    throw new RuntimeException('Disposable local WordPress runtime required.');
}
$fixturePath = getenv('ZF_WP_CONNECTION');
if (!$fixturePath || !is_file($fixturePath)) {
    throw new RuntimeException('Private test connection fixture required.');
}
$fixture = json_decode(file_get_contents($fixturePath), true, 32, JSON_THROW_ON_ERROR);
$count = 0;
$assert = static function (bool $condition, string $label) use (&$count): void {
    if (!$condition) {
        throw new RuntimeException('FAIL: ' . $label);
    } $count++;
};
$request = static function (string $method, string $route, array $body = [], array $headers = []) {
    $r = new WP_REST_Request($method, '/zionfood/v1/' . $route);
    $r->set_header('Content-Type', 'application/json');
    $r->set_header('Origin', home_url());
    foreach ($headers as $key => $value) {
        $r->set_header($key, $value);
    }
    $r->set_body(wp_json_encode($body));
    return rest_do_request($r);
};
global $wpdb;
$wpdb->query('DELETE FROM ' . $wpdb->prefix . 'zionfood_rate_limits');
$admin = get_user_by('login', 'zionfood_test');
wp_set_current_user($admin->ID);
$nonce = wp_create_nonce('wp_rest');
$assert($request('GET', 'admin/state')->get_status() === 403, 'admin requires an explicit nonce');
$assert($request('GET', 'admin/state', [], ['X-WP-Nonce' => $nonce])->get_status() === 200, 'administrator can read status');
$subscriberId = username_exists('zionfood_subscriber') ?: wp_create_user('zionfood_subscriber', wp_generate_password(30), 'subscriber@example.test');
wp_set_current_user($subscriberId);
$assert($request('GET', 'admin/state', [], ['X-WP-Nonce' => wp_create_nonce('wp_rest')])->get_status() === 403, 'subscriber cannot manage connection');
wp_set_current_user($admin->ID);
$nonce = wp_create_nonce('wp_rest');
$connect = Settings::connect($fixture['token'], $fixture['webhook_secret']);
$assert(!is_wp_error($connect), 'real local WordPress/Laravel connection');
$assert(Settings::secret() === $fixture['token'], 'stored credential decrypts correctly');
$assert(!str_contains(get_option('zionfood_connection')['key'], $fixture['token']), 'credential ciphertext does not contain the bearer');
$assert(!str_contains(wp_json_encode($connect), $fixture['token']) && !str_contains(wp_json_encode($connect), $fixture['webhook_secret']), 'status excludes API credentials');
$sealed = Crypto::seal('private receipt');
$assert(Crypto::open($sealed) === 'private receipt', 'receipt authenticated-encryption roundtrip');
try {
    Crypto::open(substr($sealed, 0, -5) . 'AAAAA');
    $tamper = false;
} catch (Throwable) {
    $tamper = true;
}
$assert($tamper, 'tampered ciphertext rejected');
$assert(Client::ORIGIN === 'https://food.zion3d.ro', 'fixed production origin');
$assert(Settings::secureSite(), 'loopback development transport allowed');
$insecureHome = static fn () => 'http://restaurant.example.test';
add_filter('home_url', $insecureHome);
$assert(!Settings::secureSite() && is_wp_error(Settings::connect($fixture['token'])), 'nonlocal HTTP cannot receive API credentials');
remove_filter('home_url', $insecureHome);
$savedKey = get_option('zionfood_connection')['key'];
$assert(is_wp_error(Settings::connect('999999|' . str_repeat('a', 40))), 'bad credential rejected through actual backend');
$assert(get_option('zionfood_connection')['key'] === $savedKey, 'failed connection preserves the working credential');
$assert(is_wp_error(Settings::save(['accent' => 'javascript:alert(1)'])), 'invalid color rejected');
$assert(is_wp_error(Settings::save(['visible_locations' => [['bad']]])), 'nested location settings rejected');
$assert(is_wp_error(Settings::save(['cache_ttl' => 1])), 'cache bounds enforced');
$assert(!is_wp_error(Settings::save(['base_url' => 'https://attacker.example'])), 'unknown host setting is ignored');
$assert(!array_key_exists('base_url', Settings::get()), 'upstream cannot be reconfigured through settings');
$assert(wp_next_scheduled('zionfood_sync') !== false && wp_next_scheduled('zionfood_cleanup') !== false, 'background tasks scheduled');
$assert(count(array_filter(array_keys(WP_Block_Type_Registry::get_instance()->get_all_registered()), static fn ($key) => str_starts_with($key, 'zionfood/'))) === 5, 'five editor blocks registered');
$html = do_shortcode('[zionfood_menu]');
$assert(str_contains($html, 'data-zf-widget') && !str_contains($html, $fixture['token']), 'inline published menu excludes API key');
wp_set_current_user(0);
$assert($request('POST', 'guest/session', [], ['Origin' => 'https://attacker.example'])->get_status() === 403, 'cross-origin session admission denied');
$session = $request('POST', 'guest/session');
$assert($session->get_status() === 200, 'guest session initialized');
$csrf = $session->get_data()['csrf'];
$cookie = $_COOKIE[Sessions::cookie()];
$headers = ['X-ZionFood-CSRF' => $csrf];
$location = Settings::get()['location_id'];
$assert($request('POST', 'guest/catalog', ['location' => $location])->get_status() === 403, 'guest CSRF required');
$assert($request('POST', 'guest/catalog', ['location' => str_repeat('0', 26)], $headers)->get_status() === 404, 'unpublished location denied');
$assert($request('POST', 'guest/admin_state', ['location' => $location], $headers)->get_status() === 422, 'public proxy rejects unlisted operations');
$catalog = $request('POST', 'guest/catalog', ['location' => $location], $headers)->get_data();
$product = $catalog['menus'][0]['categories'][0]['items'][0];
$assert(isset($product['public_id']), 'live menu loads through the public proxy');
$data = ['location' => $location, 'consent' => true, 'customer_name' => 'WordPress test guest', 'customer_phone' => '0712345678', 'fulfillment' => 'pickup', 'items' => [['product_id' => $product['public_id'], 'quantity' => 1, 'price' => 1]], 'total' => 1];
$assert($request('POST', 'guest/quote', [...$data, 'consent' => false], $headers)->get_status() === 422, 'server requires contact-use confirmation');
$quote = $request('POST', 'guest/quote', $data, $headers);
$assert($quote->get_status() === 200 && $quote->get_data()['total'] === $product['price'], 'authoritative quote ignores spoofed prices');
$key = wp_generate_uuid4();
$first = $request('POST', 'guest/checkout', [...$data, 'idempotency_key' => $key], $headers);
$assert($first->get_status() === 200, 'real order placed through WordPress');
$order = $first->get_data();
$assert(isset($order['order_id']) && !isset($order['tracking_token']), 'private order proof never reaches guest response');
$second = $request('POST', 'guest/checkout', [...$data, 'idempotency_key' => $key], $headers);
$assert($second->get_data()['order_id'] === $order['order_id'] && $second->get_data()['replayed'], 'same request is safely replayed');
$brokenReceipt = static function ($pre, $args, $url) {
    return str_ends_with($url, '/checkout') ? ['headers' => [], 'body' => '{"unexpected":true}', 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => []] : $pre;
};
add_filter('pre_http_request', $brokenReceipt, 9, 3);
$malformed = $request('POST', 'guest/checkout', [...$data, 'idempotency_key' => wp_generate_uuid4()], $headers);
remove_filter('pre_http_request', $brokenReceipt, 9);
$assert($malformed->get_status() === 502 && $malformed->get_data()['data']['retryable'], 'malformed success receipt is rejected safely and remains retryable');
$track = $request('POST', 'guest/track', ['location' => $location, 'id' => $order['order_id']], $headers);
$assert($track->get_status() === 200 && $track->get_data()['total'] === $product['price'], 'guest tracks its order through server-held proof');
unset($_COOKIE[Sessions::cookie()]);
$other = $request('POST', 'guest/session')->get_data();
$assert($request('POST', 'guest/track', ['location' => $location, 'id' => $order['order_id']], ['X-ZionFood-CSRF' => $other['csrf']])->get_status() === 404, 'another guest cannot read the order');
$_COOKIE[Sessions::cookie()] = $cookie;
$booking = $request('POST', 'guest/reserve', ['location' => $location, 'consent' => true, 'idempotency_key' => wp_generate_uuid4(), 'guest_name' => 'Reservation test', 'guest_phone' => '0712345678', 'party_size' => 2, 'starts_at' => gmdate('Y-m-d', time() + DAY_IN_SECONDS) . 'T14:00'], $headers);
$assert($booking->get_status() === 200 && isset($booking->get_data()['reservation_id']), 'real reservation created');
$reservation = $booking->get_data()['reservation_id'];
$assert(!isset($booking->get_data()['token']), 'reservation private proof is server-only');
$reservationState = $request('POST', 'guest/reservation_track', ['location' => $location, 'id' => $reservation], $headers)->get_data();
$assert($reservationState['status'] === 'confirmed', 'reservation status retrieved');
$preorder = $request('POST', 'guest/checkout', [...$data, 'fulfillment' => 'dine_in', 'reservation_id' => $reservation, 'idempotency_key' => wp_generate_uuid4()], $headers);
$assert($preorder->get_status() === 200 && $preorder->get_data()['scheduled_for'], 'confirmed reservation preorder uses the server-held proof');
$cancel = $request('POST', 'guest/reservation_cancel', ['location' => $location, 'id' => $reservation, 'version' => $reservationState['version'], 'idempotency_key' => wp_generate_uuid4()], $headers);
$assert($cancel->get_status() === 200 && $cancel->get_data()['status'] === 'cancelled', 'reservation cancellation respects version');
$tables = (new Client())->request('GET', 'locations/' . $location . '/tables');
$table = $tables['tables'][0];
parse_str((string) parse_url($table['qr_url'], PHP_URL_FRAGMENT), $qr);
$joined = $request('POST', 'guest/table_connect', ['location' => $location, 'id' => $table['public_id'], 'qr_token' => $qr['token'], 'idempotency_key' => wp_generate_uuid4()], $headers);
$assert($joined->get_status() === 200 && !isset($joined->get_data()['token']), 'QR table connects without exposing its session token');
$assert($request('POST', 'guest/table_availability', ['location' => $location, 'id' => $table['public_id']], $headers)->get_data()['can_order'] === true, 'connected table exposes effective availability');
$dining = $request('POST', 'guest/checkout', [...$data, 'fulfillment' => 'dine_in', 'table_id' => $table['public_id'], 'idempotency_key' => wp_generate_uuid4()], $headers);
$assert($dining->get_status() === 200, 'QR dining checkout uses the server-held table proof');
$active = $request('POST', 'guest/table_orders', ['location' => $location, 'id' => $table['public_id']], $headers);
$assert($active->get_status() === 200 && count($active->get_data()['orders']) > 0, 'connected table sees active orders');
unset($_COOKIE[Sessions::cookie()]);
$stranger = $request('POST', 'guest/session')->get_data();
$assert($request('POST', 'guest/table_orders', ['location' => $location, 'id' => $table['public_id']], ['X-ZionFood-CSRF' => $stranger['csrf']])->get_status() === 404, 'unconnected guest cannot read table orders');
$_COOKIE[Sessions::cookie()] = $cookie;
Settings::save(['enable_ordering' => false, 'enable_reservations' => false]);
$assert($request('POST', 'guest/quote', $data, $headers)->get_status() === 422, 'plugin ordering switch is enforced on the server');
$assert($request('POST', 'guest/reservation_slots', ['location' => $location, 'date' => gmdate('Y-m-d', time() + DAY_IN_SECONDS), 'party_size' => 2], $headers)->get_status() === 422, 'plugin reservation switch is enforced on the server');
Settings::save(['enable_ordering' => true, 'enable_reservations' => true]);
$webhook = new WP_REST_Request('POST', '/zionfood/v1/webhook');
$event = '01M' . strtoupper(substr(hash('sha256', wp_generate_uuid4()), 0, 23));
$raw = wp_json_encode(['id' => $event, 'type' => 'menu.updated', 'data' => []]);
$webhook->set_body($raw);
$webhook->set_header('X-ZionFood-Delivery', $event);
$webhook->set_header('X-ZionFood-Event', 'menu.updated');
$webhook->set_header('X-ZionFood-Timestamp', (string) time());
$assert(rest_do_request($webhook)->get_status() === 401, 'unsigned callback denied');
$webhook->set_header('X-ZionFood-Signature', 'sha256=' . hash_hmac('sha256', $webhook->get_header('x-zionfood-timestamp') . '.' . $raw, $fixture['webhook_secret']));
$assert(rest_do_request($webhook)->get_status() === 200, 'valid HMAC callback accepted');
$revision = get_option('zionfood_cache_revision');
$assert(rest_do_request($webhook)->get_status() === 200 && get_option('zionfood_cache_revision') === $revision, 'duplicate event is idempotent');
$assert(RateLimit::admit('unit_' . $key, 2) && RateLimit::admit('unit_' . $key, 2) && !RateLimit::admit('unit_' . $key, 2), 'shared atomic rate bucket enforced');
$logs = wp_json_encode(ZionFood\WP\Journal::recent());
$assert(!str_contains($logs, $fixture['token']) && !str_contains($logs, '0712345678'), 'diagnostics exclude keys and contacts');
$wpdb->query('DELETE FROM ' . $wpdb->prefix . 'zionfood_rate_limits');
wp_set_current_user($admin->ID);
echo 'PASS: ' . $count . " real WordPress/Laravel integration checks.\n";
