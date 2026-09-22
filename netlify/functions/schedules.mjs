import { schedulesStore, hasSession, json, unauthorized } from "./_ring.mjs";
import { normalizeIntervals, isDeviceId, MAX_INTERVALS } from "./_schedule.mjs";

const KEY = "schedules";

async function readAll() {
  try {
    return (await schedulesStore().get(KEY, { type: "json" })) || {};
  } catch {
    return {};
  }
}

export default async (req) => {
  if (!hasSession(req)) return unauthorized();

  try {
    if (req.method === "GET") {
      return json({ ok: true, max: MAX_INTERVALS, schedules: await readAll() });
    }

    if (req.method === "PUT") {
      const { deviceId, intervals } = await req.json();

      if (!isDeviceId(deviceId)) return json({ ok: false, error: "Neplatné ID kamery." }, 400);

      const result = normalizeIntervals(intervals);
      if (!result.ok) return json({ ok: false, error: result.error }, 400);

      const all = await readAll();
      if (result.intervals.length) all[deviceId] = result.intervals;
      else delete all[deviceId];        // an empty schedule is an absent one

      await schedulesStore().setJSON(KEY, all);
      return json({ ok: true, intervals: result.intervals });
    }

    return json({ ok: false, error: "GET nebo PUT" }, 405);
  } catch (e) {
    console.error("schedules", e);
    return json({ ok: false, error: e.message }, 500);
  }
};
