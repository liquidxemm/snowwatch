// Measured snow depth from avalanche-service stations: SLF IMIS (Switzerland) and the EUREGIO services
// (Tirol, Südtirol, Trentino). SLF has no browser access, so the Action collects both into one file.
// Usage: node scripts/stations.mjs <output stations.json>
import { writeFile } from "node:fs/promises";

const outPath = process.argv[2] || "stations.json";
const UA = { headers: { "User-Agent": "snowwatch (github.com/liquidxemm/snowwatch)" } };
const getJson = async url => { const r = await fetch(url, UA); if (!r.ok) throw new Error(`${url} answered ${r.status}`); return r.json(); };
const round = v => (v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const out = [];

// SLF IMIS: station list + the last 24 h of 30-minute values for all stations
try {
  const [stations, meas] = await Promise.all([
    getJson("https://measurement-api.slf.ch/public/api/imis/stations"),
    getJson("https://measurement-api.slf.ch/public/api/imis/measurements"),
  ]);
  const byStation = {};
  for (const m of meas) if (m.HS != null) (byStation[m.station_code] ||= []).push(m);
  for (const s of stations) {
    const ms = (byStation[s.code] || []).sort((a, b) => a.measure_date.localeCompare(b.measure_date));
    if (!ms.length) continue;
    const last = ms[ms.length - 1], t = Date.parse(last.measure_date);
    const ref = ms.find(m => t - Date.parse(m.measure_date) <= 24.5 * 3600e3);
    out.push({
      id: "SLF-" + s.code, name: s.label, src: "SLF", lat: s.lat, lon: s.lon, elev: Math.round(s.elevation),
      hs: round(last.HS), d24: ref && t - Date.parse(ref.measure_date) >= 20 * 3600e3 ? round(last.HS - ref.HS) : null, d72: null,
      temp: round(last.TA_30MIN_MEAN), t,
    });
  }
} catch (e) { console.warn("SLF:", e.message); }

// EUREGIO: one GeoJSON with current values and 24/48/72 h snow depth change
try {
  const g = await getJson("https://static.avalanche.report/weather_stations/stations.geojson");
  for (const f of g.features) {
    const p = f.properties, [lon, lat, elev] = f.geometry.coordinates;
    if (p.HS == null) continue;
    out.push({
      id: "EU-" + (p["LWD-Nummer"] || f.id), name: p.name, src: p.operator || "EUREGIO", lat, lon, elev: Math.round(elev),
      hs: round(p.HS), d24: round(p.HSD24), d72: round(p.HSD72), temp: round(p.LT), t: Date.parse(p.date),
    });
  }
} catch (e) { console.warn("EUREGIO:", e.message); }

await writeFile(outPath, JSON.stringify({ updated: Date.now(), stations: out }) + "\n");
console.log(`stations: ${out.length} with snow depth (${out.filter(s => s.src === "SLF").length} SLF)`);
