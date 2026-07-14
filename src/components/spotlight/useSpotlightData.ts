'use client';

/**
 * Spotlight data hook + model builder.
 *
 * useSpotlightData(dbn, indicators): one fetch per resource, all existing
 * endpoints (spec: never fork the data layer):
 *   - schools master (identity, NTA crosswalk, profile need-fields)
 *   - PWC history → latest membership snapshot (peer set + groups)
 *   - geographies → NTA display name
 *   - per-dbn profile / program / arts-ed
 *   - analytics series fan-out, one request per active indicator
 *     (community → the school's-NTA aggregation, same as Scorecard)
 *
 * buildSpotlightModel(...): pure — assembles candidates, ranks both
 * sections for the requested mode, resolves the displayed tiles (URL
 * overrides win over auto-selection), builds sentences, fallback facts,
 * and the suggested headline. The card, the export layout, and the print
 * view all render from this one model.
 */

import { useEffect, useState } from 'react';
import {
  fetchAnalyticsSeries,
  fetchGeographies,
  fetchPwcHistory,
  fetchPwcProgram,
  fetchSchoolArtsEd,
  fetchSchoolProfile,
  fetchSchoolsMaster,
} from '../../contract/client';
import type {
  AnalyticsSeriesRow,
  GeographiesResponse,
  IndicatorPublic,
  PwcMember,
  PwcProgram,
  SchoolArtsEd,
  SchoolMaster,
  SchoolProfile,
} from '../../contract/types';
import { belongsToPwcGroup } from '../../store/pwcGroups';
import {
  buildCommunityCandidates,
  buildNeutralCommunityFacts,
  buildSchoolCandidates,
  type CandidateContext,
  type NeutralFact,
} from '../../spotlight/candidates';
import {
  BENCHMARK_SOURCE,
  rankSection,
  TILES_PER_SECTION,
  type ScoredCandidate,
  type SectionRanking,
  type SpotlightMode,
} from '../../spotlight/spotlightRanking';
import { caseSentence, suggestHeadline } from '../../spotlight/framing';
import { formatValue } from '../../lib/format';

/* ------------------------------- fetching -------------------------------- */

export interface SpotlightData {
  loading: boolean;
  error: string | null;
  schoolsMaster: SchoolMaster[];
  school: SchoolMaster | null;
  profile: SchoolProfile | null;
  program: PwcProgram | null;
  artsEd: SchoolArtsEd | null;
  member: PwcMember | null;
  members: PwcMember[];
  ntaName: string | null;
  seriesById: Record<string, AnalyticsSeriesRow[]>;
}

export function useSpotlightData(dbn: string, indicators: IndicatorPublic[]): SpotlightData {
  const [state, setState] = useState<SpotlightData>({
    loading: true,
    error: null,
    schoolsMaster: [],
    school: null,
    profile: null,
    program: null,
    artsEd: null,
    member: null,
    members: [],
    ntaName: null,
    seriesById: {},
  });

  useEffect(() => {
    let abandoned = false;
    async function load(): Promise<void> {
      try {
        const [masterRes, historyRes, geosRes, profileRes, artsRes, seriesResults] = await Promise.all([
          fetchSchoolsMaster(),
          fetchPwcHistory(),
          fetchGeographies(),
          fetchSchoolProfile(dbn),
          fetchSchoolArtsEd(dbn).catch(() => ({ artsEd: null })),
          Promise.all(
            indicators.map(async (ind) => {
              try {
                const r = await fetchAnalyticsSeries(ind.id, ind.family === 'community' ? 'nta_2020' : null);
                return { id: ind.id, rows: r.series };
              } catch {
                return { id: ind.id, rows: [] as AnalyticsSeriesRow[] };
              }
            }),
          ),
        ]);

        const years = Object.keys(historyRes.byYear).sort();
        const latestPwcYear = years[years.length - 1] ?? null;
        const members = latestPwcYear ? (historyRes.byYear[latestPwcYear] ?? []) : [];

        // Program facts come from the same latest PWC year.
        const programRes = latestPwcYear
          ? await fetchPwcProgram(dbn, latestPwcYear).catch(() => ({ program: null }))
          : { program: null as PwcProgram | null };

        if (abandoned) return;

        const school = masterRes.schools.find((s) => s.dbn === dbn) ?? null;
        const ntaId = school?.geos.nta_2020 ?? null;
        const ntaName = ntaId ? lookupNtaName(geosRes, ntaId) : null;

        const seriesById: Record<string, AnalyticsSeriesRow[]> = {};
        for (const r of seriesResults) seriesById[r.id] = r.rows;

        setState({
          loading: false,
          error: null,
          schoolsMaster: masterRes.schools,
          school,
          profile: profileRes.profile,
          program: programRes.program,
          artsEd: (artsRes as { artsEd: SchoolArtsEd | null }).artsEd,
          member: members.find((m) => m.dbn === dbn) ?? null,
          members,
          ntaName,
          seriesById,
        });
      } catch (err) {
        if (!abandoned) {
          setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
        }
      }
    }
    void load();
    return () => {
      abandoned = true;
    };
  }, [dbn, indicators]);

  return state;
}

