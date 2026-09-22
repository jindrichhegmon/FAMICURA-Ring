import { eventsStore, hasSession, json, unauthorized } from "./_ring.mjs";

export default async (req) => {
  if (req.method !== "GET") return json({ ok:false, error:"GET required" }, 405);
  if (!hasSession(req)) return unauthorized();

  try {
    const store = eventsStore();
    const { blobs = [] } = await store.list();

    // Keys are `<kind>-<epoch ms>-<id>`. Sorting the whole string would group
    // every diag- before every event-, so order by the timestamp itself.
    const keys = blobs
      .map((b) => b.key)
      .sort((a, b) => (Number(b.split("-")[1]) || 0) - (Number(a.split("-")[1]) || 0))
      .slice(0, 50);

    const items = [];
    for (const key of keys) {
      try {
        const value = await store.get(key, { type: "json" });
        items.push({ key, kind: key.startsWith("diag-") ? "diag" : "event", value });
      } catch (error) {
        items.push({ key, kind: "error", value: { error: String(error) } });
      }
    }

    return json({ ok:true, count: blobs.length, items });
  } catch (e) {
    console.error("events", e);
    return json({ ok:false, error:e.message }, 500);
  }
};
