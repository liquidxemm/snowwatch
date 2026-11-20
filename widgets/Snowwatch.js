// Snowwatch widget for Scriptable (iOS). https://liquidxemm.github.io/snowwatch/
//
// Setup: Scriptable app → + → paste this script → name it "Snowwatch".
// Home screen: add a Scriptable widget, long-press → Edit widget → Script: Snowwatch.
// Parameter (optional), several separated by spaces:
//   (empty)          snow outlook for the next 3 days
//   2 | 3 | 7        outlook for today + tomorrow, 3 or 7 days
//   <cam id>         live image of one cam, e.g. cortina-faloria or hintereisferner1
//                    (cam ids are in the address bar when you open a cam on the website)
// Works on the lock screen too (rectangular, inline and round widgets).

const DATA_URL = "https://raw.githubusercontent.com/liquidxemm/snowwatch/data/widget.json";
const SITE = "https://liquidxemm.github.io/snowwatch/";

// ---------- look ----------
const C = {
  paper: Color.dynamic(new Color("#ffffff"), new Color("#0b0b0c")),
  ink: Color.dynamic(new Color("#0d0d0d"), new Color("#f1f1f1")),
  mute: Color.dynamic(new Color("#7c7c7c"), new Color("#8b8b8b")),
  rule: Color.dynamic(new Color("#e2e2e2"), new Color("#2a2a2c")),
  accent: Color.dynamic(new Color("#1238ff"), new Color("#6b83ff")),
  range: Color.dynamic(new Color("#1238ff", 0.22), new Color("#6b83ff", 0.3)),
};
const LEVEL_COLORS = { 1: "#ccff66", 2: "#ffff00", 3: "#ff9900", 4: "#ff0000", 5: "#ff0000" };
const font = (size, weight = "regular") => {
  const name = { regular: "HelveticaNeue", medium: "HelveticaNeue-Medium", bold: "HelveticaNeue-Bold" }[weight];
  return new Font(name, size);
};

// ---------- parameters ----------
const params = String(args.widgetParameter || "").trim().split(/\s+/).filter(Boolean);
const days = Number(params.find(p => /^(2|3|7)$/.test(p)) || 3);
const camId = params.find(p => !/^(2|3|7)$/.test(p));
const family = config.widgetFamily || "medium";
const key = "d" + days;
const span = days === 2 ? "heute + morgen" : `${days} Tage`;
const inSpan = days === 2 ? "heute + morgen" : `in ${days} Tagen`;

// ---------- data (with an offline copy) ----------
async function loadData() {
  const fm = FileManager.local(), path = fm.joinPath(fm.cacheDirectory(), "snowwatch-widget.json");
  try {
    const req = new Request(DATA_URL + "?t=" + Math.floor(Date.now() / 600000));
    req.timeoutInterval = 15;
    const data = await req.loadJSON();
    if (!data || !data.cams) throw new Error("no data");
    fm.writeString(path, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(path)) return { ...JSON.parse(fm.readString(path)), offline: true };
    return null;
  }
}

async function loadImage(url) {
  try { const r = new Request(url); r.timeoutInterval = 15; return await r.loadImage(); } catch (e) { return null; }
}

// ---------- drawing helpers ----------
function barImage(med, lo, hi, max, w = 300, h = 18) {
  const ctx = new DrawContext();
  ctx.size = new Size(w, h);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const x = v => Math.max(0, Math.min(w, (v / max) * w));
  ctx.setFillColor(C.range);
  ctx.fillRect(new Rect(x(lo), h * 0.36, Math.max(2, x(hi) - x(lo)), h * 0.28));
  ctx.setFillColor(C.accent);
  ctx.fillRect(new Rect(0, 0, Math.max(med > 0.5 ? 3 : 0, x(med)), h));
  return ctx.getImage();
}

// crop an image to the widget's aspect ratio around its centre; cropTop cuts off a caption bar (share of height)
function coverImage(img, aspect, cropTop = 0) {
  if (!img) return null;
  const s = img.size, y0 = s.height * cropTop, h = s.height - y0;
  const cw = Math.min(s.width, h * aspect);
  if (cropTop === 0 && cw >= s.width * 0.95) return img;
  const ctx = new DrawContext();
  ctx.size = new Size(cw, h);
  ctx.drawImageAtPoint(img, new Point(-(s.width - cw) / 2, -y0));
  return ctx.getImage();
}

