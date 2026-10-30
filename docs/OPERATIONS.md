# Operare — 0.0.1

## Conectare

Hostul din `includes/Client.php` este fix: `https://food.zion3d.ro`. Browserul folosește REST-ul WordPress, iar WordPress comunică cu API-ul ZionFood. Nu introduce parola contului ZionFood; folosește cheia generată pentru integrarea WordPress. O cheie revocată, expirată sau fără permisiunile necesare trebuie înlocuită în dashboard.

Cheia trebuie să permită `storefront:read`; comenzile necesită `checkout:write`, rezervările `reservations:create`. Statisticile necesită permisiunile analytics ale API-ului. Callback-ul este opțional și necesită separat `menu:read`, `webhooks:manage` și secretul de semnare primit la crearea conexiunii. Fără callback pluginul continuă cu cache și sincronizare periodică.

Nu schimba sărurile WordPress fără să ai cheia disponibilă pentru reconectare: criptarea folosește cheia derivată din `wp_salt('auth')` și ID-ul site-ului. Backupul bazei de date trebuie protejat împreună cu configurația WordPress. Deconectarea șterge cheia și sesiunile private locale; nu revocă cheia centrală. Dezactivarea callback-urilor la deconectare este best effort pentru primele trei locații; verifică și elimină celelalte endpointuri în ZionFood când este cazul.

## Setări funcționale

Fiecare control are ajutor la hover și focus. Modificările se aplică după salvare și reîncărcarea paginii publice.

| Setare | Efect |
|---|---|
| Locații vizibile | Publică numai locațiile bifate; proxy-ul public respinge celelalte locații |
| Locație implicită | Alegerea inițială a widgeturilor fără atribut de locație |
| Pagina meniului | Destinația publicată; ascunde butoanele flotante pe acea pagină |
| Comenzi / rezervări | Controlează butoanele și accesul operațiilor publice corespunzătoare; nu activează un serviciu oprit în ZionFood |
| RO / EN și selector limbă | Limba inițială și afișarea selectorului în widget; conținutul tradus depinde de traducerile publicate în ZionFood |
| Culoare accent | Culoarea controalelor, butoanelor și hărții |
| Grilă / listă | Aranjarea cardurilor meniului |
| Fotografii / descrieri / căutare | Afișarea elementelor respective în meniu și detaliile produsului |
| Alergeni / nutriție | Afișarea datelor publicate; pluginul nu calculează sau inventează valori nutriționale |
| Butoane flotante | Niciunul, comandă, rezervare sau ambele; numai când serviciul și permisiunea sunt disponibile |
| Poziție stânga / dreapta | Poziția butoanelor flotante |
| Text buton comandă | Text propriu pentru lansarea comenzii; gol folosește textul tradus standard |
| Păstrează coșul | Memorează local doar ID-uri, opțiuni și cantități; catalogul este revalidat la încărcare |
| Memorarea datelor clientului | Oferă un checkbox explicit vizitatorului; implicit nu păstrează contacte pe dispozitiv |
| Cache 15–300 secunde | Durata catalogului; disponibilitatea are cache separat 10 secunde și este verificată la checkout |
| Diagnosticare | Activează jurnalul și secțiunea de diagnosticare; nu înregistrează corpuri de mesaje |
| Șterge la dezinstalare | Elimină numai datele pluginului dacă este bifat; implicit păstrează datele. Nu șterge comenzile ZionFood sau paginile WordPress |

## Publicare și QR

Blocurile Gutenberg folosesc selector de locație în inspector. Shortcode-urile acceptă atributul opțional `location` cu ID public. Nu publica aceeași pagină de comandă în iframe de pe alt domeniu; sesiunile sunt first-party și originile sunt verificate.

Pentru o masă deja existentă, pluginul poate primi un link de forma:

```text
https://restaurant.example/meniu/?zf_table=ID_PUBLIC_MASA#token=TOKEN_QR_VALID
```

