import {
  exchangeAuthorizationCode,
  getRingMe,
  putTokenRecord
} from "./_ring.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      ok:false,
      error:"POST required"
    }), {
      status:405,
      headers:{ "content-type":"application/json" }
    });
  }

  try {
    const raw = await req.text();
    const ct = req.headers.get("content-type") || "";

    let data = {};
    try {
      data = ct.includes("json")
        ? JSON.parse(raw || "{}")
        : Object.fromEntries(new URLSearchParams(raw));
    } catch {}

    const url = new URL(req.url);
    const code =
      data.code ||
      data.authorization_code ||
      data.authorizationCode ||
      url.searchParams.get("code");

    if (!code) {
      return new Response(JSON.stringify({
        ok:false,
        error:"Missing authorization code"
      }), {
        status:400,
        headers:{ "content-type":"application/json" }
      });
    }

    const tokens = await exchangeAuthorizationCode(code);
    const { accountId } = await getRingMe(tokens.access_token);

    const now = Date.now();

    await putTokenRecord({
      account_id: accountId,
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

    return new Response(JSON.stringify({ ok:true }), {
      status:200,
      headers:{
        "content-type":"application/json",
        "cache-control":"no-store"
      }
    });

  } catch (e) {
    console.error("token-exchange", e, e?.details || "");
    return new Response(JSON.stringify({
      ok:false,
      error:e.message
    }), {
      status:500,
      headers:{ "content-type":"application/json" }
    });
  }
};
