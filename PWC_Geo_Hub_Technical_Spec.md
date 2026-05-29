# PWC Geospatial Intelligence Hub — Technical Specification

**Client:** Partnership with Children (PWC)
**Vendor:** North Arrow Maps LLC
**Doc owner:** Product (Charles)
**Status:** Draft v0.1 — for internal engineering review
**Last updated:** 2026-05-29

---

## 0. How to read this document

This is the single source of truth for *what* the Hub does and *in what order* we build it. It is written to be referenced during development and to seed the `CLAUDE.md` context file used for Claude Code–assisted work. Sections 1–9 define the product and its data contracts; Section 10 defines the phased build plan with acceptance tests; Section 11 captures the architecture decisions that keep us out of technical debt; Section 12 lists open questions that must be resolved with PWC before the phases they block.

Anything marked **🔴 OPEN** is a blocking decision. Anything marked **🟡 ASSUMPTION** is how we will proceed unless told otherwise.

---

## 1. Product overview

The Hub is an **internal, map-centered web application** that lets PWC's advocacy, development, and program teams see their programmatic footprint against the public conditions of the communities they serve, across time, filtered by the political and administrative geographies they report into.

It is distinct from the existing public-facing Story Map. The Story Map *broadcasts*; the Hub *informs internal strategy, fundraising, and advocacy*.

**Primary jobs-to-be-done**

1. *Advocacy / government relations* — filter the entire view to a legislative district and instantly see PWC schools and community need within it.
2. *Systems-change storytelling* — layer one community-need indicator (polygon) under one school outcome indicator (points) to show how external conditions shape student outcomes.
3. *Program strategy* — rank PWC schools on any indicator, see 5-year trends, and compare Anchor vs. Healing Arts vs. citywide.

**Users:** internal PWC staff (advocacy, development, program, data). Not public. (A separate public/focused version is a later, separately-scoped deliverable.)

---

## 2. Information architecture & layout

