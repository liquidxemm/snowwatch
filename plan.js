// Planner: 7-day outlook for watched cams, and the per-model comparison in the cam view.
import { fetchPlan, spread, powderDays, MODELS, modelTotals } from "./snow.js?v=mwyqq5rj";
import { $, esc, f0, f1, fmtWd, fmtDM, cached } from "./util.js?v=mwyqq5rj";

const PLAN_AGE = 30 * 60e3;
const tint = cm => `color-mix(in srgb, var(--accent) ${Math.round(Math.min(1, cm / 30) * 55)}%, transparent)`;
const dayHead = d => { const t = Date.parse(d + "T12:00:00Z"); return `<span class="wd">${fmtWd(t)}</span><span class="dm">${fmtDM(t)}</span>`; };

async function loadPlans(cams) {
  const key = "plan:" + cams.map(c => c.id).join(",");
  return cached(key, PLAN_AGE, () => fetchPlan(cams));
}

// Score a ski day 0–100: fresh snow from the days before (and the night), sunshine, calm wind, cold enough.
// Heavy snowfall on the day itself costs points (no visibility).
export function dayScore(r, k, ctx) {
  const s = r.p.snow, b = r.p.byModel.best_match, a = ctx.analyses[r.c.id];
  const before = k => (k >= 0 ? s[k] || 0 : k === -1 ? a?.past24 || 0 : 0);
  const fresh = before(k - 1) + before(k - 2) + .3 * (s[k] || 0);
  const sun = r.p.sun[k] || 0, gust = b.gust[k] ?? 50, tmax = b.tmax[k] ?? 0;
  const parts = {
    fresh, sun, gust, tmax,
    pts: Math.min(fresh, 40) / 40 * 55 + Math.min(sun, 8) / 8 * 30 + (gust < 40 ? 15 : gust < 60 ? 8 : gust < 75 ? 0 : -25) - ((s[k] || 0) > 5 ? 15 : 0) - (tmax > 4 ? 10 : 0),
  };
  parts.score = Math.max(0, Math.min(100, Math.round(parts.pts)));
  return parts;
}

let rankWhen = "all";
function renderRanking(rows, days, ctx) {
  const weekend = d => [0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay());
  const list = rows.flatMap(r => days.map((d, k) => ({ r, d, k, ...dayScore(r, k, ctx) })))
    .filter(x => rankWhen === "all" || weekend(x.d)).sort((x, y) => y.score - x.score).slice(0, 8);
  $("rank").innerHTML = list.length ? list.map((x, i) => {
    const t = Date.parse(x.d + "T12:00:00Z");
    return `<div class="rrow"><span class="alt">${i + 1}</span><span class="rd">${fmtWd(t)} ${fmtDM(t)}</span>
      <button data-open="${esc(x.r.c.id)}"><b>${esc(x.r.c.name)}</b> ${ctx.levelBadge(ctx.bulletinFor(x.r.c))}</button>
      <span class="rbar"><i style="width:${x.score}%"></i></span><span class="n">${x.score}</span>
      <span class="why">${f0(x.fresh)} cm Neuschnee · ${f0(x.sun)} h Sonne · Böen ${f0(x.gust)} km/h · max ${f0(x.tmax)} °C</span></div>`;
  }).join("") : `<p class="note">Keine Wochenendtage im Prognosezeitraum.</p>`;
}

