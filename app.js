import { fetchWeather, fetchHistory, analyse, step, describe, seasonOf, snowBetween, snowEventStart, hourIndex, CODE_TEXT } from "./snow.js?v=mvhzitr4";
import { hasArchive, isPanorama, findFrame, latestUrl } from "./archive.js?v=mvhzitr4";
import { H, $, esc, f1, f0, fmtWhen, fmtTime, fmtDay, isDay, lastDaylight, touch, fmtSpan, store, dayKey } from "./util.js?v=mvhzitr4";
import { renderPlanner, renderModels } from "./plan.js?v=mvhzitr4";
import { renderMap, initMapControls, refreshMapCams } from "./map.js?v=mvhzitr4";
import { renderSeason, renderEvent, renderYears } from "./season.js?v=mvhzitr4";

const VIS_URL = "https://raw.githubusercontent.com/liquidxemm/snowwatch/data/vis.json";
const VIS_LABEL = { clear: "klar", drops: "Tropfen / unscharf", fog: "Nebel / Schneetreiben", dark: "dunkel" };
let vis = {};
async function loadVis() {
  try { const r = await fetch(VIS_URL + "?t=" + Math.floor(Date.now() / 300e3)); if (r.ok) vis = (await r.json()).cams || {}; } catch {}
}
const visOf = c => { const v = vis[c.id]; return v && Date.now() - v.t < 2 * H ? v : null; };

const REPO = "liquidxemm/snowwatch";
const WEATHER_EVERY = 10 * 60e3, IMAGE_EVERY = 5 * 60e3;
let catalog = [], repoWatch = [], analyses = store.get("analyses", {}), local = store.get("state", {});
let added = new Set(store.get("added", [])), removed = new Set(store.get("removed", []));
const byId = id => catalog.find(c => c.id === id);
const watched = () => [...repoWatch.filter(id => !removed.has(id)), ...[...added].filter(id => !repoWatch.includes(id))].map(byId).filter(Boolean);
const isWatched = id => watched().some(c => c.id === id);
const saveLocal = () => { store.set("added", [...added]); store.set("removed", [...removed]); };
const ctx = {
  watched: () => watched(), catalog: () => catalog, byId: id => byId(id), get analyses() { return analyses; },
  statusOf: c => statusOf(c), stateText: c => stateText(c),
};
function toggleWatch(id) {
  if (isWatched(id)) { added.delete(id); if (repoWatch.includes(id)) removed.add(id); }
  else { removed.delete(id); if (!repoWatch.includes(id)) added.add(id); }
  saveLocal();
}

const bust = url => url + (url.includes("?") ? "&" : "?") + "t=" + Math.floor(Date.now() / IMAGE_EVERY);
const statusOf = c => { const a = analyses[c.id]; return !a ? "none" : a.snowingNow ? "snow" : a.next3 >= 0.5 ? "soon" : "dry"; };
const stateText = c => { const s = statusOf(c), a = analyses[c.id]; return s === "snow" ? "Schneefall" : s === "soon" ? "Schnee in < 3 h" : a ? (CODE_DE[a.code] || CODE_TEXT[a.code] || "–") : "–"; };
const sq = c => `<i class="sq ${statusOf(c)}" aria-hidden="true"></i>`;
const CODE_DE = { 0: "klar", 1: "meist klar", 2: "teils bewölkt", 3: "bedeckt", 45: "Nebel", 48: "Raureifnebel", 51: "Niesel", 53: "Niesel", 55: "Niesel",
  56: "gefr. Niesel", 57: "gefr. Niesel", 61: "Regen", 63: "Regen", 65: "starker Regen", 66: "gefr. Regen", 67: "gefr. Regen",
  71: "leichter Schneefall", 73: "Schneefall", 75: "starker Schneefall", 77: "Schneegriesel", 80: "Schauer", 81: "Schauer", 82: "starke Schauer",
  85: "Schneeschauer", 86: "starke Schneeschauer", 95: "Gewitter", 96: "Gewitter", 99: "Gewitter" };

/* ---------- overview ---------- */

function bars(a, max) {
  const W = 240, Hh = 22, n = a.series.length, bw = W / n;
  let out = `<line x1="0" y1="${Hh - .5}" x2="${W}" y2="${Hh - .5}" stroke="var(--rule)"/>`;
  a.series.forEach((v, i) => {
    const h = Math.min(1, v / max) * (Hh - 2);
    if (h > 0) out += `<rect x="${(i * bw).toFixed(1)}" y="${(Hh - h).toFixed(1)}" width="${(bw * .72).toFixed(1)}" height="${h.toFixed(1)}" fill="${i <= a.idxNow ? "var(--accent)" : "var(--mute)"}" opacity="${i <= a.idxNow ? 1 : .55}"/>`;
  });
  const nx = ((a.idxNow + 1) * bw).toFixed(1);
  return `<svg class="bars" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="Stündlicher Schneefall, letzte und nächste 24 Stunden">${out}<line x1="${nx}" y1="0" x2="${nx}" y2="${Hh}" stroke="var(--ink)" stroke-width=".75"/></svg>`;
}

