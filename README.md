# ZionFood pentru WordPress — 0.0.1

Meniul restaurantului, comenzile și rezervările, direct în site-ul WordPress. Conectezi cheia restaurantului, alegi locațiile și publici. Catalogul și regulile comerciale rămân administrate în ZionFood.

**Server:** `https://food.zion3d.ro` — fix în cod, exclusiv HTTPS. Nu este necesar WooCommerce. Nu sunt necesare Node, Composer sau npm pe site-ul unde instalezi arhiva.

## Instalare și prima conectare

1. În ZionFood → integrarea WordPress, generează o cheie pentru locațiile dorite. Permisiuni: `storefront:read`, `checkout:write`, `reservations:create`. Activează serviciile și publică meniul în ZionFood.
2. În WordPress → Module → Adaugă modul → Încarcă modul, încarcă `zionfood-wordpress-0.0.1.zip` și activează **ZionFood**.
3. Deschide **ZionFood → Conectare**, introdu cheia și salvează. Pluginul preia automat restaurantul, locațiile autorizate, meniul și serviciile disponibile.
4. În **Experiență / Setări** alege locația implicită și locațiile vizibile, aspectul și funcțiile publice.
5. În **Publicare**, creează pagina de meniu sau folosește blocurile/shortcode-urile de mai jos.

Necesită WordPress 6.6+, PHP 8.1+ cu OpenSSL AES-256-GCM și mbstring, bază de date WordPress funcțională și HTTPS pe site. HTTP este acceptat numai pe localhost pentru dezvoltare. Serverul WordPress trebuie să poată contacta `food.zion3d.ro` pe HTTPS. Contul administratorului WordPress configurează integrarea; rolurile angajaților din ZionFood nu devin automat administratori WordPress.

## Implementat în 0.0.1

- [x] Repository separat, plugin WordPress nativ și build manual ZIP verificat, fără GitHub Actions.
- [x] Dashboard cu restaurantul conectat, starea conexiunii, ultima sincronizare, număr de produse/categorii/locații și servicii active; indicatori pe ultimele 7 zile când cheia permite analytics.
- [x] Cheie API criptată pe server, înlocuire verificată înainte de salvare și deconectare locală.
- [x] Interfață proprie aerisită, notificări popup, informații la hover/focus, RO implicit și EN opțional.
- [x] Preluare automată catalog și locații, cache configurabil, sincronizare manuală și WP-Cron la 5 minute.
- [x] Cinci blocuri Gutenberg și cinci shortcode-uri: meniu, comandă, rezervări, program și promoții.
- [x] Publicare pagină de meniu dintr-un buton, locații multiple autorizate și meniu accesibil în site fără iframe.
- [x] Fotografii, căutare, categorii, ingrediente, gramaj, alergeni, etichete alimentare și valori nutriționale publicate de restaurant, inclusiv marcaje pentru date estimative și ingrediente congelate.
- [x] Selectarea variantelor și opțiunilor de produs/categorie/variantă, selecții implicite, limite min/max și cantități pentru extraopțiuni.
- [x] Coș compact cu fotografii, cantități și memorare opțională; totalul final este calculat exclusiv de ZionFood.
- [x] Ridicare și livrare, zone poștale sau poligoane, hartă Leaflet, pin și completare adresă prin API; adresa rămâne editabilă.
- [x] Program și disponibilitate vizibile înainte de comandă; serverul verifică din nou regulile la finalizare.
- [x] Comenzi programate, intervale preluate de la server, coduri promoționale și reduceri calculate de server.
- [x] Rezervări cu disponibilitate reală, urmărire/anulare și precomandă pentru rezervările confirmate când serviciul este activ.
- [x] Confirmări de comandă și rezervare private, stări actualizate periodic, revenire la meniu și izolare între sesiunile vizitatorilor.
- [x] Suport pentru conectarea la o masă cu un token QR valid și afișarea comenzilor active comune mesei. Vezi limitările de integrare QR în [ghid](docs/OPERATIONS.md).
- [x] Butoane flotante configurabile; dialoguri responsive cu total și acțiuni permanent vizibile.
- [x] Jurnal tehnic opțional, fără chei, contacte sau corpuri de comenzi, cu retenție 7 zile.
- [x] Callback opțional semnat HMAC pentru invalidarea catalogului, protecție replay, control de acces, CSRF și rate limiting.
- [x] Build cu allowlist, manifest de fișiere, commit sursă, verificare CRC și checksum SHA-256.