export async function renderPlanner(ctx) {
  const cams = ctx.watched();
  $("plan").innerHTML = `<p class="note">Prognosen werden geladen …</p>`;
  let plans;
  try { plans = await loadPlans(cams); }
  catch { $("plan").innerHTML = `<p class="note">Prognose gerade nicht verfügbar. Später nochmal versuchen.</p>`; return; }
  const rows = cams.map((c, i) => {
    const p = plans[i];
    const total = p.snow.reduce((s, v) => s + (v || 0), 0);
    const tMin = p.days.reduce((s, _, k) => s + (spread(p, "snow", k)?.min || 0), 0);
    const tMax = p.days.reduce((s, _, k) => s + (spread(p, "snow", k)?.max || 0), 0);
    return { c, p, total, tMin, tMax, powder: powderDays(p) };
  });
  const sortBy = $("planSort").value;
  rows.sort((a, b) => sortBy === "elev" ? b.c.elev - a.c.elev : b.total - a.total);
  const days = rows[0]?.p.days || [];
  renderRanking(rows, days, ctx);
  $("rankWhen").onclick = e => { const b = e.target.closest("[data-w]"); if (!b) return; rankWhen = b.dataset.w; [...$("rankWhen").children].forEach(x => x.setAttribute("aria-pressed", x === b)); renderRanking(rows, days, ctx); };

  // summary
  const pw = rows.flatMap(r => r.powder.map((on, k) => on ? { r, k } : null).filter(Boolean))
    .sort((x, y) => x.k - y.k || y.r.total - x.r.total)[0];
  const most = rows.slice().sort((a, b) => b.total - a.total)[0];
  const sunByDay = days.map((_, k) => rows.reduce((s, r) => s + (r.p.sun[k] || 0), 0) / Math.max(1, rows.length));
  const sunK = sunByDay.indexOf(Math.max(...sunByDay));
  const camBtn = c => `<button data-open="${esc(c.id)}">${esc(c.name)}</button>`;
  $("planFacts").innerHTML =
    `<div><dt>Nächster Pulvertag</dt><dd>${pw ? `${fmtWd(Date.parse(days[pw.k] + "T12:00:00Z"))} ${fmtDM(Date.parse(days[pw.k] + "T12:00:00Z"))} ${camBtn(pw.r.c)}` : `– <span>keiner in Sicht</span>`}</dd></div>` +
    `<div><dt>Am meisten Neuschnee, 7 Tage</dt><dd>${most ? `${f0(most.total)} cm ${camBtn(most.c)}` : "–"}</dd></div>` +
    `<div><dt>Spanne der Modelle</dt><dd>${most ? `${f0(most.tMin)}–${f0(most.tMax)} cm <span>${esc(most.c.name)}</span>` : "–"}</dd></div>` +
    `<div><dt>Sonnigster Tag</dt><dd>${days.length ? `${fmtWd(Date.parse(days[sunK] + "T12:00:00Z"))} ${fmtDM(Date.parse(days[sunK] + "T12:00:00Z"))} <span>Ø ${f1(sunByDay[sunK])} h Sonne</span>` : "–"}</dd></div>`;

  $("plan").innerHTML = `<div class="scrollx"><table class="ptab">
    <thead><tr><th class="l">Cam</th>${days.map(d => `<th>${dayHead(d)}</th>`).join("")}<th>7 Tage</th></tr></thead>
    <tbody>${rows.map(({ c, p, total, tMin, tMax, powder }) => {
      const st = ctx.stationFor(c);
      return `<tr><th class="l"><button data-open="${esc(c.id)}"><span class="alt">${c.elev}</span> ${esc(c.name)} ${ctx.levelBadge(ctx.bulletinFor(c))}</button>${st ? `<span class="rng">gemessen ${f0(st.hs)} cm${st.d24 != null ? ` (${st.d24 >= 0 ? "+" : ""}${f0(st.d24)} in 24 h)` : ""}</span>` : ""}</th>
        ${days.map((_, k) => {
          const s = p.snow[k] || 0, sp = spread(p, "snow", k), sun = p.sun[k] || 0;
          return `<td class="${powder[k] ? "pow" : ""}" style="background:${s >= .5 ? tint(s) : "transparent"}">
            <b>${s >= .5 ? f0(s) : "·"}</b>${sp && sp.n > 1 && sp.max - sp.min >= 1 ? `<span class="rng">${f0(sp.min)}–${f0(sp.max)}</span>` : `<span class="rng">&nbsp;</span>`}
            <span class="sun" title="${f1(sun)} h Sonne"><i style="width:${Math.min(100, sun / 10 * 100)}%"></i></span>
            ${powder[k] ? `<span class="tag">Pulver</span>` : ""}</td>`;
        }).join("")}
        <td class="tot"><b>${f0(total)}</b><span class="rng">${f0(tMin)}–${f0(tMax)}</span></td></tr>`;
    }).join("")}</tbody></table></div>`;
}

