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

The station also polls authenticated device endpoints:

```text
GET /api/device/config
GET /api/device/firmware?version=<current-firmware-version>
Authorization: Bearer <WEATHER_STATION_API_KEY>
```

The protected admin UI is available at:

```text
/admin
```

## Local Setup

```bash
npm install
npm run dev
```

Local environment variables:

```text
WEATHER_STATION_API_KEY=<shared station token>
WEATHER_STATION_ADMIN_PASSWORD=<admin login password>
ADMIN_SESSION_SECRET=<long random cookie signing secret>
BLOB_READ_WRITE_TOKEN=<Vercel Blob token>
```

## Vercel Setup

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

`/admin` stores remote config and update manifests in Redis/Upstash, with in-memory fallback for local development. Uploaded binaries are stored in Vercel Blob:

- Remote config: station runtime values, seeded from the latest station telemetry when available.
- Firmware upload: stores the newest `firmware.bin`, computes SHA-256/size, updates the manifest, and deletes the previous firmware blob after the new upload succeeds.
- SPIFFS upload: stores the newest SPIFFS image, computes SHA-256/size, updates the manifest, and deletes the previous SPIFFS blob after the new upload succeeds.
- Update status: compares the target versions with the latest `firmwareVersion` and `spiffsVersion` reported by the station.

For firmware updates, build the ESP32 firmware binary and upload it in `/admin`. For SPIFFS updates, build the filesystem image and upload it in `/admin`.

```text
~/.platformio/penv/bin/pio run
~/.platformio/penv/bin/pio run -t buildfs
```

The ESP32 installs an update only when the manifest is enabled and the manifest version differs from the version reported by the device.

## Notes

- Without Redis, the app still works in local development with in-memory storage.
- On Vercel, use Redis/Upstash. Serverless memory is not persistent across invocations.
- The UI intentionally matches the station web UI: black background, high contrast, 3x3 display tile layout.
