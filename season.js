// Season: first snow per season, snow events from the log, and the same-day comparison across years.
import { fetchArchiveDaily, fetchHistory, snowBetween, snowEventStart } from "./snow.js?v=mvhzwkkp";
import { hasArchive, findFrame, latestUrl } from "./archive.js?v=mvhzwkkp";
import { H, DAY, $, esc, f0, f1, fmtDM, fmtWhen, fmtDate, fmtSpan, dayKey, noonOf, lastDaylight, nextDaylight, cached } from "./util.js?v=mvhzwkkp";

const FIRST_CM = 2;         // a day with at least this much new snow counts as "first snow"
const SEASONS_BACK = 5;

const seasonStartYear = t => { const d = new Date(t), y = d.getUTCFullYear(); return d.getUTCMonth() >= 8 ? y : y - 1; };
const seasonLabel = y => `${String(y).slice(2)}/${String(y + 1).slice(2)}`;

/* ---------- events from the log ---------- */

export async function loadLog() {
  try { const r = await fetch("data/log.json", { cache: "no-store" }); return r.ok ? await r.json() : []; } catch { return []; }
}

// One snow event = per-cam snowfall intervals that overlap (12 h tolerance), across all cams.
export function groupEvents(log) {
  const open = {}, intervals = [];
  for (const e of log.slice().sort((a, b) => a.t - b.t)) {
    if (e.type === "start" || e.type === "first") { if (!open[e.id]) open[e.id] = { id: e.id, name: e.name, start: e.t, end: null, first: e.type === "first" }; }
    else if (e.type === "stop" && open[e.id]) { open[e.id].end = e.t; intervals.push(open[e.id]); delete open[e.id]; }
  }
  intervals.push(...Object.values(open));
  intervals.sort((a, b) => a.start - b.start);
  const events = [];
  for (const iv of intervals) {
    const ev = events[events.length - 1], evEnd = ev && (ev.ongoing ? Date.now() : ev.end);
    if (ev && iv.start <= evEnd + 12 * H) {
      ev.cams.push(iv); ev.ongoing = ev.ongoing || !iv.end; ev.end = Math.max(ev.end || 0, iv.end || 0);
    } else events.push({ start: iv.start, end: iv.end || 0, ongoing: !iv.end, cams: [iv] });
  }
  return events.map(e => ({ ...e, key: dayKey(e.start) })).reverse();
}

export async function renderSeason(ctx) {
  const log = await loadLog();
  const events = groupEvents(log);
  $("events").innerHTML = events.length ? events.map(e => `<button class="evrow" data-event="${e.key}">
      <span class="when">${fmtDM(e.start)}${e.ongoing ? "" : e.end && dayKey(e.end) !== e.key ? `–${fmtDM(e.end)}` : ""}</span>
      <span><b>${e.ongoing ? "Schneefall läuft" : "Schneefall"}</b> · ${e.cams.length} Cams${e.cams.some(c => c.first) ? " · erster Schnee der Saison" : ""}</span>
      <span class="mute">${esc(e.cams.slice(0, 4).map(c => c.name).join(", "))}${e.cams.length > 4 ? " …" : ""}</span></button>`).join("")
    : `<p class="note">Noch keine Schneeereignisse. Sie entstehen aus dem Saison-Log.</p>`;
  renderFirstSnow(ctx);
}

