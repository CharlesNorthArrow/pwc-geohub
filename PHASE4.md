# PWC Geohub — Phase 4 (Time slider + longitudinal wiring)

Phase 4 introduces the §6.5 time slider: a single `year` in the store drives
both layers, each resolving availability independently so the 🗓️ branch for
one layer never breaks the other.

## What's new

### Store change — single `year` slice
Removed Phase 1's per-family `schoolYearOverride` / `communityYearOverride`
placeholders. Replaced with:
```ts
year: SliderYear   // '2020-21' | '2021-22' | '2022-23' | '2023-24' | '2024-25'
setYear(y: SliderYear): void
```
Default = `'2024-25'` (the spec's "latest year" convention). URL hydration
moved from `?schoolYear` / `?communityYear` to a single `?year=`.

### `src/contract/year.ts` — year format helpers
- `SLIDER_YEARS` — the 5 school-year stops the slider exposes (§6.5).
- `DEFAULT_YEAR` — `'2024-25'`.
- `toCommunityYear(schoolYear)` — maps `"YYYY1-YY2"` to the calendar year
  `String(YYYY1 + 1)` (spring half). e.g. `"2020-21" → "2021"`,
  `"2024-25" → "2025"`.
- `isSliderYear(s)` — narrowing predicate for URL hydration.

### Independent per-layer availability — `<Shell/>`
```ts
const schoolYear =
  schoolIndicator && schoolIndicator.years.includes(year) ? year : null;

const communityCalYear = toCommunityYear(year);
const communityYear =
  communityIndicator && communityCalYear && communityIndicator.years.includes(communityCalYear)
    ? communityCalYear
    : null;
```
Either being `null` triggers that layer's `<NoDataNotice/>` without affecting
the other. Verified end-to-end:

| Slider | School (`math_proficiency`) | Community (`child_poverty`) |
|---|---|---|
| `2022-23` | 1,098 features rendered | community year `2023` → 2,327 tracts rendered |
| `2020-21` | indicator covers it → renders | community year `2021` → **0 rows → 🗓️** |
| `2024-25` | renders | community year `2025` → **0 rows → 🗓️** |
| arts_ed at `2022-23` | gap year → **0 rows → 🗓️** | (community unaffected) |

### `<TimeSlider/>` — header control
Native `<input type="range">` for accessibility (keyboard ←/→, screen-reader
value-text), wrapped in tick labels and a discreet "Showing 2023-24" label.
Lives in `<HeaderBar/>` to the right of the four filters; "↺ Reset filters"
sits to its right.

### `<YearBadge/>` simplification
The Phase 1 per-indicator year-dropdown stand-in is gone. Each badge is now
a read-only "Points: 2024-25" / "Tracts: 2023" label. When a layer's
indicator has no data for the chosen year, the badge reads "no 2024-25 data"
in a muted alert color.

## How `year` flows
```
TimeSlider ──setYear──▶ store.year ──┬──▶ Shell: schoolYear  ──▶ /api/schools ─┐
                                      │                                         │
                                      │                                         ▶ MapView (points)
                                      │                                         │
                                      ├──▶ Shell: PWC year   ──▶ /api/pwc ───── ▶ feature flag merge
                                      │                                         │
                                      └──▶ Shell: communityYear ──▶ /api/community ▶ MapView (choropleth)

                                                                  also
                                                                  ─────
                                      store.year ──▶ universe (Phase 3 cascade)
                                                  ──▶ school list (Phase 5; reads same set)
                                                  ──▶ KPI cards (Phase 5; reads same year)
```
Every consumer pulls from one store value; nothing keeps a private copy.
Phase 5's KPI cards, ranked list, and timeline marker will read `year`
directly with no rework.

## Decisions applied

### Community reacts to the slider (your clarification)
Per the goal answer: the slider acts **as if** community indicators had
longitudinal data. Each slider position is mapped through `toCommunityYear`
and queried honestly; today only `2023` returns rows (mapped from school year
`2022-23`), so most positions trigger the community 🗓️. When ACS / CDC
historical years are fetched later, community will light up across the range
with no UI change.

### Q5 — public-indicator cap at 2024-25
Slider stops at `2024-25`. PWC program data reaches `2025-26` but Phase 4 has
no PWC-only visualization on the slider axis; the Phase 5 KPI cards will
expose 2025-26 separately if PWC confirms. Flagged.

### Q4 — graduation grain
**Already handled at Phase 0.** `scripts/etl/11-load-school-indicators.ts`
maps `cohort_year` → `school_year` (cohort 2012 → 2015-16, etc.) before
insert. The slider asks for `school_year` like any other indicator;
graduation simply returns its row for that mapped cohort. **Non-HS schools**
have no graduation rows so they don't render — no special case. Documented.

## Acceptance tests (§10 Phase 4)

| # | Test | Status |
|---|---|---|
| ✅ | Scrubbing updates map symbology, one-year aggregates, school list | Slider → `store.year` → Shell re-fetches school + PWC + community → MapView paints + filter re-applies. Phase 3 universe rebuilds automatically (it reads the same PWC member set). |
| ✅ | Timeline marker moves but lines stay; sparklines mark the year | No timeline chart in Phase 4 (Phase 5 builds it). `store.year` is exposed cleanly; the Phase 5 marker/sparkline read it with no rework. |
| ✅ | Indicators without the selected year show the missing-data state without breaking others | Each layer's `*NoData` flag is `true` if `*Year` is `null` OR the API returned 0 rows. The flag controls only that layer's render path — verified with arts_ed gap + community 🗓️. |

## Out of scope for Phase 4
- Right-panel KPI cards, 5-yr timeline chart, ranked list + sparklines,
  School District / NTA aggregation — all Phase 5.
- Multi-year community indicators — the slider already speaks the right
  language; backfill the data and the UI catches up automatically.
- 2025-26 in the slider — pending Q5 confirmation.
