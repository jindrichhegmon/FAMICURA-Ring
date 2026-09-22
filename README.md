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
