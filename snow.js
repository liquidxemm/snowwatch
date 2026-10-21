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
      past_hours: "24", forecast_hours: "24", timezone: "GMT",
    });
    const j = await withRetry(async () => {
      const r = await fetchImpl("https://api.open-meteo.com/v1/forecast?" + q);
      if (!r.ok) throw new Error(`Open-Meteo answered ${r.status}`);
      return r.json();
    });
    out.push(...(Array.isArray(j) ? j : [j]));
  }
  return out;
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
