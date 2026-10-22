// Shared snow logic for the dashboard (browser) and the alert job (Node).
// Weather comes from Open-Meteo, downscaled to each cam's altitude.

export const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);

export const CODE_TEXT = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "rime fog",
  51: "drizzle", 53: "drizzle", 55: "drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
  61: "rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
  80: "showers", 81: "showers", 82: "heavy showers", 85: "snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm", 99: "thunderstorm",
};

// How long it must stay dry before a snowfall counts as over (avoids on/off pings in showers).
export const STOP_AFTER_MS = 2 * 3600e3;
// Minimum gap between two "snow coming" pings for the same cam.
export const SOON_REPEAT_MS = 6 * 3600e3;

const BATCH = 50;

// Hourly values are the median of several models: a single source can drop out (e.g. return 0 cm while it snows).
const HOURLY_MODELS = ["best_match", "meteoswiss_icon_ch2", "icon_d2", "icon_eu", "ecmwf_ifs025"];
const med = v => { v = v.filter(x => x != null).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
function medianHourly(h, key) {
  const series = HOURLY_MODELS.map(m => h[`${key}_${m}`]).filter(Boolean);
  if (!series.length) return h[key] || [];
  return h.time.map((_, i) => med(series.map(s => s[i])));
}
const pick = (o, key) => (o[key] !== undefined ? o[key] : o[`${key}_best_match`]);
function normalise(w, keys) {
  const hourly = { time: w.hourly.time };
  for (const k of keys) hourly[k] = medianHourly(w.hourly, k);
  let current = w.current;
  if (current) {
    current = {};
    for (const k of Object.keys(w.current)) current[k.replace(/_best_match$/, "")] = w.current[k];
    // the current block can also miss snowfall: fall back to the median of the current hour
    const i = hourly.time.indexOf(w.current.time.slice(0, 13) + ":00");
    if (hourly.snowfall && i >= 0 && (current.snowfall || 0) === 0 && hourly.snowfall[i] > 0) current.snowfall = hourly.snowfall[i] / 4;
  }
  return { ...w, hourly, current };
}

async function withRetry(fn, tries = 3) {
  for (let k = 1; ; k++) {
    try { return await fn(); }
    catch (e) { if (k >= tries) throw e; await new Promise(r => setTimeout(r, 2000 * k)); }
  }
}

// Fetch weather for many cams, batched (Open-Meteo accepts comma-separated locations).
export async function fetchWeather(cams, fetchImpl = fetch) {
  const out = [];
  for (let i = 0; i < cams.length; i += BATCH) {
    const part = cams.slice(i, i + BATCH);
    const q = new URLSearchParams({
      latitude: part.map(c => c.lat).join(","),
      longitude: part.map(c => c.lon).join(","),
      elevation: part.map(c => c.elev).join(","),
      current: "temperature_2m,weather_code,snowfall,precipitation",
      hourly: "snowfall,freezing_level_height",
      models: HOURLY_MODELS.join(","),
      past_hours: "24", forecast_hours: "24", timezone: "GMT",
    });
    const j = await withRetry(async () => {
      const r = await fetchImpl("https://api.open-meteo.com/v1/forecast?" + q);
      if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
      return r.json();
    });
    out.push(...(Array.isArray(j) ? j : [j]).map(w => normalise(w, ["snowfall", "freezing_level_height"])));
  }
  return out;
}

// Hourly history + forecast for one cam: snowfall (cm), temperature, modelled snow depth (cm), weather code.
export async function fetchHistory(cam, pastDays = 7, fetchImpl = fetch) {
  const q = new URLSearchParams({
    latitude: cam.lat, longitude: cam.lon, elevation: cam.elev,
    hourly: "snowfall,temperature_2m,snow_depth,weather_code,freezing_level_height,relative_humidity_2m,precipitation,cloud_cover_low,visibility",
    models: HOURLY_MODELS.join(","),
    past_days: String(pastDays), forecast_days: "2", timezone: "GMT",
  });
  const j = await withRetry(async () => {
    const r = await fetchImpl("https://api.open-meteo.com/v1/forecast?" + q);
    if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
    return r.json();
  });
  const h = normalise(j, ["snowfall", "temperature_2m", "snow_depth", "relative_humidity_2m", "precipitation", "cloud_cover_low"]).hourly;
  return {
    t: h.time.map(s => Date.parse(s + "Z")),
    snow: h.snowfall.map(v => v || 0),
    temp: h.temperature_2m,
    depth: h.snow_depth.map(v => (v == null ? null : v * 100)),
    code: pick(j.hourly, "weather_code") || [],
    frz: pick(j.hourly, "freezing_level_height") || [],
    rh: h.relative_humidity_2m, precip: h.precipitation, cloudLow: h.cloud_cover_low,
    vis: pick(j.hourly, "visibility") || [],
  };
}

// Forecast models compared in the planner. Short-range models simply return null beyond their horizon.
export const MODELS = [
  { id: "best_match", name: "Open-Meteo", note: "automatische Auswahl je Ort" },
  { id: "meteoswiss_icon_ch1", name: "ICON-CH1", note: "MeteoSchweiz, 1 km, 33 h" },
  { id: "meteoswiss_icon_ch2", name: "ICON-CH2", note: "MeteoSchweiz, 2 km, 5 Tage" },
  { id: "icon_d2", name: "ICON-D2", note: "DWD, 2,2 km, 48 h" },
  { id: "icon_eu", name: "ICON-EU", note: "DWD, 7 km, 5 Tage" },
  { id: "ecmwf_ifs025", name: "ECMWF", note: "EZMW, 25 km, 15 Tage" },
];
const PLAN_DAILY = ["snowfall_sum", "sunshine_duration", "wind_gusts_10m_max", "temperature_2m_max", "temperature_2m_min", "weather_code"];

// 7-day daily forecast per cam and model: { days[], byModel: { model: { snow[], sun[], gust[], tmax[], tmin[], code[] } } }
export async function fetchPlan(cams, days = 7, fetchImpl = fetch) {
  const out = [];
  for (let i = 0; i < cams.length; i += 20) {
    const part = cams.slice(i, i + 20);
    const q = new URLSearchParams({
      latitude: part.map(c => c.lat).join(","), longitude: part.map(c => c.lon).join(","), elevation: part.map(c => c.elev).join(","),
      daily: PLAN_DAILY.join(","), models: MODELS.map(m => m.id).join(","), forecast_days: String(days), timezone: "Europe/Vienna",
    });
    const j = await withRetry(async () => {
      const r = await fetchImpl("https://api.open-meteo.com/v1/forecast?" + q);
      if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
      return r.json();
    });
    for (const w of Array.isArray(j) ? j : [j]) {
      const d = w.daily, byModel = {};
      for (const m of MODELS) {
        const get = k => d[`${k}_${m.id}`] || (m.id === "best_match" ? d[k] : null) || d.time.map(() => null);
        byModel[m.id] = {
          snow: get("snowfall_sum"), sun: get("sunshine_duration").map(v => (v == null ? null : v / 3600)),
          gust: get("wind_gusts_10m_max"), tmax: get("temperature_2m_max"), tmin: get("temperature_2m_min"), code: get("weather_code"),
        };
      }
      // Headline value: median of the individual models (more robust than a single pick)
      const median = k => d.time.map((_, i) => {
        const v = MODELS.filter(m => m.id !== "best_match").map(m => byModel[m.id][k][i]).filter(x => x != null).sort((a, b) => a - b);
        if (!v.length) return byModel.best_match[k][i];
        return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
      });
      out.push({ days: d.time, byModel, snow: median("snow"), sun: median("sun") });
    }
  }
  return out;
}

// Spread of a daily value across models that have data for that day.
export function spread(plan, key, i) {
  const vals = MODELS.filter(m => m.id !== "best_match").map(m => plan.byModel[m.id][key][i]).filter(v => v != null);
  return vals.length ? { min: Math.min(...vals), max: Math.max(...vals), n: vals.length } : null;
}

// A powder day: the first sunny day (6 h+) after at least 15 cm of new snow in the two days before, cold enough to keep it.
export function powderDays(plan) {
  const b = plan.byModel.best_match, s = plan.snow, out = [];
  plan.days.forEach((_, i) => {
    const fresh = (s[i - 1] || 0) + (s[i - 2] || 0);
    out[i] = fresh >= 15 && (s[i] || 0) < 3 && (plan.sun[i] || 0) >= 6 && (b.tmax[i] ?? 9) < 3 && !out[i - 1];
  });
  return out;
}

// Daily snowfall history from the ERA5 reanalysis (for first-snow dates of past seasons).
export async function fetchArchiveDaily(cam, startDate, endDate, fetchImpl = fetch) {
  const q = new URLSearchParams({ latitude: cam.lat, longitude: cam.lon, elevation: cam.elev, start_date: startDate, end_date: endDate, daily: "snowfall_sum,temperature_2m_max", timezone: "Europe/Vienna" });
  const j = await withRetry(async () => {
    const r = await fetchImpl("https://archive-api.open-meteo.com/v1/archive?" + q);
    if (!r.ok) throw new Error(`Open-Meteo archive answered ${r.status}`);
    return r.json();
  });
  return { days: j.daily.time, snow: j.daily.snowfall_sum.map(v => v || 0), tmax: j.daily.temperature_2m_max };
}

const GRID_MODELS = ["meteoswiss_icon_ch2", "icon_d2", "icon_eu", "ecmwf_ifs025"];
// Snowfall sums over a lat/lon grid for the map (grid point's own terrain height).
export async function fetchGrid(points, days = 3, fetchImpl = fetch) {
  const out = [];
  for (let i = 0; i < points.length; i += 100) {
    const part = points.slice(i, i + 100);
    const q = new URLSearchParams({
      latitude: part.map(p => p[0]).join(","), longitude: part.map(p => p[1]).join(","),
      daily: "snowfall_sum", models: GRID_MODELS.join(","), forecast_days: String(days), timezone: "Europe/Vienna",
    });
    const j = await withRetry(async () => {
      const r = await fetchImpl("https://api.open-meteo.com/v1/forecast?" + q);
      if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
      return r.json();
    });
    for (const w of Array.isArray(j) ? j : [j]) {
      const series = GRID_MODELS.map(m => w.daily[`snowfall_sum_${m}`]).filter(Boolean);
      const snow = w.daily.time.map((_, i) => med(series.map(x => x[i])) || 0);
      out.push({ lat: w.latitude, lon: w.longitude, elev: w.elevation, snow, days: w.daily.time });
    }
  }
  return out;
}

// Index of the hour that contains time t.
export const hourIndex = (h, t) => { let i = 0; while (i + 1 < h.t.length && h.t[i + 1] <= t) i++; return i; };

// Snow that fell between t1 and t2 (cm).
export function snowBetween(h, t1, t2) {
  const [a, b] = t1 < t2 ? [t1, t2] : [t2, t1];
  let s = 0;
  h.t.forEach((t, i) => { if (t > a && t <= b) s += h.snow[i]; });
  return s;
}

// Start of the most recent snowfall: walk back from t through hours with snow, allowing gaps up to 3 dry hours.
export function snowEventStart(h, t = Date.now(), minCm = 0.1) {
  let i = hourIndex(h, t), last = -1, gap = 0;
  for (; i >= 0; i--) {
    if (h.snow[i] >= minCm) { last = i; gap = 0; }
    else if (last >= 0 && ++gap > 3) break;
    else if (last < 0 && h.t[hourIndex(h, t)] - h.t[i] > 72 * 3600e3) break;
  }
  return last >= 0 ? h.t[last] - 3600e3 : null; // the hour before the first snowy hour
}

// Turn one Open-Meteo result into the numbers the UI and alerts need.
export function analyse(w, now = Date.now()) {
  const h = w.hourly;
  const times = h.time.map(t => Date.parse(t + "Z"));
  let past24 = 0, next3 = 0, next24 = 0, idxNow = 0;
  times.forEach((t, i) => {
    const s = h.snowfall[i] || 0;
    if (t <= now) { past24 += s; idxNow = i; }
    else { next24 += s; if (t - now <= 3 * 3600e3) next3 += s; }
  });
  const c = w.current;
  return {
    temp: c.temperature_2m,
    code: c.weather_code,
    snowRate: c.snowfall || 0,              // cm in the last 15 min interval
    snowingNow: (c.snowfall || 0) > 0 || SNOW_CODES.has(c.weather_code),
    past24, next3, next24,
    freezingLevel: h.freezing_level_height[idxNow],
    series: h.snowfall.map(v => v || 0),
    idxNow,
  };
}

export function seasonOf(t) {
  const d = new Date(t), y = d.getUTCFullYear(), start = d.getUTCMonth() >= 8 ? y : y - 1; // season starts 1 Sept
  return `${String(start).slice(2)}/${String(start + 1).slice(2)}`;
}

// Advance one cam's state with a fresh analysis. Returns the new state and any events to announce.
// state: { status: "dry"|"snow", lastSnowAt, soonAt }
export function step(prev, a, now, { soonCm = 0.5, firstOfSeason = false } = {}) {
  const s = { status: "dry", lastSnowAt: 0, soonAt: 0, ...prev };
  const events = [];
  if (a.snowingNow) {
    if (s.status !== "snow") {
      events.push({ type: firstOfSeason ? "first" : "start", t: now });
      s.status = "snow";
    }
    s.lastSnowAt = Math.floor(now / 3600e3) * 3600e3; // hourly resolution keeps state changes rare
  } else if (s.status === "snow" && now - s.lastSnowAt > STOP_AFTER_MS) {
    events.push({ type: "stop", t: now });
    s.status = "dry";
  } else if (s.status === "dry" && a.next3 >= soonCm && now - (s.soonAt || 0) > SOON_REPEAT_MS) {
    events.push({ type: "soon", t: now });
    s.soonAt = now;
  }
  return { state: s, events };
}

const f1 = v => (v == null || Number.isNaN(v) ? "–" : v.toFixed(1));

export function describe(ev, cam, a) {
  switch (ev.type) {
    case "first": return { title: `❄ First snow of season ${seasonOf(ev.t)}: ${cam.name}`, body: `It's snowing at ${cam.elev} m, ${f1(a.temp)} °C. ${f1(a.next24)} cm forecast for the next 24 h.` };
    case "start": return { title: `❄ Snowing: ${cam.name}`, body: `${cam.elev} m, ${f1(a.temp)} °C. ${f1(a.next24)} cm forecast for the next 24 h.` };
    case "soon":  return { title: `Snow coming: ${cam.name}`, body: `${f1(a.next3)} cm forecast within 3 h at ${cam.elev} m (${f1(a.temp)} °C now).` };
    case "stop":  return { title: `Snow stopped: ${cam.name}`, body: `${f1(a.past24)} cm in the last 24 h.` };
  }
}
