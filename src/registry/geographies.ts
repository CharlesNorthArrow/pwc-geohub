/**
 * Geography registry — spec §3.4.
 *
 * 8 boundary layers cached from ArcGIS. The ID/label fields are exactly as
 * specified by the reference table; the ETL fetches all features and writes
 * them to (a) the Neon `geographies` table and (b) Vercel Blob as GeoJSON.
 *
 * `county` is requested as a geo filter but is not in the reference table;
 * we derive it from US Census TIGER county boundaries (NY state, 5 NYC
 * county FIPS) via the ETL.
 */

export type GeoLayerId =
  | 'nta_2020'
  | 'council'
  | 'assembly'
  | 'senate'
  | 'school_district'
  | 'community_district'
  | 'congressional'
  | 'nda'
  | 'county';

export interface GeoLayerConfig {
  id: GeoLayerId;
  label: string;
  /** ArcGIS feature service layer 0 URL (queryable JSON endpoint). */
  feature_service_url: string | null;
  /** Field on the feature whose value identifies the area uniquely. */
  id_field: string;
  /** Field on the feature whose value is the human-readable name. */
  label_field: string;
  /** Additional attribute fields to preserve verbatim in `geographies.attributes`. */
  passthrough_fields?: string[];
  /**
   * Optional ArcGIS `where` clause to filter rows server-side. Use this for
   * national layers (senate, congressional) to avoid pulling 50 states only
   * to discard 49.
   */
  where?: string;
}

const ARCGIS = {
  ntas:
    'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Neighborhood_Tabulation_Areas_2020/FeatureServer/0',
  council:
    'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_City_Council_Districts/FeatureServer/0',
  assembly:
    'https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Assembly_Districts/FeatureServer/0',
  senate:
    'https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/State_Legislative_Districts_Upper_Houses_v1/FeatureServer/0',
  school_district:
    'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_School_Districts/FeatureServer/0',
  community_district:
    'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services/NYC_Community_Districts/FeatureServer/0',
  congressional:
    'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_119th_Congressional_Districts/FeatureServer/0',
  nda:
    'https://services3.arcgis.com/BLmIv6wksXDT6JVg/arcgis/rest/services/Neighborhood_Development_Areas_20251117/FeatureServer/0',
} as const;

export const GEO_LAYERS: readonly GeoLayerConfig[] = [
  {
    id: 'nta_2020',
    label: 'NYC NTAs (2020)',
    feature_service_url: ARCGIS.ntas,
    // NTA2020 has both an ID (NTA2020) and a display name (NTAName).
    id_field: 'NTA2020',
    label_field: 'NTAName',
    passthrough_fields: ['BoroName', 'BoroCode', 'CDTA2020', 'NTAType'],
  },
  {
    id: 'council',
    label: 'NYC City Council Districts',
    feature_service_url: ARCGIS.council,
    id_field: 'CounDist',
    label_field: 'CounDist',
  },
  {
    id: 'assembly',
    label: 'NYS Assembly Districts',
    feature_service_url: ARCGIS.assembly,
    id_field: 'District',
    label_field: 'District',
  },
  {
    id: 'senate',
    label: 'NYS Senate Districts',
    feature_service_url: ARCGIS.senate,
    // Layer is national; filter to NY (STATE='36') server-side to keep the
    // payload small enough to survive flaky proxies. Field is `STATE`, not STATEFP.
    id_field: 'NAME',
    label_field: 'NAME',
    where: "STATE='36'",
    passthrough_fields: ['STATE', 'SLDU', 'GEOID'],
  },
  {
    id: 'school_district',
    label: 'NYC School Districts',
    feature_service_url: ARCGIS.school_district,
    id_field: 'SchoolDist',
    label_field: 'SchoolDist',
  },
  {
    id: 'community_district',
    label: 'NYC Community Districts',
    feature_service_url: ARCGIS.community_district,
    id_field: 'BoroCD',
    label_field: 'BoroCD',
  },
  {
    id: 'congressional',
    label: 'US Congressional Districts (119th)',
    feature_service_url: ARCGIS.congressional,
    // National layer — filter to NY server-side. This service uses `STFIPS`.
    id_field: 'DISTRICTID',
    label_field: 'NAME',
    passthrough_fields: ['STFIPS', 'CDFIPS', 'STATE_ABBR', 'NAME', 'PARTY'],
    where: "STFIPS='36'",
  },
  {
    id: 'nda',
    label: 'NYC Neighborhood Development Areas',
    feature_service_url: ARCGIS.nda,
    id_field: 'NDA_ID',
    label_field: 'NDA_ID',
  },
  {
    id: 'county',
    label: 'NYC Counties (5 boroughs)',
    // Counties come from TIGER, not the reference table.
    // The ETL constructs this layer from Census TIGERweb (state=36, COUNTY in NYC FIPS set).
    feature_service_url: null,
    id_field: 'GEOID',
    label_field: 'NAME',
  },
];

/** NYC county FIPS (3-digit codes within state 36). */
export const NYC_COUNTY_FIPS = {
  '005': 'Bronx',
  '047': 'Kings',
  '061': 'New York',
  '081': 'Queens',
  '085': 'Richmond',
} as const;

export const NY_STATE_FIPS = '36';

/** TIGERweb counties feature service (Census). */
export const TIGER_COUNTIES_URL =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/13';
