# ❄ Snowwatch

Alpine webcams in one place, with a ping to your phone when it starts snowing at a cam you watch.

- **Dashboard** (GitHub Pages): live snapshots, current temperature, snowfall now / last 24 h / next 24 h, the 0 °C line, and an hourly snowfall chart per cam. Cams where it's snowing jump to the top.
- **Cam view**: click any cam for a large view with a time-lapse over 24 h / 48 h / 7 days (night frames skipped), aligned with hourly snowfall and temperature, and a before/after slider. "Before the snowfall" is detected from the weather data; the view shows new snow in between, modelled snow depth before → after and temperature. Works for all foto-webcam.eu cams (archive back several years) and the Saas-Fee roundshot panoramas.
- **Planner**: 7-day outlook for all watched cams: new snow per day as the median of six models (MeteoSwiss ICON-CH1/CH2, DWD ICON-D2/EU, ECMWF, Open-Meteo), the spread between them, sunshine, and powder days (first sunny day after 15 cm+).
- **Model comparison**: every cam view lists each model's daily forecast side by side.
- **Map**: radar (RainViewer, last 2 h + nowcast) and forecast snowfall for 24/48/72 h across the Alps, with all cams.
- **Season**: snow events with before/after of every affected cam and new-snow totals; first snow per cam for the last six seasons (ERA5 reanalysis); same day across years for any cam.
- **Visibility**: a GitHub Action scores every cam image above 2000 m every 30 minutes (clear / drops / fog / dark) and learns which cams stay clear while it snows. Scores live on the `data` branch.
- **Wall**: switch all images to 24 h or 7 days ago in one click.
- **All cams**: 367 cams to pick from, searchable and filterable by country and altitude: every live cam on [foto-webcam.eu](https://www.foto-webcam.eu) plus hand-picked ones (Saas-Fee, Hintertux, Stubai, Pitztal, Kitzsteinhorn, Jungfraujoch, Aiguille du Midi).
- **Phone alerts**: a GitHub Action checks the cams in `watchlist.json` every 15 minutes and pushes through [ntfy](https://ntfy.sh) when snow starts (marked as *first snow of the season* the first time), when ≥ 0.5 cm is forecast within 3 h, and logs when it stops.
- **Season log**: every event is saved in `data/log.json` and shown on the dashboard.

Snow detection uses [Open-Meteo](https://open-meteo.com) forecasts downscaled to each cam's altitude, not image analysis. It can be off by an hour or miss very local showers.

## Setup (once)

1. **Turn on the dashboard**: repo *Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save*. After a minute it's at `https://liquidxemm.github.io/snowwatch/`.
2. **Phone pushes**: install the ntfy app ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)) and subscribe to a topic name that's hard to guess, e.g. `snowwatch-7fq2k9x`. The repo is public, so keep the name in a secret: *Settings → Secrets and variables → Actions → New repository secret*, name `NTFY_TOPIC`, value your topic name.
3. **Start the check**: *Actions → Snow check → Run workflow*. After that it runs every 15 minutes on its own.

Optional: set a repository *variable* `SOON_CM` to change the "snow coming" limit (default 0.5 cm in 3 h).

## Choosing cams

- For phone alerts, edit [`watchlist.json`](watchlist.json): a list of cam ids from `cams.json`. On the dashboard, pick cams under **All cams**, then use *Copy this view as watchlist.json* and paste it into the file on GitHub.
- To add a cam that isn't on foto-webcam.eu, add it to `extras.json` (name, coordinates, altitude, live page, and a direct `.jpg` snapshot URL if there is one), then run *Actions → Update cam catalog*. That workflow also refreshes the foto-webcam.eu list every Monday.

## Notes

- GitHub pauses scheduled workflows in a repo with no activity for 60 days. During snow events the job commits state changes, which keeps it alive; otherwise re-enable it under *Actions*.
- Scheduled runs on GitHub can start a few minutes late.
- Run locally: `node scripts/check.mjs --dry-run` prints the current state of every watched cam; `python3 -m http.server` serves the dashboard at `localhost:8000`.
