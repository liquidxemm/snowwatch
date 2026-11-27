// Builds widget.json: everything the iPhone widget shows, in one small file (outlook, status, images, avalanche level).
// Run by .github/workflows/visibility.yml and published on the data branch.
// Usage: node scripts/widget.mjs <previous widget.json> <output widget.json>
import { readFile, writeFile } from "node:fs/promises";
import { fetchPlan, fetchWeather, analyse, modelTotals } from "../snow.js";
import { loadMeasurements, bulletinFor, stationFor } from "../measure.js";

const [prevPath = "prev-widget.json", outPath = "widget.json"] = process.argv.slice(2);
const root = new URL("../", import.meta.url);
const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };

const { cams: catalog } = await readJson(new URL("cams.json", root), { cams: [] });
const watch = await readJson(new URL("watchlist.json", root), []);
const cams = watch.map(id => catalog.find(c => c.id === id)).filter(Boolean);
const prev = await readJson(prevPath, null);
const SITE = "https://liquidxemm.github.io/snowwatch/";

// small image for the widget: foto-webcam 400 px, panoramas their small strip
const thumb = c => c.source === "foto-webcam.eu" ? c.img.replace("/816.jpg", "/400.jpg")
  : c.source === "panomax" ? c.img.replace(/recent_\w+\.jpg$/, "recent_optimized.jpg") : c.img;

let plans, weather;
try {
  [plans, weather] = await Promise.all([fetchPlan(cams, 7), fetchWeather(cams)]);
} catch (e) {
  // keep the last good file rather than publishing nothing
  console.warn("forecast unavailable:", e.message);
  if (prev) { await writeFile(outPath, JSON.stringify({ ...prev, stale: true }) + "\n"); process.exit(0); }
  throw e;
}
try { await loadMeasurements(); } catch {}

const now = Date.now();
const wd = d => new Date(d + "T12:00:00Z").toLocaleDateString("de-AT", { weekday: "short", timeZone: "UTC" }).replace(".", "");
const round = v => Math.round((v || 0) * 10) / 10;

const rows = cams.map((c, i) => {
  const p = plans[i], a = analyse(weather[i], now), b = bulletinFor(c), s = stationFor(c);
  const window = n => {
    const sum = p.snow.slice(0, n).reduce((t, v) => t + (v || 0), 0), tots = modelTotals(p, n);
    return { med: round(sum), lo: round(Math.min(sum, ...tots)), hi: round(Math.max(sum, ...tots)) };
  };
  return {
    id: c.id, name: c.name, elev: c.elev, lat: c.lat, lon: c.lon,
    status: a.snowingNow ? "snow" : a.next3 >= 0.5 ? "soon" : "dry",
    temp: round(a.temp), past24: round(a.past24), next24: round(a.next24),
    d2: window(2), d3: window(3), d7: window(7),
    days: p.days.map((d, k) => ({ d, wd: wd(d), snow: round(p.snow[k]), sun: round(p.sun[k]) })),
    level: b && b.valid ? b.level : null,
    measured: s ? { hs: s.hs, d24: s.d24, station: s.name } : null,
    img: thumb(c), url: SITE + "#" + encodeURIComponent(c.id),
  };
});

// one-sentence answer, like the outlook on the website
function lead(key, label) {
  const r = rows.slice().sort((x, y) => y[key].med - x[key].med), top = r[0];
  if (!top || top[key].med < 1) return `${label}: kaum Schnee an deinen Cams.`;
  const over10 = r.filter(x => x[key].med >= 10).length;
  return `${label}: am meisten bei ${top.name}, ${Math.round(top[key].med)} cm (${Math.round(top[key].lo)}–${Math.round(top[key].hi)}). ${over10} von ${r.length} Cams über 10 cm.`;
}

const out = {
  updated: now, site: SITE,
  snowing: rows.filter(r => r.status === "snow").length, total: rows.length,
  lead: { d2: lead("d2", "Heute + morgen"), d3: lead("d3", "Nächste 3 Tage"), d7: lead("d7", "Nächste 7 Tage") },
  cams: rows,
};
await writeFile(outPath, JSON.stringify(out) + "\n");
console.log(`widget.json: ${rows.length} cams, ${out.snowing} snowing · ${out.lead.d3}`);