export async function renderModels(cam) {
  const el = $("models");
  el.innerHTML = `<p class="note">Modelle werden geladen …</p>`;
  let p;
  try { [p] = await loadPlans([cam]); } catch { el.innerHTML = `<p class="note">Modellprognosen gerade nicht verfügbar.</p>`; return; }
  const max = Math.max(1, ...MODELS.flatMap(m => p.byModel[m.id].snow.filter(v => v != null)));
  const row = m => {
    const s = p.byModel[m.id].snow, has = s.some(v => v != null);
    if (!has) return "";
    const tot = s.reduce((a, v) => a + (v || 0), 0);
    return `<tr><th class="l"><b>${m.name}</b><span class="rng">${m.note}</span></th>
      ${s.map(v => v == null ? `<td class="na">–</td>` : `<td><b>${v >= .5 ? f0(v) : "·"}</b><span class="mbar"><i style="height:${Math.round(v / max * 100)}%"></i></span></td>`).join("")}
      <td class="tot"><b>${s.every(v => v != null) ? f0(tot) : `${f0(tot)}+`}</b></td></tr>`;
  };
  const b = p.byModel.best_match;
  const med = p.snow.reduce((a, v) => a + (v || 0), 0);
  el.innerHTML = `<div class="scrollx"><table class="ptab models">
    <thead><tr><th class="l">Neuschnee cm</th>${p.days.map(d => `<th>${dayHead(d)}</th>`).join("")}<th>Summe</th></tr></thead>
    <tbody><tr class="med"><th class="l"><b>Median</b><span class="rng">aller Modelle</span></th>${p.snow.map(v => `<td><b>${v >= .5 ? f0(v) : "·"}</b></td>`).join("")}<td class="tot"><b>${f0(med)}</b></td></tr>
    ${MODELS.map(row).join("")}
      <tr class="sub"><th class="l">Sonne h</th>${p.sun.map(v => `<td>${v == null ? "–" : f0(v)}</td>`).join("")}<td></td></tr>
      <tr class="sub"><th class="l">Böen km/h</th>${b.gust.map(v => `<td>${v == null ? "–" : f0(v)}</td>`).join("")}<td></td></tr>
      <tr class="sub"><th class="l">Temp. min / max</th>${b.tmin.map((v, k) => `<td>${f0(v)} / ${f0(b.tmax[k])}</td>`).join("")}<td></td></tr>
    </tbody></table></div>
    <p class="note">Hochauflösende Modelle rechnen nur 1–2 Tage voraus, danach bleibt das Feld leer. Je weiter die Modelle auseinanderliegen, desto unsicherer ist die Prognose.</p>`;
}

