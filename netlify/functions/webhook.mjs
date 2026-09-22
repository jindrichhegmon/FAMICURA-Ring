import crypto from "node:crypto";
import { verifyWebhook, eventsStore, putDiag, json } from "./_ring.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ ok:false, error:"POST required" }, 405);

  try {
    const raw = await req.text();
    const result = verifyWebhook(raw, req.headers);

    if (!result.ok) {
      // Record the header names we did receive (never their values) so a
      // mismatched signature header is visible in /api/events.
      await putDiag("webhook-rejected", {
        signature_headers_present: result.seen,
        all_header_names: [...req.headers.keys()],
        body_bytes: raw.length
      });
      return json({ ok:false, error:"Invalid Ring webhook signature" }, 401);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ ok:false, error:"Invalid JSON" }, 400);
    }

    const requestId = payload?.meta?.request_id || crypto.randomUUID();

    await eventsStore().setJSON(`event-${Date.now()}-${requestId}`, {
      received_at: new Date().toISOString(),
      signature_header: result.header,
      payload
    });

    return json({ ok:true });
  } catch (e) {
    console.error("webhook", e);
    await putDiag("webhook-error", { error: e.message });
    return json({ ok:false, error:e.message }, 500);
  }
};
