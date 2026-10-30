# Progres verificat — 0.0.1

## Implementare

- [x] Bootstrap WordPress, activare/dezactivare/dezinstalare, trei tabele, criptare și cron.
- [x] Client API fix, validare conexiune, permisiuni și publicarea selectivă a locațiilor.
- [x] Dashboard și setări funcționale RO/EN, publicare, blocuri și shortcode-uri.
- [x] Meniu, produse configurabile, checkout, rezervări/precomandă, confirmări și suport de sesiune QR.
- [x] Cache, callback verificat, rate limiting, jurnal fără date sensibile și manual builder.
- [x] Teste unitare frontend și suită de integrare într-un WordPress real, separat de producție.

## Mediu și dovezi

Validarea se face pe Windows cu PHP 8.4, WordPress 7.1.4, adaptorul oficial SQLite Database Integration 1.8.0 și o instanță ZionFood cu bază SQLite de test izolată. WordPress comunică efectiv HTTP cu backendul local printr-un adaptor privat de test care înlocuiește numai originul fix. Acest adaptor, cheile și conturile de test nu sunt în Git/ZIP. Nu este o verificare a conexiunii TLS către producție.

Verificările finale și rezultatele lor se înregistrează mai jos înaintea commitului. Nu se trimit emailuri reale și nu se procesează plăți în aceste teste.

## Verificări finale

Executate la 2026-10-30:

| Verificare | Rezultat |
|---|---|
| Sintaxă PHP, 16 fișiere runtime/test | PASS |
| Pint PSR-12 pe Linux, cache privat nou, apoi auditul normal `--test` | PASS, 16 fișiere în fiecare audit |
| `npm run format:check` | PASS |
| `npm test` | PASS, 4 teste |
| `npm run build` | PASS, assets esbuild/Leaflet locale |
| Integrare WordPress real ↔ ZionFood local | PASS, 53 verificări |
| Ciclu de dezinstalare, fără ștergerea fișierelor pluginului | PASS, 6 verificări pentru păstrare/ștergere opțională și protejarea datelor altor pluginuri |
| Playwright Chromium, desktop și viewport mobil 390×844 | PASS, 6 teste |
| Metadate versiune și selecția fișierelor pentru build | PASS, 0.0.1, 31 fișiere runtime/documentație înaintea manifestului |

Integrarea verifică drepturile administratorului, nonce, criptarea și rezistența la modificarea ciphertextului, cheia invalidă fără pierderea conexiunii vechi, HTTPS, CSRF/origin, locații publicate, allowlist, quote fără încredere în prețuri trimise de browser, checkout real, replay idempotent, răspuns upstream incomplet, confirmări private, rezervare/anulare/precomandă, sesiune QR și comenzi comune mesei, dezactivarea comenzilor/rezervărilor, callback HMAC/replay, rate limiting și jurnal sanitizat.

Cele șase fluxuri din browser acoperă conectare/salvare/publicare și ridicare, variante/cantități extra și livrare poștală, rezervare cu precomandă, comandă programată cu slot real, traduceri RO/EN și date alimentare/tooltips, respectiv pin de livrare cu adresă editabilă și checkout mobil. Confirmat: browserul nu contactează direct API-ul cu cheia restaurantului. Totalul și acțiunile sunt în viewport-ul mobil, iar conținutul dialogului se poate derula separat.

Pentru testul hărții, dalele și răspunsul de geocodare sunt înlocuite cu fixtures locale; pinul, proxy-ul WordPress, validarea poligonului și checkout-ul folosesc fluxul real. Nu se declară verificarea serviciului public de geocodare. Tema WordPress folosită este Twenty Twenty-Five; testele rulează cu preferința standard `reducedMotion: reduce` pentru a evita tranzițiile de navigare ale temei.

Defecte corectate în timpul validării: autoload pentru clasa I18n, denumiri accesibile ale câmpurilor cu tooltips, transmiterea cantităților extraopțiunilor, verificarea programului la restaurarea sesiunii QR, etichetarea bazei nutriționale, polling în meniul popup și invalidarea durabilă a cache-ului înaintea confirmării callback-ului.

Testul separat `tests/wp-uninstall.php` verifică opțiunea de ștergere explicită, retenția implicită, tabelele și cron-ul, eliminarea cheilor de cache proprii și păstrarea unor opțiuni cu nume asemănătoare. Curățarea folosește prefixe escapate și API-ul WordPress pentru invalidarea corectă a cache-ului de opțiuni.

Arhiva finală se construiește **după commit și push**, conform solicitării. Builderul rulează din nou testele frontend, formatarea, buildul și lintul PHP, apoi verifică versiunea, allowlistul, CRC și SHA-256. Rezultatul arhivei și al instalării de verificare se raportează la livrare; nu este un deploy pe producție.

## Lucru rămas / limite

Vezi checklistul README și raportul de capabilități. Nu sunt validate producția, combinațiile de teme/pluginuri/cache/CDN, traficul ridicat, network activation/multisite, plățile, livrarea emailurilor sau callback-ul prin DNS/TLS public. Nu se declară compatibilitate completă cu toate promoțiile GloriaFood. Pluginul nu generează automat QR-uri WordPress și nu folosește încă reconcilierea prin cursor de evenimente.
