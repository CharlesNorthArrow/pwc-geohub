# PWC Geohub — Phase 0 setup

This is the developer setup for the **data foundation** only (no UI yet — see
`PWC_Geo_Hub_Technical_Spec.md` §10 Phase 0). The end state is: every
acceptance test in §10 passes and `reports/data-quality.md` is generated.

## 1. Install local dependencies

```pwsh
npm install
```

> If `npm install` fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (TLS cert
> error from a corporate / antivirus proxy), retry with:
>
> ```pwsh
> $env:NODE_OPTIONS = "--use-system-ca"; npm install
> ```

## 2. Provision Vercel-native infra (one-time)

The Hub is hosted Vercel-native (spec §11.9). For Phase 0 we need two
Marketplace integrations:

1. In the Vercel dashboard → create the project (link `pwc-geohub` repo) →
   **Storage** tab.
2. **Add Neon** (Postgres) — Vercel marketplace integration; pick the free
   "Launch" plan. Vercel will set `DATABASE_URL` for you.
3. **Add Blob** storage. Vercel will set `BLOB_READ_WRITE_TOKEN`.
4. Get a **US Census API key** (free, instant):
   <https://api.census.gov/data/key_signup.html>. Add it to the Vercel project
   as `CENSUS_API_KEY` (Environment = Production + Preview + Development).
5. _(Optional)_ Get a **CDC PLACES app token** to raise CDC rate limits at
   <https://data.cdc.gov/profile/app_tokens>. Add as `CDC_APP_TOKEN`.

## 3. Pull env vars locally

```pwsh
npm install -g vercel        # if you don't have it
vercel link                  # link the local checkout to the Vercel project
vercel env pull .env.local   # writes DATABASE_URL, BLOB_READ_WRITE_TOKEN, etc.
```

## 4. Run the ETL

```pwsh
# end-to-end (each step is also runnable individually):
npm run etl:all
```

This runs, in order:

| Step | Script | What it writes |
|---|---|---|
| `etl:init`        | `00-init-db.ts`              | Schema + PostGIS extension on Neon |
| `etl:schools`     | `10-load-schools-master.ts`  | `schools` (one row per DBN) + `schools_year` |
| `etl:indicators`  | `11-load-school-indicators.ts` | `school_indicator_values` (long contract) |
| `etl:pwc`         | `12-load-pwc-schools.ts`     | `pwc_school_program` panel |
| `etl:geos`        | `20-fetch-geographies.ts`    | `geographies` + Vercel Blob GeoJSON |
| `etl:crosswalks`  | `21-build-crosswalks.ts`     | `school_geo_crosswalk` (school_district + nta_2020) |
| `etl:acs`         | `30-fetch-acs.ts`            | `community_indicator_values` (6 ACS indicators) |
| `etl:cdc`         | `31-fetch-cdc-places.ts`     | `community_indicator_values` (2 CDC indicators) |
| `etl:report`      | `90-data-quality-report.ts`  | `reports/data-quality.{md,json}` |

## 5. Verify Phase 0 acceptance tests

Open `reports/data-quality.md`. Confirm:

- ✅ **Per-indicator year coverage** — `arts_ed_score` shows only `2020-21`
  and `2024-25`.
- ✅ **DBN remap** — `08X208 → 84X208` applied; row count > 0.
- ✅ **Known unmatched** — `03M299` listed as known closed (Maxine Greene).
- ✅ **Null-coordinate schools** — count present (~5% of master per spec).
- ✅ **Crosswalks** — `school_district` + `nta_2020` matched counts both
  approximately = plottable_schools.
- ✅ **Registry-only add** — `teacher_q119_disruptive_sel` row at the bottom
  of the report = PASS (this is the §10 Phase 0 "add by registry alone"
  acceptance test).

## 6. Useful one-offs

```pwsh
# Type-check the project (no emit).
npm run typecheck

# Re-run only the indicator ETL (e.g. after editing the registry).
npm run etl:indicators && npm run etl:report
```

## Open questions surfaced to PWC

- **Q1 — Anchor / Healing Arts definition.** Phase 0 uses the spec's proposed
  default (Anchor=`core_school=1`, Healing Arts=`arts_program=1`, overlap
  allowed). The data-quality report prints the overlap count under
  `anchor_healing_overlap` — confirm with PWC before Phase 2.
- **Q2 — Closed school 03M299.** Default = exclude from map; surface in DQ
  report. Implemented; revisit if PWC wants closed-school history.
- **Q3 — Safety categorical.** Default = use `safety_pct_positive` for the
  gradient; `safety_climate_rating` is preserved in `value_text` for tooltip
  use later. Implemented.
- **Q4 — Graduation cohort grain.** Default = map `cohort_year` → `school_year`
  for display (cohort 2012 → 2015-16, etc.). Implemented in
  `scripts/lib/year.ts`.
