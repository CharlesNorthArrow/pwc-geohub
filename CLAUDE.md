# CLAUDE.md — PWC Geospatial Intelligence Hub

Context for Claude Code working on this repo. Read this first. Full detail lives in `PWC_Geo_Hub_Technical_Spec.md` — this file is the working primer; the spec is the source of truth.

## What we're building
An **internal, map-centered web app** for the nonprofit **Partnership with Children (PWC)**, built by **North Arrow Maps**. A map of NYC sits in the center; users overlay **public data indicators** (school-level points + community-level polygons) and **PWC's own program data** to drive advocacy, fundraising, and program strategy. Not public-facing.

## The one mental model to hold
There are **two indicator families**, and the whole app is built generically around them — avoid per-indicator special-casing.

| | School indicators | Community indicators |
|---|---|---|
| Geometry | **Points** (one per school) | **Polygons** (mostly census tract) |
| Symbology | circle: **size = enrollment**, **color = value** | choropleth: **color = value** |
| Key | `DBN` (string, keep leading zeros) | census `GEOID` |
| Source | **hosted** CSVs in repo | **API**: ACS Census + CDC PLACES |
| Update | **manual** (future Admin Panel upload) | **automatic** (latest API year, cached) |
| Count | 12 indicators / 5 themes | 9 / 7 themes (1 = Crime, **deferred**) |

**Hard rule:** at most **one school indicator + one community indicator** active at once.

## Glossary (PWC domain)
- **DBN** — NYC DOE school code; the universal join key.
- **Anchor school** — PWC flagship social-work partner. Proposed = `core_school == 1`. *(🔴 confirm — see open Q1.)*
- **Healing Arts school** — PWC arts-residency school. Proposed = `arts_program == 1`. **Anchor and Healing Arts overlap** (a school can be both).
- **Cohort** — PWC geographic grouping (Brownsville, Morrisania, East Harlem, Fort Greene).
- **In-school services** — PWC social-work activity metrics (caseload, contacts) → a dedicated view, not the main map.

## Data locations
- School indicators (hosted, long format after ETL): ingested from these CSVs, all keyed `DBN` + `school_year`, each with a `*_label` column:
  - `arts_ed.csv` (`arts_ed_score`, **only 2021 & 2024-25**), `suspensions.csv` (`suspension_rate`), `temp_housing.csv` (`temp_housing_rate`), `math.csv` (`math_pct_proficient`, since 2017-18), `ela.csv` (`ela_pct_proficient`, since 2017-18), `chronic_absenteeism.csv` (`chronic_absent_rate`), `graduation.csv` (`graduation_rate`, **keyed by `cohort_year`, HS only**), `school_quality.csv` (`safety_climate_rating` categorical + `safety_pct_positive`), `family_survey.csv` (`family_q36_pct_satisfied`), `teacher_survey.csv` (`teacher_q120_access_supports`, also `teacher_q119_disruptive_sel`), `student_survey.csv` (`student_q20_mental_health`, `student_q22_felt_happy`).
  - `schools_master.csv` — **geocoding + enrollment + demographics master** (`latitude`, `longitude`, `total_enrollment` = circle size, `borough`, race/ELL/poverty/ENI/disability fields). 2020-21 → 2024-25.
- PWC program data: `pwc_schools.csv` — long panel `DBN` × `school_year`, 54 schools, **2020-21 → 2025-26**. All-null program row = no active program that year.
- Geographies: ArcGIS feature services (fetch + cache as GeoJSON). Layers & label fields in spec §3.4: NTA (`NTAName`), Council (`CounDist`), Assembly (`District`), Senate (`NAME`), School District (`SchoolDist`), Community District (`BoroCD`), Congressional (`DISTRICTID`), NDA (`NDA_ID`). Counties (5 boroughs) derived from `borough`.
- Community APIs: ACS 5-yr `api.census.gov/data/2024/acs/acs5[/subject|/profile]` (tables B17001, S2301, B11003, DP04→`DP04_0078PE`, B05009, B03002); CDC PLACES `data.cdc.gov/resource/cwsq-ngmh.json` (measures `MHLTH`, `HOUSING`).

