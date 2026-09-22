import {
  exchangeAuthorizationCode,
  getRingMe,
  putTokenRecord,
  putDiag,
  json
} from "./_ring.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    await putDiag("exchange-bad-method", {
      method: req.method,
      query: [...new URL(req.url).searchParams.keys()]
    });
    return json({ ok:false, error:"POST required" }, 405);
  }

  try {
    const raw = await req.text();
    const contentType = req.headers.get("content-type") || "";

    let data = {};
    try {
      data = contentType.includes("json")
        ? JSON.parse(raw || "{}")
        : Object.fromEntries(new URLSearchParams(raw));
    } catch { /* fall through to the query string */ }

    const url = new URL(req.url);
    const code =
      data.code ||
      data.authorization_code ||
      data.authorizationCode ||
      url.searchParams.get("code");

    if (!code) {
      await putDiag("exchange-no-code", { content_type: contentType, keys: Object.keys(data) });
      return json({ ok:false, error:"Missing authorization code" }, 400);
    }

    const tokens = await exchangeAuthorizationCode(code);
    const { accountId, source, candidates } = await getRingMe(tokens.access_token);

    const candidateList = Object.entries(candidates)
      .filter(([, id]) => id)
      .map(([candidateSource, id]) => ({ source: candidateSource, id: String(id) }))
      .filter((c, i, all) => all.findIndex((o) => o.id === c.id) === i);

    // Which field the account_id came from decides whether nonce matching can
    // ever succeed, so record it.
    await putDiag("exchange-ok", {
      account_id: accountId,
      account_id_source: source,
      candidates_present: Object.keys(candidates).filter((k) => candidates[k])
    });

    const now = Date.now();

    await putTokenRecord({
      account_id: accountId,
      account_id_source: source,
      account_id_candidates: candidateList,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type || "Bearer",
      scope: tokens.scope || "",
      expires_in: tokens.expires_in || 14400,
      expires_at: now + (tokens.expires_in || 14400) * 1000,
      status: "unclaimed",
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString()
    });

    return json({ ok:true });
  } catch (e) {
    console.error("token-exchange", e, e?.details || "");
    await putDiag("exchange-failed", { error: e.message, details: e?.details || null });
    return json({ ok:false, error:e.message }, 500);
  }
};
