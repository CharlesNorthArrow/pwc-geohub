/**
 * Tests for the Spotlight ranking + framing + candidate-assembly modules.
 *
 * Covers (spec "Testing" list): polarity both directions; mode direction
 * filtering; the magnitude-weight nudge; category-diversity dedup;
 * tie-breaking; missing-data exclusion; the <3-candidate fallback chain;
 * categorical/context exclusion; std=0 fallback; celebrate-community
 * honesty flag; case-sentence patterns.
 *
 * Run: `npm run test:spotlight`.
 */

import {
  rankSection,
  rankWorstFirst,
  stdDev,
  iqr,
  MAGNITUDE_WEIGHT,
  TILES_PER_SECTION,
  type CandidateSpec,
} from '../src/spotlight/spotlightRanking.js';
import { ordinal, gapText, caseSentence, suggestHeadline } from '../src/spotlight/framing.js';
import {
  buildSchoolCandidates,
  buildCommunityCandidates,
  buildNeutralCommunityFacts,
  PROFILE_FIELDS,
  type CandidateContext,
} from '../src/spotlight/candidates.js';
import type { IndicatorPublic, SchoolMaster } from '../src/contract/types.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
    if (detail !== undefined) console.error('    detail:', detail);
  }
}

function approx(a: number | null, b: number, eps = 1e-9): boolean {
  return a != null && Math.abs(a - b) < eps;
}

const cand = (over: Partial<CandidateSpec>): CandidateSpec => ({
  id: 'x',
  label: 'X',
  category: 'Cat',
  format: 'percent',
  polarity: 1,
  value: 50,
  benchmark: 60,
  peerValues: [40, 50, 60, 70, 80],
  ...over,
});

console.log('== statistics helpers ==');
{
  check('stdDev of [2,4,4,4,5,5,7,9] = 2 (population)', approx(stdDev([2, 4, 4, 4, 5, 5, 7, 9]), 2));
  check('stdDev of single value = null', stdDev([5]) === null);
  check('iqr of [1,2,3,4] = 1.5', approx(iqr([1, 2, 3, 4]), 1.5));
  check('iqr needs 4 values', iqr([1, 2, 3]) === null);
}

console.log('\n== polarity handling (both directions) ==');
{
  // higher-is-better, below benchmark → negative g (worse).
  const hiGood = rankSection([cand({ id: 'a', polarity: 1, value: 40, benchmark: 60 })], 'case');
  check('high-good below benchmark → g < 0 (a need)', hiGood.ranked[0]!.g < 0 && hiGood.defaultSelection.includes('a'));

  // higher-is-worse, above benchmark → negative g (worse).
  const hiBad = rankSection([cand({ id: 'b', polarity: -1, value: 80, benchmark: 60 })], 'case');
  check('low-good above benchmark → g < 0 (a need)', hiBad.ranked[0]!.g < 0 && hiBad.defaultSelection.includes('b'));

  // higher-is-worse, below benchmark → positive g (a strength).
  const strength = rankSection([cand({ id: 'c', polarity: -1, value: 40, benchmark: 60 })], 'celebrate');
  check('low-good below benchmark → g > 0 (celebrate keeps it)', strength.ranked[0]!.g > 0 && strength.defaultSelection.includes('c'));
}

console.log('\n== mode direction filtering ==');
{
  const worse = cand({ id: 'worse', value: 40, benchmark: 60 });   // g<0
  const better = cand({ id: 'better', value: 80, benchmark: 60 }); // g>0
  const caseR = rankSection([worse, better], 'case');
  const celebR = rankSection([worse, better], 'celebrate');
  check('case keeps only g<0 as direction-correct', caseR.ranked.filter((r) => r.directionMatched).every((r) => r.id === 'worse'));
  check('celebrate keeps only g>0 as direction-correct', celebR.ranked.filter((r) => r.directionMatched).every((r) => r.id === 'better'));
  check('wrong-direction candidate still reachable via relaxed list', caseR.ranked.some((r) => r.id === 'better' && !r.directionMatched));
}

