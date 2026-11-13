import { J, serverDay, auth } from "../_lib.js";

async function submit(request, env) {
  const u = await auth(request, env);
  if (!u) return J({ error: "auth" }, 401);
  let b;
  try { b = await request.json(); } catch { return J({ error: "bad" }, 400); }
  const day = b.day | 0, score = b.score | 0, ms = b.time_ms | 0, ok = b.ok | 0, n = b.n | 0;
  const sd = serverDay();
  if (day < 1 || Math.abs(day - sd) > 1 || n < 9 || n > 45 || n % 3 ||
      ok < 0 || ok > n || score < 0 || score > ok * 24 + (ok ? 60 : 0) ||
      ms < ok * 1000 || ms > 864e5 * 2) return J({ error: "invalid" }, 400);

  const last = u.last_name ? u.last_name[0] + "." : "";
  const name = ([u.first_name, last].filter(Boolean).join(" ") || u.username || "Oʻyinchi").slice(0, 24);

  const ins = await env.DB.prepare(
    "INSERT INTO scores(day,tg_id,score,time_ms,ok,n,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(day,tg_id) DO NOTHING"
  ).bind(day, u.id, score, ms, ok, n, Date.now()).run();

  const isNew = ins.meta.changes > 0;
  if (isNew) {
    const cur = await env.DB.prepare("SELECT streak,best_streak,last_day FROM users WHERE tg_id=?").bind(u.id).first();
    let st = 1, ld = day;
    if (cur) {
      if (day === cur.last_day + 1) st = cur.streak + 1;
      else if (day <= cur.last_day) { st = cur.streak; ld = cur.last_day; }
    }
    const best = Math.max(st, cur ? cur.best_streak : 0);
    await env.DB.prepare(
      "INSERT INTO users(tg_id,name,streak,best_streak,last_day,total_score,games,best_score) VALUES(?1,?2,?3,?4,?5,?6,1,?6) " +
      "ON CONFLICT(tg_id) DO UPDATE SET name=?2,streak=?3,best_streak=?4,last_day=?5," +
      "total_score=total_score+?6,games=games+1,best_score=MAX(best_score,?6)"
    ).bind(u.id, name, st, best, ld, score).run();
  }
  return J({ ok: true, new: isNew });
}


export async function onRequestPost({ request, env }) {
  if (!env.DB) return J({ error: "no_db" }, 500);
  try { return await submit(request, env); }
  catch (e) { return J({ error: "server" }, 500); }
}
