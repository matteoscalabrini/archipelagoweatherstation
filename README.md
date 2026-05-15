# Archipelago Weather Station

High-contrast remote dashboard for the ESP32 weather station. Built with Next.js 15, React 19, and TypeScript. Deployed on Vercel with Redis/Upstash for persistent telemetry storage.

## Features

- **Live Dashboard** — Real-time 3×3 OLED-inspired panel grid showing temperature, humidity, pressure, wind, solar, battery, and forecast data with sparkline trend graphs and signal-level progress bars.
- **Weather Forecast** — Derived forecast with confidence scoring based on pressure, humidity, and wind trend alignment.
- **History Lab** — Interactive time-series chart with cursor tracking (crosshair + tooltip showing value and timestamp at any point), configurable time windows (6H / 24H / 7D / All), and per-series statistics (latest, min, max, avg, delta).
- **Admin Console** — Password-protected panel for remote station configuration, firmware/SPIFFS OTA uploads, alert rules, event timeline, and notification settings.
- **System Diagnostics** — Solar mode, uptime, network status, last POST code, and sensor health chips.
- **Mobile Responsive** — Adaptive layout: 3-column grid on desktop, 2-column on tablet, single-column on phone. Header stays as a row with nav links to the right of the title.
- **OLED-Inspired Dark Theme** — Black panels with white text, matrix-style sparkline graphs, and pixel progress bars.
- **Vercel Analytics** — Built-in page analytics via `@vercel/analytics`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 19, TypeScript 5 |
| Styling | CSS (custom properties, grid, responsive media queries) |
| Fonts | Doto (display), Share Tech Mono (monospace) |
| Storage | Upstash Redis / Vercel KV (persistent), in-memory fallback |
| File Storage | Vercel Blob (firmware/SPIFFS artifacts) |
| Analytics | Vercel Analytics |
| Deployment | Vercel (region: `fra1`) |

## Project Structure

```
├── config/
│   └── weatherstation-admin-settings.example.json   # Station config template
├── public/
│   └── firmware/                                     # Firmware binary storage
├── src/
│   ├── app/
│   │   ├── page.tsx              # Home → Dashboard
│   │   ├── dashboard.tsx         # Main dashboard component
│   │   ├── globals.css           # All styles (tokens, layout, responsive)
│   │   ├── layout.tsx            # Root layout with viewport meta
│   │   ├── history/
│   │   │   ├── page.tsx          # History page wrapper
│   │   │   └── history-client.tsx # History chart + stats component
│   │   ├── admin/
│   │   │   ├── page.tsx          # Admin page wrapper
│   │   │   └── admin-client.tsx  # Admin console component
│   │   └── api/
│   │       ├── latest/route.ts   # Latest telemetry snapshot
│   │       ├── history/route.ts  # Telemetry history
│   │       ├── ingest/route.ts   # Station telemetry ingestion
│   │       ├── device/           # Device endpoints (config, firmware, artifact)
│   │       └── admin/            # Admin endpoints (login, config, firmware, alerts, events, notifications)
│   └── lib/
│       ├── telemetry.ts          # Telemetry types and validation
│       ├── insights.ts           # Weather insight derivation (dew point, heat index, pressure delta)
│       ├── events.ts             # Alert rules, event timeline, active alerts
│       ├── management.ts         # Remote config and firmware manifest types
│       ├── notification-settings.ts # Webhook notification settings
│       ├── notifications.ts      # Notification delivery logic
│       ├── store.ts              # Redis/Upstash storage abstraction
│       └── auth.ts               # Session authentication
├── vercel.json                   # Vercel deployment config
├── package.json                  # Dependencies and scripts
└── .env.example                  # Environment variable template
```

## API

### Station → Server

The station posts telemetry to:

```text
POST /api/ingest
Authorization: Bearer <WEATHER_STATION_API_KEY>
Content-Type: application/json
```

### Dashboard → Server

The dashboard reads:

```text
GET /api/latest          # Latest telemetry snapshot
GET /api/history?limit=N # Telemetry history (up to 10080 samples)
```

### Station → Device Endpoints (authenticated)

The station polls these endpoints for remote management:

```text
GET /api/device/config
GET /api/device/firmware?version=<current-firmware-version>
GET /api/device/artifact?type=firmware
GET /api/device/artifact?type=spiffs
Authorization: Bearer <WEATHER_STATION_API_KEY>
```

### Admin UI

```text
/admin   # Password-protected admin console
```

## Local Setup

```bash
npm install
npm run dev
```

### Environment Variables

Create a `.env.local` file with:

```text
WEATHER_STATION_API_KEY=<shared station token>
WEATHER_STATION_ADMIN_PASSWORD=<admin login password>
ADMIN_SESSION_SECRET=<long random cookie signing secret>
BLOB_READ_WRITE_TOKEN=<Vercel Blob token>
```

Optional (for persistent storage in local dev):

```text
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

Or the Vercel KV equivalents:

```text
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

See [`.env.example`](.env.example) for the full template.

## Vercel Deployment

1. Create a Vercel project from this folder.
2. Add a Redis/Upstash store from the Vercel Marketplace for persistent latest telemetry.
3. Add these environment variables in Vercel:

```text
WEATHER_STATION_API_KEY=<same value as local .env.local>
WEATHER_STATION_ADMIN_PASSWORD=<admin login password>
ADMIN_SESSION_SECRET=<long random cookie signing secret>
BLOB_READ_WRITE_TOKEN=<Vercel Blob read/write token>
```

4. Check that the Redis/Upstash integration created either of these environment variable pairs:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

or:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

5. Deploy.
6. In the local weather station admin page, set:

```text
serverPostEnabled = true
postUrl = https://YOUR-VERCEL-PROJECT.vercel.app/api/ingest
postToken = WEATHER_STATION_API_KEY
```

The exact local station settings template is in:

```text
config/weatherstation-admin-settings.local.json
```

That file is ignored by git because it contains the shared secret.

## Remote Management

`/admin` stores remote config and update manifests in Redis/Upstash, with in-memory fallback for local development. Uploaded binaries are stored as private Vercel Blob objects and streamed to stations through `/api/device/artifact`; artifact downloads accept either the station bearer token or the short-lived signed URL returned by `/api/device/firmware`:

- **Remote config**: desired station runtime values, including solar policy, posting intervals, battery percentage bounds, and battery lockout thresholds.
- **Firmware upload**: stores the newest `firmware.bin`, computes SHA-256/size, updates the manifest, and deletes the previous firmware blob after the new upload succeeds.
- **SPIFFS upload**: stores the newest SPIFFS image, computes SHA-256/size, updates the manifest, and deletes the previous SPIFFS blob after the new upload succeeds.
- **Update status**: compares the target versions with the latest `firmwareVersion` and `spiffsVersion` reported by the station.
- **Alert rules**: configurable thresholds for offline detection, battery warnings, pressure drops, and sensor failures.
- **Event timeline**: chronological log of station events with severity levels (ok, info, warn, bad).
- **Notification settings**: webhook-based alert delivery with configurable cooldown and station name.

For firmware updates, build the ESP32 firmware binary and upload it in `/admin`. For SPIFFS updates, build the filesystem image and upload it in `/admin`.

```text
~/.platformio/penv/bin/pio run
~/.platformio/penv/bin/pio run -t buildfs
```

The ESP32 installs an update only when the manifest is enabled and the manifest version differs from the version reported by the device.

## Dashboard Panels

The 3×3 grid displays these channels:

| Channel | Label | Description |
|---------|-------|-------------|
| CH-01 | ENV TEMP | Temperature (°C) with feels-like secondary |
| CH-02 | ENV HUM | Humidity (%) |
| CH-03 | ENV PRES | Pressure (hPa) |
| CH-04 | FORECAST | Weather forecast with confidence score and driver trends |
| CH-05 | WIND SPD | Wind speed (m/s) with Beaufort secondary |
| CH-06 | WIND DIR | Wind direction (deg) |
| CH-07 | SOLAR | Solar power (W) with voltage secondary |
| CH-08 | BATTERY | Battery power (W) with voltage secondary |
| CH-09 | BAT LVL | Battery level (%) with voltage secondary |

Each panel includes:
- Channel ID and label header
- Primary value with unit
- Signal-level progress bar
- 1-hour trend text (UP/DOWN/FLAT with delta)
- Matrix sparkline graph (pixel-based trend visualization)
- Secondary value line

## Responsive Breakpoints

| Breakpoint | Layout |
|-----------|--------|
| > 760px | 3-column grid, full header row |
| ≤ 760px | 2-column grid, compact header with row layout |
| ≤ 640px | 1-column grid, reduced panel padding, smaller fonts |
| ≤ 380px | Single-column diagnostics and insight grids |

## Notes

- Without Redis, the app still works in local development with in-memory storage.
- On Vercel, use Redis/Upstash. Serverless memory is not persistent across invocations.
- The UI uses a light, high-contrast 3×3 display tile layout with OLED-inspired dark panels.
- The history chart supports interactive cursor tracking with crosshair and tooltip.
- All pages share a consistent header structure with brand, page title, navigation links, and status indicator.