console.log('\n== magnitude-weight nudge ==');
{
  // Same standardized gap |g|, but B's absolute gap saturates the IQR scale
  // while A's doesn't → B scores higher by exactly the magnitude term.
  const a = cand({ id: 'a', label: 'A', value: 55, benchmark: 60, peerValues: [40, 50, 60, 70, 80] }); // |diff|=5
  const b = cand({ id: 'b', label: 'B', value: 25, benchmark: 60, peerValues: [40, 50, 60, 70, 80] }); // |diff|=35
  const r = rankSection([a, b], 'case');
  const sa = r.ranked.find((x) => x.id === 'a')!;
  const sb = r.ranked.find((x) => x.id === 'b')!;
  check('larger absolute gap → larger normalizedMagnitude', sb.normalizedMagnitude > sa.normalizedMagnitude);
  check('normalizedMagnitude clamped to 1', sb.normalizedMagnitude <= 1);
  check('score = |g| + weight × normMag', approx(sb.score, Math.abs(sb.g) + MAGNITUDE_WEIGHT * sb.normalizedMagnitude));
  check('nudged candidate ranks first', r.defaultSelection[0] === 'b');
}

console.log('\n== category diversity ==');
{
  const math = cand({ id: 'math', label: 'Math', category: 'Student Outcomes', value: 10, benchmark: 60 });
  const ela = cand({ id: 'ela', label: 'ELA', category: 'Student Outcomes', value: 12, benchmark: 60 });
  const susp = cand({ id: 'susp', label: 'Suspensions', category: 'Student Experience', polarity: -1, value: 90, benchmark: 60 });
  const temp = cand({ id: 'temp', label: 'Temp Housing', category: 'Student Need', polarity: -1, value: 85, benchmark: 60 });
  const r = rankSection([math, ela, susp, temp], 'case');
  check('only one of Math/ELA auto-selected', [
    r.defaultSelection.includes('math'),
    r.defaultSelection.includes('ela'),
  ].filter(Boolean).length === 1);
  check('three tiles selected across distinct categories', r.defaultSelection.length === 3);
  check('the deduped sibling stays in ranked (swappable)', r.ranked.some((x) => x.id === 'ela' || x.id === 'math'));

  const noDiv = rankSection([math, ela, susp, temp], 'case', { enforceCategoryDiversity: false });
  check('flag off → Math and ELA can co-exist', noDiv.defaultSelection.includes('math') && noDiv.defaultSelection.includes('ela'));

  // Diversity must not starve the section when only one category exists.
  const only = rankSection([math, ela], 'case');
  check('diversity never starves: both same-category tiles used when short', only.defaultSelection.length === 2);
}

console.log('\n== tie-breaking ==');
{
  // Identical distributions scaled ×10: same g, same normMag → same score;
  // larger |value − benchmark| must win.
  const small = cand({ id: 'small', label: 'Small', value: 50, benchmark: 60, peerValues: [40, 50, 60, 70, 80] });
  const big = cand({ id: 'big', label: 'Big', value: 500, benchmark: 600, peerValues: [400, 500, 600, 700, 800] });
  const r = rankSection([small, big], 'case', { enforceCategoryDiversity: false });
  check('equal score → larger absolute gap first', r.defaultSelection[0] === 'big');

  const zeta = cand({ id: 'z', label: 'Zeta', value: 50, benchmark: 60 });
  const alpha = cand({ id: 'a2', label: 'Alpha', value: 50, benchmark: 60 });
  const r2 = rankSection([zeta, alpha], 'case', { enforceCategoryDiversity: false });
  check('full tie → stable alphabetical by label', r2.defaultSelection[0] === 'a2');
}

console.log('\n== missing-data exclusion ==');
{
  const withVal = cand({ id: 'ok', value: 40 });
  const noVal = cand({ id: 'missing', value: null });
  const noBench = cand({ id: 'nobench', benchmark: null });
  const r = rankSection([withVal, noVal, noBench], 'case');
  check('null value excluded from candidacy', !r.ranked.some((x) => x.id === 'missing'));
  check('null benchmark excluded from candidacy', !r.ranked.some((x) => x.id === 'nobench'));
}

console.log('\n== <3-candidate fallback chain ==');
{
  // One genuine need + two strengths → direction relaxes to fill.
  const need = cand({ id: 'need', value: 30, benchmark: 60 });
  const s1 = cand({ id: 's1', label: 'S1', category: 'C1', value: 70, benchmark: 60 });
  const s2 = cand({ id: 's2', label: 'S2', category: 'C2', value: 90, benchmark: 60 });
  const r = rankSection([need, s1, s2], 'case');
  check('directionRelaxed flagged', r.directionRelaxed === true);
  check('section filled to 3 via relaxed candidates', r.defaultSelection.length === 3);
  check('relaxed fills are closest-to-benchmark first', r.defaultSelection[1] === 's1');
  check('relaxed candidates marked directionMatched=false',
    r.ranked.filter((x) => x.id === 's1' || x.id === 's2').every((x) => !x.directionMatched));

  // Only one candidate at all → shortfall reported for the UI fallback pool.
  const r2 = rankSection([need], 'case');
  check('shortfall counts unfillable slots', r2.shortfall === TILES_PER_SECTION - 1);
}

