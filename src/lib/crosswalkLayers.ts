/**
 * Geography layers with a school↔area crosswalk (point-in-polygon,
 * precomputed — spec §11.9: never ST_Within at request time).
 *
 * Consumed by scripts/etl/21-build-crosswalks.ts (full ETL rebuild) and
 * src/server/schoolMasterAdminDb.ts (rebuild after an admin master apply).
 */
export const CROSSWALK_LAYERS = [
  // Phase 0
  'school_district',
  'nta_2020',
  // Phase 3 — §6.1 Geo filter (Counties, Senate, Assembly, Council, School Dist, Community Dist)
  'county',
  'senate',
  'assembly',
  'council',
  'community_district',
  // Added per user request — US Congressional Districts (not in §6.1 but
  // useful to PWC advocacy work).
  'congressional',
] as const;