Folosește tokenul QR valid emis de ZionFood, nu cheia API. Fragmentul este eliminat după conectare; tokenul sesiunii mesei se păstrează numai pe server. Linkurile/codurile QR emise acum de ZionFood continuă să trimită către ZionFood. Generarea automată a codurilor orientate către WordPress este lucru rămas. Lista comună încarcă prima pagină de până la 30 de comenzi active; paginarea UI suplimentară este rămasă.

## Sincronizare și disponibilitate

WP-Cron sincronizează manifestul la 5 minute când WordPress execută cron. Pentru trafic redus, configurează un cron real pe hosting care apelează cron-ul WordPress. Catalogul se reîncarcă la expirarea cache-ului și după invalidare. Confirmările active se verifică periodic: comenzile la 10 secunde, rezervările în așteptare la 12 secunde; disponibilitatea și lista sesiunii se actualizează periodic în meniu. Nu există WebSocket în pluginul 0.0.1.

Callback-ul se înregistrează din Diagnosticare → actualizări instant, pe un site HTTPS cu permalinkuri funcționale și endpoint REST accesibil din exterior. Un singur endpoint de callback este disponibil pe locație în API-ul curent: activarea pe alt site poate înlocui destinația anterioară. Alertele pentru erori folosesc toasturi și jurnalul; nu se trimit emailuri direct de plugin.

Promoțiile disponibile sunt cele publicate în ZionFood. Codul introdus în checkout este validat de server. Timpii, disponibilitatea, masa, variantele, restricțiile, prețurile și reducerile sunt validate de server la quote și din nou la comandă. Subtotalul coșului este orientativ până la quote. La eroare ambiguă de rețea se reîncearcă aceeași cerere cu aceeași cheie de idempotency; nu se trimite automat o comandă nouă.

## Confidențialitate, cache și depanare

- Exclude `/wp-json/zionfood/v1/*` din cache/CDN. Pluginul emite `private, no-store` și `noindex`, dar configurația CDN nu trebuie să le ignore. HTML-ul meniului nu conține chei sau confirmări private și poate fi cache-uit conform regulilor site-ului.
- Cookie-ul HttpOnly al vizitatorului expiră după 90 zile; tokenurile de confirmare sunt criptate în baza WordPress. Ștergerea cookie-ului sau deconectarea integrației face confirmările vechi inaccesibile pe acel browser.
- Datele clientului sunt trimise către ZionFood la cererea acestuia. Harta transmite IP-ul către serviciul de dale OpenStreetMap. Adaugă aceste aspecte în politica site-ului; pluginul adaugă text sugerat în instrumentul WordPress pentru politica de confidențialitate.
- Jurnalul afișează ultimele 50 de operații, cod HTTP, durată și request ID; retenție 7 zile prin cron. Diagnosticele centrale ZionFood sunt separate.
- 401/403: verifică cheia, expirarea, permisiunile și locațiile; 429: așteaptă și verifică limitele API; 5xx/rețea: verifică hosting, TLS, DNS și jurnalul central cu request ID.
- Limitele pluginului sunt suplimentare celor din API: 120 cereri publice/minut/IP, 20 mutații/minut/IP, 30 sesiuni/10 minute/IP, 5 rezolvări adresă/minut/IP și 30 acțiuni admin/minut/IP. IP-ul folosit este `REMOTE_ADDR`; hostingul trebuie să configureze corect proxy-ul de încredere.
- Folosește câte o instalare normală per site. Network activation/multisite nu a fost validat.

## Testare locală

Testele PHP folosesc un WordPress real separat și un API ZionFood cu DB izolată. Necesită `ZIONFOOD_TEST_RUNTIME`, host loopback și fișier privat `ZF_WP_CONNECTION`; sunt blocate pe o instanță normală. Playwright citește contul și cheia din `.local/` sau căi furnizate prin mediu. Nu adăuga aceste fișiere în Git sau ZIP. Nu rula testele pe restaurantul de producție.