function addLevel(stack, level, size = 10) {
  if (!level) return;
  const b = stack.addStack();
  b.backgroundColor = new Color(LEVEL_COLORS[level]);
  b.setPadding(1, 4, 1, 4);
  const t = b.addText(String(level));
  t.font = font(size, "bold");
  t.textColor = new Color(level >= 4 ? "#ffffff" : "#111111");
}

function text(stack, s, size, weight = "regular", color = C.ink) {
  const t = stack.addText(s);
  t.font = font(size, weight);
  t.textColor = color;
  t.lineLimit = 1;
  return t;
}

const cm = v => `${Math.round(v)}`;
const deg = v => `${Math.round(v)}°`.replace("-", "−");
const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 2 ? "gerade aktualisiert" : m < 60 ? `vor ${m} min` : `vor ${Math.round(m / 60)} h`;
};
const snowingText = d => d.snowing ? `Schneefall an ${d.snowing} von ${d.total} Cams` : `Gerade kein Schneefall`;

// ---------- widgets ----------
function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = C.paper;
  text(w, "Snowwatch", 13, "bold");
  w.addSpacer(4);
  const t = text(w, msg, 12, "regular", C.mute);
  t.lineLimit = 4;
  return w;
}

function header(w, right) {
  const h = w.addStack();
  h.centerAlignContent();
  text(h, "Snowwatch", 12, "bold");
  h.addSpacer();
  if (right) text(h, right, 11, "regular", C.mute);
  w.addSpacer(4);
  const line = w.addStack();
  line.backgroundColor = C.ink;
  line.size = new Size(0, 1);
  line.addSpacer();
}

function outlookWidget(data) {
  const w = new ListWidget();
  w.backgroundColor = C.paper;
  w.url = SITE;
  w.setPadding(14, 14, 12, 14);
  const rows = data.cams.slice().sort((a, b) => b[key].med - a[key].med);
  const top = rows[0];

  if (family === "small") {
    text(w, `Neuschnee · ${span}`, 11, "medium", C.mute);
    w.addSpacer(6);
    const big = text(w, `${cm(top[key].med)} cm`, 34, "medium", C.accent);
    big.minimumScaleFactor = 0.6;
    const n = text(w, top.name, 13, "medium");
    n.minimumScaleFactor = 0.7;
    text(w, `Modelle ${cm(top[key].lo)}–${cm(top[key].hi)} cm`, 11, "regular", C.mute);
    w.addSpacer();
    text(w, data.snowing ? `${data.snowing}/${data.total} schneit` : "kein Schneefall", 11, "medium", data.snowing ? C.accent : C.mute);
    w.url = top.url;
    return w;
  }

  const count = family === "large" ? 9 : 4;
  header(w, family === "large" ? `${span}${data.offline ? " · offline" : ""}`
    : `${span}${data.snowing ? ` · ${data.snowing} schneit` : ""}${data.offline ? " · offline" : ""}`);
  w.addSpacer(family === "large" ? 8 : 6);
  if (family === "large") {
    const lead = text(w, data.lead[key], 13, "regular");
    lead.lineLimit = 3;
    w.addSpacer(8);
  }
  const max = Math.max(5, ...rows.slice(0, count).map(r => r[key].hi));
  for (const r of rows.slice(0, count)) {
    const row = w.addStack();
    row.centerAlignContent();
    row.url = r.url;
    const name = row.addStack();
    name.size = new Size(family === "large" ? 150 : 118, 0);
    name.centerAlignContent();
    const t = text(name, r.name, 12, "medium");
    t.minimumScaleFactor = 0.75;
    if (r.level) { name.addSpacer(3); addLevel(name, r.level, 8); }
    name.addSpacer();
    row.addSpacer(6);
    const bar = row.addImage(barImage(r[key].med, r[key].lo, r[key].hi, max));
    bar.imageSize = new Size(family === "large" ? 100 : 104, 9);
    row.addSpacer(6);
    const v = row.addStack();
    v.size = new Size(44, 0);
    v.addSpacer();
    text(v, `${cm(r[key].med)}`, 15, "medium", r[key].med >= 10 ? C.accent : C.ink);
    text(v, " cm", 10, "regular", C.mute);
    w.addSpacer(family === "large" ? 6 : 5);
  }
  w.addSpacer();
  if (family !== "large") return w;
  const foot = w.addStack();
  text(foot, snowingText(data), 10, "medium", data.snowing ? C.accent : C.mute);
  foot.addSpacer();
  text(foot, ago(data.updated), 10, "regular", C.mute);
  return w;
}

