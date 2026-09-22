import crypto from "node:crypto";
import {
  verifyWebhook,
  eventsStore
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
    const signature = req.headers.get("x-signature") || "";

    if (!verifyWebhook(raw, signature)) {
      return new Response(JSON.stringify({
        ok:false,
        error:"Invalid Ring webhook signature"
      }), {
        status:401,
        headers:{ "content-type":"application/json" }
      });
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({
        ok:false,
        error:"Invalid JSON"
      }), {
        status:400,
        headers:{ "content-type":"application/json" }
      });
    }

    const requestId =
      payload?.meta?.request_id ||
      crypto.randomUUID();

    const store = eventsStore();

    await store.setJSON(
      `event-${Date.now()}-${requestId}`,
      payload
    );

    return new Response(JSON.stringify({ ok:true }), {
      status:200,
      headers:{
        "content-type":"application/json",
        "cache-control":"no-store"
      }
    });

  } catch (e) {
    console.error("webhook", e);

    return new Response(JSON.stringify({
      ok:false,
      error:e.message
    }), {
      status:500,
      headers:{ "content-type":"application/json" }
    });
  }
};
