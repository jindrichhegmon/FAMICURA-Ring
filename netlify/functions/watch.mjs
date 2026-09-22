import { watchStore, hasSession, json, unauthorized } from "./_ring.mjs";
import { isDeviceId } from "./_schedule.mjs";
// The page applies these same rules, so what is stored is what it will do.
import { normalizeWatch, isDefaultWatch } from "../../public/watch.js";

const KEY = "watch";

async function readAll() {
  try {
    return (await watchStore().get(KEY, { type: "json" })) || {};
  } catch {
    return {};
  }
}

export default async (req) => {
  if (!hasSession(req)) return unauthorized();

  try {
    if (req.method === "GET") {
      return json({ ok: true, watch: await readAll() });
    }

    if (req.method === "PUT") {
      const { deviceId, watch } = await req.json();

      if (!isDeviceId(deviceId)) return json({ ok: false, error: "Neplatné ID kamery." }, 400);

      const result = normalizeWatch(watch);
      if (!result.ok) return json({ ok: false, error: result.error }, 400);

      const all = await readAll();
      if (isDefaultWatch(result.watch)) delete all[deviceId];   // default is the absence of a setting
      else all[deviceId] = result.watch;

      await watchStore().setJSON(KEY, all);
      return json({ ok: true, watch: result.watch });
    }

    return json({ ok: false, error: "GET nebo PUT" }, 405);
  } catch (e) {
    console.error("watch", e);
    return json({ ok: false, error: e.message }, 500);
  }
};
