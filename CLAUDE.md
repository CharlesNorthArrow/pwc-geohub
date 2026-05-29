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
