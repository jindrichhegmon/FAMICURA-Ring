/**
 * HTTP vrstva (Request → Response), bez vazby na framework kvůli testům.
 *
 *   GET  /api/health   → verze webu a serveru
 *   GET  /api/diag     → připojení a počty řádků obou tabulek
 *   POST /api/clb      { typ: 'udalost' | 'nahravka', ... } → zápis do CLB1
 *
 * Stránka zůstává na Netlify; sem chodí jen to, co potřebuje SQL, protože
 * firewall CLB1 pouští pevnou IP adresu VPS. Přihlášení se ověřuje stejnou
 * cookie jako na Netlify – vlastní SQL z prohlížeče poslat nejde.
 */
import { prihlasen } from './session.mjs';
import * as zaznamy from './zaznamy.mjs';

// Na VPS běží vedle sebe víc aplikací za jedním Caddy. Když hostname spadne
// na sousední aplikaci, vrátí se její 404 a v prohlížeči to vypadá jako naše
// chyba. Každá odpověď proto říká, kdo ji napsal.
const APLIKACE = 'famicura-ring';

const CORS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Allow-Credentials': 'true',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });

export function createHandler({ dbs }) {
  return async function handle(req) {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '');
    const m = req.method.toUpperCase();

    try {
      if (m === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      if (m === 'GET' && path === '/api/health') {
        return json({ ok: true, aplikace: APLIKACE, cas: new Date().toISOString(),
          verze: process.env.APP_VERZE || '', commit: process.env.APP_COMMIT || '',
          vetev: process.env.APP_VETEV || '', nasazeno: process.env.APP_NASAZENO || '',
          spusteno: process.env.APP_SPUSTENO || '' });
      }

      if (m === 'GET' && path === '/api/diag') {
        if (!prihlasen(req.headers)) return json({ ok: false, chyba: 'Nepřihlášeno.' }, 401);
        return json({ ok: true, ...(await zaznamy.diagnostika(dbs)) });
      }

      if (m === 'POST' && path === '/api/clb') {
        if (!prihlasen(req.headers)) return json({ ok: false, error: 'Nepřihlášeno.' }, 401);

        let row;
        try { row = await req.json(); }
        catch { return json({ ok: false, error: 'Tělo požadavku musí být JSON.' }, 400); }

        const out = await zaznamy.zapsat(dbs, row);
        if (!out.ok) return json({ ok: false, error: out.chyba }, out.status || 400);
        return json({ ok: true });
      }

      return json({ ok: false, aplikace: APLIKACE, error: 'Neznámá adresa.' }, 404);
    } catch (e) {
      console.error('[famicura-ring]', e);
      return json({ ok: false, error: e.message || 'Chyba serveru' }, e.status || 500);
    }
  };
}
