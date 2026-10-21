// Records real Open-Meteo responses for the requests the dashboard makes (test fixtures).
import { readFile, writeFile } from "node:fs/promises";
import { fetchWeather, fetchHistory, fetchPlan, fetchArchiveDaily, fetchGrid } from "../snow.js";
import { GRID } from "../map.js";
const rec = {};
const keyOf = u => { const x = new URL(u), p = x.searchParams; return [x.host + x.pathname, p.get("latitude"), p.get("models") || "", p.get("daily") || "", p.get("hourly") || "", p.get("current") || ""].join("|"); };
const recFetch = async (u) => { const r = await fetch(u); const body = await r.text(); rec[keyOf(u)] = { status: r.status, body }; console.log(r.status, keyOf(u).slice(0, 120)); return new Response(body, { status: r.status }); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const { cams } = JSON.parse(await readFile("cams.json", "utf8"));
const byId = id => cams.find(c => c.id === id);
const watch = JSON.parse(await readFile("watchlist.json", "utf8")).map(byId).filter(Boolean);
const tryit = async (name, fn) => { try { await fn(); } catch (e) { console.log("FAIL", name, e.message); } await sleep(1500); };
await tryit("weather", () => fetchWeather(watch, recFetch));
await tryit("plan", () => fetchPlan(watch, 7, recFetch));
for (const id of ["hintereisferner1", "saasgrund-hohsaas", "ruefikopf", "jungfraujoch", "lech"]) {
  await tryit("plan1 " + id, () => fetchPlan([byId(id)], 7, recFetch));
}
for (const c of watch) await tryit("hist " + c.id, () => fetchHistory(c, 7, recFetch));
await tryit("grid", () => fetchGrid(GRID, 3, recFetch));
const end = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
for (const c of watch) await tryit("era5 " + c.id, () => fetchArchiveDaily(c, "2021-09-01", end, recFetch));
await writeFile("fixtures.json", JSON.stringify(rec));
console.log("recorded", Object.keys(rec).length);
