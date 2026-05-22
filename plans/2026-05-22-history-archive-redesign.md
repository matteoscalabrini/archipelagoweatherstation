# History & Archive Redesign — Design Spec

## Goal

Two related fixes:

1. Make the page header consistent across all four pages (Dashboard, Archive, History, Admin).
2. Rewrite the History and Archive UIs so they share the dashboard's OLED visual language (black panels, Doto font, green accent) while their charts are rendered in a **precise, technical** style — not the chunky matrix-sparkline aesthetic the dashboard tiles use.

The data layer (APIs, telemetry schema, archive aggregates) is unchanged. This is a markup + CSS restyle.

## Non-goals

- No new metrics, no new endpoints, no new state.
- No change to the Dashboard's OLED panels or their matrix sparklines.
- No accessibility-feature additions beyond what comes for free with semantic markup.
- No mobile-specific redesign; existing responsive breakpoints continue to apply.

## 1. Consistent Header

All four pages render the same header structure:

```tsx
<nav className="station-header">
  <div className="station-brand-stack">
    <a className="brand station-brand-word" href="/">Archipelago</a>
    <h1><em>{PAGE_TITLE}</em></h1>
  </div>
  <div className="station-header-actions">
    <a className="station-nav-link" href="/" aria-current={current === "/" ? "page" : undefined}>Dashboard</a>
    <a className="station-nav-link" href="/archive" aria-current={current === "/archive" ? "page" : undefined}>Archive</a>
    <a className="station-nav-link" href="/history" aria-current={current === "/history" ? "page" : undefined}>History</a>
    <a className="station-nav-link" href="/admin" aria-current={current === "/admin" ? "page" : undefined}>Admin</a>
    <span className={`station-status ${statusTone}`}>{statusText}</span>
  </div>
</nav>
```

Per-page `PAGE_TITLE`:

| Page | Title |
|---|---|
| `/` | Weather Station |
| `/archive` | Archive |
| `/history` | History |
| `/admin` | Admin |

Notes:
- Dashboard's brand becomes an `<a>` (currently a `<span>`).
- `<h1><em>History Lab</em></h1>` → `<h1><em>History</em></h1>` (drop "Lab" naming).
- All four nav links render on every page; the link for the current page gets `aria-current="page"` and is styled with the green accent via `.station-nav-link[aria-current="page"]`.
- The status pill stays page-specific (Dashboard: connection; History/Archive: load state; Admin: session state).

## 2. Page structure (Archive + History)

Both pages drop their bespoke "lab" containers and use the dashboard's chrome:

```
<main class="station-dashboard ...-page">
  <nav class="station-header"> … </nav>
  <div class="station-meta-strip"> … </div>      ← Doto chips, page-specific facts
  <div class="data-toolbar"> … </div>             ← range / year-month / chart-field controls
  <section class="chart-panel"> … </section>      ← single full-width OLED panel containing the technical chart
  <section class="stat-grid"> … </section>        ← 5 OLED stat cards
  <section class="series-grid"> … </section>      ← (History only) per-series mini OLED cards
  <section class="archive-table-section"> … </section>  ← (Archive only) daily records table
</main>
```

### Page-specific meta strip

- **History**: `Last <strong>{age}</strong>` · `Window <strong>{spanLabel}</strong>` · `Samples <strong>{n}</strong>` · `Series <strong>{n}</strong>`
- **Archive**: `Year <strong>{Y}</strong>` · `Month <strong>{M | "All"}</strong>` · `Days <strong>{n}</strong>` · `Samples <strong>{n}</strong>`

### Toolbar

- **History**: `6H` / `24H` / `7D` / `All` range buttons.
- **Archive**: Year `<select>` + Month chip-button row (`All`, `Jan`…`Dec`) + Chart-field `<select>`.

Both toolbars share a `.data-toolbar` shell with Doto typography, dark background, subtle border. Active state uses the green accent.

### Stat grid

