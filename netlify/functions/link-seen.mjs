import { putDiag, json } from "./_ring.mjs";

// The Account Link page is static, so a visit leaves no trace on its own.
// This beacon records that Ring actually redirected a browser to /link -
// the step between "Connect clicked" and "form submitted".
export default async (req) => {
  if (req.method !== "POST") return json({ ok:false, error:"POST required" }, 405);

  try {
    const { nonce, time, referrer } = await req.json();
    const t = Number(time);

    await putDiag("link-page-opened", {
      has_nonce: Boolean(nonce),
      nonce_length: nonce ? String(nonce).length : 0,
      has_time: Boolean(time),
      time: time ? String(time) : null,
      age_seconds: Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null,
      referrer: referrer ? String(referrer).slice(0, 200) : null
    });

    return json({ ok:true });
  } catch (e) {
    console.error("link-seen", e);
    return json({ ok:false, error:e.message }, 500);
  }
};
