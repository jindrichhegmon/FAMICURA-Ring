# Famicura Ring

Private test integration Ring -> Famicura on Netlify.

## Ring URLs after deployment
- Account Link URL: `https://YOUR-SITE.netlify.app/link`
- App Homepage URL: `https://YOUR-SITE.netlify.app/`
- Token Exchange URL: `https://YOUR-SITE.netlify.app/api/token-exchange`
- Webhook URL: `https://YOUR-SITE.netlify.app/api/webhook`

## Netlify Environment Variables
Set `RING_CLIENT_ID`, `RING_CLIENT_SECRET`, `RING_HMAC_KEY`, `FAMICURA_LINK_PASSWORD`, optionally `FAMICURA_USER_EMAIL`.

Never commit real secrets. Tokens are stored server-side in Netlify Blobs and are never sent to the browser.

This test build implements Ring-driven one-way account linking, token refresh, HMAC nonce matching, webhook HMAC verification and device discovery.


## v2 fix
All Netlify Functions use only the modern `export default` Functions v2 syntax so Netlify Blobs can receive its runtime context automatically.


## v3 - explicit Netlify Blobs authentication

This version intentionally does not rely on implicit Netlify Blobs runtime context.

Add these two additional Netlify Environment Variables:

- `NETLIFY_SITE_ID` = Project ID from Netlify -> Project configuration -> General -> Project information
- `NETLIFY_AUTH_TOKEN` = a Netlify Personal Access Token created under User settings -> Applications -> Personal access tokens

The token must be treated as a secret and must never be committed to GitHub.

## v4 - diagnostika a WHEP live stream

### Co přibylo

**Živý obraz z kamer.** Nová funkce `/api/stream` proxuje WHEP handshake proti
`POST https://api.amazonvision.com/v1/devices/{deviceId}/media/streaming/whep/sessions`.
Prohlížeč pošle SDP offer, funkce ho podepíše Ring access tokenem a vrátí SDP answer;
access token se do prohlížeče nikdy nedostane. `DELETE /api/stream` ukončí session
(cíl je omezen na origin Ring API). Homepage nabídne seznam kamer a přehrává obraz
přes `RTCPeerConnection`.

**Silná konzistence Netlify Blobs.** `getStore` nově používá `consistency: "strong"`.
Výpis blobů je jinak eventuálně konzistentní, takže `link-claim` nemuselo vidět token,
který `token-exchange` zapsalo o vteřinu dřív. `link-claim` navíc zkouší match 4x
s odstupem 800 ms.

**Diagnostika.** `/api/status` hlásí, které proměnné prostředí chybí (nikdy jejich
hodnoty), dostupnost Blobs, počet nevyzvednutých tokenů a z jakého pole se vzalo
`account_id`. `/api/events` vypisuje uložené webhooky i diagnostické záznamy
(`diag-*`) - včetně toho, jaké hlavičky přišly u odmítnutého webhooku.

**Webhook podpis.** Ověřuje se proti několika možným názvům hlavičky
(`x-signature`, `x-ring-signature`, `x-hub-signature-256`, ...). Když žádná nesedne,
do logu se uloží seznam přijatých hlaviček, aby šlo zjistit, jak se signatura jmenuje.

**Autentizace.** `/api/devices`, `/api/status`, `/api/events` a `/api/stream` nově
vyžadují session cookie podepsanou `RING_HMAC_KEY`. Získáte ji přes `/api/login`
heslem `FAMICURA_LINK_PASSWORD`, nebo automaticky po úspěšném propojení na `/link`.
Ring endpointy (`/api/token-exchange`, `/api/webhook`, `/api/link-claim`) zůstávají
veřejné - Ring je volá bez cookie.

### Ladění propojení

Přihlaste se na homepage a podívejte se do sekce Diagnostika a Log:

- *chybí proměnné* - doplňte je v Netlify, jinak každá funkce vrací 500
- *Nevyzvednuté tokeny = 0* - Ring nezavolal Token Exchange URL, hledejte `exchange-*` v logu
- *nonce neodpovídá* - ověřte `RING_HMAC_KEY` a `account_id_source` v záznamu `exchange-ok`
- *webhook-rejected* - v záznamu je seznam hlaviček, které Ring skutečně poslal

