// Rebuilds cams.json: every live cam listed on foto-webcam.eu, plus the hand-picked cams in extras.json.
import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

// The foto-webcam.eu homepage embeds its cam list as a JSON object starting with {"cams":[
function extractCamList(html) {
  const start = html.indexOf('{"cams":[');
  if (start < 0) throw new Error("cam list not found on foto-webcam.eu homepage");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1)).cams;
  }
  throw new Error("cam list JSON is not terminated");
}

const res = await fetch("https://www.foto-webcam.eu/", { headers: { "User-Agent": "snowwatch (github.com/liquidxemm/snowwatch)" } });
if (!res.ok) throw new Error(`foto-webcam.eu answered ${res.status}`);
const fw = extractCamList(await res.text())
  .filter(c => !c.offline && !c.hidden && c.latitude && c.longitude && c.elevation > 0 && c.elevation < 5000)
  .map(c => ({
    id: c.id,
    name: c.name,
    title: c.title,
    country: c.country,
    lat: +c.latitude.toFixed(4),
    lon: +c.longitude.toFixed(4),
    elev: c.elevation,
    interval: Math.max(300, +c.captureInterval || 600) <= 3600 ? Math.max(300, +c.captureInterval || 600) : 600,
    img: `https://www.foto-webcam.eu/webcam/${c.id}/current/816.jpg`,
    page: `https://www.foto-webcam.eu/webcam/${c.id}/`,
    source: "foto-webcam.eu",
  }));

const extras = JSON.parse(await readFile(new URL("extras.json", root), "utf8"));
const cams = [...extras, ...fw.filter(c => !extras.some(e => e.id === c.id))]
  .sort((a, b) => b.elev - a.elev);

// Avalanche warning region of each cam (EAWS micro-regions), used to look up the bulletin.
const REGION_FILES = ["CH", "AT-07", "AT-08", "AT-05", "AT-02", "AT-06", "AT-04", "AT-03", "IT-32-BZ", "IT-32-TN", "DE-BY", "IT-25", "IT-23", "SI", "FR"];
const inRing = (x, y, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPolygon = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some(h => inRing(x, y, h));
const regions = [];
for (const f of REGION_FILES) {
  try {
    const r = await fetch(`https://regions.avalanches.org/micro-regions/${f}_micro-regions.geojson.json`);
    if (!r.ok) continue;
    for (const feat of (await r.json()).features || []) {
      const g = feat.geometry, id = feat.properties?.id;
      if (!g || !id || feat.properties?.end_date) continue;
      regions.push({ id, polys: g.type === "Polygon" ? [g.coordinates] : g.coordinates });
    }
  } catch (e) { console.warn("regions", f, e.message); }
}
for (const c of cams) {
  const hit = regions.find(r => r.polys.some(p => inPolygon(c.lon, c.lat, p)));
  if (hit) c.region = hit.id;
}
console.log(`regions: ${regions.length} loaded, ${cams.filter(c => c.region).length} cams assigned`);

await writeFile(new URL("cams.json", root), JSON.stringify({ updated: new Date().toISOString(), cams }, null, 1) + "\n");
console.log(`cams.json: ${cams.length} cams (${fw.length} from foto-webcam.eu, ${extras.length} extras)`);