function lookupNtaName(geos: GeographiesResponse, ntaId: string): string | null {
  const area = geos.layers.nta_2020?.find((a) => a.area_id === ntaId);
  return area?.label ?? null;
}

/* ------------------------------- the model -------------------------------- */

export interface SpotlightTile {
  kind: 'scored';
  candidate: ScoredCandidate;
  sentence: string;
  /** True on the single strongest tile across both sections. */
  topOutlier: boolean;
  /** True when another ranked candidate exists to swap to. */
  canSwap: boolean;
}

export interface FactTile {
  kind: 'fact';
  id: string;
  label: string;
  /** Pre-formatted display value ("94.0%", "Dance · Music", "✓ On site"). */
  display: string;
  sentence: string;
}

export type AnyTile = SpotlightTile | FactTile;

export interface SpotlightModel {
  mode: SpotlightMode;
  schoolTiles: AnyTile[];
  communityTiles: AnyTile[];
  schoolRanking: SectionRanking;
  communityRanking: SectionRanking;
  communityNeutral: boolean;
  suggestedHeadline: string;
}

export interface TileOverrides {
  /** Explicit indicator ids per section (from the URL). Invalid ids are
   *  dropped; missing slots fall back to auto-selection order. */
  school: string[];
  community: string[];
}

export function buildSpotlightModel(
  data: SpotlightData,
  indicators: IndicatorPublic[],
  dbn: string,
  mode: SpotlightMode,
  overrides: TileOverrides,
): SpotlightModel {
  const pwcDbns = new Set(data.members.map((m) => m.dbn));
  const anchorDbns = new Set(data.members.filter((m) => belongsToPwcGroup(m.category, 'anchor')).map((m) => m.dbn));
  const healingDbns = new Set(data.members.filter((m) => belongsToPwcGroup(m.category, 'healing_arts')).map((m) => m.dbn));

  const ctx: CandidateContext = {
    dbn,
    indicators,
    seriesById: data.seriesById,
    pwcDbns,
    anchorDbns,
    healingDbns,
    schoolsMaster: data.schoolsMaster,
    benchmarkSource: BENCHMARK_SOURCE,
  };

  const schoolRanking = rankSection(buildSchoolCandidates(ctx), mode);
  const communityRanking = rankSection(buildCommunityCandidates(ctx), mode);
  const communityNeutral = mode === 'celebrate' && communityRanking.noGenuinePositives;

  const resolve = (ranking: SectionRanking, wanted: string[]): ScoredCandidate[] => {
    const byId = new Map(ranking.ranked.map((c) => [c.id, c]));
    const picked: ScoredCandidate[] = [];
    for (const id of wanted) {
      const c = byId.get(id);
      if (c && !picked.some((p) => p.id === id)) picked.push(c);
    }
    for (const id of ranking.defaultSelection) {
      if (picked.length >= TILES_PER_SECTION) break;
      const c = byId.get(id);
      if (c && !picked.some((p) => p.id === id)) picked.push(c);
    }
    return picked.slice(0, TILES_PER_SECTION);
  };

  const schoolPicked = resolve(schoolRanking, overrides.school);
  // Celebrate-honesty: when the community has no genuine positives we render
  // neutral context instead of forced spin — no scored community tiles.
  const communityPicked = communityNeutral ? [] : resolve(communityRanking, overrides.community);

  // The single strongest tile overall gets the "Top outlier" flag.
  const allPicked = [...schoolPicked, ...communityPicked].filter((c) => c.directionMatched);
  const top = allPicked.reduce<ScoredCandidate | null>(
    (best, c) => (best == null || c.score > best.score ? c : best),
    null,
  );

  const toTile = (c: ScoredCandidate, ranking: SectionRanking, displayed: ScoredCandidate[]): SpotlightTile => ({
    kind: 'scored',
    candidate: c,
    sentence: caseSentence(c, mode),
    topOutlier: top != null && c.id === top.id,
    canSwap: ranking.ranked.some((r) => !displayed.some((d) => d.id === r.id)),
  });

  const schoolTiles: AnyTile[] = schoolPicked.map((c) => toTile(c, schoolRanking, schoolPicked));
  fillWithSchoolFacts(schoolTiles, data);

  const communityTiles: AnyTile[] = communityPicked.map((c) => toTile(c, communityRanking, communityPicked));
  fillWithCommunityContext(communityTiles, ctx, data.ntaName);

  const suggestedHeadline = suggestHeadline({
    mode,
    schoolName: data.school?.school_name ?? data.profile?.school_name ?? dbn,
    ntaName: data.ntaName,
    topSchool: schoolPicked.find((c) => c.directionMatched) ?? null,
    topCommunity: communityPicked.find((c) => c.directionMatched) ?? null,
  });

  return {
    mode,
    schoolTiles,
    communityTiles,
    schoolRanking,
    communityRanking,
    communityNeutral,
    suggestedHeadline,
  };
}

