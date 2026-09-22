import { ensureFreshLinkedRecord, ringFetch } from "./_ring.mjs";

export default async (req) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ ok:false, error:"GET required" }), {
      status:405,
      headers:{ "content-type":"application/json" }
    });
  }

  try {
    const rec = await ensureFreshLinkedRecord();

    if (!rec) {
      return new Response(JSON.stringify({
        ok:false,
        linked:false,
        error:"Ring účet zatím není propojen."
      }), {
        status:404,
        headers:{
          "content-type":"application/json",
          "cache-control":"no-store"
        }
      });
    }

    const res = await ringFetch("/v1/devices", rec.access_token);
    const text = await res.text();

    let payload;
    try { payload = JSON.parse(text); }
    catch { payload = { raw:text }; }

    if (!res.ok) {
      console.error("devices", res.status, payload);
      return new Response(JSON.stringify({
        ok:false,
        error:`Ring devices API: ${res.status}`
      }), {
        status:res.status,
        headers:{ "content-type":"application/json" }
      });
    }

    return new Response(JSON.stringify({
      ok:true,
      linked:true,
      data:payload
    }), {
      status:200,
      headers:{
        "content-type":"application/json",
        "cache-control":"no-store"
      }
    });

  } catch (e) {
    console.error("devices", e);
    return new Response(JSON.stringify({
      ok:false,
      error:e.message
    }), {
      status:500,
      headers:{ "content-type":"application/json" }
    });
  }
};