console.log('\n== std=0 fallback ==');
{
  const flat = cand({ id: 'flat', value: 30, benchmark: 60, peerValues: [50, 50, 50, 50] });
  const r = rankSection([flat, cand({ id: 'other', label: 'Other', value: 30, benchmark: 60 })], 'case', { enforceCategoryDiversity: false });
  const s = r.ranked.find((x) => x.id === 'flat')!;
  // peerStd = 0 → g = polarity*(value-benchmark)/|benchmark| = (30-60)/60 = -0.5
  check('peerStd=0 falls back to |benchmark| scaling', approx(s.g, -0.5));
}

console.log('\n== celebrate-community honesty flag ==');
{
  const allNeed = [
    cand({ id: 'pov', label: 'Poverty', polarity: -1, value: 90, benchmark: 60, category: 'A' }),
    cand({ id: 'unemp', label: 'Unemployment', polarity: -1, value: 80, benchmark: 60, category: 'B' }),
  ];
  const r = rankSection(allNeed, 'celebrate');
  check('no genuine positives → noGenuinePositives=true', r.noGenuinePositives === true);
  const mixed = rankSection([...allNeed, cand({ id: 'low', label: 'Low', polarity: -1, value: 30, benchmark: 60, category: 'C' })], 'celebrate');
  check('one genuine positive → flag false', mixed.noGenuinePositives === false);
}

console.log('\n== rank + framing ==');
{
  check('ordinal 1/2/3/4/11/22', ordinal(1) === '1st' && ordinal(2) === '2nd' && ordinal(3) === '3rd' && ordinal(4) === '4th' && ordinal(11) === '11th' && ordinal(22) === '22nd');
  check('rankWorstFirst low-good: highest value ranks 1', rankWorstFirst(90, [90, 60, 30], -1) === 1);
  check('rankWorstFirst high-good: lowest value ranks 1', rankWorstFirst(30, [90, 60, 30], 1) === 1);
  check('gapText percent → pp', gapText(80, 61.8, 'percent') === '18.2 pp');

  const needTile = rankSection([cand({ id: 'absent', label: 'Chronic Absenteeism', polarity: -1, value: 80, benchmark: 61.8, peerValues: [80, 60, 40, 30, 20] })], 'case').ranked[0]!;
  const s = caseSentence(needTile, 'case');
  check('need/high-is-worse sentence pattern', s === '80.0% — 1st highest of 5 PWC schools · 18.2 pp above citywide (61.8%)', s);

  const celebTile = rankSection([cand({ id: 'math', label: 'Math', polarity: 1, value: 80, benchmark: 60, peerValues: [80, 60, 40, 30, 20] })], 'celebrate').ranked[0]!;
  const s2 = caseSentence(celebTile, 'celebrate');
  check('celebrate/high-is-better sentence pattern', s2 === '80.0% — 1st highest of 5 · 20.0 pp above citywide', s2);

  const lowGood = rankSection([cand({ id: 'susp', label: 'Suspensions', polarity: -1, value: 20, benchmark: 60, peerValues: [80, 60, 40, 30, 20] })], 'celebrate').ranked[0]!;
  const s3 = caseSentence(lowGood, 'celebrate');
  check('celebrate/low-is-good uses truthful low-side rank', s3 === '20.0% — 1st lowest of 5 · 40.0 pp below citywide', s3);

  const h = suggestHeadline({ mode: 'case', schoolName: 'P.S. 067', ntaName: 'Fort Greene', topSchool: needTile, topCommunity: celebTile });
  check('headline suggestion is non-empty prose', h.startsWith('At P.S. 067,') && h.endsWith('.'), h);
}