/** School fallback pool — profile facts + program facts. Never fabricates:
 *  only facts present in the data become tiles. */
function fillWithSchoolFacts(tiles: AnyTile[], data: SpotlightData): void {
  if (tiles.length >= TILES_PER_SECTION) return;
  const pool: FactTile[] = [];
  const p = data.profile;
  if (p?.pct_poverty != null) {
    pool.push(fact('fact_poverty', '% Poverty', `${formatValue(p.pct_poverty, 'percent')}`, 'Share of students living in poverty.'));
  }
  if (p?.total_enrollment != null) {
    pool.push(fact('fact_enrollment', 'Enrollment', formatValue(p.total_enrollment, 'integer'), 'Students enrolled.'));
  }
  if (p?.pct_students_with_disabilities != null) {
    pool.push(fact('fact_swd', '% Students with Disabilities', formatValue(p.pct_students_with_disabilities, 'percent'), 'Students receiving special-education services.'));
  }
  if (data.artsEd && data.artsEd.disciplines.length > 0) {
    pool.push(fact('fact_arts', 'Arts disciplines taught', data.artsEd.disciplines.join(' · '), 'Arts education on site.'));
  }
  if (data.program?.arts_program_type) {
    pool.push(fact('fact_arts_residency', 'PWC arts residency', data.program.arts_program_type, 'Healing-arts programming in residence.'));
  }
  if (data.program?.food_pantry) {
    pool.push(fact('fact_pantry', 'Food pantry', 'On site', 'PWC operates a food pantry at this school.'));
  }
  if (data.program?.laundry) {
    pool.push(fact('fact_laundry', 'Laundry services', 'On site', 'PWC operates laundry services at this school.'));
  }
  for (const f of pool) {
    if (tiles.length >= TILES_PER_SECTION) break;
    tiles.push(f);
  }
}

/** Community last-resort fill — 'none'-direction indicators rendered
 *  neutrally as "the community this school serves". */
function fillWithCommunityContext(tiles: AnyTile[], ctx: CandidateContext, ntaName: string | null): void {
  if (tiles.length >= TILES_PER_SECTION) return;
  const facts: NeutralFact[] = buildNeutralCommunityFacts(ctx);
  for (const f of facts) {
    if (tiles.length >= TILES_PER_SECTION) break;
    tiles.push(fact(`context_${f.id}`, f.label, formatValue(f.value, f.format), `Context for ${ntaName ?? 'the community this school serves'} — not scored.`));
  }
}

function fact(id: string, label: string, display: string, sentence: string): FactTile {
  return { kind: 'fact', id, label, display, sentence };
}
