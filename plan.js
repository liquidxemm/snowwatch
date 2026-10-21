// Planner: 7-day outlook for watched cams, and the per-model comparison in the cam view.
import { fetchPlan, spread, powderDays, MODELS } from "./snow.js?v=mvhzitr4";
import { $, esc, f0, f1, fmtWd, fmtDM, cached } from "./util.js?v=mvhzitr4";

const PLAN_AGE = 30 * 60e3;
const tint = cm => `color-mix(in srgb, var(--accent) ${Math.round(Math.min(1, cm / 30) * 55)}%, transparent)`;
const dayHead = d => { const t = Date.parse(d + "T12:00:00Z"); return `<span class="wd">${fmtWd(t)}</span><span class="dm">${fmtDM(t)}</span>`; };

async function loadPlans(cams) {
  const key = "plan:" + cams.map(c => c.id).join(",");
  return cached(key, PLAN_AGE, () => fetchPlan(cams));
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
      return `<tr><th class="l"><button data-open="${esc(c.id)}"><span class="alt">${c.elev}</span> ${esc(c.name)}</button></th>
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
