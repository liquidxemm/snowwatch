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
    img: `https://www.foto-webcam.eu/webcam/${c.id}/current/816.jpg`,
    page: `https://www.foto-webcam.eu/webcam/${c.id}/`,
    source: "foto-webcam.eu",
  }));

const extras = JSON.parse(await readFile(new URL("extras.json", root), "utf8"));
const cams = [...extras, ...fw.filter(c => !extras.some(e => e.id === c.id))]
  .sort((a, b) => b.elev - a.elev);

await writeFile(new URL("cams.json", root), JSON.stringify({ updated: new Date().toISOString(), cams }, null, 1) + "\n");
console.log(`cams.json: ${cams.length} cams (${fw.length} from foto-webcam.eu, ${extras.length} extras)`);
