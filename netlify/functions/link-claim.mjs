import {
  env,
  getTokenRecords,
  computeNonce,
  secureEqual,
  ringFetch,
  putTokenRecord,
  putDiag,
  maskEmail,
  sessionCookie,
  json
} from "./_ring.mjs";

const MATCH_ATTEMPTS = 4;
const MATCH_DELAY_MS = 800;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async (req) => {
  if (req.method !== "POST") return json({ ok:false, error:"POST required" }, 405);

  try {
    const { nonce, time, password, email } = await req.json();

    if (!nonce || !time || !password) {
      return json({ ok:false, error:"Chybí nonce, time nebo heslo." }, 400);
    }

    // Certification requires the user to authenticate before any nonce match.
    if (!secureEqual(password, env("FAMICURA_LINK_PASSWORD"))) {
      return json({ ok:false, error:"Nesprávné heslo Famicura." }, 401);
    }

    const t = Number(time);
    if (!Number.isFinite(t)) {
      return json({ ok:false, error:"Neplatný parametr time." }, 400);
    }

    const delta = (Date.now() - t) / 1000;
    if (delta < 0 || delta > 600) {
      await putDiag("link-expired", { time, delta_seconds: Math.round(delta) });
      return json({
        ok:false,
        error:`Požadavek na propojení vypršel (stáří ${Math.round(delta)} s, limit 600 s). Spusťte Connect z Ring znovu.`
      }, 400);
    }

    // Ring calls our Token Exchange URL and redirects the browser in parallel,
    // so the unclaimed token can land a moment after this request starts.
    let matched = null;
    let inspected = 0;

    for (let attempt = 1; attempt <= MATCH_ATTEMPTS && !matched; attempt++) {
      if (attempt > 1) await sleep(MATCH_DELAY_MS);

      const records = (await getTokenRecords()).filter((r) => r.status === "unclaimed");
      inspected = records.length;

      for (const record of records) {
        if (secureEqual(computeNonce(String(time), record.account_id), nonce)) {
          matched = record;
          break;
        }
      }
    }

    if (!matched) {
      await putDiag("link-no-match", {
        unclaimed_inspected: inspected,
        attempts: MATCH_ATTEMPTS,
        time
      });
      return json({
        ok:false,
        error: inspected === 0
          ? "Ring zatím nedoručil žádný nevyzvednutý token (Token Exchange URL neproběhlo). Zkuste Connect znovu."
          : `Nonce neodpovídá žádnému z ${inspected} nevyzvednutých tokenů. Zkontrolujte RING_HMAC_KEY a account_id.`
      }, 404);
    }

    const accountIdentifier = maskEmail(
      email || env("FAMICURA_USER_EMAIL", false) || "user@famicura.local"
    );

    const postRes = await ringFetch("/v1/accounts/me/app-integrations", matched.access_token, {
      method:"POST",
      body: JSON.stringify({ account_identifier: accountIdentifier, nonce })
    });

    if (!postRes.ok) {
      const body = await postRes.text();
      console.error("app-integrations POST", postRes.status, body);
      await putDiag("link-post-failed", { status: postRes.status, body: body.slice(0, 2000) });
      return json({ ok:false, error:`Ring POST app-integrations selhal (${postRes.status}).` }, 502);
    }

    const patchRes = await ringFetch("/v1/accounts/me/app-integrations", matched.access_token, {
      method:"PATCH",
      body: JSON.stringify({ account_identifier: accountIdentifier, status:"completed" })
    });

    if (!patchRes.ok) {
      const body = await patchRes.text();
      console.error("app-integrations PATCH", patchRes.status, body);
      await putDiag("link-patch-failed", { status: patchRes.status, body: body.slice(0, 2000) });
      return json({ ok:false, error:`Ring PATCH app-integrations selhal (${patchRes.status}).` }, 502);
    }

    matched.status = "linked";
    matched.partner_identifier = accountIdentifier;
    matched.linked_at = new Date().toISOString();
    matched.updated_at = matched.linked_at;

    await putTokenRecord(matched);
    await putDiag("link-ok", { account_id: matched.account_id });

    // Carry the user straight into the dashboard without a second password prompt.
    return json(
      { ok:true, linked:true, account_identifier: accountIdentifier },
      200,
      { "set-cookie": sessionCookie() }
    );
  } catch (e) {
    console.error("link-claim", e);
    await putDiag("link-error", { error: e.message });
    return json({ ok:false, error:e.message }, 500);
  }
};
