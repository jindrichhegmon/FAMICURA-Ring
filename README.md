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
