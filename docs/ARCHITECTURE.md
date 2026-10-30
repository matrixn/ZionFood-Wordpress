# Arhitectură — 0.0.1

Plugin nativ WordPress, PHP 8.1+, fără dependențe PHP externe. JavaScript simplu și CSS compilate cu esbuild; Leaflet este inclus local pentru harta de livrare. Editorul folosește API-urile standard Gutenberg deja incluse de WordPress.

```text
Browser → WordPress REST /zionfood/v1/guest/*
        → sesiune HttpOnly + CSRF + locație publicată + allowlist
        → Client → HTTPS food.zion3d.ro/api/v1/wordpress/*
                  → acțiunile de domeniu ZionFood

Administrator → manage_options + X-WP-Nonce → configurare / publicare
ZionFood callback → HMAC(timestamp.body) → invalidare cache
```

## Separarea responsabilităților

- `Settings`: validare, conexiune, permisiuni și locații vizibile. Nicio setare nu schimbă originul API.
- `Client`: HTTPS nativ WordPress, verificare TLS, fără redirecționări, timeout 15 secunde, răspuns maxim 2 MiB, mesaje sanitizate.
- `Rest`: proxy explicit pentru catalog/disponibilitate, quote/checkout, intervale, rezervări, confirmări, mese și adresă. Nu expune un proxy generic de API sau endpointurile de administrare ale restaurantului.
- `Crypto`: AES-256-GCM, nonce aleator, autentificarea ciphertextului, cheie derivată din sarea WordPress și ID site.
- `Sessions`: cookie aleator first-party, hash HMAC în DB, payload criptat, CSRF și tokenuri private de comandă/rezervare/masă. Revizii și compare-and-swap pentru actualizări concurente.
- `Catalog`: cache per locație/limbă, revizie invalidabilă, verificarea periodică a manifestului și eliminarea locațiilor care nu mai sunt autorizate.
- `RateLimit`: contoare atomice în DB, IP hashuit, bucketuri cu expirare.
- `Journal`: metadate ale transportului, fără corpuri sau date personale.
- `Publishing`: shortcode-uri, blocuri dinamice, HTML de rezervă și configurare publică fără secrete.
- `Admin`: dashboard, setări, pagini de publicare și diagnosticare.

## Proprietăți de securitate

Cheia API nu ajunge în JavaScript, HTML, localStorage sau jurnal. Autentificarea administratorului folosește capabilități WordPress și nonce REST. Sesiunile publice au propriul CSRF: nonces WordPress pentru vizitatori nu sunt folosite ca autentificare. Hostul/scheme/portul originului trebuie să coincidă, iar solicitările cross-site sunt respinse. HTTPS este obligatoriu în afara loopback.

Confirmările se pot consulta numai cu dovada salvată în sesiunea respectivă; public ID-ul singur nu acordă acces. Lista comună de comenzi ale mesei necesită sesiunea mesei conectate cu token QR valid. Tokenurile private primite din API sunt eliminate din răspunsurile către browser și criptate pe server.

Quote/checkout folosesc identificatori și cantități, niciodată prețuri impuse de browser. Datele de contact nu sunt memorate implicit pe dispozitiv. Cererile de comandă și rezervare sunt idempotente, iar reîncercările ambigue păstrează cheia aceleiași operații. API-ul rămâne autoritatea pentru validarea produselor, programului și prețurilor.

Callback-urile verifică exact corpul semnat, timestamp ±300 secunde, ID și tip eveniment. Invalidarea cache-ului trebuie să reușească înainte de confirmare; markerul de admitere este durabil. Datele venite din catalog sunt escapate la randare, iar căile imaginilor sunt limitate la storage-ul originului fix.

Aceste controale nu elimină riscul compromiterii administratorului/hostingului WordPress. Nu există criptare care să protejeze cheia de cod malițios cu acces la baza de date și sărurile WordPress. Folosește HTTPS, actualizări și backupuri protejate.

## Date locale și distribuție

Opțiuni `zionfood_*`, user meta pentru limba administratorului și trei tabele per prefix: `zionfood_sessions`, `zionfood_rate_limits`, `zionfood_logs`. Datele expirate se curăță zilnic. Dezactivarea oprește cron; dezinstalarea șterge date numai dacă opțiunea explicită este activă.

Buildul include doar fișiere runtime, documentația de bază, licențe, imagini și assets compilate. Manifestul înregistrează commitul sursă și hashurile fișierelor. Node/Python/PHP CLI sunt necesare numai pe mașina care construiește arhiva.

## Surse primare

- [Autentificare REST WordPress](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/)
- [Nonces WordPress și limitările pentru vizitatori](https://developer.wordpress.org/plugins/security/nonces/)
- [Politica dalelor OpenStreetMap](https://operations.osmfoundation.org/policies/tiles/)