function renderHero(list) {
  const as = list.map(c => [c, analyses[c.id]]).filter(([, a]) => a);
  const snowing = as.filter(([, a]) => a.snowingNow);
  if (!as.length) {
    $("big").innerHTML = `–<small>/${list.length}</small>`;
    ["fLine", "fPast", "fNext", "fFrz"].forEach(id => $(id).textContent = "–");
    $("lede").textContent = "Wetterdaten werden geladen.";
    return;
  }
  $("big").innerHTML = `${snowing.length}<small>/${list.length}</small>`;
  const camBtn = c => `<button data-open="${esc(c.id)}">${esc(c.name)}</button>`;
  const low = snowing.slice().sort((x, y) => x[0].elev - y[0].elev)[0];
  $("fLine").innerHTML = low ? `${low[0].elev} m ${camBtn(low[0])}` : `– <span>kein Schneefall</span>`;
  const maxBy = k => as.slice().sort((x, y) => y[1][k] - x[1][k])[0];
  const p = maxBy("past24"), n = maxBy("next24");
  $("fPast").innerHTML = p ? `${f1(p[1].past24)} cm ${camBtn(p[0])}` : "–";
  $("fNext").innerHTML = n ? `${f1(n[1].next24)} cm ${camBtn(n[0])}` : "–";
  const fl = as.map(([, a]) => a.freezingLevel).filter(v => v != null);
  $("fFrz").innerHTML = fl.length ? `${Math.round(fl.reduce((s, v) => s + v, 0) / fl.length / 10) * 10} m` : "–";
  $("lede").textContent = snowing.length ? "Beobachtete Cams, an denen es gerade schneit. Klick auf eine Cam für Zeitraffer und Vorher/Nachher." : "Gerade schneit es an keiner deiner Cams.";
  document.title = snowing.length ? `${snowing.length}/${list.length} schneit · Snowwatch` : "Snowwatch";
}

let wallAgo = 0, wallToken = 0;
function renderWall(list) {
  const order = { snow: 0, soon: 1, dry: 2, none: 3 };
  const vscore = c => visOf(c)?.score ?? 50;
  const withImg = list.filter(c => c.img).sort((x, y) => order[statusOf(x)] - order[statusOf(y)] || (statusOf(x) === "snow" ? vscore(y) - vscore(x) : 0) || y.elev - x.elev);
  const noImg = list.filter(c => !c.img).sort((x, y) => y.elev - x.elev);
  const token = ++wallToken;
  $("wall").innerHTML = withImg.map(c => {
    const a = analyses[c.id];
    const src = wallAgo ? "" : esc(bust(c.img));
    return `<button class="tile" data-open="${esc(c.id)}">
      <span class="frame">${src ? `<img src="${src}" alt="Aktuelles Bild ${esc(c.name)}" loading="lazy" onerror="this.style.visibility='hidden'">` : `<img data-id="${esc(c.id)}" alt="${esc(c.name)} vor ${wallAgo} h" style="opacity:0">`}
        ${wallAgo ? `<span class="when" data-when="${esc(c.id)}">vor ${wallAgo === 168 ? "7 Tagen" : wallAgo + " h"}</span>` : visOf(c) ? `<span class="vis ${visOf(c).cls}">Sicht: ${VIS_LABEL[visOf(c).cls]}</span>` : ""}</span>
      <span class="cap"><span class="alt">${c.elev}</span><b>${esc(c.name)}</b>${sq(c)}</span>
      <span class="sub" style="display:block">${stateText(c)}${a ? ` · ${f1(a.temp)} °C · ${f1(a.past24)} cm in 24 h` : ""}</span></button>`;
  }).join("") || `<p class="note">Du beobachtest keine Cams. Füge welche unter „Alle Cams“ hinzu.</p>`;
  $("links").hidden = !noImg.length;
  $("links").innerHTML = `<span class="mute">Ohne Bildarchiv (360°-Viewer der Skigebiete)</span>` + noImg.map(c => `<button data-open="${esc(c.id)}">${sq(c)}&ensp;${esc(c.name)}</button>`).join("");
  if (wallAgo) {
    const t = Date.now() - wallAgo * H;
    withImg.forEach(async c => {
      const f = await findFrame(c, t, "view");
      if (token !== wallToken) return;
      const img = document.querySelector(`#wall img[data-id="${CSS.escape(c.id)}"]`);
      const lab = document.querySelector(`#wall [data-when="${CSS.escape(c.id)}"]`);
      if (!img) return;
      if (f) { img.src = f.url; img.style.opacity = 1; if (lab) lab.textContent = fmtWhen(f.t); }
      else if (lab) lab.textContent = "kein Archivbild";
    });
  }
}

function renderBoard(list) {
  const rows = list.slice().sort((x, y) => y.elev - x.elev);
  const max = Math.max(0.5, ...rows.map(c => analyses[c.id]).filter(Boolean).flatMap(a => a.series));
  $("board").innerHTML = `<div class="brow head"><span>m</span><span>Cam</span><span class="st">Jetzt</span><span class="n">°C</span><span class="n c-now">cm 24 h</span><span class="n">cm +24 h</span><span class="tl c-tl"><span>−24 h</span><span>jetzt</span><span>+24 h</span></span></div>` +
    rows.map(c => {
      const a = analyses[c.id];
      return `<div class="brow"><span class="alt">${c.elev}</span>
        <button class="name" data-open="${esc(c.id)}">${sq(c)}&ensp;${esc(c.name)}</button>
        <span class="st">${stateText(c)}</span>
        <span class="n">${a ? f1(a.temp) : "–"}</span>
        <span class="n c-now ${a && a.past24 >= 1 ? "hot" : ""}">${a ? f1(a.past24) : "–"}</span>
        <span class="n ${a && a.next24 >= 5 ? "hot" : ""}">${a ? f1(a.next24) : "–"}</span>
        <span class="c-tl">${a ? bars(a, max) : ""}</span></div>`;
    }).join("");
}

