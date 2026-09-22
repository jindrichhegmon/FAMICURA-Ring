# Nasazení

1. Vytvořte privátní GitHub repository `FAMICURA-Ring` a nahrajte obsah této složky.
2. Netlify -> Add new project -> Import existing project -> GitHub.
3. Publish directory: `public`; Functions directory: `netlify/functions`.
4. V Netlify Environment variables nastavte: `RING_CLIENT_ID`, `RING_CLIENT_SECRET`, `RING_HMAC_KEY`, `FAMICURA_LINK_PASSWORD`, volitelně `FAMICURA_USER_EMAIL`.
5. Po deployi získejte hostname, např. `https://famicura-ring.netlify.app`.
6. V Ring Developer Portal nastavte:
   - Account Link URL: `https://HOST/link`
   - App Homepage URL: `https://HOST/`
   - Token Exchange URL: `https://HOST/api/token-exchange`
   - Webhook URL: `https://HOST/api/webhook`
7. V Ring otevřete Connect a připojte svůj Ring účet.
8. Po přesměrování na `/link` zadejte testovací e-mail a `FAMICURA_LINK_PASSWORD`.
9. Na homepage klikněte Načíst zařízení.

Důležité: Client Secret a HMAC key nikdy nedávejte do GitHubu ani HTML.

## v4 - po nasazení

10. Otevřete homepage a přihlaste se heslem `FAMICURA_LINK_PASSWORD`.
11. Sekce **Diagnostika** musí hlásit `Konfigurace: kompletní` a `Netlify Blobs: dostupné`.
    Pokud ne, doplňte chybějící proměnné (včetně `NETLIFY_SITE_ID` a `NETLIFY_AUTH_TOKEN`).
12. Klikněte **Načíst zařízení** a u kamery **Živý obraz**.
13. Když něco selže, klikněte **Načíst log** - `/api/events` ukáže poslední
    diagnostické záznamy (`exchange-*`, `link-*`, `whep-*`, `webhook-rejected`).