export async function renderEvent(ctx, key) {
  const ev = groupEvents(await loadLog()).find(e => e.key === key);
  if (!ev) { $("evHead").innerHTML = `<h1>Ereignis nicht gefunden</h1>`; $("evCams").innerHTML = ""; $("evFigs").innerHTML = ""; return; }
  const end = ev.ongoing ? Date.now() : ev.end;
  const cams = ev.cams.map(iv => ({ iv, c: ctx.byId(iv.id) })).filter(x => x.c);
  // The log only knows when the check first saw the snow; the weather data knows when it really started.
  const pastDays = Math.min(92, Math.ceil((Date.now() - ev.start) / DAY) + 3);
  await Promise.all(cams.map(async x => {
    x.start = x.iv.start; x.sum = null;
    try {
      const h = await fetchHistory(x.c, pastDays);
      const s0 = snowEventStart(h, x.iv.start + H);
      if (s0 && s0 < x.iv.start) x.start = s0 + H;
      x.sum = snowBetween(h, x.start - H, x.iv.end || Date.now());
    } catch {}
  }));
  if (cams.length) ev.start = Math.min(...cams.map(x => x.start));
  $("evHead").innerHTML = `<h1>Schneefall ${fmtDM(ev.start)}${!ev.ongoing && dayKey(end) !== key ? `–${fmtDM(end)}` : ""}</h1>
    <div class="meta"><span>${fmtWhen(ev.start)} bis ${ev.ongoing ? "jetzt (läuft)" : fmtWhen(end)} · ${fmtSpan(end - ev.start)}</span></div>`;
  cams.sort((a, b) => hasArchive(b.c) - hasArchive(a.c) || (b.sum ?? -1) - (a.sum ?? -1));
  const top = cams.find(x => x.sum != null), low = cams.slice().sort((a, b) => a.c.elev - b.c.elev)[0];
  $("evFigs").innerHTML =
    `<div><dt>Betroffene Cams</dt><dd>${cams.length}</dd></div>` +
    `<div class="hot"><dt>Am meisten Neuschnee</dt><dd>${top ? `${f1(top.sum)} cm<span>${esc(top.c.name)}</span>` : "–"}</dd></div>` +
    `<div><dt>Tiefste Cam mit Schnee</dt><dd>${low ? `${low.c.elev} m<span>${esc(low.c.name)}</span>` : "–"}</dd></div>` +
    `<div><dt>Dauer</dt><dd>${fmtSpan(end - ev.start)}<span>${ev.ongoing ? "läuft noch" : "abgeschlossen"}</span></dd></div>`;
  $("evCams").innerHTML = cams.map(({ c, iv, sum, start }) => {
    const before = lastDaylight(start - H), after = iv.end ? nextDaylight(iv.end) : Date.now();
    return `<figure class="evcard" data-cmp="${esc(c.id)}" data-b="${before}" data-a="${after}">
      <div class="pair">${hasArchive(c) ? `<span class="ph"><img data-src-b alt="${esc(c.name)} vorher" style="opacity:0" onload="this.style.opacity=1"><em>Vorher</em></span><span class="ph"><img data-src-a alt="${esc(c.name)} nachher" style="opacity:0" onload="this.style.opacity=1"><em>Nachher</em></span>` : `<span class="ph none wide">Kein Bildarchiv · ${esc(c.page.replace(/^https?:\/\/(www\.)?/, "").split("/")[0])}</span>`}</div>
      <figcaption><span class="alt">${c.elev}</span><b>${esc(c.name)}</b><span class="n">${sum == null ? "–" : `+${f1(sum)} cm`}</span></figcaption></figure>`;
  }).join("");
  // load images
  document.querySelectorAll("#evCams .evcard").forEach(async fig => {
    const c = ctx.byId(fig.dataset.cmp); if (!hasArchive(c)) return;
    const live = Date.now() - +fig.dataset.a < 30 * 60e3;
    const [fb, fa] = await Promise.all([findFrame(c, +fig.dataset.b, "view"),
      live ? latestUrl(c, "view").then(url => url && { url }) : findFrame(c, +fig.dataset.a, "view")]);
    const ib = fig.querySelector("[data-src-b]"), ia = fig.querySelector("[data-src-a]");
    if (fb) ib.src = fb.url; if (fa) ia.src = fa.url;
  });
}

/* ---------- first snow per season ---------- */

async function archiveFor(c) {
  const now = Date.now(), y0 = seasonStartYear(now) - SEASONS_BACK;
  const end = dayKey(now - 6 * DAY); // reanalysis lags about 5 days behind
  return cached(`era5:${c.id}:${end}`, 7 * DAY, () => fetchArchiveDaily(c, `${y0}-09-01`, end));
}

export function firstSnowBySeason(a) {
  const out = {};
  a.days.forEach((d, i) => {
    const t = Date.parse(d + "T12:00:00Z"), y = seasonStartYear(t);
    if (out[y] == null && a.snow[i] >= FIRST_CM) out[y] = d;
  });
  return out;
}
const dayOfSeason = d => (Date.parse(d + "T12:00:00Z") - Date.parse(`${seasonStartYear(Date.parse(d + "T12:00:00Z"))}-09-01T12:00:00Z`)) / DAY;