Five OLED-styled cards per page (replaces today's `.history-selected-stat`):

- **History**: Latest / Minimum / Average / Maximum / Delta (delta colored by sign).
- **Archive**: Days / Samples / Avg Temp / Min Temp / Max Temp.

Each card uses the same head layout as dashboard tiles (`.oled-panel-head` with channel id + label + status pixel) so the visual rhythm matches.

### Series grid (History only)

Bottom strip of small OLED cards, one per numeric series, replacing the current `.history-series-card`. Same head as dashboard tiles; large value; min/Δ/max meta line. Reuses `.oled-panel` styling rather than its own.

### Archive table

Below the chart, restyled with:
- Black background, faint `#2f2f2f` row borders
- Doto headers (uppercase, letter-spaced)
- `font-variant-numeric: tabular-nums` for data cells
- Green accent for the date column

## 3. Technical chart style

The single chart panel on each page is the centerpiece. Rendered as an SVG inside `.chart-panel` (a full-width OLED panel).

Shared rules:
- **Line**: 1.5px solid green stroke, `stroke-linejoin: round`, `stroke-linecap: round`. No filled area (or `<= 5%` alpha for the faintest hint).
- **Axes**: thin 1px baselines at the bottom and left of the plot region. Small (3px) tick marks on each axis at every labelled tick.
- **Grid**: thin 1px lines at 10% white opacity, only horizontal.
- **Tick density**: 5–6 y-axis labels (auto-rounded), 6–8 x-axis time labels for history, daily-stride for archive.
- **Labels**: Doto, 0.7rem, slightly desaturated green (`color-mix(in srgb, var(--accent) 70%, transparent)`). `font-variant-numeric: tabular-nums` so digits don't shimmy under the cursor.
- **Reference lines**: faint dashed horizontal lines at min / avg / max, each labelled at the right edge with the exact value. Toggle-able later, but on by default.
- **Crosshair**: vertical + horizontal line at cursor, snap-to-nearest data point. Tooltip styled as a readout: `23.4 °C` on line 1, `14:32` on line 2.
- **Top-right readout strip** inside the panel header:
  - History: `LATEST 23.4 °C   Δ1H +0.3   MIN 19.1   MAX 24.8`
  - Archive: `AVG 19.7 °C   MIN 12.4   MAX 28.1` (no LATEST/Δ — the view is historical)
  - All Doto with tabular numerals; units inherited from the active series.
- **Y-axis labels**: 5 evenly-spaced ratios (0, 0.25, 0.5, 0.75, 1) across the padded value range — mirrors the existing tick logic, just with consistent formatting via `fmt(value, unit)`.

Archive-specific:
- Each day renders as a **vertical min-max range bar** (1px green line, 30% opacity) plus a 2px dot at the average. This shows daily variability honestly without bar-chart visual noise.
- The dashed reference lines on Archive use period-wide stats: `min(dailyMin)`, `mean(dailyAvg)`, `max(dailyMax)` — not single-day values.
- X-axis labels stride by week when the window > 14 days; daily labels otherwise.

### Daily weather emoji strip

A thin horizontal row of emojis sitting **inside the chart panel, between the header and the SVG plot**, sharing the chart's horizontal scale. Each emoji is centered on its day's x-position.

- **One emoji per day** — never per sample.
- **Picker**: reuse `weatherEmoji(tempC, humidity, pressureDelta)` from `src/app/dashboard.tsx`. Refactor it into `src/lib/insights.ts` so both Archive and History can import it (Dashboard updates its import path).
- **Inputs per day**:
  - Archive (`DailyAggregate`): `tempC = tempAvg`, `humidity = humidityAvg`, `pressureDelta = (pressureMax ?? 0) - (pressureMin ?? 0)` (positive only — magnitude of pressure swing for the day; preserves the storm-vs-clear distinction the dashboard uses for instantaneous Δ via signed comparison only when humidity > 80).
  - History (sub-hourly samples): bucket points by local-calendar day; `tempC = mean(tempSamples)`, `humidity = mean(humiditySamples)`, `pressureDelta = lastPressure − firstPressure` for that day.
- **Empty days**: render `·` (faint, accent at 30% opacity) in place of an emoji so the strip keeps its rhythm.
- **History range gating**: only render the strip when the active range spans more than one day (i.e., 24H / 7D / All). For 6H, hide the strip.
- **Visual**: ~1.4em row height; emoji at 1.1rem; faint `1px solid color-mix(in srgb, var(--accent) 12%, transparent)` bottom border to separate from the SVG; no background fill.
- **Interaction**: hovering an emoji shows a tooltip `May 18 · 18.7 °C · 64 %` using the same readout style as the crosshair tooltip.

Implementation note: the strip is rendered as a sibling `<div>` above the chart `<svg>`, using `display: grid` with one column per day so it scales with the chart's inner width. The chart and the strip share the same left-padding (`pad.left`) and right-padding (`pad.right`) so emoji centers align with their SVG x-positions exactly.

## 4. CSS work in globals.css

New / changed rules:

- `.station-nav-link[aria-current="page"]` — green accent, no underline change.
- `.station-brand-word` already styled; ensure `<a>` form inherits identical look.
- `.data-toolbar` — new shared shell for History range + Archive selectors. Active button gets the green accent (`background: color-mix(in srgb, var(--accent) 15%, transparent)` and `color: var(--accent)`).
- `.chart-panel` — extends `.oled-panel`, full width, taller min-height (~360px), header reserves room for the readout strip.
- `.chart-readout-strip` — top-right text inside `.chart-panel`.
- `.chart-emoji-strip` + `.chart-emoji-cell` + `.chart-emoji-empty` — the daily emoji row above the SVG.
- `.chart-axis`, `.chart-axis-tick`, `.chart-axis-label`, `.chart-grid-line`, `.chart-reference-line`, `.chart-reference-label`, `.chart-line`, `.chart-area` — restyled chart internals (the existing `.history-series-*` rules are dropped or remapped).
- `.stat-grid` — generic 5-column responsive grid using `.oled-panel` cards.
- `.archive-daily-table` — dark table styling.
- Delete the dropped "lab" rules: `.history-lab-page`, `.history-lab-board`, `.history-lab-panel`, `.history-insight-panel`, `.history-station-list`, `.history-derived-grid`, `.history-lab-report`, `.history-lab-toolbar` (or remap to new names if reused).

## 5. File-level changes

| File | Change |
|---|---|
| `src/app/dashboard.tsx` | Header markup: brand → `<a>`, add Dashboard link with `aria-current="page"`. Replace local `weatherEmoji` with the import from `@/lib/insights`. |
| `src/app/history/history-client.tsx` | New layout: drop board/insight panel, new chart component with technical styling, restyle range toolbar, stat grid, series grid; header gets all 4 links. Render daily emoji strip when range > 6H. |
| `src/app/archive/archive-client.tsx` | New layout: technical chart with min-max bars, daily emoji strip, restyle toolbar/stat grid/table; header gets all 4 links. |
| `src/app/admin/admin-client.tsx` | Header gets all 4 links incl. Admin with `aria-current="page"`. (Three header instances on this page — all updated.) |
| `src/app/globals.css` | New rules listed above; delete obsolete "lab" rules. |
| `src/lib/insights.ts` | Export `weatherEmoji(tempC, humidity, pressureDelta)` moved from dashboard.tsx. |

No changes to API routes or telemetry types.

## 6. Acceptance checks

- Header on every page renders all four links; the current page's link is visibly green / current.
- Brand text on dashboard is now clickable (currently inert).
- History page: chart panel is a single black OLED panel with a thin green line, visible min/avg/max dashed references, dense tick labels in Doto, hover crosshair + readout, top-right LATEST/Δ/MIN/MAX strip. Daily weather emoji strip appears above the SVG when range is 24H or longer. Range buttons styled as Doto pills. Stat grid renders 5 OLED-styled cards. No "Lab" naming anywhere.
- Archive page: same chart styling, plus daily min-max range bars behind the line and the daily emoji strip above. Year + month + chart-field toolbar styled to match. Daily records table is dark + Doto-headed with tabular numerals.
- `weatherEmoji` lives in `src/lib/insights.ts`; Dashboard imports it from there (no duplication).
- No regressions on the Dashboard or Admin pages beyond their new header.
- Page lints + builds (`npm run build` and `npm run lint` if present) succeed.
