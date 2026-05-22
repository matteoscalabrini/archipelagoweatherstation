# Archipelago Weather Station

High-contrast remote dashboard for a solar-powered ESP32 weather station. Built with Next.js 15, React 19, and TypeScript. Deployed on Vercel with Redis/Upstash for persistent telemetry and Vercel Blob for raw-data archive.

This repository is the **web dashboard**. The matching ESP32 firmware lives in [matteoscalabrini/Wheather_station_01](https://github.com/matteoscalabrini/Wheather_station_01).

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/matteoscalabrini/archipelagoweatherstation)

## Features

- **Live Dashboard** — 3×3 OLED-inspired panel grid for temperature, humidity, pressure, wind, solar, battery, and a derived forecast. Each panel has a signal-level bar, 1-hour trend delta, and a matrix sparkline.
- **History** — Interactive technical chart with crosshair tooltip, min/avg/max reference lines, daily weather-emoji strip, range selector (6H / 24H / 7D / All), and clickable per-series mini-tiles.
- **Archive** — Long-term daily aggregates with year + month + series selectors, min/max range bars per day, period stats, and a daily records table.
- **Admin Console** — Password-protected panel for remote station config, firmware/SPIFFS OTA uploads, alert rules, event timeline, and webhook notifications.
- **System Diagnostics** — Solar mode, cumulative uptime, network state, last POST code, sensor health chips.
- **OLED Dark Theme** — Doto display font, green accent, black panels, mobile-responsive layout.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 19, TypeScript 5 |
| Styling | CSS (custom properties, grid, responsive media queries) |
| Fonts | Doto (display), Share Tech Mono (monospace) |
| Storage | Upstash Redis / Vercel KV (in-memory fallback for local dev) |
| File Storage | Vercel Blob (raw JSONL archive, firmware/SPIFFS artifacts) |
| Analytics | Vercel Analytics |

## Deploy on Vercel

The fastest path is the Deploy button above. The manual steps:

1. **Fork or clone** this repository.
2. **Create a Vercel project** pointing at the repo. Framework preset auto-detects as Next.js.
3. **Add storage** from the Vercel Marketplace:
   - **Upstash Redis** (free tier is fine) — used for latest telemetry, history list, remote config, and daily aggregates.
   - **Vercel Blob** — used for the long-term raw telemetry archive and firmware/SPIFFS uploads.
   Vercel auto-injects the relevant environment variables.
4. **Set these required environment variables** in *Project Settings → Environment Variables*:

   | Variable | Purpose |
   |----------|---------|
   | `WEATHER_STATION_API_KEY` | Shared bearer token used by the ESP32 to authenticate `POST /api/ingest` and device polling. |
   | `WEATHER_STATION_ADMIN_PASSWORD` | Login password for the `/admin` console. |
   | `ADMIN_SESSION_SECRET` | Long random string used to sign admin session cookies. |
   | `BLOB_READ_WRITE_TOKEN` | Created automatically when you add the Vercel Blob store. |

5. **Verify the Redis pair was injected**:
   - Upstash creates `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
   - Vercel KV creates `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
   The app accepts either pair.

6. **Deploy**.

7. **Point the station at your deployment**. In the local station config (or via `/admin`), set:
   ```text
   serverPostEnabled = true
   postUrl = https://YOUR-PROJECT.vercel.app/api/ingest
   postToken = <same value as WEATHER_STATION_API_KEY>
   ```

That's it — the station should appear on the dashboard within one post cycle.

## Local Development

```bash
npm install
npm run dev
```

Create a `.env.local` with at least:

```text
WEATHER_STATION_API_KEY=<shared station token>
WEATHER_STATION_ADMIN_PASSWORD=<admin login password>
ADMIN_SESSION_SECRET=<long random cookie signing secret>
BLOB_READ_WRITE_TOKEN=<Vercel Blob token, optional locally>
```

Optionally add the Upstash or Vercel KV pair to persist data between restarts. Without them the app uses an in-memory store, which is fine for previewing the UI.

See [`.env.example`](.env.example) for the full template.

## API

### Station → Server

```text
POST /api/ingest
Authorization: Bearer <WEATHER_STATION_API_KEY>
Content-Type: application/json
```

