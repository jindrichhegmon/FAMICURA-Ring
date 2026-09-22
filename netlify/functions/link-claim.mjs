import {
  env,
  getTokenRecords,
  computeNonce,
  secureEqual,
  ringFetch,
  putTokenRecord,
  maskEmail
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
    const { nonce, time, password, email } = await req.json();

    if (!nonce || !time || !password) {
      return new Response(JSON.stringify({
        ok:false,
        error:"Chybí nonce, time nebo heslo."
      }), {
        status:400,
        headers:{ "content-type":"application/json" }
      });
    }

    if (!secureEqual(password, env("FAMICURA_LINK_PASSWORD"))) {
      return new Response(JSON.stringify({
        ok:false,
        error:"Nesprávné heslo Famicura."
      }), {
        status:401,
        headers:{ "content-type":"application/json" }
      });
    }

    const now = Date.now();
    const t = Number(time);

    if (!Number.isFinite(t)) {
      return new Response(JSON.stringify({
        ok:false,
        error:"Neplatný parametr time."
      }), {
        status:400,
        headers:{ "content-type":"application/json" }
      });
    }

    const delta = (now - t) / 1000;
    if (delta < 0 || delta > 600) {
      return new Response(JSON.stringify({
        ok:false,
        error:"Požadavek na propojení vypršel. Spusťte Connect z Ring znovu."
      }), {
        status:400,
        headers:{ "content-type":"application/json" }
      });
    }

    const records = (await getTokenRecords())
      .filter(r => r.status === "unclaimed");

    let matched = null;

    for (const rec of records) {
      const expected = computeNonce(String(time), rec.account_id);
      if (secureEqual(expected, nonce)) {
        matched = rec;
        break;
      }
    }

    if (!matched) {
      return new Response(JSON.stringify({
        ok:false,
        error:"Nenalezen odpovídající nevyzvednutý Ring token."
      }), {
        status:404,
        headers:{ "content-type":"application/json" }
      });
    }

    const accountIdentifier = maskEmail(
      email ||
      env("FAMICURA_USER_EMAIL", false) ||
      "user@famicura.local"
    );

    const postRes = await ringFetch(
      "/v1/accounts/me/app-integrations",
      matched.access_token,
      {
        method:"POST",
        body:JSON.stringify({
          account_identifier:accountIdentifier,
          nonce
        })
      }
    );

    if (!postRes.ok) {
      const txt = await postRes.text();
      console.error("app-integrations POST", postRes.status, txt);

      return new Response(JSON.stringify({
        ok:false,
        error:`Ring POST app-integrations selhal (${postRes.status}).`
      }), {
        status:502,
        headers:{ "content-type":"application/json" }
      });
    }

    const patchRes = await ringFetch(
      "/v1/accounts/me/app-integrations",
      matched.access_token,
      {
        method:"PATCH",
        body:JSON.stringify({ status:"completed" })
      }
    );

    if (!patchRes.ok) {
      const txt = await patchRes.text();
      console.error("app-integrations PATCH", patchRes.status, txt);

      return new Response(JSON.stringify({
        ok:false,
        error:`Ring PATCH app-integrations selhal (${patchRes.status}).`
      }), {
        status:502,
        headers:{ "content-type":"application/json" }
      });
    }

    matched.status = "linked";
    matched.partner_identifier = accountIdentifier;
    matched.linked_at = new Date().toISOString();
    matched.updated_at = matched.linked_at;

    await putTokenRecord(matched);

    return new Response(JSON.stringify({
      ok:true,
      linked:true,
      account_identifier:accountIdentifier
    }), {
      status:200,
      headers:{
        "content-type":"application/json",
        "cache-control":"no-store"
      }
    });

  } catch (e) {
    console.error("link-claim", e);

    return new Response(JSON.stringify({
      ok:false,
      error:e.message
    }), {
      status:500,
      headers:{ "content-type":"application/json" }
    });
  }
};