// Outlook on the overview: answers "how much snow will fall in the next days?" at a glance.
let outlookDays = 3;
export async function renderOutlook(ctx) {
  const el = $("outlook"), cams = ctx.watched();
  if (!cams.length) { el.innerHTML = ""; return; }
  let plans;
  try { plans = await loadPlans(cams); }
  catch { $("outlookLead").textContent = "Die Prognose ist gerade nicht verfügbar. Sie lädt beim nächsten Aktualisieren neu."; el.innerHTML = ""; return; }
  const n = Math.min(outlookDays, plans[0].days.length), days = plans[0].days.slice(0, n);
  const rows = cams.map((c, i) => {
    const p = plans[i], s = p.snow.slice(0, n).map(v => v || 0), tots = modelTotals(p, n);
    return { c, s, sum: s.reduce((a, v) => a + v, 0), lo: Math.min(...tots), hi: Math.max(...tots) };
  }).sort((a, b) => b.sum - a.sum);

  // lead sentence: where most, how many cams get a real dump, and which days carry it
  const top = rows[0], over10 = rows.filter(r => r.sum >= 10).length;
  const perDay = days.map((_, k) => rows.reduce((a, r) => a + r.s[k], 0));
  const total = perDay.reduce((a, v) => a + v, 0);
  // the days that carry the snow: those with a quarter of the total, else the two strongest
  let mainDays = days.map((d, k) => ({ d, k, v: perDay[k] })).filter(x => total > 0 && x.v >= total * .25);
  if (total > 0 && !mainDays.length) mainDays = days.map((d, k) => ({ d, k, v: perDay[k] })).sort((a, b) => b.v - a.v).slice(0, 2).sort((a, b) => a.k - b.k);
  const dayName = d => fmtWd(Date.parse(d + "T12:00:00Z"));
  const dayWord = x => x.k === 0 ? "heute" : x.k === 1 ? "morgen" : `am ${dayName(x.d)}`;
  const span = n === 2 ? "heute und morgen" : `in den nächsten ${n} Tagen`;
  const unsure = top && top.hi > 0 && (top.hi - top.lo) > Math.max(10, top.sum * .8);
  $("outlookLead").innerHTML = !top || top.sum < 1
    ? `${span[0].toUpperCase() + span.slice(1)} fällt an deinen Cams kaum Schnee (unter 1 cm).`
    : `${span[0].toUpperCase() + span.slice(1)} fällt am meisten Schnee bei <button data-open="${esc(top.c.id)}">${esc(top.c.name)}</button>: <b>${f0(top.sum)} cm</b> (Modelle ${f0(top.lo)}–${f0(top.hi)} cm). `
      + `${over10 ? `${over10} von ${rows.length} Cams bekommen mehr als 10 cm. ` : "Keine Cam bekommt mehr als 10 cm. "}`
      + `${mainDays.length ? `Der meiste Schnee kommt ${mainDays.map(dayWord).join(mainDays.length === 2 ? " und " : ", ").replace(/, ([^,]*)$/, " und $1")}.` : ""}`
      + `${unsure ? " Die Modelle sind sich noch uneinig, die Menge kann sich deutlich ändern." : ""}`;

  const max = Math.max(5, ...rows.map(r => r.hi));
  const x = v => (Math.min(v, max) / max * 100).toFixed(1);
  el.innerHTML = `<div class="ohead"><span>Cam</span><span>Neuschnee, Median und Spanne der Modelle</span><span class="n">cm</span><span class="days">${days.map(d => `<i>${dayName(d)}</i>`).join("")}</span></div>`
    + rows.map(r => `<div class="orow">
      <button data-open="${esc(r.c.id)}"><span class="alt">${r.c.elev}</span> ${esc(r.c.name)} ${ctx.levelBadge(ctx.bulletinFor(r.c))}</button>
      <span class="obar" title="Median ${f0(r.sum)} cm, Modelle ${f0(r.lo)}–${f0(r.hi)} cm">
        <span class="rng" style="left:${x(r.lo)}%;width:${(x(r.hi) - x(r.lo)).toFixed(1)}%"></span><span class="med" style="width:${x(r.sum)}%"></span></span>
      <span class="n"><b>${r.sum >= .5 ? f0(r.sum) : "0"}</b> <small>${f0(r.lo)}–${f0(r.hi)}</small></span>
      <span class="days">${r.s.map((v, k) => `<i title="${dayName(days[k])}: ${f1(v)} cm" style="--h:${Math.min(1, v / 20)}">${v >= 1 ? f0(v) : ""}</i>`).join("")}</span></div>`).join("");
}
export function initOutlook(ctx) {
  $("outlookDays").addEventListener("click", e => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    outlookDays = +b.dataset.d; [...$("outlookDays").children].forEach(x => x.setAttribute("aria-pressed", x === b));
    renderOutlook(ctx);
  });
}