The interface is a single screen. The map is the center of gravity; panels frame it; the header sits *between* the panels, not above them.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [PWC logo → website]   ░░░ HEADER (filters + time slider) ░░░                   │  ← header spans only the
├───────────┬──────────────────────────────────────────────┬─────────────────────┤    space between L and R panels
│           │  Geo ▾ (popup)  │ School Type ▾ │ Cohort ▾ │ School ▾ │  ⏱ time ──── │
│  LEFT     ├──────────────────────────────────────────────┤   RIGHT PANEL        │
│  PANEL    │                                              │   (default open,     │
│  (~15%)   │                                              │    collapsible, ~35%)│
│           │                                              │                      │
│ Indicator │                MAP OF NYC                     │  ┌────┬────┬────┐    │
│ selector  │   • school points (size=enrollment,           │  │Anc │HArt│ All│ KPI│
│  (school  │     color=school indicator)                   │  │avg │avg │avg │    │
│   +       │   ▦ community polygons (choropleth =           │  └────┴────┴────┘    │
│   comm.)  │     community indicator)                       │  ▁▂▃▅ 5-yr timeline  │
│           │   ◉ PWC schools highlighted (halo)             │   (3 lines)          │
│ Legend    │                                              │  Ranked PWC school   │
│ (dynamic) │                                              │   list + sparklines  │
│           │                                              │   (worst→best)       │
└───────────┴──────────────────────────────────────────────┴─────────────────────┘
```

| Region | Default width | Collapsible | Contents |
|---|---|---|---|
| Left panel | ~15% | No (v1) | Indicator selector (one school + one community indicator), dynamic legend |
| Map | remainder | — | Base map of NYC + active layers |
| Right panel | ~35% | **Yes**, open by default | KPI cards, 5-yr timeline, ranked PWC school list |
| Header | spans map width only | — | Cascading filters + time slider |

---

## 3. Core data model

### 3.1 Two indicator families

| | **School indicators** | **Community indicators** |
|---|---|---|
| Geometry | **Point** (one per school) | **Polygon** (census tract / block; some at neighborhood) |
| Symbology | Circle: **size = total enrollment**, **color = indicator value** (gradient) | Choropleth: **color = indicator value** (gradient) |
| Key | `DBN` | Census `GEOID` (tract) / area id |
| Source type | **Hosted** (in project DB; pre-built longitudinal datasets) | **API** (ACS Census API + CDC PLACES API) |
| Update mechanism | **Manual** via Admin Panel (client uploads new year) | **Automatic** (query latest year on demand / scheduled cache) |
| Count | **12 indicators across 5 themes** | **9 indicators across 7 themes** (1 deferred — Crime) |

**Hard rule:** the map shows **at most one school indicator and at most one community indicator at a time** (readability). The left panel enforces this.

### 3.2 School indicator catalog (hosted, point layer)

All datasets are keyed on `DBN` + `school_year` and ship a pre-formatted `*_label` column for tooltips. **Year coverage differs per indicator** — this is real, not hypothetical, and drives the "latest available year" defaulting and the "Data not available" handling (§6.4).

| # | Theme | Indicator | Dataset file | Value field | Label field | Year coverage | Notes |
|---|---|---|---|---|---|---|---|
| 1 | 🎨 Educational Enrichment | Arts education access (# disciplines, 0–4) | `arts_ed.csv` | `arts_ed_score` | `arts_ed_score_label` (+`arts_ed_disciplines`) | **2021, 2024-25 only** | Discontinuous; gap years must show "not available" |
| 2 | 📊 Student Demographics & Equity | Suspension / disciplinary rate (per 100) | `suspensions.csv` | `suspension_rate` | `suspension_rate_label` | 2020-21 → 2024-25 | `R` redactions → null |
| 3 | 📊 Student Demographics & Equity | % students in temporary housing | `temp_housing.csv` | `temp_housing_rate` | `temp_housing_rate_label` | 2020-21 → 2024-25 | |
| 4 | 📚 Academic Outcomes | Math proficiency (gr 3–8, % L3+4) | `math.csv` | `math_pct_proficient` | `math_pct_proficient_label` | **2017-18** → 2024-25 | Deeper history than 5-yr window |
| 5 | 📚 Academic Outcomes | ELA proficiency (gr 3–8, % L3+4) | `ela.csv` | `ela_pct_proficient` | `ela_pct_proficient_label` | **2017-18** → 2024-25 | |
| 6 | 📚 Academic Outcomes | Chronic absenteeism rate | `chronic_absenteeism.csv` | `chronic_absent_rate` | `chronic_absent_rate_label` | 2018-19 → 2024-25 | |
| 7 | 📚 Academic Outcomes | 4-yr HS graduation rate | `graduation.csv` | `graduation_rate` | `graduation_rate_label` | by `cohort_year` | **HS only**; different temporal grain (cohort, not school year) |
| 8 | 🤝🏾 Strengthening Support Network | Safety & school climate rating | `school_quality.csv` | `safety_climate_rating` (categorical) + `safety_pct_positive` (numeric) | matching `*_label` | 2020-21 → 2024-25 | 🔴 rating is categorical → decide categorical color scale vs. use `safety_pct_positive` for gradient |
| 9 | 🤝🏾 Strengthening Support Network | Family satisfaction with education (q36) | `family_survey.csv` | `family_q36_pct_satisfied` | `family_q36_pct_satisfied_label` | 2020-21 → 2024-25 | |
| 10 | 🤝🏾 Strengthening Support Network | Teacher: access to behavioral supports (q120) | `teacher_survey.csv` | `teacher_q120_access_supports` | `teacher_q120_access_supports_label` | 2020-21 → 2024-25 | Same file as #11 below |
| 11 | 🧠 Health | Student: knows where to go for mental-health support (q20) | `student_survey.csv` | `student_q20_mental_health` | `student_q20_mental_health_label` | 2020-21 → 2024-25 | Same file as #12 |
| 12 | 🧠 Health | Student: felt happy at school (q22) | `student_survey.csv` | `student_q22_felt_happy` | `student_q22_felt_happy_label` | 2020-21 → 2024-25 | |

> A 13th candidate, **Teacher: recognizes disruptive behavior as SEL opportunity (q119)** (`teacher_survey.csv` → `teacher_q119_disruptive_sel`), is present in the data but marked "Maybe" in the wishlist. Treat as an easy add via the indicator registry if PWC selects it. This is the canonical demonstration of **one dataset → multiple indicators** (so is `student_survey.csv`).

**`schools_master.csv`** (9,373 rows, school × year, 2020-21 → 2024-25) is the **geocoding + enrollment + demographics master**. It supplies: `latitude`/`longitude` (point geometry), `total_enrollment` (circle size), `borough`, `school_name`, `grades`, and the "Existing" demographic indicators the wishlist also lists (race composition, `pct_english_language_learners`, `pct_poverty`/`economic_need_index`, `pct_students_with_disabilities`). These can be promoted to selectable school indicators with zero new ingestion.

### 3.3 Community indicator catalog (API, polygon layer)

| # | Theme | Indicator | Source | Endpoint / table | Geo grain |
|---|---|---|---|---|---|
| 1 | 🧠 Health | Adult mental-health distress | CDC PLACES | `data.cdc.gov/resource/cwsq-ngmh.json` measure `MHLTH` | Census tract |
| 2 | 💰 Economic Conditions | Child poverty rate (<18 below poverty) | ACS 5-yr | `api.census.gov/data/2024/acs/acs5` table `B17001` | Census tract |
| 3 | 💰 Economic Conditions | Adult unemployment in households w/ children | ACS 5-yr | `…/acs5/subject` table `S2301` | Census tract |
| 4 | 👨‍👦‍👦 Family Type | Single-parent household rate | ACS 5-yr | `…/acs5` table `B11003` | Census tract |
| 5 | 🏠 Housing & Stability | Housing insecurity (past 12 mo) | CDC PLACES | PLACES measure `HOUSING` | Census tract |
| 6 | 🏠 Housing & Stability | Overcrowded household units | ACS 5-yr | `…/acs5/profile` `DP04` field `DP04_0078PE` | Census tract |
| 7 | 🌍 Immigration & Language | Children in immigrant families | ACS 5-yr | `…/acs5` table `B05009` | Census tract |
| 8 | 🗺️ Demographics | Racial predominance | ACS 5-yr | `…/acs5` `B03002` → argmax(Black, White, Asian, Hispanic) | Census tract |
| 9 | 🚨 Safety | Crime / violent incidents near schools | NYPD Complaint Data | spatial join to school walk-buffer, keyed to DBN | site/point | **⏸ DEFERRED** — build registry slot + note; do not implement in initial build |

> **Crime is deferred** per direction. Reserve its registry entry and document the intended method (5-minute-walk buffer spatial join, count per DBN) so adding it later is config + one ETL job, not a refactor. Note it is **point/site-grained**, not polygon — it is the one community indicator that would not be a choropleth.
>
> Several additional ACS/CDC indicators appear in the wishlist as "Maybe/New" (e.g., asthma ED visits at UHF42, health insurance, LEP households, housing cost burden, eviction filings). These are **future registry adds**, not initial scope.

### 3.4 Geographies (boundary layers)

Fetched from ArcGIS Feature Services; cache as GeoJSON / vector tiles. The **ID/label field per layer is fixed** (use exactly these):

| Boundary | Service layer | Label field | Feature service (layer 0) |
|---|---|---|---|
| NYC NTAs (2020) | `NYC_Neighborhood_Tabulation_Areas_2020` | `NTAName` | services5.arcgis.com/GfwWNkhOj9bNBqoJ/…/NYC_Neighborhood_Tabulation_Areas_2020/FeatureServer/0 |
| NYC City Council Districts | `NYC_City_Council_Districts` | `CounDist` | services5…/NYC_City_Council_Districts/FeatureServer/0 |
| NYS Assembly Districts | `NYS_Assembly_Districts` | `District` | services6…/NYS_Assembly_Districts/FeatureServer/0 |
| NYS Senate Districts | `State_Legislative_Districts_Upper_Houses_v1` | `NAME` | services2…/State_Legislative_Districts_Upper_Houses_v1/FeatureServer/0 |
| NYC School Districts | `NYC_School_Districts` | `SchoolDist` | services5…/NYC_School_Districts/FeatureServer/0 |
| NYC Community Districts | `NYC_Community_Districts` | `BoroCD` | services5…/NYC_Community_Districts/FeatureServer/0 |
| US Congressional Districts (119th) | `USA_119th_Congressional_Districts` | `DISTRICTID` | services…/USA_119th_Congressional_Districts/FeatureServer/0 |
| NYC Neighborhood Development Areas | `Neighborhood_Development_Areas_20251117` | `NDA_ID` | services3…/Neighborhood_Development_Areas_20251117/FeatureServer/0 |

Notes / data-quality flags for Phase 0:
- **Counties (5 boroughs)** are a requested geo filter but are not in the reference table; derive from `borough` / county FIPS.
- The reference table has a **duplicate `#9`** (School Districts and Community Districts) — cosmetic, ignore.
- NTA and School District are also used by the **school↔community aggregation toggle** (§5.6), so they must load even when not the active geo filter.

