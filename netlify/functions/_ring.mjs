import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

export const RING_API = "https://api.amazonvision.com";
export const RING_OAUTH = "https://oauth.ring.com/oauth/token";

export function env(name, required = true) {
  const value = process.env[name];
  if (required && !value) throw new Error(`Missing environment variable: ${name}`);
  return value || "";
}

export function hasEnv(name) {
  return Boolean(process.env[name]);
}

export function secureEqual(a, b) {
  const aa = Buffer.from(String(a ?? ""));
  const bb = Buffer.from(String(b ?? ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

export function computeNonce(time, accountId) {
  return crypto
    .createHmac("sha256", env("RING_HMAC_KEY"))
    .update(`${time}:${accountId}`, "utf8")
    .digest("base64url");
}

// Ring may label the signature header differently across environments, so we
// try every plausible name and report which ones actually arrived.
export const SIGNATURE_HEADERS = [
  "x-signature",
  "x-ring-signature",
  "ring-signature",
  "x-hub-signature-256",
  "x-amz-signature",
  "signature"
];

function hmacHex(rawBody) {
  return crypto
    .createHmac("sha256", env("RING_HMAC_KEY"))
    .update(Buffer.from(rawBody || "", "utf8"))
    .digest("hex");
}

export function verifyWebhook(rawBody, headers) {
  const expected = hmacHex(rawBody);
  const seen = [];

  for (const name of SIGNATURE_HEADERS) {
    const raw = headers.get(name);
    if (!raw) continue;
    seen.push(name);
    const received = String(raw).replace(/^sha256=/i, "").trim();
    if (secureEqual(expected, received)) return { ok: true, header: name, seen };
  }

  return { ok: false, header: null, seen };
}

export async function ringFetch(path, accessToken, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("authorization", `Bearer ${accessToken}`);
  if (options.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(`${RING_API}${path}`, { ...options, headers });
}

export async function exchangeAuthorizationCode(code) {
  const response = await fetch(RING_OAUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env("RING_CLIENT_ID"),
      client_secret: env("RING_CLIENT_SECRET")
    })
  });

  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) {
    const error = new Error(`Ring token exchange failed (${response.status})`);
    error.details = payload;
    throw error;
  }
  return payload;
}

// The nonce is HMAC(key, "<time>:<account_id>"), so picking the wrong field
// here makes every link attempt fail with a misleading "no token" error.
// We keep the whole resolution trail for /api/events.
export async function getRingMe(accessToken) {
  const response = await ringFetch("/v1/users/me", accessToken);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`GET /v1/users/me failed (${response.status})`);

  const candidates = {
    "meta.account_id": payload?.meta?.account_id,
    "data.attributes.account_id": payload?.data?.attributes?.account_id,
    "data.relationships.account.data.id": payload?.data?.relationships?.account?.data?.id,
    "data.id": payload?.data?.id,
    "account_id": payload?.account_id,
    "id": payload?.id
  };

  const source = Object.keys(candidates).find((key) => candidates[key]);
  const accountId = source ? candidates[source] : null;

  if (!accountId) {
    const error = new Error("Could not find Ring account_id in /v1/users/me response");
    error.details = payload;
    throw error;
  }

  return { accountId, source, candidates, profile: payload };
}

export async function refreshTokens(record) {
  const response = await fetch(RING_OAUTH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: record.refresh_token,
      client_id: env("RING_CLIENT_ID"),
      client_secret: env("RING_CLIENT_SECRET")
    })
  });

  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`Ring token refresh failed (${response.status})`);

  const now = Date.now();
  return {
    ...record,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || record.refresh_token,
    token_type: payload.token_type || record.token_type || "Bearer",
    scope: payload.scope || record.scope || "",
    expires_in: payload.expires_in || 14400,
    expires_at: now + (payload.expires_in || 14400) * 1000,
    updated_at: new Date(now).toISOString()
  };
}

// Blob listing is eventually consistent by default, which loses the token
// that token-exchange wrote moments earlier. Strong consistency is required
// for the nonce match to find it.
function storeOptions() {
  return {
    siteID: env("NETLIFY_SITE_ID"),
    token: env("NETLIFY_AUTH_TOKEN"),
    consistency: "strong"
  };
}

export function tokensStore() {
  return getStore("ring-tokens", storeOptions());
}

export function eventsStore() {
  return getStore("ring-events", storeOptions());
}

export function schedulesStore() {
  return getStore("ring-schedules", storeOptions());
}

export function watchStore() {
  return getStore("ring-watch", storeOptions());
}

export async function putDiag(kind, data) {
  try {
    await eventsStore().setJSON(`diag-${Date.now()}-${kind}`, {
      kind,
      at: new Date().toISOString(),
      ...data
    });
  } catch (error) {
    console.error("putDiag", kind, error);
  }
}

export async function getTokenRecords() {
  const store = tokensStore();
  const result = await store.list({ prefix: "token-" });
  const records = [];
  for (const blob of result.blobs || []) {
    try {
      const record = await store.get(blob.key, { type: "json" });
      if (record) records.push(record);
    } catch (error) {
      console.error("Unable to read token record", blob.key, error);
    }
  }
  return records;
}

export async function putTokenRecord(record) {
  await tokensStore().setJSON(`token-${record.account_id}`, record);
}

export async function deleteTokenRecord(accountId) {
  try {
    await tokensStore().delete(`token-${accountId}`);
  } catch (error) {
    console.error("Unable to delete token record", accountId, error);
  }
}

// Every id /v1/users/me offered, so nonce matching can try them all instead of
// betting on one field.
export function accountIdCandidates(record) {
  if (Array.isArray(record.account_id_candidates) && record.account_id_candidates.length) {
    return record.account_id_candidates;
  }
  return [{ source: record.account_id_source || "account_id", id: record.account_id }];
}

export async function getLinkedRecord() {
  const records = await getTokenRecords();
  return records
    .filter((record) => record.status === "linked")
    .sort((a, b) =>
      String(b.updated_at || b.created_at || "").localeCompare(
        String(a.updated_at || a.created_at || "")
      )
    )[0] || null;
}

export async function ensureFreshLinkedRecord() {
  let record = await getLinkedRecord();
  if (!record) return null;

  if (!record.expires_at || Date.now() > record.expires_at - 5 * 60 * 1000) {
    record = await refreshTokens(record);
    await putTokenRecord(record);
  }
  return record;
}

export function maskEmail(email) {
  const value = String(email || "user@famicura.local");
  const [name = "user", domain = "famicura.local"] = value.split("@");
  if (name.length <= 2) return `${name[0] || "u"}*@${domain}`;
  return `${name[0]}***${name[name.length - 1]}@${domain}`;
}

/* ---------- Browser session ---------- */

const SESSION_COOKIE = "fam_sess";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function signSession(expiresAt) {
  return crypto
    .createHmac("sha256", env("RING_HMAC_KEY"))
    .update(`famicura-session:${expiresAt}`, "utf8")
    .digest("base64url");
}

export function sessionCookie() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const value = `${expiresAt}.${signSession(expiresAt)}`;
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function hasSession(req) {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;

  const [expiresAt, signature] = decodeURIComponent(match[1]).split(".");
  if (!expiresAt || !signature) return false;
  if (!Number.isFinite(Number(expiresAt)) || Date.now() > Number(expiresAt)) return false;

  return secureEqual(signSession(expiresAt), signature);
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders
    }
  });
}

export function unauthorized() {
  return json({ ok: false, error: "Přihlaste se heslem Famicura." }, 401);
}
