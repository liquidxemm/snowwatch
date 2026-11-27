// Widget page: setup steps for the Scriptable widget, a copy button for the script, and previews of every
// widget at iOS sizes built from the same widget.json the phone loads (layout mirrors widgets/Snowwatch.js).
import { $, esc } from "./util.js?v=mwyre1z6";

const DATA_URL = "https://raw.githubusercontent.com/liquidxemm/snowwatch/data/widget.json";
const LEVEL_COLORS = { 1: "#ccff66", 2: "#ffff00", 3: "#ff9900", 4: "#ff0000", 5: "#ff0000" };
const cm = v => `${Math.round(v)}`;
const deg = v => `${Math.round(v)}°`.replace("-", "−");
let data = null, days = 3, cam = "";

const lvl = l => (l ? `<span class="wlv"><i style="color:${LEVEL_COLORS[l]}">●</i>${l}</span>` : "");
const spanOf = d => (d === 2 ? "heute + morgen" : `${d} Tage`);
const inSpanOf = d => (d === 2 ? "heute + morgen" : `in ${d} Tagen`);
const snowingText = d => (d.snowing ? `Schneefall an ${d.snowing} von ${d.total} Cams` : "Gerade kein Schneefall");

function outlook(size) {
  const key = "d" + days, rows = data.cams.slice().sort((a, b) => b[key].med - a[key].med), top = rows[0];
  if (size === "small") return `<div class="wg small" title="Klein">
    <span class="wsub">Neuschnee · ${spanOf(days)}</span><span class="wbig">${cm(top[key].med)} cm</span>
    <span class="wname">${esc(top.name)}</span><span class="wsub">Modelle ${cm(top[key].lo)}–${cm(top[key].hi)} cm</span>
    <span class="wfill"></span><span class="wfoot ${data.snowing ? "on" : ""}">${data.snowing ? `${data.snowing}/${data.total} schneit` : "kein Schneefall"}</span></div>`;
  const count = size === "large" ? 9 : 4, list = rows.slice(0, count), max = Math.max(5, ...list.map(r => r[key].hi));
  const x = v => Math.max(0, Math.min(100, v / max * 100));
  return `<div class="wg ${size}" title="${size === "large" ? "Groß" : "Mittel"}">
    <div class="whead"><b>Snowwatch</b><span>${spanOf(days)}${size !== "large" && data.snowing ? ` · ${data.snowing} schneit` : ""}</span></div>
    ${size === "large" ? `<p class="wlead">${esc(data.lead[key])}</p>` : ""}
    <div class="wrows">${list.map(r => `<div class="wrow"><span class="wn">${esc(r.name)}${lvl(r.level)}</span>
      <span class="wbar"><i class="rng" style="left:${x(r[key].lo)}%;width:${Math.max(1, x(r[key].hi) - x(r[key].lo))}%"></i><i class="med" style="width:${x(r[key].med)}%"></i></span>
      <span class="wv ${r[key].med >= 10 ? "on" : ""}">${cm(r[key].med)}<small> cm</small></span></div>`).join("")}</div>
    <span class="wfill"></span>
    ${size !== "large" ? "" : `<div class="wfoot2"><span class="${data.snowing ? "on" : ""}">${snowingText(data)}</span><span>gerade aktualisiert</span></div>`}</div>`;
}

