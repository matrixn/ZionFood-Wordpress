=== ZionFood ===
Contributors: matrixn
Tags: restaurant, online ordering, reservations, menu, zionfood
Requires at least: 6.6
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.0.1
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connect a ZionFood restaurant to WordPress: digital menus, ordering, reservations, opening hours and promotions.

== Description ==
Connect your restaurant API key, select locations and publish a native menu or ordering/reservation buttons. Romanian and English interfaces, flexible presentation, private receipts, server-calculated quotes and optional diagnostic logs.

This plugin requires an active ZionFood restaurant and API key. Its fixed external service is https://food.zion3d.ro. WordPress sends the API key server-to-server to retrieve authorized restaurant data. Visitor contact details, requested products, delivery address/pin and booking details are sent when they submit the relevant requests. Prices and availability are validated by ZionFood.

Delivery polygon maps load tiles from https://tile.openstreetmap.org with attribution. Tile requests disclose the visitor IP to that service. Address lookup is proxied through ZionFood. Review https://operations.osmfoundation.org/policies/tiles/ and configure your restaurant privacy policy in WordPress.

An HttpOnly first-party guest cookie lasts up to 90 days. Optional remembered contact details are stored on the visitor device only after explicit selection. API keys and private receipt tokens are encrypted on the WordPress server. Technical logs omit message bodies and customer contact details and expire after 7 days.

Online payments are not implemented in this release. Editing menus, kitchen operations and staff remain in the ZionFood workspace. See README.md and docs for current coverage and outstanding work.

== Installation ==
1. Upload the release ZIP through Plugins > Add New > Upload Plugin.
2. Activate ZionFood and open its dashboard.
3. Enter your restaurant WordPress API key. Your WordPress site must use HTTPS except localhost development.
4. Select visible locations and publish a page or add one of the five ZionFood blocks/shortcodes.

== Frequently Asked Questions ==
= Is WooCommerce required? =
No. Orders and bookings are processed by ZionFood.

= Can I change the API host? =
No. The server is fixed in code to https://food.zion3d.ro.

= Does disconnect revoke my key? =
It removes local credentials and private receipt sessions. Revoke the key in ZionFood when required.

== Changelog ==
= 0.0.1 =
Initial native WordPress integration with dashboard, settings, blocks, menus, orders, reservations, diagnostics and manual ZIP builds.