function renderWatch() { const list = watched(); renderHero(list); renderWall(list); renderBoard(list); }

function renderCatalog() {
  const q = $("q").value.trim().toLowerCase(), cc = $("country").value, min = +$("minElev").value;
  const hits = catalog.filter(c => c.elev >= min && (!cc || c.country === cc) && (!q || (c.name + " " + c.title + " " + c.id).toLowerCase().includes(q)));
  $("catCount").textContent = `${hits.length} von ${catalog.length} Cams`;
  const thumbOf = c => c.img.includes("foto-webcam.eu") ? c.img.replace("/816.jpg", "/400.jpg") : c.img.replace(/\/medium$/, "/thumbnail");
  $("catalog").innerHTML = hits.slice(0, 250).map(c => `<div class="brow crow">
      <span class="alt">${c.elev}</span>
      <button data-open="${esc(c.id)}">${c.img ? `<img class="thumb" src="${esc(thumbOf(c))}" alt="" loading="lazy">` : `<span class="thumb"></span>`}</button>
      <button class="title" data-open="${esc(c.id)}"><b style="font-weight:500">${esc(c.name)}</b><span>${esc(c.title)}</span></button>
      <span class="cc mute">${c.country.toUpperCase()}</span>
      <button class="tog ${isWatched(c.id) ? "on" : ""}" data-toggle="${esc(c.id)}">${isWatched(c.id) ? "■ Beobachtet" : "□ Beobachten"}</button></div>`).join("");
}

async function renderLog() {
  $("season").textContent = `Saison ${seasonOf(Date.now())}`;
  const kind = { first: "Erster Schnee der Saison.", start: "Schneefall beginnt.", stop: "Schneefall vorbei.", soon: "Schnee im Anmarsch." };
  try {
    const r = await fetch("data/log.json", { cache: "no-store" });
    const log = r.ok ? await r.json() : [];
    $("log").innerHTML = log.length ? log.slice().reverse().slice(0, 80).map(e => `<div class="${e.type}">
        <time>${fmtWhen(e.t)}</time>
        <span><b style="font-weight:500">${esc(e.name)}</b> ${kind[e.type] || ""} ${e.type === "stop" ? `${f1(e.past24)} cm in 24 h.` : `${f1(e.temp)} °C.`}</span></div>`).join("")
      : `<div><time>–</time><span>Noch keine Einträge. Sie erscheinen, sobald der GitHub-Check gelaufen ist.</span></div>`;
  } catch { $("log").innerHTML = `<div><time>–</time><span>Das Log lädt, wenn die Seite über GitHub Pages läuft.</span></div>`; }
}

function renderRobust() {
  const rows = Object.entries(vis).map(([id, v]) => ({ c: byId(id), v })).filter(x => x.c && x.v.snowN >= 3)
    .map(x => ({ ...x, rate: x.v.clearSnowN / x.v.snowN })).sort((a, b) => b.rate - a.rate || b.v.snowN - a.v.snowN).slice(0, 15);
  $("robust").innerHTML = rows.length ? `<div class="robust">${rows.map(({ c, v, rate }) => `<div><span class="alt">${c.elev}</span>
      <button data-open="${esc(c.id)}">${esc(c.name)}</button><span class="bar"><i style="width:${Math.round(rate * 100)}%"></i></span>
      <span class="n">${Math.round(rate * 100)} % klar</span></div>`).join("")}</div>
      <p class="note">Anteil klarer Bilder während Schneefall, aus der Sichtbewertung alle 30 Minuten (${Object.keys(vis).length} Cams ab 2000 m). Gezählt ab 3 Schneefall-Messungen pro Cam.</p>`
    : `<p class="note">Die Sichtbewertung läuft alle 30 Minuten für alle Cams ab 2000 m und lernt bei jedem Schneefall dazu. Die Rangliste erscheint, sobald genug Messungen während Schneefall vorliegen.</p>`;
}

/* ---------- cam view ---------- */

const cv = { yrsDate: "", cam: null, hist: null, mode: "tl", rangeH: 48, nightSkip: true, frames: [], idx: 0, playing: false, before: 0, after: 0, beforeKey: "", split: 50, token: 0 };

function frameTimes(c, hours) {
  const step = Math.max((c.interval || 600) * 1000, hours > 48 ? H : hours > 24 ? 1800e3 : 0);
  const end = Math.floor(Date.now() / step) * step, out = [];
  for (let t = end - hours * H; t <= end; t += step) if (!cv.nightSkip || isDay(t) || t === end) out.push(t);
  return out;
}

async function openCam(id) {
  const c = byId(id); if (!c) return;
  cv.cam = c; cv.hist = null; cv.playing = false; cv.token++;
  showView("cam");
  window.scrollTo(0, 0);
  $("cName").textContent = c.name;
  $("cMeta").textContent = `${c.elev} m · ${c.country.toUpperCase()} · ${c.title}`;
  $("cLink").href = c.page;
  $("cWatch").textContent = isWatched(c.id) ? "■ Beobachtet" : "□ Beobachten";
  $("cMode").hidden = !hasArchive(c);
  setMode(hasArchive(c) ? cv.mode : "tl");
  $("play").hidden = !hasArchive(c);
  renderModels(c);
  cv.hist = await loadHistory(c);
  if (cv.cam !== c) return;
  cv.after = Date.now();
  const ev = cv.hist && snowEventStart(cv.hist, Date.now());
  cv.before = ev ? lastDaylight(ev) : Date.now() - 24 * H; cv.beforeKey = ev ? "event" : "24";
  if (cv.pending) { cv.before = cv.pending.before; cv.after = cv.pending.after; cv.beforeKey = ""; cv.pending = null; }
  renderCam();
}