function camCard(size, c) {
  const key = "d" + days;
  const fw = c.img.includes("foto-webcam.eu");
  const img = c.img ? `style="background-position:center ${fw ? "100%" : "50%"};background-size:${fw && size !== "medium" ? "auto 109%" : "cover"};background-image:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.15) 45%,rgba(0,0,0,.7)),url('${esc(c.img)}')"` : `style="background:#1b1b1d"`;
  return `<div class="wg cam ${size}" ${img}>
    <div class="wtop">${c.status === "snow" ? `<span class="wsnow">SCHNEIT</span>` : ""}${lvl(c.level)}</div><span class="wfill"></span>
    <span class="wname">${esc(c.name)}</span>
    <span class="wsub">${c.elev} m · ${deg(c.temp)}${size !== "small" ? ` &ensp;24 h ${cm(c.past24)} cm${c.measured ? ` &ensp;gemessen ${cm(c.measured.hs)} cm` : ""}` : ""}</span>
    <span class="wfc"><b>${cm(c[key].med)} cm</b> ${size === "small" ? inSpanOf(days) : `${inSpanOf(days)}${c[key].hi >= 1 && Math.round(c[key].lo) !== Math.round(c[key].hi) ? ` · Modelle ${cm(c[key].lo)}–${cm(c[key].hi)}` : ""}`}</span>
    ${size === "large" ? `<div class="wdays">${c.days.map(d => `<span><small>${d.wd}</small>${d.snow >= 1 ? cm(d.snow) : "·"}</span>`).join("")}</div>` : ""}</div>`;
}

function lock(c) {
  const key = "d" + days, r = c || data.cams.slice().sort((a, b) => b[key].med - a[key].med)[0];
  return `<div class="wlock"><div class="lrect"><b>❄ Neuschnee · ${spanOf(days)}</b><span>${esc(r.name)} ${cm(r[key].med)} cm</span><small>${snowingText(data)}</small></div>
    <div class="lcirc"><b>${cm(r[key].med)}</b><small>cm</small></div><div class="linl">❄ ${esc(r.name)} ${cm(r[key].med)} cm · ${spanOf(days)}</div></div>`;
}

function render() {
  if (!data) return;
  const c = data.cams.find(x => x.id === cam) || data.cams.filter(x => x.img).sort((a, b) => b["d" + days].med - a["d" + days].med)[0];
  $("wPreview").innerHTML = `
    <figure><figcaption>Ausblick · Parameter leer${days !== 3 ? ` oder <code>${days}</code>` : ""}</figcaption><div class="wset">${outlook("small")}${outlook("medium")}</div><div class="wset">${outlook("large")}</div></figure>
    <figure><figcaption>Cam · Parameter <code>${esc(c.id)}${days !== 3 ? " " + days : ""}</code></figcaption><div class="wset">${camCard("small", c)}${camCard("medium", c)}</div><div class="wset">${camCard("large", c)}</div></figure>
    <figure><figcaption>Sperrbildschirm</figcaption>${lock(c)}</figure>`;
  $("wCam").innerHTML = data.cams.map(x => `<option value="${esc(x.id)}" ${x.id === c.id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  $("wIds").innerHTML = data.cams.map(x => `<span><code>${esc(x.id)}</code> ${esc(x.name)}</span>`).join("");
}

export async function renderWidgetPage() {
  if (!data) {
    try { data = await fetch(DATA_URL + "?t=" + Math.floor(Date.now() / 600e3)).then(r => r.json()); }
    catch { $("wPreview").innerHTML = `<p class="note">Die Widget-Daten sind gerade nicht erreichbar.</p>`; return; }
  }
  render();
}

export function initWidgetPage() {
  $("wDays").addEventListener("click", e => { const b = e.target.closest("[data-d]"); if (!b) return; days = +b.dataset.d; [...$("wDays").children].forEach(x => x.setAttribute("aria-pressed", x === b)); render(); });
  $("wCam").addEventListener("change", e => { cam = e.target.value; render(); });
  $("wCopy").onclick = async () => {
    const btn = $("wCopy");
    try {
      const code = await fetch("widgets/Snowwatch.js", { cache: "no-store" }).then(r => r.text());
      await navigator.clipboard.writeText(code);
      btn.textContent = "Kopiert. Jetzt in Scriptable einfügen.";
    } catch { btn.textContent = "Kopieren ging nicht. Öffne den Code und kopiere ihn von dort."; }
  };
}
