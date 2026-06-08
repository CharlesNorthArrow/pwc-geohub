/**
 * Client-side fetchers — the only path the React components use to read data.
 * Components must NOT fetch CSVs or external APIs directly (spec §11.1).
 */

import type {
  AggregationArea,
  AnalyticsSeriesResponse,
  CommunityResponse,
  GeographiesResponse,
  GeoSelectionResponse,
  IndicatorsResponse,
  PwcHistoryResponse,
  PwcProgramResponse,
  PwcResponse,
  SchoolArtsEdResponse,
  SchoolProfileResponse,
  SchoolsMasterResponse,
  SchoolsResponse,
} from './types';
import type { GeoFilterLayerId } from './types';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${res.status} ${res.statusText} ${detail}`);
  }
  return (await res.json()) as T;
}

export function fetchIndicators(): Promise<IndicatorsResponse> {
  return getJson<IndicatorsResponse>('/api/indicators');
}

export function fetchSchoolFeatures(
  indicatorId: string,
  year: string,
): Promise<SchoolsResponse> {
  return getJson<SchoolsResponse>(
    `/api/schools?indicator=${encodeURIComponent(indicatorId)}&year=${encodeURIComponent(year)}`,
  );
}

export function fetchCommunityValues(
  indicatorId: string,
  year: string,
): Promise<CommunityResponse> {
  return getJson<CommunityResponse>(
    `/api/community?indicator=${encodeURIComponent(indicatorId)}&year=${encodeURIComponent(year)}`,
  );
}

export async function fetchTractGeoJsonUrl(): Promise<string> {
  const { url } = await getJson<{ url: string }>('/api/geo/tracts');
  return url;
}

export function fetchPwcMembership(year: string): Promise<PwcResponse> {
  return getJson<PwcResponse>(`/api/pwc?year=${encodeURIComponent(year)}`);
}

export function fetchPwcHistory(): Promise<PwcHistoryResponse> {
  return getJson<PwcHistoryResponse>('/api/pwc/history');
}

export function fetchSchoolsMaster(): Promise<SchoolsMasterResponse> {
  return getJson<SchoolsMasterResponse>('/api/schools-master');
}

export function fetchGeographies(): Promise<GeographiesResponse> {
  return getJson<GeographiesResponse>('/api/geographies');
}

export function fetchAnalyticsSeries(
  indicatorId: string,
  aggArea: AggregationArea | null,
): Promise<AnalyticsSeriesResponse> {
  const params = new URLSearchParams({ indicator: indicatorId });
  if (aggArea) params.set('aggArea', aggArea);
  return getJson<AnalyticsSeriesResponse>(`/api/analytics/series?${params.toString()}`);
}

export function fetchSchoolProfile(dbn: string): Promise<SchoolProfileResponse> {
  return getJson<SchoolProfileResponse>(
    `/api/schools/profile?dbn=${encodeURIComponent(dbn)}`,
  );
}

export function fetchSchoolArtsEd(dbn: string): Promise<SchoolArtsEdResponse> {
  return getJson<SchoolArtsEdResponse>(
    `/api/schools/arts-ed?dbn=${encodeURIComponent(dbn)}`,
  );
}

export function fetchPwcProgram(dbn: string, year: string): Promise<PwcProgramResponse> {
  return getJson<PwcProgramResponse>(
    `/api/pwc/program?dbn=${encodeURIComponent(dbn)}&year=${encodeURIComponent(year)}`,
  );
}

export function fetchGeoSelection(
  picks: Partial<Record<GeoFilterLayerId, string[]>>,
): Promise<GeoSelectionResponse> {
  // Empty selection → don't hit the server.
  const hasAny = Object.values(picks).some((arr) => (arr?.length ?? 0) > 0);
  if (!hasAny) {
    return Promise.resolve({ type: 'FeatureCollection', features: [], intersectingTractGeoids: [] });
  }
  return getJson<GeoSelectionResponse>(
    `/api/geo/selection?picks=${encodeURIComponent(JSON.stringify(picks))}`,
  );
}
