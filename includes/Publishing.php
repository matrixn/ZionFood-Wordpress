<?php

declare(strict_types=1);

namespace ZionFood\WP;

final class Publishing
{
    public function register(): void
    {
        foreach (['menu', 'order', 'reservations', 'hours', 'promotions'] as $mode) {
            add_shortcode('zionfood_' . $mode, fn ($attrs) => $this->render($mode, is_array($attrs) ? $attrs : []));
            register_block_type('zionfood/' . $mode, ['api_version' => 3, 'attributes' => ['location' => ['type' => 'string', 'default' => '']], 'render_callback' => fn ($attrs) => $this->render($mode, $attrs), 'editor_script' => 'zionfood-blocks']);
        }
        wp_register_script('zionfood-blocks', plugins_url('assets/dist/blocks.js', FILE), ['wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components'], VERSION, true);
        wp_localize_script('zionfood-blocks', 'zionfoodBlocks', ['locations' => Settings::locations(), 'labels' => I18n::dictionaries()[I18n::locale()]]);
    }

    private function assets(): void
    {
        wp_enqueue_style('zionfood-public', plugins_url('assets/dist/public.css', FILE), [], VERSION);
        wp_enqueue_script('zionfood-public', plugins_url('assets/dist/public.js', FILE), [], VERSION, true);
    }

    public function render(string $mode, array $attrs = []): string
    {
        $s = Settings::get();
        $location = isset($attrs['location']) && is_string($attrs['location']) && $attrs['location'] ? $attrs['location'] : $s['location_id'];
        if (!Settings::published($location)) {
            return current_user_can('manage_options') ? '<p class="zf-notice">' . esc_html(I18n::t('publish_connect')) . '</p>' : '';
        }
        if (($mode === 'order' && (!$s['enable_ordering'] || !Settings::has('checkout:write'))) || ($mode === 'reservations' && (!$s['enable_reservations'] || !Settings::has('reservations:create')))) {
            return '';
        }
        $this->assets();
        $id = wp_unique_id('zf-widget-');
        $publicSettings = array_intersect_key($s, array_flip(['language', 'language_switcher', 'accent', 'menu_layout', 'show_images', 'show_descriptions', 'show_nutrition', 'show_allergens', 'show_search', 'enable_ordering', 'enable_reservations', 'persist_cart', 'remember_customer', 'order_label']));
        $publicSettings['enable_ordering'] = $publicSettings['enable_ordering'] && Settings::has('checkout:write');
        $publicSettings['enable_reservations'] = $publicSettings['enable_reservations'] && Settings::has('reservations:create');
        $config = ['id' => $id, 'root' => rest_url('zionfood/v1/'), 'origin' => Client::ORIGIN, 'location' => $location, 'locations' => array_values(array_filter(Settings::locations(), static fn ($l) => Settings::published($l['public_id']))), 'mode' => $mode, 'settings' => $publicSettings, 'dictionaries' => I18n::dictionaries(), 'privacy_url' => get_privacy_policy_url()];
        $output = '<section class="zf-widget" id="' . esc_attr($id) . '" data-zf-widget style="--zf-accent:' . esc_attr($s['accent']) . '">';
        if (in_array($mode, ['order', 'reservations'], true)) {
            $label = $mode === 'order' ? ($s['order_label'] ?: I18n::t('order_now', $s['language'])) : I18n::t('reserve_table', $s['language']);
            $output .= '<button type="button" class="zf-button" data-zf-launch>' . esc_html($label) . '<span aria-hidden="true"> ↗</span></button>';
        } else {
            // Readable cached HTML remains useful when JavaScript is unavailable. No guest secrets are embedded.
            $data = Catalog::get($location, $s['language']);
            $output .= '<div data-zf-content>' . $this->fallback($mode, $data, $s) . '</div>';
        }
        $output .= '<script type="application/json" data-zf-config>' . wp_json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . '</script></section>';
        return $output;
    }

    private function fallback(string $mode, array|\WP_Error $data, array $settings): string
    {
        if (is_wp_error($data)) {
            return '<p role="status">' . esc_html(I18n::t('temporarily_unavailable', $settings['language'])) . '</p>';
        }
        $html = '<h2>' . esc_html($data['restaurant']['name'] ?? 'ZionFood') . '</h2>';
        if ($mode === 'hours') {
            foreach ($data['hours'] ?? [] as $row) {
                $html .= '<p>' . esc_html(I18n::t('day_' . $row['weekday'], $settings['language']) . ' · ' . substr($row['opens_at'], 0, 5) . '–' . substr($row['closes_at'], 0, 5)) . '</p>';
            }
        } elseif ($mode === 'promotions') {
            foreach ($data['promotions'] ?? [] as $promotion) {
                $html .= '<p>' . esc_html($promotion['name']) . '</p>';
            }
        } else {
            foreach ($data['menus'] ?? [] as $menu) {
                foreach ($menu['categories'] ?? [] as $category) {
                    $html .= '<h3>' . esc_html($category['name']) . '</h3><div class="zf-fallback-grid">';
                    foreach ($category['items'] ?? [] as $item) {
                        $html .= '<article><h4>' . esc_html($item['name']) . '</h4>' . ($settings['show_descriptions'] ? '<p>' . esc_html($item['description'] ?? '') . '</p>' : '') . '<strong>' . esc_html(number_format((int) $item['price'] / 100, 2, ',', '.') . ' ' . ($data['location']['currency'] ?? 'RON')) . '</strong></article>';
                    }
                    $html .= '</div>';
                }
            }
            $html .= '<noscript><p>' . esc_html(I18n::t('javascript_required', $settings['language'])) . '</p></noscript>';
        }
        return $html;
    }

    public function floating(): void
    {
        if (is_admin() || wp_doing_ajax() || !Settings::published(Settings::get()['location_id'])) {
            return;
        }
        $s = Settings::get();
        if ($s['floating_button'] === 'none' || ($s['menu_page_id'] && is_page($s['menu_page_id']))) {
            return;
        }
        echo '<aside class="zf-floating zf-floating-' . esc_attr($s['floating_position']) . '" aria-label="ZionFood">';
        if (in_array($s['floating_button'], ['order', 'both'], true)) {
            echo $this->render('order');
        }
        if (in_array($s['floating_button'], ['reserve', 'both'], true)) {
            echo $this->render('reservations');
        }
        echo '</aside>';
    }
}
