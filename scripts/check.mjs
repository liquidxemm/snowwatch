// Alert job: checks every cam in watchlist.json, pushes to ntfy when snow starts, is coming, or stops.
// Run by .github/workflows/snowcheck.yml. State lives in data/state.json, history in data/log.json.
import { readFile, writeFile } from "node:fs/promises";
import { fetchWeather, analyse, step, describe, seasonOf } from "../snow.js";

const root = new URL("../", import.meta.url);
const readJson = async (p, d) => { try { return JSON.parse(await readFile(new URL(p, root), "utf8")); } catch { return d; } };
const writeJson = (p, v) => writeFile(new URL(p, root), JSON.stringify(v, null, 1) + "\n");

const topic = process.env.NTFY_TOPIC || "";
const soonCm = parseFloat(process.env.SOON_CM || "0.5");
const dashboard = process.env.DASHBOARD_URL || "";
const dryRun = process.argv.includes("--dry-run");

const { cams: catalog } = await readJson("cams.json", { cams: [] });
const watch = await readJson("watchlist.json", []);
const cams = watch.map(id => catalog.find(c => c.id === id)).filter(Boolean);
const missing = watch.filter(id => !catalog.some(c => c.id === id));
if (missing.length) console.warn("Not in cams.json, skipped:", missing.join(", "));

const state = await readJson("data/state.json", {});
const log = await readJson("data/log.json", []);
const now = Date.now();
const season = seasonOf(now);
const hadSnowThisSeason = id => log.some(e => e.id === id && (e.type === "start" || e.type === "first") && seasonOf(e.t) === season);

const weather = await fetchWeather(cams);
const pushes = [];
cams.forEach((cam, i) => {
  const a = analyse(weather[i], now);
  const { state: next, events } = step(state[cam.id], a, now, { soonCm, firstOfSeason: !hadSnowThisSeason(cam.id) });
  state[cam.id] = next;
  for (const ev of events) {
    const { title, body } = describe(ev, cam, a);
    log.push({ t: ev.t, id: cam.id, name: cam.name, type: ev.type, msg: body, past24: +a.past24.toFixed(1), temp: a.temp });
    if (ev.type !== "stop") pushes.push({ cam, title, body });
  }
  console.log(`${cam.name.padEnd(26)} ${String(cam.elev).padStart(4)} m  ${a.snowingNow ? "SNOW" : "    "}  ${a.temp} °C  now ${a.snowRate} cm  24h ${a.past24.toFixed(1)}  next24 ${a.next24.toFixed(1)}  ${events.map(e => e.type).join(",")}`);
});

for (const p of pushes) {
  console.log("PUSH", p.title, "|", p.body);
  if (!topic || dryRun) continue;
  const headers = { Title: p.title, Tags: "snowflake", Priority: p.title.startsWith("❄") ? "high" : "default" };
  if (p.cam.img) headers.Attach = p.cam.img;
  headers.Click = dashboard || p.cam.page;
  const r = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: "POST", body: p.body, headers });
  if (!r.ok) console.error("ntfy answered", r.status, await r.text());
}
if (pushes.length && !topic) console.warn("NTFY_TOPIC is not set, so nothing was pushed.");

if (!dryRun) {
  await writeJson("data/state.json", state);
  await writeJson("data/log.json", log.slice(-500));
}