### Station → Device Endpoints (authenticated)

```text
GET /api/device/config
GET /api/device/firmware?version=<current-firmware-version>
GET /api/device/artifact?type=firmware
GET /api/device/artifact?type=spiffs
Authorization: Bearer <WEATHER_STATION_API_KEY>
```

### Dashboard → Server

```text
GET /api/latest                       # Latest telemetry snapshot
GET /api/history?limit=N              # Telemetry history (up to 10080 samples)
GET /api/archive/years                # Years with daily aggregates
GET /api/archive/daily?year=&month=   # Daily aggregates
```

### Admin

```text
/admin                                # Password-protected admin console
POST /api/admin/device-command        # Queue a one-shot command for the next poll
```

## Project Structure

```
├── config/
│   └── weatherstation-admin-settings.example.json
├── public/
├── plans/                            # Design specs and architecture notes
├── src/
│   ├── app/
│   │   ├── layout.tsx                # Root layout + site footer
│   │   ├── page.tsx                  # Home → Dashboard
│   │   ├── dashboard.tsx             # Main dashboard component
│   │   ├── globals.css               # All styles
│   │   ├── history/
│   │   ├── archive/
│   │   ├── admin/
│   │   └── api/
│   │       ├── latest/
│   │       ├── history/
│   │       ├── ingest/
│   │       ├── archive/{years,daily,raw}/
│   │       ├── device/{config,firmware,artifact}/
│   │       └── admin/
│   └── lib/
│       ├── telemetry.ts              # Telemetry types + validation
│       ├── insights.ts               # Dew point, heat index, weather emoji
│       ├── archive.ts                # Daily aggregate accumulators
│       ├── events.ts                 # Alert rules, event timeline
│       ├── management.ts             # Remote config + firmware manifest
│       ├── notification-settings.ts  # Webhook config
│       ├── notifications.ts          # Notification delivery
│       ├── store.ts                  # Redis/Upstash storage layer
│       └── auth.ts                   # Admin session auth
├── vercel.json
├── package.json
└── .env.example
```

## Remote Management

The `/admin` console stores remote config and firmware manifests in Redis with an in-memory fallback. Uploaded binaries are kept as private Vercel Blob objects and streamed to stations through `/api/device/artifact` (auth either by station bearer token or short-lived signed URL from `/api/device/firmware`).

Build the ESP32 firmware/SPIFFS from the [firmware repo](https://github.com/matteoscalabrini/Wheather_station_01) and upload the artefacts in `/admin`:

```bash
~/.platformio/penv/bin/pio run
~/.platformio/penv/bin/pio run -t buildfs
```

The ESP32 installs an update only when the manifest is enabled and the manifest version differs from the version reported by the device.

## Dashboard Panels

| Channel | Label | Description |
|---------|-------|-------------|
| CH-01 | ENV TEMP | Temperature (°C) with feels-like secondary |
| CH-02 | ENV HUM | Humidity (%) |
| CH-03 | ENV PRES | Pressure (hPa) |
| CH-04 | FORECAST | Forecast with confidence score and driver trends |
| CH-05 | WIND SPD | Wind speed (m/s) with Beaufort secondary |
| CH-06 | WIND DIR | Wind direction (°) |
| CH-07 | SOLAR | Solar power (W) with voltage secondary |
| CH-08 | BATTERY | Battery power (W) with voltage secondary |
| CH-09 | BAT LVL | Battery level (%) with voltage secondary |

## Responsive Breakpoints

| Breakpoint | Layout |
|-----------|--------|
| > 760px | 3-column dashboard grid, full header row |
| ≤ 760px | 2-column dashboard grid, compact header |
| ≤ 640px | 1-column dashboard grid, smaller fonts |
| ≤ 380px | Single-column diagnostics + stats |

## Related repositories

- **Firmware** — [matteoscalabrini/Wheather_station_01](https://github.com/matteoscalabrini/Wheather_station_01)
- **Dashboard** (this repo) — [matteoscalabrini/archipelagoweatherstation](https://github.com/matteoscalabrini/archipelagoweatherstation)

## License

Open source. See repo for license details.