const histCache = new Map();
async function loadHistory(c, tries = 3) {
  const hit = histCache.get(c.id);
  if (hit && Date.now() - hit.at < WEATHER_EVERY) return hit.h;
  for (let k = 0; k < tries; k++) {
    try { const h = await fetchHistory(c, 7); histCache.set(c.id, { h, at: Date.now() }); return h; }
    catch { await new Promise(r => setTimeout(r, 5000 * (k + 1))); if (cv.cam !== c) return null; }
  }
  return null;
}

function setMode(m) {
  cv.mode = m; cv.playing = false;
  [...$("cMode").children].forEach(b => b.setAttribute("aria-pressed", b.dataset.mode === m));
  $("cmpBox").hidden = m !== "cmp";
  $("tlCtrl").hidden = m !== "tl";
  $("stage").hidden = $("tlBox").hidden = m === "yrs";
  $("yrsBox").hidden = m !== "yrs";
  renderCam();
}

function renderCam() {
  const c = cv.cam; if (!c) return;
  const stage = $("stage");
  if (cv.mode === "yrs" && hasArchive(c)) {
    cv.frames = frameTimes(c, cv.rangeH); cv.idx = cv.frames.length - 1;
    $("cHint").textContent = "Dieselbe Cam am selben Tag, jeweils um 12 Uhr";
    $("yrsDate").value = cv.yrsDate || dayKey(Date.now());
    renderYears(c, $("yrsDate").value);
    renderFigs();
    return;
  }
  stage.className = "stage";
  if (!hasArchive(c)) {
    stage.classList.add("none");
    stage.innerHTML = `<div class="msg">Diese Cam hat kein offenes Bildarchiv. <a href="${esc(c.page)}" target="_blank" rel="noopener">360°-Viewer öffnen ↗</a></div>`;
    $("cHint").textContent = "";
    cv.frames = frameTimes(c, cv.rangeH); cv.idx = cv.frames.length - 1;
  } else if (cv.mode === "tl") {
    stage.classList.add(isPanorama(c) ? "pano" : "photo");
    stage.innerHTML = isPanorama(c) ? `<div class="strip"><img id="sImg" alt=""></div><span class="stamp" id="sStamp"></span>` : `<img id="sImg" alt=""><span class="stamp" id="sStamp"></span>`;
    $("cHint").textContent = isPanorama(c) ? "360°: zum Umsehen wischen oder ziehen" : touch ? "Auf der Zeitleiste wischen" : "Pfeiltasten ← → springen, Leertaste spielt ab";
    cv.frames = frameTimes(c, cv.rangeH);
    cv.idx = cv.frames.length - 1;
    showFrame(true);
  } else {
    stage.classList.add(isPanorama(c) ? "pano" : "photo", "cmp");
    stage.innerHTML = isPanorama(c)
      ? `<div class="strip"><div style="position:relative"><img id="bImg" alt="Vorher"><span class="stamp" id="bStamp"></span></div><div style="position:relative"><img id="aImg" alt="Nachher"><span class="stamp" id="aStamp"></span></div></div>`
      : `<img id="aImg" alt="Nachher"><img id="bImg" class="before" alt="Vorher"><div class="split"></div><span class="stamp" id="bStamp"></span><span class="stamp r" id="aStamp"></span>`;
    stage.style.setProperty("--split", cv.split + "%");
    $("cHint").textContent = isPanorama(c) ? "Oben vorher, unten nachher, beide scrollen gemeinsam" : "Trennlinie ziehen";
    renderPresets();
    loadCompare();
  }
  renderChart();
  renderFigs();
}

async function setImg(el, f, fallback) {
  if (!el) return;
  if (!f) { el.removeAttribute("src"); el.alt = fallback; return; }
  await new Promise(res => { const im = new Image(); im.onload = im.onerror = res; im.src = f.url; });
  el.src = f.url;
}

async function showFrame(latest = false) {
  const c = cv.cam, t = cv.frames[cv.idx], token = cv.token;
  const size = isPanorama(c) ? (innerWidth > 900 && !cv.playing ? "large" : "view") : (cv.playing ? "view" : "large");
  $("stage").classList.add("loading");
  let f;
  if (latest && c.source === "foto-webcam.eu") f = { url: bust(await latestUrl(c, size)), t: Date.now() };
  else f = await findFrame(c, t, size);
  if (token !== cv.token || cv.cam !== c) return;
  await setImg($("sImg"), f, "Kein Bild zu diesem Zeitpunkt");
  $("stage").classList.remove("loading");
  $("sStamp").textContent = f ? (latest ? `Jetzt · ${fmtTime(Date.now())}` : fmtWhen(f.t)) : `${fmtWhen(t)} · kein Bild`;
  if ($("sImg")) $("sImg").alt = `${c.name}, ${f ? fmtWhen(f.t) : ""}`;
  updateCursor();
  renderFigs();
}

