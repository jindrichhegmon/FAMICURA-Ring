import { env, secureEqual, json, sessionCookie } from "./_ring.mjs";

export default async (req) => {
  if (req.method !== "POST") return json({ ok:false, error:"POST required" }, 405);

  try {
    const { password } = await req.json();

    if (!password || !secureEqual(password, env("FAMICURA_LINK_PASSWORD"))) {
      return json({ ok:false, error:"Nesprávné heslo Famicura." }, 401);
    }

    return json({ ok:true }, 200, { "set-cookie": sessionCookie() });
  } catch (e) {
    console.error("login", e);
    return json({ ok:false, error:e.message }, 500);
  }
};
