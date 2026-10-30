# Raport capabilități — 0.0.1

Referințe verificate: [pluginul oficial GloriaFood](https://wordpress.org/plugins/menu-ordering-reservations/) și [prezentarea oficială WordPress](https://www.gloriafood.com/wordpress-restaurant-plugin). Raportul descrie ce implementează acest plugin; nu susține paritate completă cu toate serviciile GloriaFood.

| Capabilitate | ZionFood WordPress 0.0.1 |
|---|---|
| Cinci tipuri de integrare în pagină | Meniu, comandă, rezervări, program, promoții; blocuri și shortcode-uri |
| Configurare conexiune | O cheie pentru conexiunea/locațiile autorizate, host fix, verificare înainte de salvare |
| Meniu și fotografii | Afișare nativă, căutare, categorii, grilă/listă și locații multiple |
| Dimensiuni/extraopțiuni | Variante, grupuri pe categorie/produs/variantă, selecții implicite, min/max, cantități |
| Date alimentare | Ingrediente, porție, alergeni/urme, etichete alimentare, proveniență congelată și nutriție publicată, inclusiv indicator estimativ |
| Traduceri | UI RO/EN; nume/descrieri/ingrediente traduse când sunt publicate. Unele denumiri de categorii/opțiuni rămân cele din catalog |
| Ridicare/livrare | Coș, quote, checkout, adrese, zone poștale/poligoane și taxe validate pe server |
| Comenzi viitoare | Sloturi și programare când serviciul ZionFood este activ |
| Rezervări/precomandă | Sloturi, creare, confirmare consultabilă, anulare cu versiune și precomandă la rezervare confirmată |
| QR la masă | Join cu token QR valid, disponibilitate și comenzi active; emiterea QR către WordPress nu este automatizată |
| Promoții | Afișare, coduri și aplicarea tipurilor ZionFood: procent, valoare fixă, livrare gratuită, buy-X-get-Y. Nu toate șabloanele GloriaFood |
| Urmărire comandă | Confirmare privată și polling; nu există push WebSocket în acest plugin |
| Personalizare | 22 setări funcționale pentru locații, afișare, limbi, CTA, cache, memorare și diagnosticare |
| Operare restaurant | Meniuri/staff/KDS se administrează în ZionFood; WordPress oferă link către panou |
| Plăți online | Placeholder: fără procesare sau colectare de date bancare |
| Marketing/mobile/imprimare | În afara acestei versiuni |
| Migrare GloriaFood | Fluxul Migration Center aparține aplicației ZionFood; acest plugin consumă catalogul deja publicat |

Setările de program, capacitate, reduceri, zone și produse nu sunt duplicate în WordPress. Pluginul preia datele și aplică prezentarea proprie, iar backendul ZionFood impune regulile. Acest lucru evită divergența între site și operațiunile restaurantului.
