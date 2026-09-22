import { hasSession, json, unauthorized, putDiag } from "./_ring.mjs";
import { buildInsert } from "./_clb.mjs";

/*
 * Forwards one row to the make.com webhook that writes into CLB1. The browser
 * never sees the webhook URL, and the SQL is built here rather than sent in.
 */
export default async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!hasSession(req)) return unauthorized();

  const url = process.env.CLB_WEBHOOK_URL;
  if (!url) {
    return json({ ok: false, configured: false,
                  error: "CLB_WEBHOOK_URL není nastavená." }, 503);
  }

  try {
    const row = await req.json();
    const built = buildInsert(row);
    if (!built.ok) return json({ ok: false, error: built.error }, 400);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.CLB_WEBHOOK_SECRET
          ? { "x-famicura-secret": process.env.CLB_WEBHOOK_SECRET } : {})
      },
      body: JSON.stringify({ sql: built.sql })
    });

    if (!res.ok) {
      const body = (await res.text()).slice(0, 500);
      console.error("clb webhook", res.status, body);
      await putDiag("clb-failed", { status: res.status, body });
      return json({ ok: false, error: `Zápis do CLB1 selhal (${res.status}).` }, 502);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("clb", e);
    await putDiag("clb-error", { error: e.message });
    return json({ ok: false, error: e.message }, 500);
  }
};
