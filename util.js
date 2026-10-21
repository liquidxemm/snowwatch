// Small helpers shared by the dashboard modules.

export const H = 3600e3, DAY = 24 * H;
export const TZ = "Europe/Vienna";
export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const f1 = v => (v == null || Number.isNaN(v) ? "–" : v.toFixed(1).replace("-", "−"));
export const f0 = v => (v == null || Number.isNaN(v) ? "–" : Math.round(v).toString().replace("-", "−"));
export const fmtWhen = t => new Date(t).toLocaleString("de-AT", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
export const fmtTime = t => new Date(t).toLocaleTimeString("de-AT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const fmtDay = t => new Date(t).toLocaleDateString("de-AT", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric" });
export const fmtDate = t => new Date(t).toLocaleDateString("de-AT", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
export const fmtDM = t => new Date(t).toLocaleDateString("de-AT", { timeZone: TZ, day: "numeric", month: "short" });
export const fmtWd = t => new Date(t).toLocaleDateString("de-AT", { timeZone: TZ, weekday: "short" });
export const localHour = t => +new Date(t).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });
export const isDay = t => { const h = localHour(t); return h >= 8 && h < 17; };
export const lastDaylight = t => { let x = Math.floor(t / H) * H; for (let k = 0; k < 48 && !isDay(x); k++) x -= H; return x; };
export const nextDaylight = t => { let x = Math.ceil(t / H) * H; for (let k = 0; k < 48 && !isDay(x); k++) x += H; return Math.min(x, Date.now()); };
// Local noon of a "YYYY-MM-DD" date string (Open-Meteo daily time) as epoch ms.
const offFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" });
const tzOffsetH = t => +((offFmt.formatToParts(new Date(t)).find(p => p.type === "timeZoneName")?.value.match(/[+-]\d+/) || ["0"])[0]);
export const localTime = (d, hh = 12) => { const utc = Date.parse(`${d}T${String(hh).padStart(2, "0")}:00:00Z`); return utc - tzOffsetH(utc) * H; };
export const noonOf = d => localTime(d, 12);
export const dayKey = t => new Date(t).toLocaleDateString("sv-SE", { timeZone: TZ }); // YYYY-MM-DD in local time
export const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
export const fmtSpan = ms => { const h = Math.round(ms / H); return h < 48 ? `${h} h` : `${Math.round(h / 24)} Tage`; };
export const store = {
  get(k, d) { try { const v = localStorage.getItem("snowwatch:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("snowwatch:" + k, JSON.stringify(v)); } catch {} },
};
// Cache an async result in localStorage for maxAge ms.
export async function cached(key, maxAge, fn) {
  const hit = store.get("c:" + key, null);
  if (hit && Date.now() - hit.at < maxAge) return hit.v;
  const v = await fn();
  store.set("c:" + key, { at: Date.now(), v });
  return v;
}
