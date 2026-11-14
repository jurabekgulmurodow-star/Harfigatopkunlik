import { J, auth, nameOf } from "../_lib.js";

// Erkin o'yin natijasini saqlaydi (faqat eng yaxshisi reytingga chiqadi)
export async function onRequestPost({ request, env }) {
  if (!env.DB) return J({ error: "no_db" }, 500);
  try {
    const u = await auth(request, env);
    if (!u) return J({ error: "auth" }, 401);
    let b;
    try { b = await request.json(); } catch { return J({ error: "bad" }, 400); }

    const word = String(b.word || "").toLowerCase();
    const gid = Number(b.gid), score = b.score | 0, ms = b.time_ms | 0, ok = b.ok | 0, n = b.n | 0;
    if (!/^[a-z]{5}$/.test(word) || n !== 15 || ok < 0 || ok > n ||
        score < 0 || score > ok * 24 + (ok ? 60 : 0) ||
        ms < ok * 1000 || ms > 864e5 * 2 ||
        !(Math.abs(Date.now() - gid) < 7 * 864e5)) return J({ error: "invalid" }, 400);

    const better = "(?3>best_score OR (?3=best_score AND ?4<best_ms))";
    const res = await env.DB.prepare(
      "INSERT INTO practice(tg_id,name,best_score,best_ms,best_ok,best_word,games,last_gid,updated) VALUES(?1,?2,?3,?4,?5,?6,1,?7,?8) " +
      "ON CONFLICT(tg_id) DO UPDATE SET name=?2," +
      "best_ok=CASE WHEN " + better + " THEN ?5 ELSE best_ok END," +
      "best_word=CASE WHEN " + better + " THEN ?6 ELSE best_word END," +
      "best_ms=CASE WHEN " + better + " THEN ?4 ELSE best_ms END," +
      "best_score=CASE WHEN " + better + " THEN ?3 ELSE best_score END," +
      "games=games+1,last_gid=?7,updated=?8 WHERE last_gid<?7"
    ).bind(u.id, nameOf(u), score, ms, ok, word, gid, Date.now()).run();

    return J({ ok: true, new: res.meta.changes > 0 });
  } catch (e) {
    return J({ error: "server" }, 500);
  }
}