## v5 - zobrazení, nahrávání a živá analýza

Funkce převzaté z prototypu Famicura Fall Analyzer a napojené na Ring stream
místo na kameru telefonu. Veškeré zpracování běží v prohlížeči - obraz se
nikam neodesílá.

### Zobrazení

Tři režimy nad živým obrazem:

- **Normální** - obraz tak, jak ho posílá Ring. Zobrazuje se přímo `<video>`,
  takže zůstává nativní ovládání a nejnižší zátěž procesoru.
- **Rozmazaný** - snímek se zmenší na ~48 px na šířku, odbarví a zvětší zpět
  bez vyhlazení. Detaily tím zaniknou, nejen změknou.
- **Černé pozadí** - jen kostra postavy na černé ploše.

Canvas se zapíná pouze když je potřeba (jiný než normální režim, nahrávání
nebo analýza); jinak by zbytečně vytěžoval telefon.

### Nahrávání

Start/stop nad `canvas.captureStream(30)` a `MediaRecorder`. Nahrává se to, co
je vidět - včetně anonymizace a kostry. Po zastavení se nabídne uložení a
sdílení (Web Share API, jinak stažení). Preferuje se `video/mp4`, jinak WebM.

### Živá analýza

Start/stop. Po spuštění se stáhne MediaPipe PoseLandmarker a do logu se
průběžně píše, co se v obraze děje - ne až na konci záznamu.

Log hlásí:

- změnu polohy (stojí / sedí / leží / mění polohu), pokud trvá aspoň 1 s
- **možný pád** s mírou podezření a důvody (rychlý pohyb kyčlí dolů, prudká
  změna orientace trupu, předchozí vzpřímená poloha, následné ležení)
- **dlouhé ležení** nad 6 s
- **ztrátu detekce postavy** nad 2 s a její návrat
- **prudkou změnu polohy těla**

Detekční pravidla a prahy jsou převzaté z prototypu beze změny, jen přepsané
ze zpětné analýzy na průběžný stavový automat (`public/analyzer.js`).

**Omezení:** analýza vychází z 2D polohy kloubů. Hluboce předkloněná postava,
která má nohy na zemi, může vyjít jako ležící - těžiště ohraničujícího
obdélníku klesne pod práh. Výstup slouží k rychlé kontrole záznamu, ne jako
zdravotnické vyhodnocení.

## v6 - hlídač zamrznutí a export logu

### Proč se obraz zasekával

Ring live session nemá neomezenou délku a telefon ztratí peer connection při
změně sítě nebo odchodu na pozadí. Oboje selhává tiše: obraz zůstane na
posledním snímku, `connectionState` dál hlásí `connected` a nic to nepozná.
Analýza pak přestane dostávat snímky a log se zastaví.

Řešení je hlídač, který každé 2 s vzorkuje `video.currentTime`. Když se
7 s nepohne, spojení se považuje za mrtvé a naváže se znovu - stejná kamera,
exponenciální odstup 1-15 s, nejvýše 8 pokusů. Pak se ukáže tlačítko
**Připojit znovu**. Vzorkování času nezávisí na žádné události, takže funguje
i v normálním režimu, kde neběží canvas.

Navíc:

- `connectionstatechange` na `failed` spustí obnovení okamžitě; `disconnected`
  se jen zobrazí, protože se často spraví samo a jinak ho chytí hlídač
- odchod na pozadí (`pagehide`, `visibilitychange`) uvolní Ring session, návrat
  ji obnoví - kamera neběží, když se nikdo nedívá. Během nahrávání se
  neuvolňuje, aby se záznam nepřerušil
- každé připojení si drží referenci na svoje `RTCPeerConnection`, takže
  opožděná odpověď ze starého pokusu nepřepíše nový stream
- po obnovení dostane analyzátor `notePause()`. Rychlost pohybu se počítá
  z předchozího snímku, takže bez toho by mezera vyrobila falešný pád

### Log analýzy

Každý řádek nese **reálný čas** (hh:mm:ss), čas od začátku analýzy a **název
kamery**, ze které událost pochází.