async function play() {
  if (cv.playing) { cv.playing = false; $("play").textContent = "▶ Abspielen"; return; }
  cv.playing = true; $("play").textContent = "❚❚ Pause";
  if (cv.idx >= cv.frames.length - 1) cv.idx = 0;
  const token = cv.token;
  while (cv.playing && token === cv.token && cv.idx < cv.frames.length - 1) {
    cv.idx++;
    const t0 = performance.now();
    await showFrame();
    const wait = 140 - (performance.now() - t0);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }
  cv.playing = false; $("play").textContent = "▶ Abspielen";
  if (token === cv.token && cv.idx === cv.frames.length - 1) showFrame(true);
}

function presetList() {
  const now = Date.now(), list = [];
  const ev = cv.hist && snowEventStart(cv.hist, cv.after);
  if (ev) list.push(["event", `Vor dem Schneefall · ${fmtWhen(lastDaylight(ev))}`, lastDaylight(ev)]);
  list.push(["6", "−6 h", cv.after - 6 * H], ["24", "−24 h", cv.after - 24 * H], ["48", "−48 h", cv.after - 48 * H], ["168", "−7 Tage", cv.after - 168 * H], ["365", "vor 1 Jahr", cv.after - 365 * 24 * H]);
  return list;
}
function renderPresets() {
  $("presets").innerHTML = presetList().map(([k, label]) => `<button data-preset="${k}" aria-pressed="${k === cv.beforeKey}">${label}</button>`).join("");
  $("tBefore").value = toInput(cv.before); $("tAfter").value = toInput(cv.after);
}
const toInput = t => { const d = new Date(t), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

async function loadCompare() {
  const c = cv.cam, token = cv.token, size = isPanorama(c) ? "view" : "large";
  $("stage").classList.add("loading");
  const isNow = Date.now() - cv.after < 20 * 60e3;
  const [fb, fa] = await Promise.all([findFrame(c, cv.before, size), isNow && c.source === "foto-webcam.eu" ? latestUrl(c, size).then(u => ({ url: bust(u), t: Date.now() })) : findFrame(c, cv.after, size)]);
  if (token !== cv.token || cv.mode !== "cmp") return;
  await Promise.all([setImg($("bImg"), fb, "Kein Bild"), setImg($("aImg"), fa, "Kein Bild")]);
  $("stage").classList.remove("loading");
  $("bStamp").textContent = "Vorher · " + (fb ? fmtWhen(fb.t) : "kein Bild");
  $("aStamp").textContent = "Nachher · " + (fa ? (isNow ? "jetzt" : fmtWhen(fa.t)) : "kein Bild");
  renderChart(); renderFigs();
}

// Chart: hourly snowfall bars + temperature line over the visible range
function chartRange() {
  if (cv.mode === "cmp") { const a = Math.min(cv.before, cv.after), b = Math.max(cv.before, cv.after); const pad = Math.max(3 * H, (b - a) * .15); return [a - pad, Math.min(Date.now(), b + pad)]; }
  return [cv.frames[0] ?? Date.now() - cv.rangeH * H, Date.now()];
}
function renderChart() {
  const h = cv.hist, svg = $("chartSvg"), [t0, t1] = chartRange();
  const W = 1000, HH = 96, x = t => ((t - t0) / (t1 - t0)) * W;
  if (!h || t0 < h.t[0] - H) {
    svg.innerHTML = ""; $("axis").innerHTML = ""; $("maxInfo").textContent = h ? "Wetterdaten reichen nur 7 Tage zurück" : "Wetterdaten nicht verfügbar";
    $("band").hidden = true; $("cursorB").hidden = true; updateCursor(); return;
  }
  svg.setAttribute("viewBox", `0 0 ${W} ${HH}`);
  const idx = h.t.map((t, i) => i).filter(i => h.t[i] > t0 && h.t[i] - H < t1);
  const maxS = Math.max(0.5, ...idx.map(i => h.snow[i]));
  const temps = idx.map(i => h.temp[i]).filter(v => v != null);
  const tMin = Math.min(-2, ...temps), tMax = Math.max(2, ...temps), y = v => HH - 6 - ((v - tMin) / (tMax - tMin)) * (HH - 14);
  const bw = Math.max(1, (H / (t1 - t0)) * W * .7);
  let out = idx.map(i => { const bh = (h.snow[i] / maxS) * (HH - 10); return bh > 0 ? `<rect x="${(x(h.t[i] - H)).toFixed(1)}" y="${(HH - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="var(--accent)"/>` : ""; }).join("");
  out += `<line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--mute)" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>`;
  out += `<polyline fill="none" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke" points="${idx.filter(i => h.temp[i] != null).map(i => `${x(h.t[i]).toFixed(1)},${y(h.temp[i]).toFixed(1)}`).join(" ")}"/>`;
  svg.innerHTML = out;
  // day ticks
  const ticks = [], d0 = new Date(t0); d0.setHours(24, 0, 0, 0);
  const every = t1 - t0 > 4 * 24 * H ? 24 * H : t1 - t0 > 30 * H ? 12 * H : 6 * H;
  for (let t = d0.getTime() - 24 * H; t < t1; t += every) if (t > t0 + (t1 - t0) * .04 && t < t1 - (t1 - t0) * .04) ticks.push(t);
  $("axis").innerHTML = ticks.map(t => `<span style="left:${(x(t) / W * 100).toFixed(2)}%">${new Date(t).getHours() === 0 ? fmtDay(t) : fmtTime(t)}</span>`).join("");
  $("maxInfo").textContent = `max ${f1(maxS)} cm/h · ${f0(tMin)} bis ${f0(tMax)} °C`;
  if (cv.mode === "cmp") {
    const a = Math.min(cv.before, cv.after), b = Math.max(cv.before, cv.after);
    $("band").hidden = false; $("band").style.left = (x(a) / W * 100) + "%"; $("band").style.width = ((x(b) - x(a)) / W * 100) + "%";
    $("cursorB").hidden = false; $("cursorB").style.left = (x(cv.before) / W * 100) + "%";
  } else { $("band").hidden = true; $("cursorB").hidden = true; }
  updateCursor();
}
function updateCursor() {
  const [t0, t1] = chartRange();
  const t = cv.mode === "cmp" ? cv.after : cv.frames[cv.idx];
  $("cursor").style.left = Math.max(0, Math.min(100, (t - t0) / (t1 - t0) * 100)) + "%";
  const s = $("scrub");
  if (cv.mode === "cmp") { s.min = 0; s.max = 1000; s.value = Math.round((cv.before - t0) / (t1 - t0) * 1000); s.setAttribute("aria-label", "Vorher-Zeitpunkt wählen"); }
  else { s.min = 0; s.max = cv.frames.length - 1; s.value = cv.idx; s.setAttribute("aria-label", "Zeitpunkt wählen"); }
  $("tlInfo").textContent = cv.mode === "tl" && cv.frames.length ? `${cv.idx + 1} / ${cv.frames.length} · ${fmtWhen(cv.frames[cv.idx])}` : "";
}

function fig(label, value, sub, hot) { return `<div class="${hot ? "hot" : ""}"><dt>${label}</dt><dd>${value}${sub ? `<span>${sub}</span>` : ""}</dd></div>`; }
function renderFigs() {
  const c = cv.cam, h = cv.hist, a = analyses[c.id];
  if (cv.mode === "cmp") {
    const inRange = t => h && t >= h.t[0];
    const at = t => h ? hourIndex(h, t) : -1;
    const snow = h && inRange(Math.min(cv.before, cv.after)) ? snowBetween(h, cv.before, cv.after) : null;
    const db = inRange(cv.before) ? h.depth[at(cv.before)] : null, da = inRange(cv.after) ? h.depth[at(cv.after)] : null;
    const tb = inRange(cv.before) ? h.temp[at(cv.before)] : null, ta = inRange(cv.after) ? h.temp[at(cv.after)] : null;
    $("figs").innerHTML =
      fig("Neuschnee dazwischen", snow == null ? "–" : `+${f1(snow)} cm`, snow == null ? "nur für die letzten 7 Tage" : `in ${fmtSpan(Math.abs(cv.after - cv.before))}`, snow >= 1) +
      fig("Schneehöhe (Modell)", db == null || da == null ? "–" : `${f0(db)} → ${f0(da)} cm`, db == null || da == null ? "" : `${da - db >= 0 ? "+" : ""}${f0(da - db)} cm`) +
      fig("Temperatur", tb == null || ta == null ? "–" : `${f1(tb)}° → ${f1(ta)}°`, "") +
      fig("Zeitraum", fmtSpan(Math.abs(cv.after - cv.before)), `${fmtWhen(cv.before)} bis ${fmtWhen(cv.after)}`);
    return;
  }
  const ev = h && snowEventStart(h, Date.now());
  const evSnow = ev ? snowBetween(h, ev, Date.now()) : 0;
  const t = cv.frames[cv.idx], i = h ? hourIndex(h, t) : -1;
  const sinceStart = h && cv.frames.length ? snowBetween(h, cv.frames[0], t) : null;
  $("figs").innerHTML =
    fig("Jetzt", a ? `${f1(a.temp)} °C` : "–", a ? stateText(c) + (a.freezingLevel != null ? ` · 0 °C auf ${Math.round(a.freezingLevel / 10) * 10} m` : "") : "", a && a.snowingNow) +
    fig("Aktueller Schneefall", ev ? `${f1(evSnow)} cm` : "–", ev ? `seit ${fmtWhen(ev + H)}` : "kein Ereignis in den letzten 3 Tagen", ev && evSnow >= 1) +
    fig("Prognose, nächste 24 h", a ? `${f1(a.next24)} cm` : "–", a ? `davon ${f1(a.next3)} cm in 3 h` : "") +
    fig("Am gewählten Zeitpunkt", i >= 0 ? `${f1(h.temp[i])} °C` : "–", i >= 0 ? `${f1(sinceStart)} cm seit Beginn der Zeitleiste · Schneehöhe ${f0(h.depth[i])} cm` : "");
}

/* ---------- interaction ---------- */

$("scrub").addEventListener("input", e => {
  const v = +e.target.value;
  if (cv.mode === "cmp") {
    const [t0, t1] = chartRange();
    cv.before = Math.min(Date.now(), t0 + (v / 1000) * (t1 - t0)); cv.beforeKey = "";
    renderPresets(); clearTimeout(cv.deb); cv.deb = setTimeout(() => { loadCompare(); }, 120);
    $("cursorB").style.left = (v / 10) + "%"; renderFigs();
  } else {
    cv.playing = false; cv.idx = v; updateCursor();
    clearTimeout(cv.deb); cv.deb = setTimeout(() => showFrame(cv.idx === cv.frames.length - 1), 60);
  }
});
$("play").onclick = play;
$("nightSkip").onclick = () => { cv.nightSkip = !cv.nightSkip; $("nightSkip").setAttribute("aria-pressed", cv.nightSkip); cv.token++; renderCam(); };
$("tlRange").addEventListener("click", e => {
  const b = e.target.closest("[data-h]"); if (!b) return;
  cv.rangeH = +b.dataset.h; [...$("tlRange").children].forEach(x => x.setAttribute("aria-pressed", x === b));
  cv.token++; renderCam();
});
$("cMode").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) { cv.token++; setMode(b.dataset.mode); } });
$("cmpBox").addEventListener("click", e => {
  const p = e.target.closest("[data-preset]"), n = e.target.closest("[data-after]");
  if (p) { const hit = presetList().find(x => x[0] === p.dataset.preset); cv.before = hit[2]; cv.beforeKey = hit[0]; }
  else if (n) { cv.after = Date.now(); }
  else return;
  cv.token++; renderPresets(); loadCompare();
});
$("tBefore").addEventListener("change", e => { const t = new Date(e.target.value).getTime(); if (t) { cv.before = t; cv.beforeKey = ""; cv.token++; renderPresets(); loadCompare(); } });
$("tAfter").addEventListener("change", e => { const t = new Date(e.target.value).getTime(); if (t) { cv.after = Math.min(t, Date.now()); cv.token++; renderPresets(); loadCompare(); } });
$("cWatch").onclick = () => { toggleWatch(cv.cam.id); $("cWatch").textContent = isWatched(cv.cam.id) ? "■ Beobachtet" : "□ Beobachten"; };

