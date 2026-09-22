import {
  RING_API,
  ensureFreshLinkedRecord,
  hasSession,
  json,
  putDiag,
  unauthorized
} from "./_ring.mjs";

// The Ring access token must never reach the browser, so the whole WHEP
// handshake is proxied: SDP offer in, SDP answer out.
export default async (req) => {
  if (!hasSession(req)) return unauthorized();

  if (req.method === "POST") return createSession(req);
  if (req.method === "DELETE") return closeSession(req);
  return json({ ok:false, error:"POST or DELETE required" }, 405);
};

async function createSession(req) {
  try {
    const { deviceId, sdpOffer } = await req.json();

    if (!deviceId) return json({ ok:false, error:"Chybí deviceId." }, 400);
    if (!sdpOffer) return json({ ok:false, error:"Chybí SDP offer." }, 400);

    const record = await ensureFreshLinkedRecord();
    if (!record) {
      return json({ ok:false, linked:false, error:"Ring účet zatím není propojen." }, 404);
    }

    const whepUrl =
      `${RING_API}/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions`;

    const res = await fetch(whepUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${record.access_token}`,
        "content-type": "application/sdp",
        accept: "application/sdp"
      },
      body: sdpOffer
    });

    const body = await res.text();

    if (!res.ok) {
      console.error("whep", res.status, body);
      await putDiag("whep-failed", { device_id: deviceId, status: res.status, body: body.slice(0, 2000) });
      return json({ ok:false, error:`Ring WHEP selhal (${res.status}).`, detail: body.slice(0, 500) }, 502);
    }

    // Location may be relative; resolve it and keep it on the Ring origin.
    const location = res.headers.get("location");
    let sessionUrl = null;
    if (location) {
      try {
        const resolved = new URL(location, RING_API);
        if (resolved.origin === new URL(RING_API).origin) sessionUrl = resolved.toString();
      } catch { /* leave sessionUrl null */ }
    }

    return json({ ok:true, sdpAnswer: body, sessionUrl });
  } catch (e) {
    console.error("stream create", e);
    await putDiag("whep-error", { error: e.message });
    return json({ ok:false, error:e.message }, 500);
  }
}

async function closeSession(req) {
  try {
    const { sessionUrl } = await req.json();
    if (!sessionUrl) return json({ ok:false, error:"Chybí sessionUrl." }, 400);

    // Only ever call back into the Ring API with our bearer token.
    let target;
    try {
      target = new URL(sessionUrl);
    } catch {
      return json({ ok:false, error:"Neplatná sessionUrl." }, 400);
    }
    if (target.origin !== new URL(RING_API).origin) {
      return json({ ok:false, error:"sessionUrl mimo Ring API." }, 400);
    }

    const record = await ensureFreshLinkedRecord();
    if (!record) return json({ ok:false, error:"Ring účet není propojen." }, 404);

    const res = await fetch(target.toString(), {
      method: "DELETE",
      headers: { authorization: `Bearer ${record.access_token}` }
    });

    return json({ ok: res.ok, status: res.status });
  } catch (e) {
    console.error("stream close", e);
    return json({ ok:false, error:e.message }, 500);
  }
}
