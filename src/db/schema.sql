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
