// Umumiy yordamchi funksiyalar (marshrut emas)
const DAY1 = Date.UTC(2026, 10, 11); // o'yinning 1-kuni (index.html bilan bir xil)
export const J = (o, s = 200) => new Response(JSON.stringify(o), {
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
export const serverDay = () => Math.floor((Date.now() + 5 * 3600e3 - DAY1) / 864e5) + 1;

// Telegram initData imzosini tekshiradi
export async function auth(request, env) {
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


// Telegram foydalanuvchisining ko'rinadigan ismi
export function nameOf(u) {
  const last = u.last_name ? u.last_name[0] + "." : "";
  return ([u.first_name, last].filter(Boolean).join(" ") || u.username || "Oʻyinchi").slice(0, 24);
}
