import { getLinkedRecord, getTokenRecords } from "./_ring.mjs";

export default async () => {
  try {
    const linked = await getLinkedRecord();
    const records = await getTokenRecords();

    return new Response(JSON.stringify({
      ok: true,
      linked: !!linked,
      account_id: linked?.account_id || null,
      linked_at: linked?.linked_at || null,
      unclaimed_tokens: records.filter(r => r.status === "unclaimed").length
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      }
    });
  } catch (e) {
    console.error("status", e);
    return new Response(JSON.stringify({
      ok: false,
      error: e.message
    }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
};
