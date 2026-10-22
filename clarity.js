// Finds the latest clear daylight image in a time window, so before/after comparisons show the landscape, not fog.
// Signals, best first: the visibility history scored by the GitHub check, pixel analysis in the browser
// (only where the image host allows it, e.g. roundshot), and the weather at the cam as an estimate.
import { hourIndex } from "./snow.js?v=mvja05y3";
import { H, isDay } from "./util.js?v=mvja05y3";
import { findFrame, isPanorama } from "./archive.js?v=mvja05y3";

const HIST_URL = "https://raw.githubusercontent.com/liquidxemm/snowwatch/data/vis-history.json";
const CLEAR = 60;
let histP;
const visHistory = () => (histP ||= fetch(HIST_URL + "?t=" + Math.floor(Date.now() / 600e3)).then(r => r.json()).then(j => j.cams || {}).catch(() => ({})));

// Scored by the GitHub check within 20 minutes of t
async function fromHistory(c, t) {
  const list = (await visHistory())[c.id];
  if (!list) return null;
  const m = t / 60000;
  const e = list.reduce((best, x) => (Math.abs(x[0] - m) < Math.abs((best?.[0] ?? -1e12) - m) ? x : best), null);
  if (!e || Math.abs(e[0] - m) > 20) return null;
  return e[2] === 0 ? Math.max(e[1], CLEAR) : Math.min(e[1], CLEAR - 25);
}

// Weather estimate: humidity near 100 % at cam height means the cam sits in cloud.
export function weatherClarity(h, t) {
  if (!h || !h.rh || t < h.t[0]) return null;
  const i = Math.max(0, Math.min(h.t.length - 1, Math.round((t - h.t[0]) / H)));
  const rh = h.rh[i], pr = h.precip?.[i] || 0, cl = h.cloudLow?.[i] || 0, vis = h.vis?.[i], code = h.code?.[i];
  if (rh == null) return null;
  let s = 100 - Math.max(0, rh - 75) * 2.5 - cl * .3;
  if (pr > .05) s -= 50;
  if (code === 45 || code === 48) s -= 40;
  if (vis != null && vis < 3000) s -= 30;
  return Math.max(0, Math.min(100, Math.round(s)));
}

// Pixel analysis: contrast and sharpness of a small copy. Returns null where the host blocks reading pixels.
const pixelCache = new Map();
export function pixelClarity(url) {
  if (!pixelCache.has(url)) pixelCache.set(url, new Promise(res => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onerror = () => res(null);
    im.onload = () => {
      try {
        const w = 160, h = Math.max(1, Math.round(im.naturalHeight / im.naturalWidth * w));
        const cv = Object.assign(document.createElement("canvas"), { width: w, height: h });
        const ctx = cv.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(im, 0, 0, w, h);
        const d = ctx.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) g[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
        const y0 = Math.floor(h * .08);
        let n = 0, sum = 0, sq = 0, ls = 0, l2 = 0, ln = 0;
        for (let y = y0; y < h; y++) for (let x = 0; x < w; x++) { const v = g[y * w + x]; sum += v; sq += v * v; n++; }
        for (let y = y0 + 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x, l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]; ls += l; l2 += l * l; ln++;
        }
        const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean)), sharp = l2 / ln - (ls / ln) ** 2;
        if (mean < 45) return res(0);
        res(Math.round(Math.min(100, std < 20 ? std * 2 : 40 + (std - 20) * 1.5) * Math.min(1, .5 + sharp / 400)));
      } catch { res(null); }
    };
    im.src = url;
  }));
  return pixelCache.get(url);
}

/**
 * Latest clear daylight time between `from` and `to` (searching backwards from `to`).
 * Returns { t, score, basis } or the best candidate found, or null without candidates.
 */
export async function findClear(c, h, { from, to, maxPixelChecks = 8 }) {
  let best = null, checks = 0;
  for (let t = Math.floor(to / H) * H; t >= from; t -= H) {
    if (!isDay(t)) continue;
    let score = await fromHistory(c, t), basis = score != null ? "Bildanalyse" : "";
    if (score == null && isPanorama(c) && checks < maxPixelChecks) {
      const w = weatherClarity(h, t);
      if (w == null || w >= 35) {
        checks++;
        const f = await findFrame(c, t, "thumb");
        if (f) { score = await pixelClarity(f.url); if (score != null) basis = "Bildanalyse"; }
      }
    }
    if (score == null) { score = weatherClarity(h, t); basis = "Wetter"; }
    if (score == null) continue;
    const cand = { t, score, basis };
    if (score >= CLEAR) return cand;
    if (!best || score > best.score) best = cand;
  }
  return best;
}

// Last hour with snowfall at or before t (from hourly history), or null.
export function lastSnowHour(h, t, minCm = .1) {
  if (!h) return null;
  for (let i = hourIndex(h, t); i >= 0; i--) if (h.snow[i] >= minCm) return h.t[i];
  return null;
}

export const clarityLabel = r => !r ? "" : r.score >= CLEAR ? `klar${r.basis === "Wetter" ? " (geschätzt)" : ""}` : "kein klares Bild gefunden";