// split drag (photo compare) and pan drag (panorama)
$("stage").addEventListener("pointerdown", e => {
  const st = $("stage");
  if (st.classList.contains("photo") && st.classList.contains("cmp")) {
    const move = ev => { const r = st.getBoundingClientRect(); cv.split = Math.max(0, Math.min(100, (ev.clientX - r.left) / r.width * 100)); st.style.setProperty("--split", cv.split + "%"); };
    move(e); st.setPointerCapture(e.pointerId);
    st.onpointermove = move; st.onpointerup = st.onpointercancel = () => { st.onpointermove = null; };
  } else if (st.classList.contains("pano") && e.pointerType === "mouse") {
    const x0 = e.clientX, s0 = st.scrollLeft; st.classList.add("drag"); st.setPointerCapture(e.pointerId);
    st.onpointermove = ev => { st.scrollLeft = s0 - (ev.clientX - x0); };
    st.onpointerup = st.onpointercancel = () => { st.onpointermove = null; st.classList.remove("drag"); };
  }
});
document.addEventListener("keydown", e => {
  if ($("viewCam").hidden || cv.mode !== "tl" || /input|select|textarea/i.test(document.activeElement.tagName) && document.activeElement.id !== "scrub") return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault(); cv.playing = false;
    cv.idx = Math.max(0, Math.min(cv.frames.length - 1, cv.idx + (e.key === "ArrowLeft" ? -1 : 1)));
    updateCursor(); clearTimeout(cv.deb); cv.deb = setTimeout(() => showFrame(cv.idx === cv.frames.length - 1), 60);
  } else if (e.key === " ") { e.preventDefault(); play(); }
  else if (e.key === "Escape") location.hash = "";
});