## Non-negotiable conventions (anti-tech-debt)
1. **Data contract, not raw reads.** Components never read a CSV/API directly. Everything goes through one access layer returning `{dbn|area_id, year, indicator_id, value, label}`.
2. **Indicators are config (registry), not code.** One registry object per indicator: `{id, family, theme, label, source{type,dataset|endpoint,value_field,label_field}, format, scale{type,good_direction}, geometry, years}`. Adding an indicator = a registry edit. One dataset can back several indicators (`student_survey`, `teacher_survey`).
3. **Single state store** for all cross-filtering: `{activeSchoolIndicator, activeCommunityIndicator, year, geoFilters[], schoolType, cohort, selectedSchool, aggregationArea}`. Components subscribe; no private copies. Filter→component effects are defined in spec §6.6.
4. **Normalize quirks once at ingestion:** redaction sentinels `"R"` and `"Above 95%"` → null; survey `"Data not available"` → null; graduation cohort→school_year mapping; preserve DBN leading zeros.
5. **APIs cached server-side** keyed `{indicator, geography, year}`. Never call ACS/CDC during UI interaction. Geographies served from our cache, not Esri at runtime.

## Known data gotchas (don't get surprised)
- **`08X208` → remap to `84X208`** in ETL (charter-district coding, same school). **`03M299`** (Maxine Greene, closed ~2023) stays unmatched → exclude from map, flag in data-quality report (address later).
- **~5% of master rows lack lat/long** → unplottable; flag.
- **Year coverage differs per indicator** → default to each indicator's own latest year and always show which year is displayed; missing year → 🗓️ "Data not available for the selected year."
- **Graduation** is cohort-grained + HS-only. **Safety** indicator is categorical. **PWC data** extends to 2025-26 while public data stops at 2024-25.
- `school_type` in `pwc_schools.csv` = DOE/Charter/D75 governance — **NOT** the dashboard "School Type" filter (All/PWC/Anchor/Healing Arts).

## School ↔ community aggregation
To put a community indicator on the PWC KPI cards/list: average the community values across polygons **contained in or overlapping** the school's area, where area = **School District OR NTA** (user toggle). Build both crosswalks in Phase 0.

## Branding
Logo top-left → links to https://partnershipwithchildren.org/. Palette (sampled — confirm against brand guide): primary blue `#027BC0`, orange `#F0901F`, lime `#A0B000`, magenta `#903090`, teal `#00A0B0`, navy text `#002040`. **Chrome only** — use separate perceptually-uniform ramps for choropleths.

## Shared selectors (don't re-derive — import these)
The Phase 1–5 features all share six pieces of derived logic. Each lives in one named place; School Detail / Scorecard / Admin Panel must **consume** them rather than reimplement. Behavior is locked by `reports/selectors-snapshot.json` — keep it byte-identical when refactoring.

