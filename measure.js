// Measured snow depth (nearest avalanche-service station) and the avalanche bulletin for each cam.
const STATIONS_URL = "https://raw.githubusercontent.com/liquidxemm/snowwatch/data/stations.json";
const BULLETINS = [
  { url: "https://aws.slf.ch/api/bulletin/caaml/de/json", src: "SLF", link: "https://www.slf.ch/de/lawinenbulletin-und-schneesituation/" },
  { url: "https://static.avalanche.report/bulletins/latest/EUREGIO_de_CAAMLv6.json", src: "Lawinenwarndienst Tirol · Südtirol · Trentino", link: "https://lawinen.report/" },
];
export const EAWS_MAP = "https://www.avalanches.org/";

export const LEVELS = { low: 1, moderate: 2, considerable: 3, high: 4, very_high: 5 };
export const LEVEL_DE = { 1: "gering", 2: "mäßig", 3: "erheblich", 4: "groß", 5: "sehr groß" };
export const PROBLEM_DE = {
  new_snow: "Neuschnee", wind_slab: "Triebschnee", persistent_weak_layers: "Altschnee", wet_snow: "Nassschnee",
  gliding_snow: "Gleitschnee", favourable_situation: "günstige Situation", no_distinct_avalanche_problem: "kein ausgeprägtes Problem", cornices: "Wechten",
};

let stations = [], bulletins = [];

export async function loadMeasurements() {
  const [st, ...bs] = await Promise.allSettled([
    fetch(STATIONS_URL + "?t=" + Math.floor(Date.now() / 600e3)).then(r => r.json()),
    ...BULLETINS.map(b => fetch(b.url).then(r => r.json()).then(j => ({ ...b, list: j.bulletins || [] }))),
  ]);
  if (st.status === "fulfilled") stations = st.value.stations || [];
  bulletins = bs.filter(x => x.status === "fulfilled").map(x => x.value);
}

const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180));

// Nearest station, weighing 100 m of height difference like 1 km of distance. Too far away → null.
export function stationFor(cam) {
  let best = null, bestScore = Infinity;
  for (const s of stations) {
    const d = km(cam, s), score = d + Math.abs(cam.elev - s.elev) / 100;
    if (d < 25 && score < bestScore) { best = { ...s, km: d }; bestScore = score; }
  }
  return best && bestScore <= 20 && Date.now() - best.t < 6 * 3600e3 ? best : null;
}

const regionMatch = (a, b) => a === b || a.startsWith(b + "-") || b.startsWith(a + "-");

// Bulletin for the cam's region: { level, levels: [{level, lower, upper}], problems, valid, from, until, source, link, highlights }
export function bulletinFor(cam) {
  if (!cam.region) return null;
  for (const src of bulletins) {
    for (const b of src.list) {
      const r = (b.regions || []).find(x => regionMatch(x.regionID, cam.region));
      if (!r) continue;
      const levels = (b.dangerRatings || []).map(d => ({ level: LEVELS[d.mainValue] || 0, lower: d.elevation?.lowerBound, upper: d.elevation?.upperBound, period: d.validTimePeriod }));
      const from = Date.parse(b.validTime?.startTime), until = Date.parse(b.validTime?.endTime);
      return {
        level: Math.max(0, ...levels.map(l => l.level)), levels, region: r.name || r.regionID,
        problems: [...new Set((b.avalancheProblems || []).map(p => PROBLEM_DE[p.problemType] || p.problemType))],
        from, until, valid: until > Date.now() - 3 * 3600e3, source: src.src, link: src.link,
        highlights: b.avalancheActivity?.highlights || "",
      };
    }
  }
  return null;
}

export const levelBadge = (b, big = false) => b && b.valid && b.level
  ? `<span class="lw l${b.level}${big ? " big" : ""}" title="Lawinengefahr ${b.level} · ${LEVEL_DE[b.level]}">${b.level}</span>` : "";

export function levelSplit(b) {
  const ls = b.levels.filter(l => l.level);
  if (ls.length < 2) return "";
  return ls.map(l => `${l.lower ? `über ${l.lower} m` : l.upper ? `unter ${l.upper} m` : l.period === "later" ? "später" : "früher"}: ${l.level}`).join(" · ");
}
