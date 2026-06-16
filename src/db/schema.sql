-- PWC Geohub — Phase 0 schema (Neon Postgres + PostGIS).
-- Canonical source of truth; scripts/etl/00-init-db.ts applies this file.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- schools: identity + point geometry (one row per DBN)
-- =============================================================================
CREATE TABLE IF NOT EXISTS schools (
  dbn               TEXT PRIMARY KEY,
  school_name       TEXT,
  borough           TEXT,
  address           TEXT,
  managed_by        TEXT,
  location_category TEXT,
  location_type     TEXT,
  grades            TEXT,
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  geom              GEOMETRY(Point, 4326),
  is_unplottable    BOOLEAN GENERATED ALWAYS AS
                      (latitude IS NULL OR longitude IS NULL) STORED,
  -- Identity row is sourced from the latest-year schools_master record.
  identity_source_year TEXT,
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schools_geom_gix ON schools USING GIST (geom);

-- =============================================================================
-- schools_year: enrollment + demographics per (DBN, school_year)
-- =============================================================================
CREATE TABLE IF NOT EXISTS schools_year (
  dbn                              TEXT NOT NULL REFERENCES schools(dbn) ON DELETE CASCADE,
  school_year                      TEXT NOT NULL,
  total_enrollment                 INTEGER,
  n_students_with_disabilities     INTEGER,
  pct_students_with_disabilities   DOUBLE PRECISION,
  n_english_language_learners      INTEGER,
  pct_english_language_learners    DOUBLE PRECISION,
  n_poverty                        INTEGER,
  pct_poverty                      DOUBLE PRECISION,
  economic_need_index              DOUBLE PRECISION,
  n_asian                          INTEGER,
  pct_asian                        DOUBLE PRECISION,
  n_black                          INTEGER,
  pct_black                        DOUBLE PRECISION,
  n_hispanic                       INTEGER,
  pct_hispanic                     DOUBLE PRECISION,
  n_white                          INTEGER,
  pct_white                        DOUBLE PRECISION,
  n_multi_racial                   INTEGER,
  pct_multi_racial                 DOUBLE PRECISION,
  n_female                         INTEGER,
  pct_female                       DOUBLE PRECISION,
  n_male                           INTEGER,
  pct_male                         DOUBLE PRECISION,
  PRIMARY KEY (dbn, school_year)
);

-- =============================================================================
-- school_indicator_values: the long-format contract from spec §11.1
-- =============================================================================
CREATE TABLE IF NOT EXISTS school_indicator_values (
  dbn          TEXT NOT NULL REFERENCES schools(dbn) ON DELETE CASCADE,
  school_year  TEXT NOT NULL,
  indicator_id TEXT NOT NULL,
  value_num    DOUBLE PRECISION,
  value_text   TEXT,
  label        TEXT,
  -- Raw source year (preserved for graduation: cohort_year stays here even
  -- after we map to school_year above).
  source_year  TEXT,
  PRIMARY KEY (dbn, school_year, indicator_id)
);
CREATE INDEX IF NOT EXISTS siv_indicator_year_idx
  ON school_indicator_values (indicator_id, school_year);
CREATE INDEX IF NOT EXISTS siv_dbn_idx
  ON school_indicator_values (dbn);

-- =============================================================================
-- pwc_school_program: PWC program panel (one row per PWC school × year)
-- =============================================================================
CREATE TABLE IF NOT EXISTS pwc_school_program (
  dbn                              TEXT NOT NULL REFERENCES schools(dbn) ON DELETE CASCADE,
  school_year                      TEXT NOT NULL,
  -- Anchor (Q1 default = core_school=1)
  core_school                      BOOLEAN,
  -- Healing Arts (Q1 default = arts_program=1)
  arts_program                     BOOLEAN,
  social_work_program              BOOLEAN,
  community_school_program         BOOLEAN,
  community_school_program_status  TEXT,
  arts_program_type                TEXT,
  ost_program                      BOOLEAN,
  ost_program_type                 TEXT,
  food_pantry                      BOOLEAN,
  laundry                          BOOLEAN,
  cohort                           TEXT,
  level                            TEXT,
  grade_served                     TEXT,
  -- Renamed from `school_type` so it never collides with the dashboard
  -- "School Type" filter (which is All / PWC / Anchor / Healing Arts).
  governance_school_type           TEXT,
  year_partnership_began           INTEGER,
  sw_caseload_students             INTEGER,
  students_individual_contacts     INTEGER,
  number_individual_contacts       INTEGER,
  students_group_contacts          INTEGER,
  number_group_contacts            INTEGER,
  total_students_served_sw         INTEGER,
  total_contacts_sw                INTEGER,
  school_enrollment_pwc            INTEGER,
  PRIMARY KEY (dbn, school_year)
);

-- =============================================================================
-- geographies: cached ArcGIS boundary layers
-- =============================================================================
CREATE TABLE IF NOT EXISTS geographies (
  geo_layer  TEXT NOT NULL,
  area_id    TEXT NOT NULL,
  label      TEXT,
  attributes JSONB,
  geom       GEOMETRY(MultiPolygon, 4326),
  fetched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (geo_layer, area_id)
);
CREATE INDEX IF NOT EXISTS geographies_geom_gix ON geographies USING GIST (geom);
CREATE INDEX IF NOT EXISTS geographies_layer_idx ON geographies (geo_layer);

-- =============================================================================
-- school_geo_crosswalk: precomputed point-in-polygon assignments
-- =============================================================================
CREATE TABLE IF NOT EXISTS school_geo_crosswalk (
  dbn       TEXT NOT NULL REFERENCES schools(dbn) ON DELETE CASCADE,
  geo_layer TEXT NOT NULL,
  area_id   TEXT NOT NULL,
  PRIMARY KEY (dbn, geo_layer)
);
CREATE INDEX IF NOT EXISTS sgc_layer_area_idx
  ON school_geo_crosswalk (geo_layer, area_id);

-- =============================================================================
-- area_tract_crosswalk: which tracts fall within / overlap each NYC school
-- district or NTA. Powers the §5.4 District ↔ NTA community aggregation —
-- precomputed once so per-request reads are simple GROUP BY queries.
-- =============================================================================
CREATE TABLE IF NOT EXISTS area_tract_crosswalk (
  area_layer  TEXT NOT NULL,   -- 'school_district' | 'nta_2020'
  area_id     TEXT NOT NULL,
  tract_geoid TEXT NOT NULL,
  PRIMARY KEY (area_layer, area_id, tract_geoid)
);
CREATE INDEX IF NOT EXISTS atc_area_idx ON area_tract_crosswalk (area_layer, area_id);
CREATE INDEX IF NOT EXISTS atc_tract_idx ON area_tract_crosswalk (tract_geoid);

-- =============================================================================
-- community_indicator_values: ACS + CDC PLACES at tract (and future) grain
-- =============================================================================
CREATE TABLE IF NOT EXISTS community_indicator_values (
  area_id      TEXT NOT NULL,
  geo_layer    TEXT NOT NULL,
  year         TEXT NOT NULL,
  indicator_id TEXT NOT NULL,
  value_num    DOUBLE PRECISION,
  value_text   TEXT,
  label        TEXT,
  source_year  TEXT,
  fetched_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (area_id, geo_layer, indicator_id, year)
);
CREATE INDEX IF NOT EXISTS civ_indicator_year_idx
  ON community_indicator_values (indicator_id, year, geo_layer);

-- =============================================================================
-- api_cache: raw payloads keyed for replay/debug
-- =============================================================================
CREATE TABLE IF NOT EXISTS api_cache (
  cache_key  TEXT PRIMARY KEY,
  payload    JSONB NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================================================
-- data_quality_findings: queryable + dumpable to reports/
-- =============================================================================
CREATE TABLE IF NOT EXISTS data_quality_findings (
  run_id   TEXT NOT NULL,
  category TEXT NOT NULL,
  subject  TEXT NOT NULL,
  details  JSONB,
  PRIMARY KEY (run_id, category, subject)
);
CREATE INDEX IF NOT EXISTS dqf_category_idx ON data_quality_findings (category);

-- =============================================================================
-- Admin Panel — versioned, append-only history of pwc_school_program uploads.
-- The live read view (`pwc_school_program`) is untouched by the dashboard.
-- Admin "apply" wraps the swap in a single tx so readers either see the old
-- or the new version, never a partial state. "Rollback" writes a NEW version
-- whose payload set equals an older version's — history stays append-only.
-- =============================================================================
CREATE TABLE IF NOT EXISTS pwc_program_versions (
  version_id  SERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT NOT NULL,           -- 'admin' until real users exist
  source      TEXT NOT NULL,           -- 'upload:<filename>' | 'rollback:v<id>' | 'seed'
  notes       TEXT,
  row_count   INTEGER NOT NULL,
  csv_url     TEXT                     -- Vercel Blob immutable snapshot
);

CREATE TABLE IF NOT EXISTS pwc_program_version_rows (
  version_id  INTEGER NOT NULL REFERENCES pwc_program_versions(version_id) ON DELETE CASCADE,
  dbn         TEXT NOT NULL,
  school_year TEXT NOT NULL,
  payload     JSONB NOT NULL,          -- full row's data columns, schema-shaped
  PRIMARY KEY (version_id, dbn, school_year)
);
CREATE INDEX IF NOT EXISTS pwc_pvr_version_idx ON pwc_program_version_rows (version_id);

-- Singleton pointer at the currently-active version. CHECK(pin=1) keeps it
-- to one row so concurrent inserts can't fork the "current" identity.
CREATE TABLE IF NOT EXISTS pwc_program_current (
  pin        INTEGER PRIMARY KEY DEFAULT 1 CHECK (pin = 1),
  version_id INTEGER NOT NULL REFERENCES pwc_program_versions(version_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- Community Indicators — per-provider versioning + availability status.
-- Provider ∈ {'acs', 'cdc_places'}. The live read view stays
-- `community_indicator_values`; admin "apply" swaps a provider's slice in
-- one Postgres tx. Rollback writes a NEW version row whose payload set
-- equals an older version's, mirroring the pwc pattern.
-- =============================================================================
CREATE TABLE IF NOT EXISTS community_provider_versions (
  version_id  SERIAL PRIMARY KEY,
  provider    TEXT NOT NULL,            -- 'acs' | 'cdc_places'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT NOT NULL,
  source      TEXT NOT NULL,            -- 'sync:acs:2025' | 'rollback:v42' | 'seed'
  notes       TEXT,
  row_count   INTEGER NOT NULL,
  -- Quick "what's in here" index, without scanning version_rows:
  --   {"<indicator_id>": ["2020", "2021", ...]}
  vintages    JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS cpv_provider_idx ON community_provider_versions (provider, version_id DESC);

CREATE TABLE IF NOT EXISTS community_provider_version_rows (
  version_id   INTEGER NOT NULL REFERENCES community_provider_versions(version_id) ON DELETE CASCADE,
  area_id      TEXT NOT NULL,
  geo_layer    TEXT NOT NULL,
  indicator_id TEXT NOT NULL,
  year         TEXT NOT NULL,
  payload      JSONB NOT NULL,          -- {value_num, value_text, label, source_year}
  PRIMARY KEY (version_id, area_id, geo_layer, indicator_id, year)
);
CREATE INDEX IF NOT EXISTS cpvr_version_idx ON community_provider_version_rows (version_id);

-- One row per provider. Forks are prevented by the PK.
CREATE TABLE IF NOT EXISTS community_provider_current (
  provider    TEXT PRIMARY KEY,
  version_id  INTEGER NOT NULL REFERENCES community_provider_versions(version_id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Availability status — read by the badge, written by the monthly cron and
-- the "Check now" button. NEVER written by the sync apply path (sync
-- updates `loaded_vintage` + `update_available` via its own apply tx so
-- the status row stays consistent with the live data).
CREATE TABLE IF NOT EXISTS community_provider_status (
  provider               TEXT PRIMARY KEY,        -- 'acs' | 'cdc_places'
  loaded_vintage         TEXT,
  cdc_loaded_updated_at  TEXT,                    -- CDC only — Socrata rowsUpdatedAt at last sync
  latest_vintage         TEXT,                    -- what the check found upstream
  cdc_latest_updated_at  TEXT,                    -- CDC only — Socrata rowsUpdatedAt at last check
  last_checked_at        TIMESTAMPTZ,
  last_check_ok          BOOLEAN NOT NULL DEFAULT FALSE,
  last_check_error       TEXT,
  update_available       BOOLEAN NOT NULL DEFAULT FALSE
);