/* ---------- alerts on this device ---------- */
let audioCtx, soundOn = false;
function chime() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    [1318.5, 1760].forEach((f, k) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime + k * .16;
      o.frequency.value = f; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.2, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + .9);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 1);
    });
  } catch {}
}
function alertUser(c, ev, a) {
  const kind = { first: "Erster Schnee der Saison", start: "Schneefall beginnt", soon: "Schnee im Anmarsch" }[ev.type];
  const body = ev.type === "soon" ? `${f1(a.next3)} cm in den nächsten 3 h` : `${f1(a.temp)} °C · ${f1(a.next24)} cm Prognose für 24 h`;
  if (soundOn) chime();
  $("banner").innerHTML = `<i class="sq snow"></i><span><b>${kind}: <button data-open="${esc(c.id)}" style="font-weight:500;text-decoration:underline">${esc(c.name)}</button></b> ${body}</span><button onclick="this.parentNode.hidden=true" aria-label="Schließen">×</button>`;
  $("banner").hidden = false;
  try { if (Notification.permission === "granted") new Notification(`❄ ${kind}: ${c.name}`, { body }); } catch {}
}

async function refresh() {
  $("status").textContent = "Aktualisiert…";
  const cams = watched();
  try {
    const ws = await fetchWeather(cams);
    const now = Date.now();
    cams.forEach((c, i) => {
      const a = analyses[c.id] = analyse(ws[i], now);
      const seen = c.id in local; // first time a cam is seen: record its state without alerting
      const { state, events } = step(local[c.id], a, now);
      local[c.id] = state;
      if (seen) for (const ev of events) if (ev.type !== "stop") alertUser(c, ev, a);
    });
    store.set("state", local); store.set("analyses", analyses); store.set("analysedAt", now);
    $("status").textContent = fmtTime(now);
  } catch {
    const at = store.get("analysedAt", 0);
    $("status").textContent = at ? `Offline · ${fmtTime(at)}` : "Wetter nicht verfügbar";
  }
  if (!$("viewWatch").hidden) renderWatch();
  if (!$("viewCam").hidden && cv.cam) renderFigs();
  refreshMapCams();
  renderLog();
}