console.log('\n== candidate assembly (categorical/context exclusion) ==');
{
  const mkInd = (over: Partial<IndicatorPublic>): IndicatorPublic => ({
    id: 'i',
    family: 'school',
    theme: 'T',
    label: 'I',
    format: 'percent',
    scale: { type: 'sequential', good_direction: 'low' },
    geometry: 'point',
    years: ['2023-24', '2024-25'],
    source_description: 'test',
    ...over,
  } as IndicatorPublic);

  const indicators: IndicatorPublic[] = [
    mkInd({ id: 'suspensions', theme: 'Student Experience', label: 'Suspension Rate' }),
    mkInd({ id: 'math', theme: 'Student Outcomes', label: 'Math', scale: { type: 'diverging', good_direction: 'high' } }),
    mkInd({ id: 'child_poverty', family: 'community', theme: 'Economic Conditions', label: 'Child Poverty' }),
    // Context/categorical — must never be scored:
    mkInd({ id: 'racial_predominance', family: 'community', theme: 'Demographics', label: 'Racial Predominance', format: 'categorical', scale: { type: 'categorical', good_direction: 'none' } }),
    mkInd({ id: 'children_immigrant_families', family: 'community', theme: 'Immigration & Language', label: 'Children in Immigrant Families', scale: { type: 'sequential', good_direction: 'none' } }),
  ];

  const rows = (id: string, vals: Array<[string, number]>) =>
    vals.map(([dbn, v]) => ({ dbn, year: id === 'child_poverty' || id === 'children_immigrant_families' ? '2024-25' : '2024-25', value_num: v, value_text: null, label: null }));

  const seriesById = {
    suspensions: rows('suspensions', [['S1', 9], ['S2', 3], ['S3', 1]]),
    math: rows('math', [['S1', 20], ['S2', 50], ['S3', 70]]),
    child_poverty: rows('child_poverty', [['S1', 40], ['S2', 25], ['S3', 10]]),
    children_immigrant_families: rows('children_immigrant_families', [['S1', 33]]),
    racial_predominance: [],
  };

  const master: SchoolMaster[] = [
    { dbn: 'S1', school_name: 'One', borough: 'Brooklyn', geos: {}, longitude: 0, latitude: 0, total_enrollment: 200, pct_poverty: 94, pct_students_with_disabilities: 30, pct_english_language_learners: 12, grades_canonical: [] },
    { dbn: 'S2', school_name: 'Two', borough: 'Bronx', geos: {}, longitude: 0, latitude: 0, total_enrollment: 300, pct_poverty: 60, pct_students_with_disabilities: 20, pct_english_language_learners: 10, grades_canonical: [] },
    { dbn: 'S3', school_name: 'Three', borough: 'Queens', geos: {}, longitude: 0, latitude: 0, total_enrollment: 400, pct_poverty: 40, pct_students_with_disabilities: 15, pct_english_language_learners: 8, grades_canonical: [] },
  ];

  const ctx: CandidateContext = {
    dbn: 'S1',
    indicators,
    seriesById,
    pwcDbns: new Set(['S1', 'S2']),
    anchorDbns: new Set(['S1']),
    healingDbns: new Set(['S2']),
    schoolsMaster: master,
    benchmarkSource: 'citywide',
  };

  const school = buildSchoolCandidates(ctx);
  check('school candidates = directional indicators + profile fields',
    school.length === 2 + PROFILE_FIELDS.length,
    school.map((c) => c.id));
  check('enrollment is never a candidate', !school.some((c) => c.id.includes('enrollment')));
  const pov = school.find((c) => c.id === 'profile_pct_poverty')!;
  check('profile poverty: value from master, polarity −1', pov.value === 94 && pov.polarity === -1);
  check('profile poverty benchmark = citywide mean', approx(pov.benchmark, (94 + 60 + 40) / 3));
  check('profile poverty peers = PWC only', pov.peerValues.length === 2);

  const susp = school.find((c) => c.id === 'suspensions')!;
  check('citywide benchmark over ALL schools', approx(susp.benchmark, (9 + 3 + 1) / 3));
  check('peer values restricted to PWC set', susp.peerValues.length === 2);

  const anchorCtx: CandidateContext = { ...ctx, benchmarkSource: 'anchor' };
  const suspAnchor = buildSchoolCandidates(anchorCtx).find((c) => c.id === 'suspensions')!;
  check('benchmark source anchor → anchor-group mean', approx(suspAnchor.benchmark, 9));

  const community = buildCommunityCandidates(ctx);
  check('community candidates exclude none/categorical', community.length === 1 && community[0]!.id === 'child_poverty');
  check('racial_predominance never scored', !community.some((c) => c.id === 'racial_predominance'));
  check('children_immigrant_families never scored', !community.some((c) => c.id === 'children_immigrant_families'));

  const neutral = buildNeutralCommunityFacts(ctx);
  check('children_immigrant_families available as neutral context', neutral.length === 1 && neutral[0]!.id === 'children_immigrant_families' && neutral[0]!.value === 33);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
