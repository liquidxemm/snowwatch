// Visibility check: scores the current image of every high cam (clear / drops / fog / dark)
// and learns which cams stay clear while it snows. Run by .github/workflows/visibility.yml.
// Usage: node scripts/visibility.mjs <previous vis.json> <output vis.json>
import { readFile, writeFile } from "node:fs/promises";
import jpeg from "jpeg-js";
import { fetchWeather, analyse } from "../snow.js";

const [prevPath = "prev-vis.json", outPath = "vis.json"] = process.argv.slice(2);
const root = new URL("../", import.meta.url);
const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };

const { cams: catalog } = await readJson(new URL("cams.json", root), { cams: [] });
const watch = new Set(await readJson(new URL("watchlist.json", root), []));
const cams = catalog.filter(c => c.source === "foto-webcam.eu" && (c.elev >= 2000 || watch.has(c.id)));
const prev = await readJson(prevPath, { cams: {} });
const now = Date.now();

// grayscale, downsampled by block averaging to about 200 px wide
function gray(buf) {
  const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 256 });
  const f = Math.max(1, Math.floor(img.width / 200)), w = Math.floor(img.width / f), h = Math.floor(img.height / f);
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) {
      const i = ((y * f + yy) * img.width + (x * f + xx)) * 4;
      s += .299 * img.data[i] + .587 * img.data[i + 1] + .114 * img.data[i + 2];
    }
    g[y * w + x] = s / (f * f);
  }
  return { g, w, h };
}

// mean brightness, contrast (std) and sharpness (variance of the Laplacian), ignoring the top 8 % (text overlay)
function metrics({ g, w, h }) {
  const y0 = Math.floor(h * .08);
  let n = 0, sum = 0, sq = 0, lap = [], ls = 0;
  for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) { const v = g[y * w + x]; sum += v; sq += v * v; n++; }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
  for (let y = y0 + 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
    lap.push(l); ls += l;
  }
  const lm = ls / lap.length, sharp = lap.reduce((s, v) => s + (v - lm) ** 2, 0) / lap.length;
  return { mean, std, sharp };
}

const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; };

async function score(c) {
  const r = await fetch(`https://www.foto-webcam.eu/webcam/${c.id}/current/400.jpg`, { headers: { "User-Agent": "snowwatch (github.com/liquidxemm/snowwatch)" } });
  if (!r.ok) throw new Error(`image ${r.status}`);
  const m = metrics(gray(Buffer.from(await r.arrayBuffer())));
  const p = prev.cams[c.id] || {};
  const hist = (p.hist || []).slice(-60);
  const daylight = m.mean >= 45;
  const base = hist.length >= 6 ? pct(hist, .75) : null;
  let cls;
  if (!daylight) cls = "dark";
  else if (m.std < 20) cls = "fog";
  else if (base && m.sharp < base * .4) cls = "drops";
  else cls = "clear";
  if (daylight && m.std >= 20) hist.push(Math.round(m.sharp));
  const rel = base ? Math.min(1.2, m.sharp / base) : Math.min(1, m.sharp / 400);
  return {
    cls, t: now,
    score: cls === "dark" ? 0 : Math.round(Math.min(100, rel * 100 * Math.min(1, m.std / 45))),
    mean: Math.round(m.mean), std: Math.round(m.std), sharp: Math.round(m.sharp), base: base && Math.round(base),
    lastClear: cls === "clear" ? now : p.lastClear || 0,
    snowN: p.snowN || 0, clearSnowN: p.clearSnowN || 0, hist,
  };
}

const out = { updated: now, cams: { ...prev.cams } };
let snowing = {};
try {
  const ws = await fetchWeather(cams);
  cams.forEach((c, i) => { snowing[c.id] = analyse(ws[i], now).snowingNow; });
} catch (e) { console.warn("weather unavailable:", e.message); }

const queue = cams.slice();
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let c; (c = queue.shift());) {
    try {
      const s = await score(c);
      if (snowing[c.id] && s.cls !== "dark") { s.snowN++; if (s.cls === "clear") s.clearSnowN++; }
      s.snowing = !!snowing[c.id];
      out.cams[c.id] = s;
    } catch (e) { console.warn(c.id, e.message); }
  }
}));

await writeFile(outPath, JSON.stringify(out) + "\n");
const counts = {};
Object.values(out.cams).forEach(s => { if (s.t === now) counts[s.cls] = (counts[s.cls] || 0) + 1; });
console.log(`scored ${cams.length} cams`, counts);