| Selector | File · export | Input → Output | Used by |
|---|---|---|---|
| **Filtered universe** (Geo → School Type → Cohort cascade) | `src/store/derived.ts` · `applyFilters({state, schoolsMaster, pwcMembers, allCohorts})` | → `{schoolDbns, afterGeo, afterSchoolType, cohortOptions, prefilterSummary}` | MapView, HeaderBar, Shell→deriveAnalytics |
| **Active layers + per-layer year/availability/missing-year** | `src/store/activeLayers.ts` · `resolveActiveLayers({schoolIndicator, communityIndicator, sliderYear, analyticsFamilyPref, schoolFeatureCount, communityValueCount, latestPerLayer})` | → `{school, community, analytics, bothFamiliesActive}` where each `LayerState` carries `{indicator, displayYear, cohortYear, noData, available, nearest}`. `displayYear` is registry-driven (stable across fetch); `noData` ORs in the empty-fetch signal; `cohortYear` is the slider-format key for series-row lookups; `latestPerLayer=true` makes each layer ignore the slider and use its own latest registry year | Shell (pass `layer.displayYear` to fetchers, `layer.noData` to the render branch). YearBadge / TimeSlider / Legend should read `layer.available` + `layer.nearest` here instead of calling `indicatorSliderYears` / `nearestSliderYear` themselves. Detail Panel reads `layer.cohortYear` to key into the analytics series |
| **Percentile in the filtered universe** | `src/store/percentile.ts` · `computePercentile({series, year, universeDbns, selectedDbn, goodDirection})` | → `{cohortValues, selfValue, rank, cohortSize, betterThanFraction, callout}`. Self is always included in the cohort; callout phrased via `good_direction`; small-N (cohort < 10) flips to "Rank X of N" instead of percentile | School Detail Panel §1.a, future Scorecard. Builds on top of `applyFilters` + `getAnalyticsSeries` — never recomputes the universe or the District/NTA aggregation |
| **PWC group membership (the "both"-rule)** | `src/store/pwcGroups.ts` · `belongsToPwcGroup(category, group)` | (`PwcCategory`, `'anchor'\|'healing_arts'`) → `boolean`. Both-category schools pass either group | `applyFilters` (School Type cascade), `deriveAnalytics` (KPI / timeline / list), any future PWC-group predicate |
| **PWC category derivation (server-side)** | `src/server/contract.ts` · `pwcCategoryFromFlags(core_school, arts_program)` (private) | (`boolean\|null`, `boolean\|null`) → `PwcCategory`. One place, used by `getPwcMembership` + `getPwcHistory` | server only |
| **`good_direction` ranking** (worst → best) | `src/store/analytics.ts` · `rankByGoodDirection(rows, valueOf, goodDirection, tiebreakKey)` | → new sorted array; nulls last; deterministic tiebreak | `deriveAnalytics` (ranked list), upcoming Scorecard / School Detail tables. Sign of `delta` is interpreted by `deltaStatus(delta, good_direction)` in the same file |
| **Group avg + delta** (KPI cards) | `src/store/analytics.ts` · `deriveAnalytics({indicator, year, series, pwcByYear, universe, timelineYears})` | → `{kpis: {anchor, healing_arts, all}, timeline, list}`. KPIs are means over the filtered universe; deltas vs all-cell; timeline citywide uses `afterSchoolType` (no Cohort) per §5.5 | RightPanel via Shell |
| **School ↔ community aggregation (District / NTA)** | `src/server/contract.ts` · `getAnalyticsSeries(indicatorId, aggArea)` SQL | Joins `school_geo_crosswalk × area_tract_crosswalk × community_indicator_values` — **no `ST_Within`/`ST_Intersects` at request time.** §11.9 invariant — crosswalks built in Phase 0 ETL | `/api/analytics/series` → Shell → deriveAnalytics |

**Rule of thumb:** if you're about to write `category === 'anchor' || category === 'both'`, or call `indicatorSliderYears` from a component, or recompute "is this layer's year present in the registry?", **stop** — there's already a selector for it.

## School Detail Panel (where things live)
The Detail Panel replaces RightPanel in the right column whenever `selectedSchoolDbn` is set — via map click, School filter, or ranked list. Closing restores the prior camera + right-panel-collapsed state captured at open.

