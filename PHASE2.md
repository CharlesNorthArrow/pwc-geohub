# PWC Geohub — Phase 2 (PWC programmatic layer)

Phase 2 makes PWC schools identifiable, categorizable, and isolable on the
Phase 1 map. The category model lives in the data layer so Phase 3 (header
filters), Phase 5 (KPI cards + ranked list), and the future in-school-services
view reuse it without re-deriving categories per component.

## What's new

- **`getPwcMembership(year)`** (`src/server/contract.ts`) — returns
  `{dbn, category, cohort}` per PWC school for a given year, applying:
  - **Active** = at least one program field non-null (excludes the 2020-21 /
    2021-22 placeholder rows where every program column is null).
  - **Anchor** = `core_school = true` (Q1 default, confirmed).
  - **Healing Arts** = `arts_program = true` (Q1 default, confirmed).
  - **Both** = `core_school AND arts_program`. Dual halo on the map; appears
    in BOTH the Anchor and Healing Arts group filters (confirmed in goal).
  - **`pwc_other`** = active but neither Anchor nor Healing Arts (rare —
    community-school-only / food-pantry-only). Counted under "Only PWC".
- **`GET /api/pwc?year=YYYY-YY`** — thin route over the function above.
- **Zustand slice** `schoolType: 'all' | 'pwc' | 'anchor' | 'healing_arts'`.
  Same store as Phase 1; not forked.
- **MapView halos** — two concentric rings drawn beneath the Phase 1 data
  point, fixed pixel widths so they stay legible at every zoom:
  - inner ring (r + 3px): magenta if Anchor or Both, PWC blue if pwc_other,
    transparent otherwise
  - outer ring (r + 7px): orange if Healing Arts or Both, transparent otherwise
  - both schools → both rings visible = the agreed "dual cue"
- **`<SchoolTypeToggle/>`** — temporary left-panel control. Phase 3 wires the
  real header dropdown to the **same Zustand slice**, no rework.
- **`<InSchoolServicesStub/>`** — collapsed entry point in the left panel.
  Reserves §4.4's dedicated view; the actual view ships later.
- **PWC halo legend** — added below the enrollment-size legend so users can
  read the symbology.

## How the PWC year is chosen
The PWC layer ALWAYS uses the active **school indicator's** year (i.e. its
registry-defined latest year, or the `?schoolYear` URL override). When no
school indicator is active, no points and no halos render — the schoolType
toggle still works but has nothing visible to filter. Phase 4's time slider
will replace this resolution with a single shared `year`.

## Acceptance tests (spec §10 Phase 2)

| # | Test | How to verify |
|---|---|---|
| ✅ | PWC schools visually distinct from non-PWC at all zoom levels | Pick `math_proficiency` → PWC schools get magenta / orange rings around the data dot; non-PWC are bare. Halo widths are fixed in pixels so the cue stays legible from `z=10` to `z=16`. |
| ✅ | Anchor and Healing Arts distinguishable; both-category schools follow the agreed rule | Anchor = single inner magenta ring; Healing Arts = single outer orange ring; Both = both rings (e.g. `02M167` in 2024-25). The PWC halo legend in the left panel explains it. |
| ✅ | "Only PWC Anchor" leaves only Anchor schools on the map | Pick School Type → "Only Anchor". The map shows only schools with `core_school=true` (26 schools in 2024-25, including the 20 both-category schools). "Only Healing Arts" shows 36. "Only PWC" shows 42. |
| ✅ | 53 matched DBNs plot; 03M299 reported, not silently dropped | `pwc_school_program` holds 53 distinct DBNs (Phase 0 FK to `schools` excludes 03M299 by design). The data-quality report (`reports/data-quality.md`) lists 03M299 under "Known unmatched" with the closed-school annotation. No code path silently drops anything. |

## Data discovery: 2020-21 / 2021-22 are empty PWC years
Every row in those two years has all program columns null. By the
spec's rule ("all-null row = no active program that year"), these rows are
excluded from `getPwcMembership` — so when an indicator's active year falls
in that range, **no schools render as PWC** even though the indicator data
itself exists. PWC began tracking program-active status in 2022-23 per the
data on disk.

## Phase 2 deviations / left for later phases

- **No header bar yet** — School Type is a left-panel toggle; Phase 3 attaches
  the real dropdown to the same Zustand slice.
- **No cohort / geo / school filter** — Phase 3.
- **No time slider** — PWC year tracks the active school indicator's year via
  the same per-layer override flow used in Phase 1.
- **Categorical school indicators** — still none active; if one is added, the
  `colorExpression` branch on `value_text` is already wired (no rework).
- **In-school services view** — entry point only; the view ships later.
- **Cohort field** — exposed by `/api/pwc` but not consumed yet. Phase 3 will
  drive the Cohort filter from this.
