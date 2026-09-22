import {
  ensureFreshLinkedRecord,
  hasSession,
  json,
  putDiag,
  ringFetch,
  unauthorized
} from "./_ring.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ ok:false, error:"GET required" }, 405);
  if (!hasSession(req)) return unauthorized();

  try {
    const record = await ensureFreshLinkedRecord();

    if (!record) {
      return json({ ok:false, linked:false, error:"Ring účet zatím není propojen." }, 404);
    }

    const res = await ringFetch("/v1/devices", record.access_token);
    const text = await res.text();

    let payload;
    try { payload = JSON.parse(text); } catch { payload = { raw:text }; }

    if (!res.ok) {
      console.error("devices", res.status, payload);
      await putDiag("devices-failed", { status: res.status, body: text.slice(0, 2000) });
      return json({ ok:false, error:`Ring devices API: ${res.status}`, detail: payload }, res.status);
    }

    // JSON:API -> flat list the UI can render and stream from.
    const devices = (payload?.data || []).map((device) => ({
      id: device.id,
      name: device.attributes?.name || device.attributes?.description || "Ring zařízení",
      kind: device.attributes?.kind || device.type || null,
      online: device.attributes?.online ?? null
    }));

    return json({ ok:true, linked:true, devices, raw: payload });
  } catch (e) {
    console.error("devices", e);
    return json({ ok:false, error:e.message }, 500);
  }
};