async function camWidget(data, cam) {
  const w = new ListWidget();
  w.url = cam.url;
  w.setPadding(12, 12, 12, 12);
  const aspect = family === "small" ? 1 : family === "large" ? 1.05 : 2.1;
  // foto-webcam burns a caption bar into the top of every image
  const img = coverImage(await loadImage(cam.img), aspect, cam.img.includes("foto-webcam.eu") ? 0.08 : 0);
  if (img) {
    w.backgroundImage = img;
    const g = new LinearGradient();
    g.colors = [new Color("#000000", 0), new Color("#000000", 0.15), new Color("#000000", 0.7)];
    g.locations = [0, 0.45, 1];
    w.backgroundGradient = g;
  } else w.backgroundColor = new Color("#1b1b1d");
  const white = new Color("#ffffff"), soft = new Color("#ffffff", 0.8);

  const top = w.addStack();
  top.centerAlignContent();
  if (cam.status === "snow") {
    const b = top.addStack();
    b.backgroundColor = C.accent;
    b.setPadding(2, 6, 2, 6);
    text(b, "SCHNEIT", 9, "bold", white);
    top.addSpacer(4);
  }
  addLevel(top, cam.level, 9);
  top.addSpacer();
  w.addSpacer();

  const name = text(w, cam.name, family === "small" ? 14 : 16, "medium", white);
  name.minimumScaleFactor = 0.7;
  const line = w.addStack();
  line.centerAlignContent();
  text(line, `${cam.elev} m · ${deg(cam.temp)}`, 11, "regular", soft);
  if (family !== "small") {
    line.addSpacer(8);
    text(line, `24 h ${cm(cam.past24)} cm`, 11, "regular", soft);
    if (cam.measured) { line.addSpacer(8); text(line, `gemessen ${cm(cam.measured.hs)} cm`, 11, "regular", soft); }
  }
  w.addSpacer(3);
  const fc = w.addStack();
  fc.centerAlignContent();
  text(fc, `${cm(cam[key].med)} cm`, family === "small" ? 18 : 20, "bold", white);
  fc.addSpacer(5);
  text(fc, family === "small" ? inSpan : `${inSpan} · Modelle ${cm(cam[key].lo)}–${cm(cam[key].hi)}`, 11, "regular", soft);
  if (family === "large") {
    w.addSpacer(8);
    const ds = w.addStack();
    for (const d of cam.days) {
      const col = ds.addStack();
      col.layoutVertically();
      col.centerAlignContent();
      text(col, d.wd, 10, "regular", soft);
      text(col, d.snow >= 1 ? cm(d.snow) : "·", 13, "medium", white);
      ds.addSpacer();
    }
  }
  return w;
}

function accessoryWidget(data, cam) {
  const w = new ListWidget();
  const r = cam || data.cams.slice().sort((a, b) => b[key].med - a[key].med)[0];
  w.url = r.url;
  if (family === "accessoryInline") {
    w.addText(`❄ ${r.name} ${cm(r[key].med)} cm · ${span}`);
  } else if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const a = w.addText(`${cm(r[key].med)}`); a.font = font(20, "bold"); a.centerAlignText();
    const b = w.addText("cm"); b.font = font(10); b.centerAlignText();
  } else {
    const a = w.addText(`❄ Neuschnee · ${span}`); a.font = font(11, "medium");
    const b = w.addText(`${r.name} ${cm(r[key].med)} cm`); b.font = font(14, "bold"); b.minimumScaleFactor = 0.7;
    const c = w.addText(snowingText(data)); c.font = font(11);
  }
  return w;
}

// ---------- main ----------
const data = await loadData();
let widget;
if (!data) widget = errorWidget("Keine Daten. Internet prüfen, das Widget versucht es automatisch wieder.");
else {
  const cam = camId ? data.cams.find(c => c.id === camId.toLowerCase()) : null;
  if (camId && !cam) widget = errorWidget(`Cam „${camId}“ nicht in deiner Watchlist. IDs stehen in der Adresszeile, wenn du eine Cam auf der Website öffnest.`);
  else if (family.startsWith("accessory")) widget = accessoryWidget(data, cam);
  else widget = cam ? await camWidget(data, cam) : outlookWidget(data);
}
widget.refreshAfterDate = new Date(Date.now() + 30 * 60000);

if (config.runsInWidget || config.runsInAccessoryWidget) Script.setWidget(widget);
else await widget.presentMedium();
Script.complete();
