# PWC Geohub — Phase 1 (Map core + single-indicator rendering)

Phase 1 delivers a working NYC map with one school indicator (points) and/or
one community indicator (tract choropleth) active at a time. Header filters,
PWC halo symbology, time slider, and the right-panel analytics arrive in
Phases 2–5 (spec §10).

## Run it

```pwsh
# One-shot Phase 0 backfill — fetches NYC tract polygons (added for Phase 1):
$env:NODE_OPTIONS = "--use-system-ca"; npm run etl:tracts

# Dev server:
$env:NODE_OPTIONS = "--use-system-ca"; npm run dev
# → http://localhost:3000
```

## Acceptance test walkthrough (spec §10 Phase 1)

| # | Test | How to verify |
|---|---|---|
| ✅ | Any school indicator → sized + colored circles + matching legend | Click any school indicator in the left panel. Circles size by enrollment, color by value. |
| ✅ | Any community indicator → tract choropleth + matching legend | Click any community indicator. Tracts color; legend swaps to community ramp. |
| ✅ | Only one school + one community indicator active at once | Click a second school indicator — replaces the first. Same for community. Click the active one again — clears it. |
| ✅ | Year label reflects the indicator's own latest year | Pick `arts_ed_score` → year badge reads `2024-25 (latest)`. Pick `chronic_absent_rate` → `2024-25`. Pick `math_proficiency` → `2024-25`. Each indicator's own latest year is used. |
| ✅ | Switching to a year with no data shows the 🗓️ notice | With `arts_ed_score` active (only 2020-21 and 2024-25 exist), open the year dropdown in the badge and pick `2019-20` via URL `?schoolYear=2019-20`. The map empties; the 🗓️ "Data not available" panel shows; the **other** layer keeps rendering. |

## Architecture

- **Data contract** — `src/server/contract.ts` is the only place that touches
  Neon. API routes (`app/api/{indicators,schools,community,geo/tracts}/route.ts`)
  return the wire format defined in `src/contract/types.ts`. Components fetch
  via `src/contract/client.ts`; **no component reads a CSV or hits the federal
  APIs** (spec §11.1).
- **Indicator registry** — `src/registry/indicators.ts` is unchanged from
  Phase 0. The UI is metadata-driven: legend, year badge, color encoding, and
  the selector all read from `IndicatorPublic` (a sanitized projection of the
  registry entry; see `src/server/contract.ts:toPublic`).
- **Single state store** — `src/store/useHubStore.ts` (Zustand). Phase 1 slice
  only: `{activeSchoolIndicator, activeCommunityIndicator, schoolYearOverride,
  communityYearOverride}`. Other phases will extend this; no new state stores.
- **Map** — MapLibre GL JS. CARTO Voyager raster basemap (no key required).
  School points (`circle`) and tract choropleth (`fill` + 0.3px `line`) live
  on one map; polygons render beneath points.
- **Tract polygons** — fetched once by `scripts/etl/22-fetch-tracts.ts` from
  TIGERweb, persisted to Neon `geographies` (geo_layer=`tract`), mirrored to
  Vercel Blob, served by `GET /api/geo/tracts → {url}` (browser fetches the
  large payload from Blob/CDN per spec §11.9).

## Phase 1 deviations / things flagged for later phases

- **No header filters, no time slider, no right panel** — explicit Phase 1
  scope. The year-badge dropdown is the temporary stand-in for the slider
  needed to exercise the 🗓️ branch; it disappears in Phase 4.
- **Categorical school indicators** — none exist in the active registry; Q3
  routed `safety_climate` to the numeric `safety_pct_positive`. If a future
  registry entry has `format: 'categorical'` for a school indicator, the
  `colorExpression()` already branches on `value_text` (no code changes
  needed).
- **No-data notice trigger** — in Phase 1, "no data" is detected either when
  the registry's `years` array doesn't include the requested year (the year
  badge offers years off-coverage too, intentionally) or when the API returns
  an empty `features` / `values` payload. The slider will replace the URL
  override flow.
- **Basemap key** — CARTO raster tiles are public; for Phase 6 polish, swap
  to a styled vector basemap if needed.
- **`@types/react` in deps** — added by the Phase 1 install; the Next.js dev
  command auto-updated `tsconfig.json` (set `jsx: "react-jsx"`) and
  `next-env.d.ts`. Both changes are kept.
