// Archive frames for a cam at any point in time.
// foto-webcam.eu: /webcam/<id>/YYYY/MM/DD/HHMM_<size>.jpg in local (Vienna) time, one image per cam interval.
// roundshot:      <storage>/YYYY-MM-DD/HH-MM-00/YYYY-MM-DD-HH-MM-00_<size>.jpg in local (Zurich) time; storage base from structure.json.

const TZ = "Europe/Vienna"; // same offset as Zurich
const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function local(t) {
  const p = Object.fromEntries(parts.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { Y: p.year, M: p.month, D: p.day, h: p.hour, m: p.minute };
}

export const hasArchive = c => c.source === "foto-webcam.eu" || c.source === "roundshot";
export const isPanorama = c => c.source === "roundshot";

// Sizes: "thumb" (small), "view" (normal), "large"
const FW_SIZE = { thumb: "sm", view: "la", large: "lm", huge: "hd" };
const RS_SIZE = { thumb: "thumbnail", view: "quarter", large: "half", huge: "half" };

const rsBase = new Map(); // cam id -> Promise<{ base, latest }>
export function roundshotInfo(c) {
  if (!rsBase.has(c.id)) {
    rsBase.set(c.id, fetch(c.page.replace(/\/$/, "") + "/structure.json").then(r => r.json()).then(d => {
      const imgs = (d.images || []).filter(i => i.status === "finished").sort((a, b) => b.datetime - a.datetime);
      const url = imgs[0]?.structure?.quarter?.url_full || "";
      return { base: url.replace(/\/\d{4}-\d{2}-\d{2}\/\d{2}-\d{2}-\d{2}\/.*$/, ""), latestLocal: imgs[0] ? imgs[0].datetime * 1000 : 0 };
    }).catch(() => ({ base: "", latestLocal: 0 })));
  }
  return rsBase.get(c.id);
}

export async function frameUrl(c, t, size = "view") {
  const { Y, M, D, h, m } = local(t);
  if (c.source === "foto-webcam.eu") return `https://www.foto-webcam.eu/webcam/${c.id}/${Y}/${M}/${D}/${h}${m}_${FW_SIZE[size]}.jpg`;
  if (c.source === "roundshot") {
    const { base } = await roundshotInfo(c);
    if (!base) return "";
    return `${base}/${Y}-${M}-${D}/${h}-${m}-00/${Y}-${M}-${D}-${h}-${m}-00_${RS_SIZE[size]}.jpg`;
  }
  return "";
}

// Time slots to try for a frame near t: the cam's own slot first, then coarser slots, then earlier ones (night gaps).
export function candidates(c, t) {
  const step = (c.interval || 600) * 1000, out = [];
  const add = v => { if (!out.includes(v)) out.push(v); };
  const base = Math.floor(t / step) * step;
  add(base);
  add(Math.floor(t / 1800e3) * 1800e3);
  add(Math.floor(t / 3600e3) * 3600e3);
  for (let k = 1; k <= 6; k++) add(base - k * step);
  for (let k = 1; k <= 6; k++) add(Math.floor(t / 3600e3) * 3600e3 - k * 3600e3);
  return out;
}

const probeCache = new Map();
function probe(url) {
  if (!probeCache.has(url)) probeCache.set(url, new Promise(res => {
    const im = new Image();
    im.onload = () => res(im.naturalWidth > 0);
    im.onerror = () => res(false);
    im.src = url;
  }));
  return probeCache.get(url);
}

// Find the nearest existing frame at or before t. Returns { url, t } or null.
export async function findFrame(c, t, size = "view") {
  if (!hasArchive(c)) return null;
  for (const ct of candidates(c, t)) {
    const url = await frameUrl(c, ct, size);
    if (url && await probe(url)) return { url, t: ct };
  }
  return null;
}

// Newest image: foto-webcam serves it under /current/, roundshot lists it in structure.json.
export async function latestUrl(c, size = "view") {
  if (c.source === "foto-webcam.eu") return `https://www.foto-webcam.eu/webcam/${c.id}/current/${{ thumb: "400", view: "816", large: "1200", huge: "1200" }[size]}.jpg`;
  if (c.source === "roundshot") {
    const f = await findFrame(c, Date.now(), size);
    return f ? f.url : c.img;
  }
  return c.img || "";
}
