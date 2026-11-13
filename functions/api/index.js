// Harfigatop API: /api/submit (POST), /api/leaderboard (GET)
// Kerak: D1 binding "DB" va secret "BOT_TOKEN"
const DAY1 = Date.UTC(2026, 10, 11); // o'yinning 1-kuni (index.html bilan bir xil)
const J = (o, s = 200) => new Response(JSON.stringify(o), {
  status: s,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const enc = new TextEncoder();

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");

// Toshkent vaqti bo'yicha bugungi kun raqami
const serverDay = () => Math.floor((Date.now() + 5 * 3600e3 - DAY1) / 864e5) + 1;

// Telegram initData imzosini tekshiradi
async function auth(request, env) {
  const h = request.headers.get("Authorization") || "";
  if (!h.startsWith("tma ") || !env.BOT_TOKEN) return null;
  const p = new URLSearchParams(h.slice(4));
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");
  const data = [...p.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => k + "=" + v).join("\n");
  const secret = await hmac(enc.encode("WebAppData"), env.BOT_TOKEN);
  const calc = hex(await hmac(secret, data));
  if (calc.length !== hash.length) return null;
  let d = 0;
  for (let i = 0; i < calc.length; i++) d |= calc.charCodeAt(i) ^ hash.charCodeAt(i);
  if (d) return null;
  const age = Date.now() / 1000 - Number(p.get("auth_date") || 0);
  if (!(age < 172800)) return null; // 48 soatdan eski bo'lmasin
  try {
    const u = JSON.parse(p.get("user"));
    return u && u.id ? u : null;
  } catch { return null; }
}

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

async function board(request, env) {
  const url = new URL(request.url);
  const sd = serverDay();
  let day = parseInt(url.searchParams.get("day")) || sd;
  if (Math.abs(day - sd) > 1) day = sd;
  const u = await auth(request, env);
  const id = u ? u.id : -1;
  const q = (s, ...a) => env.DB.prepare(s).bind(...a);

  const [t, s, a, m] = await env.DB.batch([
    q("SELECT u.name,s.score,s.time_ms AS ms,s.ok,s.n,(u.tg_id=?2) AS you FROM scores s JOIN users u ON u.tg_id=s.tg_id WHERE s.day=?1 ORDER BY s.score DESC,s.time_ms ASC LIMIT 20", day, id),
    q("SELECT name,streak AS st,best_streak AS best,(tg_id=?2) AS you FROM users WHERE last_day>=?1-1 AND streak>0 ORDER BY streak DESC,best_streak DESC,total_score DESC LIMIT 20", day, id),
    q("SELECT name,total_score AS total,games,(tg_id=?1) AS you FROM users ORDER BY total_score DESC,games ASC LIMIT 20", id),
    q("SELECT u.streak,u.best_streak,u.last_day,u.total_score,u.games,(SELECT score FROM scores WHERE day=?1 AND tg_id=?2) AS today,(SELECT time_ms FROM scores WHERE day=?1 AND tg_id=?2) AS today_ms FROM users u WHERE u.tg_id=?2", day, id)
  ]);
  const fix = r => ({ ...r, you: !!r.you });

  let me = null;
  if (u) {
    const r = m.results[0];
    me = { streak: 0, best_streak: 0, total: 0, games: 0, today: null, rank_today: null };
    if (r) {
      me.streak = r.last_day >= day - 1 ? r.streak : 0;
      me.best_streak = r.best_streak;
      me.total = r.total_score;
      me.games = r.games;
      me.today = r.today;
      if (r.today != null) {
        const rk = await q("SELECT COUNT(*)+1 AS r FROM scores WHERE day=?1 AND (score>?2 OR (score=?2 AND time_ms<?3))", day, r.today, r.today_ms).first();
        me.rank_today = rk ? rk.r : null;
      }
    }
  }
  return J({ day, today: t.results.map(fix), streak: s.results.map(fix), total: a.results.map(fix), me });
}

export async function onRequest({ request, env, params }) {
  const route = [].concat(params.path || []).join("/");
  if (!env.DB) return J({ error: "no_db" }, 500);
  try {
    if (route === "submit" && request.method === "POST") return await submit(request, env);
    if (route === "leaderboard" && request.method === "GET") return await board(request, env);
    return J({ error: "not_found" }, 404);
  } catch (e) {
    return J({ error: "server" }, 500);
  }
}
