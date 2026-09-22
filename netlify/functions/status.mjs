import {
  getLinkedRecord,
  getTokenRecords,
  hasEnv,
  hasSession,
  json
} from "./_ring.mjs";

const REQUIRED_ENV = [
  "RING_CLIENT_ID",
  "RING_CLIENT_SECRET",
  "RING_HMAC_KEY",
  "FAMICURA_LINK_PASSWORD",
  "NETLIFY_SITE_ID",
  "NETLIFY_AUTH_TOKEN"
];

export default async (req) => {
  // Reports presence of configuration, never its values.
  const environment = Object.fromEntries(REQUIRED_ENV.map((n) => [n, hasEnv(n)]));
  const missing = REQUIRED_ENV.filter((n) => !environment[n]);

  if (!hasSession(req)) {
    return json({ ok:true, authenticated:false, environment, missing });
  }

  try {
    const records = await getTokenRecords();
    const linked = await getLinkedRecord();

    return json({
      ok: true,
      authenticated: true,
      linked: !!linked,
      account_id: linked?.account_id || null,
      account_id_source: linked?.account_id_source || null,
      linked_at: linked?.linked_at || null,
      token_expires_at: linked?.expires_at
        ? new Date(linked.expires_at).toISOString()
        : null,
      unclaimed_tokens: records.filter((r) => r.status === "unclaimed").length,
      total_tokens: records.length,
      environment,
      missing,
      blobs: "reachable"
    });
  } catch (e) {
    console.error("status", e);
    return json({
      ok: false,
      authenticated: true,
      error: e.message,
      environment,
      missing,
      blobs: "unreachable"
    }, 500);
  }
};