/* ---------- navigation ---------- */
const VIEWS = { watch: "viewWatch", all: "viewAll", cam: "viewCam", plan: "viewPlan", map: "viewMap", season: "viewSeason", event: "viewEvent" };
const TABS = { watch: "tabWatch", all: "tabAll", plan: "tabPlan", map: "tabMap", season: "tabSeason", event: "tabSeason" };
function showView(v) {
  for (const [k, id] of Object.entries(VIEWS)) $(id).hidden = k !== v;
  for (const [k, id] of Object.entries(TABS)) if (k !== "event") $(id).setAttribute("aria-selected", TABS[v] === id);
  if (v !== "cam") { cv.playing = false; cv.token++; }
}
function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (id === "alle") { showView("all"); renderCatalog(); }
  else if (id === "planen") { showView("plan"); renderPlanner(ctx); }
  else if (id === "karte") { showView("map"); renderMap(ctx); }
  else if (id === "saison") { showView("season"); renderSeason(ctx); renderLog(); renderRobust(); }
  else if (id.startsWith("ereignis-")) { showView("event"); window.scrollTo(0, 0); renderEvent(ctx, id.slice(9)); }
  else if (id && byId(id)) openCam(id);
  else { showView("watch"); renderWatch(); }
}
window.addEventListener("hashchange", route);
$("tabWatch").onclick = () => { location.hash = ""; };
$("home").onclick = () => { location.hash = ""; };
$("tabAll").onclick = () => { location.hash = "alle"; };
$("tabPlan").onclick = () => { location.hash = "planen"; };
$("tabMap").onclick = () => { location.hash = "karte"; };
$("tabSeason").onclick = () => { location.hash = "saison"; };
$("planSort").addEventListener("change", () => renderPlanner(ctx));
initMapControls();
$("yrsDate").addEventListener("change", e => { if (e.target.value) { cv.yrsDate = e.target.value; renderYears(cv.cam, cv.yrsDate); } });
$("yearChips").addEventListener("click", e => { const b = e.target.closest("[data-yday]"); if (b) { cv.yrsDate = b.dataset.yday; $("yrsDate").value = cv.yrsDate; renderYears(cv.cam, cv.yrsDate); } });
$("btnRefresh").onclick = refresh;
$("btnNotify").onclick = () => {
  soundOn = !soundOn;
  $("btnNotify").classList.toggle("on", soundOn);
  $("btnNotify").textContent = soundOn ? "Ton an" : "Ton aus";
  if (soundOn) { chime(); try { Notification.requestPermission(); } catch {} }
};
document.addEventListener("click", e => {
  const ev = e.target.closest("[data-event]");
  if (ev) { location.hash = "ereignis-" + ev.dataset.event; return; }
  const card = e.target.closest("[data-cmp]");
  if (card) { cv.pending = { before: +card.dataset.b, after: +card.dataset.a }; cv.mode = "cmp"; location.hash = encodeURIComponent(card.dataset.cmp); return; }
  const fsd = e.target.closest("[data-years]");
  if (fsd) { cv.mode = "yrs"; cv.yrsDate = fsd.dataset.date; location.hash = encodeURIComponent(fsd.dataset.years); return; }
  const o = e.target.closest("[data-open]");
  if (o) { e.preventDefault(); location.hash = encodeURIComponent(o.dataset.open); return; }
  const t = e.target.closest("[data-toggle]");
  if (t) { toggleWatch(t.dataset.toggle); renderCatalog(); }
});
$("wallWhen").addEventListener("click", e => {
  const b = e.target.closest("[data-ago]"); if (!b) return;
  wallAgo = +b.dataset.ago; [...$("wallWhen").children].forEach(x => x.setAttribute("aria-pressed", x === b));
  renderWall(watched());
});
$("wallSize").addEventListener("click", e => {
  const b = e.target.closest("[data-size]"); if (!b) return;
  [...$("wallSize").children].forEach(x => x.setAttribute("aria-pressed", x === b));
  $("wall").style.setProperty("--tile", { s: "200px", m: "300px", l: "460px" }[b.dataset.size]);
  $("wall").classList.toggle("s", b.dataset.size === "s");
  store.set("tile", b.dataset.size);
});
["q", "country", "minElev"].forEach(id => $(id).addEventListener("input", renderCatalog));
$("wlLink").href = `https://github.com/${REPO}/edit/main/watchlist.json`;
$("btnCopyWl").onclick = async () => {
  const text = JSON.stringify(watched().map(c => c.id), null, 2);
  try { await navigator.clipboard.writeText(text); $("btnCopyWl").textContent = "Kopiert. In watchlist.json auf GitHub einfügen."; }
  catch { $("btnCopyWl").textContent = text; }
};
const savedTile = store.get("tile", "m");
document.querySelector(`#wallSize [data-size="${savedTile}"]`)?.click();

loadVis().then(() => { if (!$("viewWatch").hidden) renderWall(watched()); });
setInterval(loadVis, 15 * 60e3);
const [cat, wl] = await Promise.all([fetch("cams.json").then(r => r.json()), fetch("watchlist.json", { cache: "no-store" }).then(r => r.json())]);
catalog = cat.cams; repoWatch = wl;
[...new Set(catalog.map(c => c.country))].sort().forEach(cc => $("country").insertAdjacentHTML("beforeend", `<option value="${cc}">${cc.toUpperCase()}</option>`));
window.__swStarted = true;
route();
refresh();
setInterval(refresh, WEATHER_EVERY);
setInterval(() => { if (!$("viewWatch").hidden && !wallAgo) renderWall(watched()); }, IMAGE_EVERY);
