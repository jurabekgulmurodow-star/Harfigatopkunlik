import { J, serverDay, auth } from "../_lib.js";

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
  // Erkin o'yin reytingi (jadval hali yaratilmagan bo'lsa ham qolgan reyting ishlayveradi)
  let practice = [];
  try {
    const pr = await q("SELECT name,best_score AS score,best_ms AS ms,best_ok AS ok,best_word AS word,games,(tg_id=?1) AS you FROM practice ORDER BY best_score DESC,best_ms ASC LIMIT 20", id).all();
    practice = pr.results.map(fix);
    if (u && me) {
      const mine = await q("SELECT best_score,best_ms,best_word,games FROM practice WHERE tg_id=?1", id).first();
      if (mine) {
        const rk = await q("SELECT COUNT(*)+1 AS r FROM practice WHERE best_score>?1 OR (best_score=?1 AND best_ms<?2)", mine.best_score, mine.best_ms).first();
        me.practice = { score: mine.best_score, ms: mine.best_ms, word: mine.best_word, games: mine.games, rank: rk ? rk.r : null };
      }
    }
  } catch (e) { practice = []; }

  return J({ day, today: t.results.map(fix), streak: s.results.map(fix), total: a.results.map(fix), practice, me });
}


export async function onRequestGet({ request, env }) {
  if (!env.DB) return J({ error: "no_db" }, 500);
  try { return await board(request, env); }
  catch (e) { return J({ error: "server" }, 500); }
}