Pod logem je **Stáhnout log**: datum od-do a čas od-do, prázdná pole znamenají
bez omezení. Výstup je CSV se středníkem a BOM (české Excel ho otevře i s
diakritikou) se sloupci Datum, Čas, Od začátku analýzy, Kamera, ID kamery,
Typ, Závažnost, Popis. Název souboru obsahuje zvolené období.

V paměti se drží až 5000 záznamů, seznam na stránce zobrazuje posledních 200 -
export ale pracuje s celou historií.

## v7 - seznam nebo dlaždice, barvy a ikony

- Kamery lze zobrazit jako **seznam** nebo **dlaždice**. Obě zobrazení sdílejí
  stejné HTML, liší se jen třída kontejneru. Volba se pamatuje v `localStorage`
  tohoto prohlížeče (čtení i zápis v try/catch - v anonymním okně může selhat).
- **Živý obraz** je zelené, **Ukončit** červené a přesunuté dolů do lišty
  s tlačítky Uložit video a Sdílet.
- **Zvuk** je ikona reproduktoru, která přepíná mezi ztlumeno a zapnuto;
  stav nese `aria-label` a `title`, protože tlačítko nemá text.

Pozn.: `.hide` má `!important`. Utility třída jinak prohrává s pravidlem
stejné váhy definovaným později (`.seg`) i s pravidlem na id (`#saveLink`) -
obojí by znamenalo, že se prvek vůbec neskryje.

## v8 - stream končí jen na povel uživatele

Hlášení: po nahrání a uložení videa se stream sám ukončil.

Tři změny, všechny směrem k „stream skončí, až když ho ukončím":

**Video se už nikdy neschovává přes `display:none`.** Dřív se při rozmazaném
a černém režimu a při nahrávání video skrylo a ukázal se canvas. Jenže
nevykreslované video může prohlížeč přestat dekódovat - a pak zamrzne obraz,
ze kterého canvas kreslí, i `currentTime`, podle kterého hlídač pozná zamrznutí.
Canvas se teď vykresluje **nad** videem (`z-index`), video zůstává celou dobu
živé. Tohle je pravděpodobně i příčina dřívějšího náhodného zasekávání.

**Skrytí stránky stream neukončí.** Safari hlásí stránku jako skrytou i při
věcech, které uživatel za odchod nepovažuje - stahovací nebo sdílecí panel,
zamčená obrazovka. Návrat na stránku už jen oživí spojení, které shodil sám
prohlížeč. Cena: při odchodu zůstává Ring session otevřená.

**Ukončit reaguje jen na skutečný klik** (`event.isTrusted`), takže stream
nemůže ukončit žádný kód.

Poznámka: v Chromiu se původní chyba nereprodukovala - při stažení souboru
nepřišla žádná lifecycle událost a stream přežil. Příčina je tedy specifická
pro Safari a opravy míří na mechanismy, které ji tam mohou způsobit.

## v9 - čistší výběr kamery

- Název kamery je větší, tučný a v plné barvě. `#devices` si drží třídu
  `.muted` kvůli zástupnému textu, takže název si barvu určuje sám, jinak by
  ji zdědil šedou.
- Technický řádek s `ava1.ring.device.…` a typem zařízení je pryč. ID zůstává
  ve sloupci exportu logu; na kartě nemá `title`, protože z něj byl při
  najetí myší přes půl obrazovky velký tooltip.
- **Offline** zůstává jako odznak - rozhoduje o tom, jestli z kamery něco
  poteče.
- Místo textu *Živý obraz* je tlačítko s ikonou kamery v bledě modré. Bledé
  pozadí neunese bílou ikonu, takže ikona je tmavě modrá (kontrast 7,5:1)
  a jemný okraj drží tvar tlačítka proti bílé kartě. Popisek nese
  `aria-label` („Živý obraz – název kamery") a `title`.

## v10 - dlaždice

Tlačítko kamery je v dlaždicích na celou šířku a název je vycentrovaný.
`grid-auto-rows:1fr` drží všechny dlaždice stejně vysoké, takže dvouřádkový
název v jednom řádku nerozhází mřížku.
