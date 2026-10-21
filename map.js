// Map view: cams, rain/snow radar (RainViewer) and forecast snowfall as a grid (Open-Meteo).
import { fetchGrid } from "./snow.js";
import { $, esc, f0, fmtTime, fmtWd, fmtDM, cached } from "./util.js";

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
let L, map, layers = {}, radar = { frames: [], idx: 0, timer: null }, mode = "radar", ctxRef;

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return new Promise((res, rej) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = LEAFLET + "leaflet.min.css"; document.head.appendChild(css);
    const s = document.createElement("script"); s.src = LEAFLET + "leaflet.min.js"; s.onload = () => res(window.L); s.onerror = rej; document.head.appendChild(s);
  });
}

const dark = () => matchMedia("(prefers-color-scheme: dark)").matches;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export async function renderMap(ctx) {
  ctxRef = ctx;
  if (!map) {
    try { L = await loadLeaflet(); } catch { $("map").innerHTML = `<p class="note">Die Karte konnte nicht geladen werden.</p>`; return; }
    map = L.map("map", { zoomControl: true, attributionControl: true, minZoom: 5, maxZoom: 12 }).setView([46.75, 10.2], 7);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "basemap", attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layers.cams = L.layerGroup().addTo(map);
    layers.grid = L.layerGroup();
    layers.radar = L.layerGroup().addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 50);
  drawCams();
  setMode(mode);
}

function drawCams() {
  layers.cams.clearLayers();
  const showAll = $("mapAll").getAttribute("aria-pressed") === "true";
  const watched = new Set(ctxRef.watched().map(c => c.id));
  const list = showAll ? ctxRef.catalog().filter(c => watched.has(c.id) || c.elev >= 1500) : ctxRef.watched();
  for (const c of list.sort((a, b) => watched.has(a.id) - watched.has(b.id))) {
    const st = ctxRef.statusOf(c), w = watched.has(c.id);
    const m = L.circleMarker([c.lat, c.lon], {
      radius: w ? 7 : 3.5, weight: w ? 1.5 : 0, color: css("--ink"),
      fillColor: st === "snow" ? css("--accent") : w ? css("--paper") : css("--mute"), fillOpacity: w ? 1 : .7,
    }).addTo(layers.cams);
    const a = ctxRef.analyses[c.id];
    m.bindTooltip(`<b>${esc(c.name)}</b> · ${c.elev} m${a ? `<br>${ctxRef.stateText(c)} · ${f0(a.temp)} °C · ${f0(a.next24)} cm in 24 h` : ""}`, { direction: "top", offset: [0, -6] });
    m.on("click", () => { location.hash = encodeURIComponent(c.id); });
  }
}

function setMode(m) {
  mode = m;
  [...$("mapMode").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m));
  $("radarCtl").hidden = m !== "radar";
  clearInterval(radar.timer); radar.timer = null; $("radarPlay").textContent = "▶ Abspielen";
  if (m === "radar") { map.removeLayer(layers.grid); layers.radar.addTo(map); loadRadar(); legend("radar"); }
  else { map.removeLayer(layers.radar); layers.grid.addTo(map); loadGrid(+m); legend("snow"); }
}

// RainViewer: radar frames of the past 2 h (10 min apart), snow shown in its own colours
async function loadRadar() {
  let d;
  try { d = await fetch("https://api.rainviewer.com/public/weather-maps.json").then(r => r.json()); }
  catch { $("radarTime").textContent = "Radar nicht verfügbar"; return; }
  layers.radar.clearLayers();
  radar.frames = [...(d.radar?.past || []), ...(d.radar?.nowcast || [])].map(f => ({
    time: f.time * 1000, future: (d.radar?.nowcast || []).includes(f),
    layer: L.tileLayer(`${d.host}${f.path}/256/{z}/{x}/{y}/4/1_1.png`, { opacity: 0, maxNativeZoom: 7, maxZoom: 12, attribution: '<a href="https://www.rainviewer.com/">RainViewer</a>' }).addTo(layers.radar),
  }));
  radar.idx = (d.radar?.past || []).length - 1;
  $("radarScrub").max = radar.frames.length - 1;
  showRadar(radar.idx);
}
function showRadar(i) {
  radar.frames.forEach((f, k) => f.layer.setOpacity(k === i ? .75 : 0));
  radar.idx = i; $("radarScrub").value = i;
  const f = radar.frames[i];
  $("radarTime").textContent = f ? `${fmtTime(f.time)}${f.future ? " · Vorhersage" : ""}` : "";
}