## De implementat / verificat ulterior

- [ ] Plăți online; momentan comanda/rezervarea nu colectează bani în plugin.
- [ ] Marketing automat, fidelizare, aplicații mobile și imprimare/POS dedicată.
- [ ] Extinderea tuturor șabloanelor comerciale avansate de promoții GloriaFood; acum folosim tipurile disponibile în ZionFood.
- [ ] Generarea în ZionFood a codurilor QR care trimit direct la site-ul WordPress; linkurile QR existente trimit în continuare la ZionFood.
- [ ] Reconciliere incrementală prin cursorul jurnalului de evenimente; prima versiune folosește callback pentru catalog și sincronizare periodică.
- [ ] Import/editor nativ WordPress pentru meniuri, personal și bucătărie; acestea se gestionează în panoul ZionFood.
- [ ] Teste de instalare în producție, CDN/cache, teme/page builders diverse, multisite/network activation și trafic ridicat.
- [ ] Automatizare de release/update în GitHub, semnare și distribuție automată.

## Publicare în pagini

| Bloc Gutenberg | Shortcode | Rezultat |
|---|---|---|
| ZionFood Menu | `[zionfood_menu]` | Meniu complet inline |
| ZionFood Ordering | `[zionfood_order]` | Buton care deschide comanda |
| ZionFood Reservations | `[zionfood_reservations]` | Buton pentru rezervare |
| ZionFood Opening Hours | `[zionfood_hours]` | Programul locației |
| ZionFood Promotions | `[zionfood_promotions]` | Promoții publicate |

Pentru o locație precisă: `[zionfood_menu location="ID_PUBLIC_LOCATIE"]`. ID-ul trebuie să fie autorizat de cheie și bifat ca vizibil. Blocurile au selector de locație în inspector. Folosește blocul Shortcode în page builders care nu expun blocurile Gutenberg.

## Build manual

Din checkout, cu PHP, Python 3.10+ și Node/npm instalate:

```powershell
.\bin\build.ps1
```

Alternativ: `python bin/build.py`. Builderul instalează dependențele frontend dacă lipsesc, rulează testele unitare și buildul, verifică sintaxa PHP și versiunile, apoi produce:

```text
build/zionfood-wordpress-0.0.1.zip
build/zionfood-wordpress-0.0.1.zip.sha256
```

Arhiva conține directorul instalabil `zionfood/`, assets compilate și `release-manifest.json`. Nu include chei, medii locale de test, Git, teste, scripturi de dezvoltare sau `node_modules`. Buildul nu publică și nu face deploy.

## Validare și documentație

Verificat local: **53 verificări de integrare WordPress–ZionFood, 6 verificări de dezinstalare, 6 teste Playwright și 4 teste frontend**, plus sintaxă PHP, Pint pe Linux, Prettier și build. Comenzi: `npm test`, `npm run format:check`, `npm run build`, lint PHP și `npm run test:e2e` pentru mediul privat descris în [progres](docs/PROGRESS.md). Testele de integrare nu se rulează pe producție.

- [Configurare, setări și depanare](docs/OPERATIONS.md)
- [Arhitectură și securitate](docs/ARCHITECTURE.md)
- [Raport de capabilități față de GloriaFood](docs/CAPABILITIES.md)
- [Verificări executate și limite](docs/PROGRESS.md)
- [Istoric versiuni](CHANGELOG.md)

Licență GPL-2.0-or-later. Leaflet: BSD-2-Clause, licența inclusă în distribuție. Hărțile folosesc dale OpenStreetMap cu atribuire; nu se preîncarcă pentru utilizare offline.
