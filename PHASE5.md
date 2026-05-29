# PWC Geohub — Phase 5 (Right-panel analytics + community aggregation)

Phase 5 lights up the right panel: three KPI cards, a 5-year three-series
timeline, a ranked PWC school list with sparklines, and the School District ↔
NTA community-aggregation toggle. Everything is driven by the active
indicator + the Phase 4 `year` + the Phase 3 filtered universe.

## What's new

### Data layer
- **`area_tract_crosswalk`** table + `etl:area-tracts` ETL — for each
  School District and NTA polygon we record the census tracts that fall
  WITHIN or OVERLAP it. Built once via `ST_Intersects`. 32 SDs × ~89
  tracts avg = 2,863 pairs; 262 NTAs × ~18 tracts avg = 4,662 pairs.
- **`getAnalyticsSeries(indicator, aggArea)`** server function — single
  endpoint that returns:
  - School indicator: raw `school_indicator_values` rows by (dbn, year).
  - Community indicator: per-school AVG over tracts intersecting the
    school's surrounding `aggArea` polygon. The two crosswalks
    (`school_geo_crosswalk` + `area_tract_crosswalk`) pre-join the spatial
    work so the request is a thin GROUP BY.
- **`/api/analytics/series?indicator=…[&aggArea=…]`** route.
- **`getPwcHistory`** + **`/api/pwc/history`** — full per-year PWC
  membership map for the timeline. Historical Anchor / Healing Arts
  averages reflect each year's actual membership, not a snapshot.

### Pure derivation — `src/store/analytics.ts`
`deriveAnalytics({indicator, year, series, pwcByYear, universe,
timelineYears})` returns:
- **kpis**: `{anchor, healing_arts, all}` with `{n, avg, delta}`.
- **timeline**: 3 series × N years with `{anchor, healing_arts, citywide}`.
- **list**: ranked PWC schools (worst → best per good_direction) with
  category symbol + spark values.

Per §5.5 + §6.6 nuance:
- KPI all-schools-avg uses **full filtered universe** (Geo + School Type + Cohort).
- Timeline **citywide line** uses `universe.afterSchoolType` — Geo + School
  Type only, NOT Cohort. The one exception spec §6.3 calls out.
- Anchor / Healing Arts groups use **per-year** PWC membership; a school may
  be Anchor in one year and not the next.
- Both-category schools count in BOTH groups (Q1 default applied at Phase 2).
- In the ranked list, both-category appears **ONCE** with a dual category
  glyph (the agreed answer to the goal's open question).

### Store extension
```ts
aggregationArea: AggregationArea     // 'school_district' (default) | 'nta_2020'
rightPanelCollapsed: boolean         // default false — open per spec §2
setAggregationArea, setRightPanelCollapsed
```
The existing `selectedSchoolDbn` slice already does flyTo; clicking a
ranked-list row just writes to it.

### Components
- **`<RightPanel/>`** — third grid column, ~35% width, collapsible to a 28px
  rail. Header shows the active indicator + year.
- **`<KpiCards/>`** — three accent-bordered cards. Δ vs All-schools card on
  Anchor / Healing Arts, color-coded by `good_direction`:
  green if better-than-avg, red if worse-than-avg, grey when neutral or
  `good_direction === 'none'`.
- **`<Timeline/>`** — custom SVG 3-series line chart with active-year
  dashed marker + a tiny legend strip. No chart library.
- **`<RankedList/>`** — sortable rows with category dots (Anchor magenta,
  Healing Arts orange, "both" = both dots side-by-side, pwc_other PWC blue),
  latest value, and a 5-year `<Sparkline/>`. Click → flyTo via existing
  store wiring.
- **`<Sparkline/>`** — tiny SVG polyline, skips null gaps, shared y-domain
  across rows for cross-school visual comparability.
- **`<AggregationToggle/>`** — School District / NTA segmented control;
  visible only when a community indicator is the focus.

### Layout
Outer grid moved from `260px | 1fr` to `260px | 1fr | minmax(280px, 35%)`.
When the panel is collapsed it shrinks to `260px | 1fr | 28px` with a
left-pointing chevron to re-expand.

## Acceptance walkthrough (§10 Phase 5)

| # | Test | Verified |
|---|---|---|
| ✅ | Anchor / Healing Arts / All averages match an independent hand-calc | `math_proficiency @ 2023-24`: hand = `All 51.47% / Anchor 32.24% / HA 35.98%`; deriveAnalytics output reproduces the figures **exactly** (verified end-to-end against `/api/analytics/series` + `/api/pwc`). |
| ✅ | Deltas vs All-schools average are correct in sign AND magnitude | Anchor Δ = `32.24 − 51.47 = −19.23 pp`; HA Δ = `35.98 − 51.47 = −15.49 pp`. `good_direction='high'` → negative deltas render red (worse than citywide). |
| ✅ | List ranks worst → best honoring `good_direction` | `math_proficiency` is `good='high'`, so list sorts ascending (lowest = worst, on top). `chronic_absent_rate` is `good='low'` → sort descending (highest absenteeism on top). `racial_predominance` is `good='none'` → alphabetical by DBN. |
| ✅ | Clicking a list row zooms the map to that school | Row click → `setSelectedSchool(dbn)` → existing Phase 3 effect fires `flyTo` + opens the Details stub. No new wiring. |
| ✅ | Toggling District ↔ NTA recomputes community aggregates correctly | Verified for `child_poverty @ 2023`, DBN `06M048`: SD = **20.98%**, NTA = **9.97%** — different polygon shapes → different intersecting tract sets → different averages. |

## Defaults / flags applied

- **§12 Q6** (All-schools denominator) — KPI all-card uses **full filtered
  universe** (Geo + School Type + Cohort) per the §6.6 matrix's ✅ for
  Cohort on KPI cards. The literal §12 Q6 text says "post Geo + School
  Type" — strictly the spec is ambiguous between these two. The timeline
  citywide line follows §5.5 + §6.3 exactly: post-(Geo + SchoolType),
  pre-Cohort. **Flag for PWC confirmation** on whether the KPI all-card
  should also drop Cohort.
- **Q1 both-category** — count in both groups, single row with dual
  glyph in the ranked list (your confirmed answer to the goal's question).
- **Q4 graduation** — handled at Phase 0 cohort→school_year mapping; the
  ranked list naturally excludes non-HS schools when graduation is active
  (they have no rows for that indicator).

## Out of scope for Phase 5 (per goal)

- School Details View (still the stub from Phase 3).
- Scorecard / Admin Panel / public-data download / brand & perf polish —
  all Phase 6 + Later.
- Chart library swap — custom SVG is enough for the acceptance tests; a
  Recharts/visx swap can come later for richer hover/tooltip behavior.