// Forecast grid over the Alps: about 0.2° × 0.3° cells, snowfall summed over 1–3 days
export const GRID = (() => { const p = []; for (let la = 45.7; la <= 47.95; la += .2) for (let lo = 5.9; lo <= 13.9; lo += .3) p.push([+la.toFixed(2), +lo.toFixed(2)]); return p; })();
async function loadGrid(days) {
  layers.grid.clearLayers();
  $("mapNote").textContent = "Prognose wird geladen …";
  let g;
  try { g = await cached("grid3", 60 * 60e3, () => fetchGrid(GRID, 3)); }
  catch { $("mapNote").textContent = "Prognose gerade nicht verfügbar."; return; }
  const accent = css("--accent");
  for (const p of g) {
    const sum = p.snow.slice(0, days).reduce((s, v) => s + v, 0);
    if (sum < .5) continue;
    const a = Math.min(.8, .12 + sum / 40 * .68);
    L.rectangle([[p.lat - .1, p.lon - .15], [p.lat + .1, p.lon + .15]], { stroke: false, fillColor: accent, fillOpacity: a, interactive: true })
      .bindTooltip(`${f0(sum)} cm in ${days * 24} h · Gitterpunkt ${f0(p.elev)} m`).addTo(layers.grid);
  }
  const t0 = Date.parse(g[0].days[0] + "T12:00:00Z"), t1 = Date.parse(g[0].days[days - 1] + "T12:00:00Z");
  $("mapNote").textContent = `Neuschnee ${fmtWd(t0)} ${fmtDM(t0)} bis ${fmtWd(t1)} ${fmtDM(t1)} · auf Höhe des Geländes im Gitter, Gipfel bekommen meist mehr`;
}

function legend(kind) {
  $("mapLegend").innerHTML = kind === "radar"
    ? `<span>Niederschlagsradar, Schnee in Weiß-Blau-Tönen</span>`
    : [1, 5, 10, 20, 40].map(v => `<span><i style="background:color-mix(in srgb, var(--accent) ${Math.round(Math.min(.8, .12 + v / 40 * .68) * 100)}%, transparent)"></i>${v} cm</span>`).join("");
  if (kind === "radar") $("mapNote").textContent = "Radar der letzten 2 Stunden und 30 Minuten Vorhersage, alle 10 Minuten.";
}

export function initMapControls() {
  $("mapMode").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b && map) setMode(b.dataset.mode); });
  $("mapAll").onclick = () => { $("mapAll").setAttribute("aria-pressed", $("mapAll").getAttribute("aria-pressed") !== "true"); if (map) drawCams(); };
  $("radarScrub").addEventListener("input", e => { clearInterval(radar.timer); radar.timer = null; $("radarPlay").textContent = "▶ Abspielen"; showRadar(+e.target.value); });
  $("radarPlay").onclick = () => {
    if (radar.timer) { clearInterval(radar.timer); radar.timer = null; $("radarPlay").textContent = "▶ Abspielen"; return; }
    $("radarPlay").textContent = "❚❚ Pause";
    radar.timer = setInterval(() => showRadar((radar.idx + 1) % radar.frames.length), 600);
  };
}
export const refreshMapCams = () => { if (map && !$("viewMap").hidden) drawCams(); };