async function renderFirstSnow(ctx) {
  const cams = ctx.watched(), now = Date.now(), cur = seasonStartYear(now);
  const years = Array.from({ length: SEASONS_BACK + 1 }, (_, k) => cur - k);
  const log = await loadLog();
  $("firstSnow").innerHTML = `<p class="note">Archivdaten werden geladen …</p>`;
  const rows = [];
  for (const c of cams) {
    let fs = {};
    try { fs = firstSnowBySeason(await archiveFor(c)); } catch {}
    const logged = log.find(e => e.id === c.id && e.type === "first" && seasonStartYear(e.t) === cur);
    if (logged && !fs[cur]) fs[cur] = dayKey(logged.t);
    const past = years.slice(1).map(y => fs[y]).filter(Boolean);
    const avg = past.length ? past.reduce((s, d) => s + dayOfSeason(d), 0) / past.length : null;
    rows.push({ c, fs, avg });
  }
  rows.sort((a, b) => b.c.elev - a.c.elev);
  const avgLabel = v => { const t = Date.parse(`${cur}-09-01T12:00:00Z`) + v * DAY; return fmtDM(t); };
  $("firstSnow").innerHTML = `<div class="scrollx"><table class="ptab fs">
    <thead><tr><th class="l">Cam</th>${years.map(y => `<th>${seasonLabel(y)}</th>`).join("")}<th>Ø Vorjahre</th><th>Heuer</th></tr></thead>
    <tbody>${rows.map(({ c, fs, avg }) => {
      const nowD = fs[cur], diff = nowD && avg != null ? Math.round(dayOfSeason(nowD) - avg) : null;
      return `<tr><th class="l"><button data-open="${esc(c.id)}"><span class="alt">${c.elev}</span> ${esc(c.name)}</button></th>
        ${years.map(y => `<td>${fs[y] ? `<button class="fsd${y === cur ? " cur" : ""}" data-years="${esc(c.id)}" data-date="${fs[y]}">${fmtDM(Date.parse(fs[y] + "T12:00:00Z"))}</button>` : y === cur ? `<span class="mute">noch nicht</span>` : "–"}</td>`).join("")}
        <td>${avg != null ? avgLabel(avg) : "–"}</td>
        <td class="${diff != null && diff < 0 ? "early" : ""}">${diff == null ? "–" : diff === 0 ? "wie üblich" : `${Math.abs(diff)} T ${diff < 0 ? "früher" : "später"}`}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="note">Erster Tag ab 1. September mit mindestens ${FIRST_CM} cm Neuschnee. Aus der ERA5-Reanalyse, auf die Höhe der Cam umgerechnet (reicht bis vor 6 Tagen); was danach fällt, kommt aus dem Saison-Log. Auf Gletscherhöhe fällt der erste Schnee oft schon im September. Klick auf ein Datum zeigt die Cam an diesem Tag in allen Jahren.</p>`;
}

/* ---------- same day across years (cam view) ---------- */

export async function renderYears(c, dateStr) {
  const el = $("years");
  if (!hasArchive(c)) { el.innerHTML = `<p class="note">Diese Cam hat kein offenes Bildarchiv.</p>`; return; }
  const [Y, M, D] = dateStr.split("-").map(Number);
  const nowY = new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, k) => Y - k).filter(y => y <= nowY);
  let arch = null;
  try { arch = await archiveFor(c); } catch {}
  const fs = arch ? firstSnowBySeason(arch) : {};
  $("yearChips").innerHTML = Object.entries(fs).sort((a, b) => b[0] - a[0]).map(([y, d]) =>
    `<button data-yday="${d}" aria-pressed="${d.slice(5) === dateStr.slice(5)}">Erster Schnee ${seasonLabel(+y)}: ${fmtDM(Date.parse(d + "T12:00:00Z"))}</button>`).join("");
  el.innerHTML = years.map(y => `<figure class="yr" data-y="${y}"><span class="ph"><img alt="${esc(c.name)} ${D}.${M}.${y}"></span>
    <figcaption><b>${y}</b><span class="mute" data-snow></span></figcaption></figure>`).join("");
  for (const y of years) {
    const ds = `${y}-${String(M).padStart(2, "0")}-${String(D).padStart(2, "0")}`, t = noonOf(ds);
    const fig = el.querySelector(`[data-y="${y}"]`);
    if (arch) {
      const i = arch.days.indexOf(ds);
      if (i >= 0) { const wk = arch.snow.slice(Math.max(0, i - 6), i + 1).reduce((s, v) => s + v, 0); fig.querySelector("[data-snow]").textContent = `${f0(wk)} cm Neuschnee in der Woche davor`; }
    }
    findFrame(c, t, "view").then(f => {
      const img = fig.querySelector("img");
      if (f) img.src = f.url; else { img.replaceWith(Object.assign(document.createElement("span"), { className: "none", textContent: "Kein Bild" })); }
    });
  }
}