### 3.5 PWC programmatic data model

Source: `pwc_schools.csv` — **longitudinal panel, one row per `DBN` × `school_year`**, 54 unique schools, years **2020-21 → 2025-26** (6 years — note this extends one year *beyond* the master/indicator data, which ends 2024-25). A row that is all-null for program fields = the school had **no active program that year** (not yet opened or already closed). Key program columns:

`core_school`, `social_work_program`, `community_school_program`, `community_school_program_status`, `arts_program`, `arts_program_type`, `ost_program`, `food_pantry`, `laundry`, `cohort`, `level`, `grade_served`, `school_type` (DOE/Charter/D75 — **governance type, not the dashboard "School Type" filter**), `year_partnership_began`, and the **in-school service metrics**: `sw_caseload_students`, `students_individual_contacts`, `number_individual_contacts`, `students_group_contacts`, `number_group_contacts`, `total_students_served_sw`, `total_contacts_sw`, `school_enrollment_pwc`.

**🔴 OPEN — Anchor vs Healing Arts definition.** The two dashboard categories are **not a single column** and **overlap**. In 2024-25: `core_school=1` for 27 schools, `arts_program=1` for 37, and **20 are both**. Proposed mapping (🟡 ASSUMPTION until confirmed):
- **Anchor** = `core_school = 1` (PWC's flagship social-work partnership), and
- **Healing Arts** = `arts_program = 1` (Center for Arts Education residency).
- A school can be **both** → decide render/aggregation tie-breaking (see §4.4, §5.3).

**Cohorts** (for the Cohort filter) come from `cohort`: currently **Brownsville, Morrisania, East Harlem, Fort Greene** (others null).

### 3.6 Join keys & known gaps (Phase-0 outputs)

- **Join key everywhere: `DBN`** (string; preserve leading zeros).
- 53 of 54 PWC `DBN`s match `schools_master` (after the `08X208` remap below). DBN-matching rules:
  - **`08X208` → remap to `84X208`** ("United Charter High School for the Humanities II"). Same borough + school number; the `08`→`84` difference is the **charter-district coding** convention in the master, not a typo. ETL must apply this crosswalk.
  - **`03M299` (Maxine Greene HS for Imaginative Inquiry) — UNMATCHED, address later.** Correct DBN (per InsideSchools), not a typo; it is a **closed school** (phased out ~2023; PWC data ends 2023-24) and does not exist in the 2020-21→2024-25 master. Surface in the data-quality report and exclude from the map until a decision is made on representing closed schools.
- `schools_master` has coordinates for **~94.8%** of rows — ~5% missing lat/long must be geocoded or flagged as unplottable.
- `pct_poverty` / `economic_need_index` contain string sentinels like **`"Above 95%"`**; surveys carry **`"Data not available"`** with null values. Define null/redaction handling once, centrally.

---

## 4. Map & symbology

### 4.1 Base map
Neutral/light base map of NYC (5 boroughs). Initial extent = NYC bounds.

### 4.2 School points (when a school indicator is active)
- One circle per school (from `schools_master` for the active year).
- **Size = `total_enrollment`** (binned scale; define 4–5 size bins + legend).
- **Color = active school indicator value** (sequential gradient; per-indicator ramp from registry).
- Categorical indicators (e.g., safety rating) use a categorical palette, not a gradient (§3.2 #8).

### 4.3 Community polygons (when a community indicator is active)
- Choropleth of the indicator's native geography (mostly census tract).
- **Color = value** (sequential or diverging per registry).
- Renders **beneath** school points.

### 4.4 PWC school highlighting
- PWC schools are visually distinguished among all city schools via a **halo** around the base circle symbol (proposed; keep size=enrollment / color=indicator intact underneath).
- Distinguish **Anchor vs Healing Arts** with a secondary cue (e.g., halo color or ring style). 🔴 define the both-category treatment.
- A **"PWC schools only" toggle** filters the point layer to PWC schools (this is the `School Type` filter, §6.2 — single source of truth, not a separate control).
- **In-school services** (the `*_sw` / contacts metrics) render in a **dedicated view**, not on the main choropleth (scope detail in a later phase; reserve the data + entry point now).

---

## 5. Right panel — analytics (indicator-focused)

Everything here is driven by the **active school indicator**, the **active year**, and the **active filters**.

### 5.1 KPI cards (top)
Three cards showing the **latest-year average** of the active indicator for:
1. **Anchor PWC schools** — with a **delta vs. All-schools average**.
2. **Healing Arts PWC schools** — with a **delta vs. All-schools average**.
3. **All schools average** (citywide, post-filter — see §5.5).

### 5.2 5-year timeline chart
Line chart, last 5 years of the active indicator, **three series**: Anchor avg, Healing Arts avg, All-schools avg. A vertical marker shows the year currently selected on the time slider (§6.5).

### 5.3 Ranked PWC school list
- All PWC schools (subject to filters), each with a **category symbol** (Anchor / Healing Arts), **ranked worst→best** on the active indicator.
- Each row: latest-year value + **sparkline** of its trend.
- **Click a row → zoom/pan map to that school.**
- 🔴 ranking for "both"-category schools and for direction-of-good (higher-is-better vs. lower-is-better, e.g., absenteeism) must be set per indicator in the registry (`good_direction`).

### 5.4 School ↔ community relationship (aggregation)
To relate PWC schools to **community** indicators, aggregate community values to each school's surrounding area:
- For each school, take the **average of community-indicator values across the polygons that are fully contained in *or* overlap** the area the school sits in.
- A **toggle** chooses the area definition: **School District** *or* **NTA**.
- This aggregation feeds the KPI cards / list when a **community** indicator is the focus.

### 5.5 Filter interaction with averages
"All-schools average" respects active **Geo** and **School Type** filters (it is the average of what's currently in view), **except** the citywide reference line — see §6 for exactly which filters touch which aggregates.

---

## 6. Header — filters, hierarchy & time

Filters sit in the header **between** the panels. **Order = hierarchy**: an upper filter pre-filters the options available to lower filters. When a lower filter's options have been narrowed by an upper filter, show a discreet **"pre-filtered by …" note**. Every filter has **reset** and **search**.

### 6.1 Geo filters — *multi-pick, own popup dialog*
The only filter with a dedicated popup (because of its breadth). Multi-select across: **Counties, State Senate Districts, State Assembly Districts, City Council Districts, NYC School Districts, Community Districts** (services per §3.4). Selecting geographies filters the **map**, the **school list**, and the geo-dependent aggregates.

### 6.2 School Type — *single select, default "All"*
Options: **All NYC Schools / Only PWC Schools / Only PWC Anchor / Only PWC Healing Arts**. Filters the **map** and the **school list**. (This *is* the "PWC-only toggle" from §4.4.)

### 6.3 Cohort Type — *single select*
PWC geographic cohorts (Brownsville, Morrisania, East Harlem, Fort Greene, …). Filters the **map, the aggregated KPIs, the timeline lines (except the citywide All-schools reference line), and the school list**.

### 6.4 School filter — *single select, all NYC schools*
Selecting a school **zooms to it** and opens the **School Details View** (separately specced phase). Has reset + search.

### 6.5 Time slider
- Dashboard **defaults to the latest available year** for each indicator. Because latest year can differ per indicator (§3.2), **always display, discreetly, which year is currently shown.**
- Slider scrubs back through **5 years** of longitudinal data (extensible later).
- Scrubbing updates: **map**, **one-year KPI aggregates**, **school list**, and **moves the marker line** on the timeline + sparklines.
- When **no data exists for the selected year** for the active indicator: show a **🗓️ calendar marker** + the message **"Data not available for the selected year."**

### 6.6 Filter → component update matrix

| Control | Map | Legend | KPI cards | Timeline lines | School list | Notes |
|---|---|---|---|---|---|---|
| Indicator selector | ✅ | ✅ | ✅ | ✅ | ✅ | One school + one community max |
| Geo filter | ✅ | — | ✅ | — | ✅ | Pre-filters School filter options |
| School Type | ✅ | — | (scopes "all") | — | ✅ | |
| Cohort Type | ✅ | — | ✅ | ✅ (except citywide line) | ✅ | |
| School filter | ✅ zoom | — | — | — | highlight | Opens School Details View |
| Time slider | ✅ | year label | ✅ | marker only | ✅ | Missing year → 🗓️ notice |

---

## 7. Public-data download
Provide a way for staff to **download the public data** behind the current view (school and community indicators). Define scope (current indicator/year vs. full dataset) in Phase 6. Respect that community data originates from public APIs (attribution + source year in the export).

---

## 8. Branding

Logo top-left, **linked to https://partnershipwithchildren.org/**. Apply PWC palette throughout. Colors below are **sampled from the logo + site** (site `theme-color` is authoritative for the blue) — **🟡 confirm exact hex against PWC's brand guide before Phase 6 polish.**

| Token | Hex (sampled) | Use |
|---|---|---|
| PWC Blue (primary) | `#027BC0` | Primary UI, wordmark, links |
| Orange | `#F0901F` | Accent, logo star, callouts |
| Lime / chartreuse | `#A0B000` | Secondary accent |
| Magenta / purple | `#903090` | Secondary accent |
| Teal | `#00A0B0` | Secondary accent |
| Navy (text) | `#002040` | Headings / body on light |

Map color ramps are **separate** from brand accents (choose perceptually-uniform sequential/diverging ramps for data legibility; brand colors are for chrome, not choropleths).

---

## 9. Non-functional requirements

- **Performance:** smooth pan/zoom with ~1,900 school points and tract-level choropleth; use vector tiles or clustering as needed. Community API responses must be **cached server-side** (never call ACS/CDC on every interaction).
- **Browsers:** evergreen Chrome/Edge/Safari/Firefox, desktop-first (internal tool).
- **Accessibility:** colorblind-safe ramps; keyboard navigation of filters; legend always reflects active encoding.
- **Data freshness:** community = latest available API year (auto); school = whatever the Admin Panel last published (manual).
- **Privacy:** the Hub shows **school- and area-aggregated public data plus PWC program aggregates** — no student-level PII. PWC program service counts are school-level aggregates; confirm no small-cell re-identification risk before any public derivative.

---

## 10. Phased build plan

Dependency-ordered. Each phase has a **goal**, **scope**, and **acceptance tests** (objectively checkable). Do not start a phase whose 🔴 open questions are unresolved.

### Phase 0 — Data foundation & ETL contracts *(no UI)*
**Goal:** a clean, validated, metadata-driven data layer that every later phase reads through one contract.
**Scope:**
- Define the **Indicator Registry** (§11.2): one config object per indicator (id, family, theme, source, file/endpoint, value field, label field, format, color ramp, `good_direction`, year coverage, geography).
- Ingest the 11 school indicator CSVs + `schools_master`; normalize to long format `{dbn, year, indicator_id, value, label}`; resolve redaction sentinels to null centrally.
- Build school→**School District** and school→**NTA** crosswalks (point-in-polygon) for the aggregation toggle.
- Build ACS + CDC PLACES API clients with server-side cache; materialize the 8 active community indicators at tract level.
- Fetch + cache all 8 geography layers as GeoJSON/vector tiles.
- Produce a **data-quality report**: DBN join coverage, the 2 unmatched PWC DBNs, missing-coordinate schools, per-indicator year-coverage matrix.

**Acceptance tests:**
- ✅ Every selected school indicator returns a value for a known DBN+year via the contract.
- ✅ Every active community indicator returns tract values via cached API.
- ✅ All 8 geographies load and validate as GeoJSON.
- ✅ Year-coverage matrix generated; `arts_ed` correctly shows only 2021 & 2024-25.
- ✅ Data-quality report applies the `08X208`→`84X208` remap and flags `03M299` (Maxine Greene, closed) as the one remaining unmatched DBN; counts null-coordinate schools.
- ✅ Adding a *new* indicator requires only a registry entry + ingestion mapping (proven by adding q119 as a test).

### Phase 1 — Map core + single-indicator rendering
**Goal:** see one indicator at a time on a working NYC map with a dynamic legend and correct year defaulting.
**Scope:** base map; render active **school** indicator as points (size=enrollment, color=value) OR active **community** indicator as choropleth; left-panel indicator selector enforcing one-of-each; dynamic legend; latest-year default with per-indicator year label; "Data not available" state.
**Acceptance tests:**
- ✅ Selecting any school indicator renders correctly-sized, correctly-colored circles for the latest available year; legend matches.
- ✅ Selecting any community indicator renders a tract choropleth; legend matches.
- ✅ At most one school + one community indicator can be active.
- ✅ Year label reflects the indicator's own latest year (e.g., arts_ed → 2024-25).
- ✅ Switching to a year with no data shows the 🗓️ "Data not available" notice.

### Phase 2 — PWC programmatic layer
**Goal:** PWC schools are identifiable, categorizable, and isolable on the map.
**Scope:** halo symbology for PWC schools; Anchor vs Healing Arts visual distinction; integrate "PWC-only / Anchor / Healing Arts" as the School Type control's effect on the layer; reserve the in-school-services view entry point.
**Acceptance tests:**
- ✅ PWC schools are visually distinct from non-PWC schools at all zooms.
- ✅ Anchor and Healing Arts are distinguishable; both-category schools follow the agreed rule.
- ✅ School Type = "Only PWC Anchor" leaves only Anchor schools on the map and list.
- ✅ The 53 matched PWC DBNs plot (incl. `84X208`); the 1 unmatched (`03M299`, closed) is reported, not silently dropped.

### Phase 3 — Header filters + cascade
**Goal:** the whole interface filters consistently with a working hierarchy.
**Scope:** Geo filter popup (multi-pick, all 6 geographies + counties); School Type dropdown; Cohort dropdown; School search; cascade with "pre-filtered by…" notices; reset + search on each.
**Acceptance tests:**
- ✅ Each control updates exactly the components in the §6.6 matrix.
- ✅ Selecting a Council District narrows the School filter's options and shows the pre-filter note.
- ✅ Geo selections filter map + list to features within the selected geographies.
- ✅ Reset returns each filter to default; search finds items within each.

### Phase 4 — Time slider + longitudinal wiring
**Goal:** time scrubbing drives every time-aware component coherently.
**Scope:** 5-year slider; updates map, one-year KPIs, list, and timeline marker; respects per-indicator availability.
**Acceptance tests:**
- ✅ Scrubbing updates map symbology, KPI values, and list values for the selected year.
- ✅ Timeline marker moves but lines stay; sparklines mark the year.
- ✅ Indicators without the selected year show the missing-data state without breaking others.

### Phase 5 — Right-panel analytics + community aggregation
**Goal:** the analytic story (groups, trends, ranking, school↔community) is complete and correct.
**Scope:** 3 KPI cards with deltas; 5-yr 3-line timeline; ranked PWC list with category symbol + sparkline + click-to-zoom; School District/NTA aggregation toggle for community indicators.
**Acceptance tests:**
- ✅ Anchor/Healing Arts/All averages match independent hand calculations for a sample indicator+year.
- ✅ Deltas vs. All-schools average are correct in sign and magnitude.
- ✅ List ranks worst→best honoring each indicator's `good_direction`.
- ✅ Clicking a list row zooms the map to that school.
- ✅ Toggling District↔NTA recomputes community aggregates correctly for a sample school.

### Phase 6 — Public-data download, branding & performance polish
**Goal:** shippable internal tool.
**Scope:** public-data export; brand pass against confirmed hex; logo link; performance (vector tiles/clustering, cache tuning); accessibility pass.
**Acceptance tests:**
- ✅ Export produces the active public data with source + year attribution.
- ✅ Brand colors/logo match the confirmed guide; logo links to PWC site.
- ✅ Pan/zoom stays smooth with full point + tract load; no uncached API calls on interaction.

### Later (separately specced)
- **School Details View** (click school / select / list-click).
- **Scorecard** (school + community indicators benchmarked vs. the two PWC groups).
- **Admin Panel** (client uploads new program data + new public indicator years).
- **Crime/NYPD** indicator (deferred); community-level longitudinal; additional "Maybe" wishlist indicators.

---

## 11. Architecture & technical-debt principles

These are the decisions that keep the build clean from the start. They are deliberately made *before* UI work.

### 11.1 Data contract first
No component reads a CSV or an API directly. Everything reads `{dbn|geoid, year, indicator_id, value, label}` (school) or `{area_id, year, indicator_id, value, label}` (community) through one access layer. Source quirks (cohort-grained graduation, redaction sentinels, "Above 95%") are normalized **once** at ingestion, never in the UI.

### 11.2 Metadata-driven indicator registry *(the key anti-debt move)*
Because (a) one dataset can back multiple indicators, (b) year coverage varies, (c) some indicators are categorical, and (d) the Admin Panel will add indicators later, **indicators are config, not code**. A registry entry fully describes an indicator:

```jsonc
{
  "id": "math_proficiency",
  "family": "school",              // "school" | "community"
  "theme": "Academic Outcomes",
  "label": "Math proficiency (gr 3–8, % L3+4)",
  "source": { "type": "hosted", "dataset": "math.csv",
              "value_field": "math_pct_proficient",
              "label_field": "math_pct_proficient_label" },
  "format": "percent",
  "scale": { "type": "sequential", "good_direction": "high" },
  "geometry": "point",
  "years": ["2017-18", "…", "2024-25"]
}
```
Adding/removing an indicator = a registry edit. This is what makes the Admin Panel feasible without a rewrite.

### 11.3 Single source of truth for app state
The cross-filtering is heavy (one control updates several components per §6.6). Use one central state store (e.g., Zustand/Redux/observable store): `{ activeSchoolIndicator, activeCommunityIndicator, year, geoFilters, schoolType, cohort, selectedSchool, aggregationArea }`. Components subscribe; nothing holds private copies. The §6.6 matrix is the spec for this store's derived selectors.

### 11.4 School vs community as parallel, not special-cased
Two families share the contract and the registry; the map renders "active point indicator" + "active polygon indicator" generically. Avoid per-indicator branching in components.

### 11.5 API isolation + caching
ACS and CDC clients live behind a server-side cache keyed by `{indicator, geography, year}`. The UI never waits on a live federal API during interaction. "Latest year" resolution is a cache concern, not a UI concern.

### 11.6 Geographies as a cached tile/GeoJSON service
Fetch ArcGIS feature services once into our own cache; the app reads our cache, not Esri at runtime — both for performance and to survive upstream service changes.

### 11.7 Suggested stack (proposal, confirm with eng)
React + TypeScript; MapLibre GL JS (or deck.gl for large point layers) consuming GeoJSON/vector tiles; the Esri layers fetched via their query endpoints into our tiles; charts via a lightweight lib (e.g., Recharts/visx); state via Zustand. Backend: a thin API + cache (Postgres/PostGIS for school data + crosswalks; scheduled jobs to refresh ACS/CDC/geographies).

### 11.8 External services & API keys

Minimal external dependencies; most are free/public.

| Service | Used for | Key needed? | Notes |
|---|---|---|---|
| **US Census ACS API** | 6 community indicators (ACS 5-yr) | **Free key, recommended** | Instant signup at api.census.gov/data/key_signup.html. Works keyless at low volume but rate-limited; store key server-side only. |
| **CDC PLACES** (Socrata) | Mental-health distress, housing insecurity | **No** (optional app token) | Public dataset; a free Socrata app token only raises rate limits. |
| **ArcGIS feature services** | 8 geography layers | **No** | Public, read-only; fetched once into our cache (§11.6). |
| **Salesforce** | — | **Not in scope** | PWC program data arrived as `pwc_schools.csv`; no live integration unless auto-sync is added later. |

All keys live **server-side** (env vars / secrets manager), never in the client bundle.

### 11.9 Hosting recommendation (Vercel-native)

The Hub is an **internal, read-heavy** tool with a small user base (PWC staff); it needs no heavy infrastructure. Host the whole thing **on Vercel** (PWC/North Arrow already use it), with one database integration. Four pieces, one vendor:

1. **App + API → Vercel.** Frontend plus the thin API as **serverless/edge functions** (request → query DB → return JSON). No always-on backend needed.
2. **Postgres + PostGIS → Neon (via Vercel Marketplace).** Standalone "Vercel Postgres" was folded into **Neon** in late 2024; provision it from Vercel's Storage tab, **billed through Vercel**. **Neon supports the PostGIS extension** (`CREATE EXTENSION postgis;`) for the school→district/NTA crosswalks and point-in-polygon work. Free tier (10 GB) is ample for this dataset.
3. **Object storage / CDN → Vercel Blob.** Serve cached **geography tiles / GeoJSON** and materialized community-indicator JSON from Blob, off the function path.
4. **Scheduled refresh → Vercel Cron Jobs.** A cron-triggered function refreshes the ACS / CDC / geography caches (annual/seasonal). Runs rarely; negligible cost.

**Serverless-fit rules (important):** functions are short-lived and size-limited, so —
- Do **all heavy spatial work once** (crosswalks, community aggregation) in **Neon/ETL/cron** and **store the results**; never compute point-in-polygon per request in a function.
- Serve **large tiles/GeoJSON from Blob/CDN**, not through functions (mind execution-time and payload limits).
- Keep API functions thin: parameterized reads against precomputed tables.

These rules are exactly why Phase 0 builds the crosswalks and caches up front (§10, §11.1).

**Setup checklist:** Vercel project (connect the GitHub repo `github.com/CharlesNorthArrow/pwc-geohub`) → add the **Neon** integration + enable PostGIS → create a **Blob** store → add **Cron Jobs** for refresh → set the **Census API key** as a server-side env var. No second vendor, no Kubernetes, no always-on GIS server.

---

## 12. Open questions (resolve before the blocking phase)

| # | Question | Blocks | Proposed default |
|---|---|---|---|
| Q1 | Exact definition of **Anchor** vs **Healing Arts**, and treatment of schools that are **both** (render + ranking + which KPI group). | Phase 2, 5 | Anchor=`core_school=1`, Healing Arts=`arts_program=1`; both counts in both groups; confirm. |
| Q2 | `03M299` (Maxine Greene, **closed ~2023**) is unmatched — represent closed schools, or exclude? (`08X208`→`84X208` already resolved as charter coding.) | Phase 0/2 | Exclude from map; surface in data-quality report; revisit if closed-school history is wanted. |
| Q3 | Safety & school climate is **categorical** (`safety_climate_rating`) — choropleth by category, or use numeric `safety_pct_positive` for the gradient? | Phase 1 | Use `safety_pct_positive` for gradient; show rating in tooltip. |
| Q4 | Graduation is **cohort-grained and HS-only** — how does it behave on the time slider and for non-HS schools? | Phase 1/4 | Map cohort→school_year for display; non-HS schools show "n/a". |
| Q5 | PWC data runs to **2025-26** but master/indicators end **2024-25** — does the slider expose 2025-26 (program data only)? | Phase 4 | Cap slider at 2024-25 for public indicators; show program-only data with a note if 2025-26 enabled. |
| Q6 | "All-schools average" denominator — **all NYC schools** or **all currently-in-view** schools? Confirm per the matrix. | Phase 5 | All in-view (post Geo + School Type), citywide line excepted. |
| Q7 | Confirm **exact brand hex** + supply logo asset variants. | Phase 6 | Use sampled palette + provided PNG until confirmed. |
| Q8 | Public-data **download scope** (current view vs. full dataset) + attribution requirements. | Phase 6 | Current active indicator+year, with source/year footer. |

---

*End of specification v0.1.*
