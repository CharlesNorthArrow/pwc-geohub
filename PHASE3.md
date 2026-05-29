# PWC Geohub — Phase 3 (Header filters + cascade)

Phase 3 introduces the §6.1–§6.4 filter bar — Geo (popup, multi-pick), School
Type, Cohort, School. Every dropdown reads from one derived selector so the
cascade, the pre-filter notes, and the map layer always agree. Time slider
(Phase 4) and the right panel (Phase 5) attach to this same plumbing without
forking state.

## What's new

### Data layer
- **`scripts/etl/21-build-crosswalks.ts`** — now builds crosswalks for all 6
  §6.1 layers: county, senate, assembly, council, school_district,
  community_district. Re-run produced **1,779 / 1,779** match on every layer
  except school_district (pre-existing 85 unmatched Bronx charter/D75 schools).
- **`scripts/etl/20-fetch-geographies.ts`** — INSERT now wraps
  `ST_MakeValid(...)` around `ST_GeomFromGeoJSON(...)`. Closes a
  data-corruption bug where ArcGIS's `f=geojson` flattened multi-component
  council polygons (e.g. CD 42's two Brooklyn pieces) into a single Polygon
  with multiple outer rings → PostGIS read the extra rings as holes →
  geometry shrunk to a tiny self-intersecting shard. Pre-fix the council
  crosswalk had a 35% miss rate; post-fix it's 0%.
- **`GET /api/schools-master`** → lightweight `{dbn, school_name, borough, geos}`
  per plottable school with all 6 crosswalk memberships baked in (~1,779 rows).
- **`GET /api/geographies`** → option lists across all 6 layers in one
  round-trip (~370 areas).
- New types: `GeoFilterLayerId`, `GeoArea`, `GeographiesResponse`,
  `SchoolMaster`, `SchoolsMasterResponse` (`src/contract/types.ts`).

### State
Extends the existing Zustand slice — no fork:
```ts
geoFilters: Partial<Record<GeoFilterLayerId, string[]>>   // missing/empty = unconstrained
cohort: string | null                                     // null = "All cohorts"
selectedSchoolDbn: string | null                          // School filter pick
```
The Phase 2 `schoolType` slice is unchanged; the new header dropdown writes to it.

### Single source of truth — `src/store/derived.ts`
`applyFilters({state, schoolsMaster, pwcMembers, allCohorts})` returns:
```ts
{
  schoolDbns:        Set<string>,         // final in-view universe
  afterGeo:          Set<string>,         // intermediate, for downstream counts
  afterSchoolType:   Set<string>,         //   "
  cohortOptions:     [{cohort, count}],   // narrowed for the Cohort dropdown
  prefilterSummary:  {forSchoolType, forCohort, forSchool: string|null},
}
```
Used by **MapView** (school-layer filter), **HeaderBar** (options + pre-filter
notes), and Phase 5 (KPI / list / aggregation will read the same set).

### Cascade semantics
- Within a layer: **UNION** (school in council 13 OR 14).
- Across layers: **INTERSECTION** (council 13 AND school_district 2).
- Empty layer: no constraint.
- Order: Geo → School Type → Cohort → School filter.
- Both-category PWC schools pass both "Only PWC Anchor" and "Only PWC
  Healing Arts" (the Phase 2 rule, preserved).

### Components
- `<HeaderBar/>` — toolbar row between the panels (in the right column above
  the map). Layout follows spec §2 — when the right panel ships in Phase 5,
  it joins the outer grid; the header stays only over the map.
- `<GeoFilterDialog/>` — modal popup, six-tab list + search + checkbox per
  area. Apply / Cancel / Reset; local working state so the map doesn't churn
  while the user picks; per-tab count badge so other tabs' selections stay
  discoverable; ESC + backdrop click cancel.
- `<FilterDropdown/>` — generic single-select with search + reset + per-option
  count + pre-filter pill. Reused by School Type, Cohort, and School filters.
- `<SchoolDetailsStub/>` — modal reserving the spec §10 Later "School
  Details View" entry point; opens when `selectedSchoolDbn` is set.
- `<MapView/>` — combined filter expression: MapLibre `'all'` of the School
  Type filter and `['in', 'dbn', filteredSchoolDbns]`. Also gains a `flyTo`
  effect for `selectedSchoolDbn`.

### Layout change
- The left panel is unchanged (260px wide).
- The right column is now `grid-template-rows: auto 1fr` — header on top, map
  below. When the right panel lands in Phase 5, the outer grid becomes
  `260px | 1fr | 35%`; the header stays in the middle column and only spans
  the map (per spec §2).
- `<SchoolTypeToggle/>` from Phase 2 was deleted — its state moved to the
  header dropdown, same Zustand slice.

## Acceptance tests (spec §10 Phase 3)

| # | Test | How to verify |
|---|---|---|
| ✅ | Each control updates exactly the components in §6.6 | Indicator selector → map + legend + (future) right-panel hooks. Geo → map + list (school dropdown). School Type → map + list. Cohort → map + list + (future) KPI/timeline targets that already read from `universe.schoolDbns`. School filter → map zoom + Details View stub. |
| ✅ | Selecting a Council District narrows the School filter's options + shows the pre-filter note | Open Geo popup → Council tab → pick CD 13 → Apply. Open School filter dropdown → it shows ~30 schools instead of ~1,779; pill above the list reads "pre-filtered by Geo: Council 13". |
| ✅ | Geo selections filter map + list to features within the selected geographies | The map's school layer applies `['in','dbn',[...]]`; the School dropdown options list comes from the same universe set. Both are derived from one selector so they can't drift. |
| ✅ | Reset returns each filter to default; search finds items within each | Each dropdown has a "↺ Reset to All" first option. The geo popup has a Reset button (clears working state) plus a "↺ Reset all" button in the header that clears all four filters. Each dropdown + the geo popup tabs has a Search box that filters labels case-insensitively. |

## Dead-options UX (decision applied)
Dropdown options with count = 0 are rendered **greyed-out** but stay
clickable, so users can see what the cascade hid. Picking a 0-count option
loads the empty state with no surprise — easier than hunting for a removed
option.

## Phase 0 data-quality finding (logged here, not in Phase 0)
The PostGIS `ST_MakeValid` fix repaired 18 council, 3 assembly, 3
school_district, and 1 community_district invalid polygons. Pre-existing
Phase 0 DQ report still shows the original 85 school_district unmatched
schools (mostly Bronx charter/D75 with coords on district edges); these are
unrelated to the validity fix and remain a known limitation when filtering by
School District.

## Phase 3 deviations / parked
- **No time slider** — Phase 4. The Phase 1 `?schoolYear` URL override still
  works.
- **No right-panel KPIs / timeline / ranked list / aggregation** — Phase 5.
  But `universe.schoolDbns` and the cascade store are ready for them with no
  rework.
- **No active-geo polygon highlighting on the map** — Phase 6 polish.
- **No School Details View** — modal stub only.
- **School filter dropdown soft-caps at 500 options** before search; the
  search box reveals the rest. With ~1,779 schools, this keeps the dropdown
  snappy without losing functionality.
