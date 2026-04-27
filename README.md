# Weather Station Vercel Dashboard

High-contrast remote dashboard for the ESP32 weather station.

## API

The station posts telemetry to:

```text
POST /api/ingest
Authorization: Bearer <WEATHER_STATION_API_KEY>
Content-Type: application/json
```

The dashboard reads:

```text
GET /api/latest
```

## Local Setup

```bash
npm install
npm run dev
```

`.env.local` already contains a generated `WEATHER_STATION_API_KEY` for local testing.

## Vercel Setup

1. Create a Vercel project from this folder.
2. Add a Redis/Upstash store from the Vercel Marketplace for persistent latest telemetry.
3. Add this environment variable in Vercel:

```text
WEATHER_STATION_API_KEY=<same value as local .env.local>
```

4. Deploy.
5. In the weather station admin page, set:

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

## Notes

- Without Redis, the app still works in local development with in-memory storage.
- On Vercel, use Redis/Upstash. Serverless memory is not persistent across invocations.
- The UI intentionally matches the station web UI: black background, high contrast, 3x3 display tile layout.