**Layout & chrome**
- `src/components/SchoolDetailPanel.tsx` — three sections in vertical sequence, each in its own padded container with a divider + alternating background tone (white → `#f7f9fb` → white).
- Header: PWC-blue (`#027BC0`) bar, white text, close × on the right. Inside: "SCHOOL DETAILS" eyebrow, name (large), DBN + borough + grades (subdued), and an inverted "Not shown on map" badge when the school is unplottable.
- Three sections — each carries its **own year pill** (no shared section-level pill, so latest-mode reads correctly):
  - **§1.a Indicators** — follows the slider (or the layer's latest in latest-mode). Per-active-layer block: family tag + indicator name + per-layer year pill (analytics-blue), self-value headline, `<StripPlot/>`, plain-language callout. Two blocks stack when both families are active.
  - **§1.b School profile** — pinned to the school's latest demographics year (`profile.profile_year`). 4-metric row: Enrollment · % Poverty · % ELL · % Disabled. Race bar below. Pill tone = "profile" (grey).
  - **§1.c PWC programs** — renders **only** when the school appears in `pwc_school_program` at all. Always shows all three program-detail rows (Community school / Arts program / OST program) with `—` for null/empty; food pantry + laundry as boolean chips. Pill tone = "program" (magenta).
- Backend: `getSchoolProfile(dbn)` (`/api/schools/profile`) returns identity + latest-year demographics, **scaled 0→100 server-side** so `pct_*` matches the rest of the app's percent convention. `getPwcProgram(dbn, year)` (`/api/pwc/program`) returns the program row with `active` flag, `null` when not PWC.

**Distribution viz (`src/components/StripPlot.tsx`)**
- Pure consumer of `PercentileResult` — no math of its own.
- Two render modes auto-picked by `cohortSize`:
  - `< 10` → cohort dots on a single center line (no jitter, opaque). Selected school's value labeled.
  - `≥ 10` → smoothed kernel-density curve only (no individual dots). Selected pin still on the strip.
- Strip always spans container width: `width="100%"`, no `height` attribute, `preserveAspectRatio="xMidYMid meet"`. Circles stay round at any panel width.
- Four equal-width visual quartile bands behind the strip (axis-position, not statistical-quartile). Statistical median rendered as a dashed tick on top.
- Axis labels (min · median · max) live in HTML below the SVG, not inside it, so they never squish.

**Map state capture / restore**
- `MapView` exposes `onViewChange({center, zoom})` (fires on idle + post-init) and a one-shot `flyToView` prop.
- Shell holds `lastMapViewRef` (latest camera) and `priorMapStateRef` (snapshot on open). Close handler restores both the camera and `rightPanelCollapsed`.
- Selection zoom = `13` (NTA-level) for both School filter pick AND Detail Panel open — unified.
- `selectedSchool={dbn, coords}` drives a maplibregl.Marker with the `.pwc-pulse` CSS keyframe (ring only — no center fill, so the indicator color + PWC halo stay visible through it). Skipped for unplottable schools; panel still opens with the "Not shown on map" badge.

## Filter bar conventions (Header)
- **Pills never grow with selection.** Every filter trigger shows only the filter name (uppercase) + a count badge when active. The chosen value lives in the trigger's `title` tooltip and is also highlighted in the open panel. Background flips white → `#027BC0` to signal "this filter is on". **Never inline the operator/value in the trigger** — it pushes the time slider.
- **Reset button** = icon-only yellow chip (`#f5c400` bg, white `↺`). Placed **before** the time slider, not after, so its appear/disappear doesn't shift the slider's horizontal anchor.
- **"Latest" pill** (`useHubStore.latestPerLayer`) sits beside the slider. When ON: `resolveActiveLayers` ignores `sliderYear` and each layer's `displayYear` becomes its own latest registry year — school and community may sit at different years simultaneously. Slider stays visible but dims to ~40% opacity. Toggle via `setLatestPerLayer`.
- **PWC counter** = `src/components/PwcCounter.tsx`, rendered as a sibling of MapView (absolutely-positioned inside the same relative container). **Counts from the filtered universe, not the map viewport.** Total stays stable across indicator switches and pan/zoom. When an indicator is active and at least one in-view PWC school lacks a value, an indented "X of N have no data for this indicator" line appears below the headline — the total never moves.

## Build order (current = Phase 0)
0. **Data foundation & ETL** ← start here (registry, normalize, crosswalks, API cache, geo cache, data-quality report). No UI.
1. Map core + single-indicator render (points OR choropleth, dynamic legend, latest-year default).
2. PWC layer (halo, Anchor/Healing Arts, PWC-only toggle).
3. Header filters + cascade.
4. Time slider + longitudinal wiring.
5. Right-panel analytics + community aggregation.
6. Download + branding + performance polish.
Later & separately specced: School Details View, Scorecard, Admin Panel, Crime indicator.

Each phase has explicit acceptance tests in the spec — implement to those, not vibes.

## Suggested stack (confirm before scaffolding)
React + TypeScript · MapLibre GL JS / deck.gl · Recharts (or visx) · Zustand state.
**Hosting = Vercel-native:** app + thin API as Vercel serverless/edge functions · **Neon** Postgres+PostGIS (via Vercel Marketplace) for school/program data + crosswalks · **Vercel Blob** for cached geo tiles/GeoJSON · **Vercel Cron** for ACS/CDC/geo refresh · Census API key as server-side env var.
**Serverless rules:** precompute crosswalks + community aggregation in Neon/ETL/cron and store results (never point-in-polygon per request); serve big tiles/GeoJSON from Blob, not functions; keep API functions thin (reads against precomputed tables).

## Before you build something blocked
Check spec §12 open questions (Q1 Anchor/Healing-Arts definition, Q3 safety categorical, Q4 graduation grain, Q5 2025-26 slider, Q6 all-schools denominator). Don't guess past a 🔴 — use the proposed default and flag it.
