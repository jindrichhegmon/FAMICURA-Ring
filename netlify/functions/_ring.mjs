import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

export const RING_API = "https://api.amazonvision.com";
export const RING_OAUTH = "https://oauth.ring.com/oauth/token";

export function env(name, required = true) {
  const value = process.env[name];
  if (required && !value) throw new Error(`Missing environment variable: ${name}`);
  return value || "";
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

export function verifyWebhook(rawBody, signatureHeader) {
  if (!signatureHeader) return false;
  const received = String(signatureHeader).replace(/^sha256=/i, "").trim();
  const expected = crypto
    .createHmac("sha256", env("RING_HMAC_KEY"))
    .update(Buffer.from(rawBody || "", "utf8"))
    .digest("hex");
  return secureEqual(expected, received);
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

export async function getRingMe(accessToken) {
  const response = await ringFetch("/v1/users/me", accessToken);
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  if (!response.ok) throw new Error(`GET /v1/users/me failed (${response.status})`);

  const accountId =
    payload?.meta?.account_id ||
    payload?.data?.attributes?.account_id ||
    payload?.data?.relationships?.account?.data?.id ||
    payload?.data?.id ||
    payload?.account_id ||
    payload?.id;

  if (!accountId) {
    const error = new Error("Could not find Ring account_id in /v1/users/me response");
    error.details = payload;
    throw error;
  }
  return { accountId, profile: payload };
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

function storeOptions() {
  return {
    siteID: env("NETLIFY_SITE_ID"),
    token: env("NETLIFY_AUTH_TOKEN")
  };
}

export function tokensStore() {
  return getStore("ring-tokens", storeOptions());
}

export function eventsStore() {
  return getStore("ring-events", storeOptions());
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
