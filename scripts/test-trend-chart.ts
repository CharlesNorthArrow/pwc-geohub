/**
 * Unit tests for the trend-chart helpers (src/store/trendChart.ts).
 * Synthetic fixtures only. Run: npm run test:trend
 */

import {
  activeTiersFor,
  axisOptionsFor,
  getTrendSeries,
  niceAxis,
  pointKind,
  resolveLabelCollisions,
  smallSampleNote,
  TREND_MIN_N,
  type PwcTier,
  type TrendSeriesKey,
} from '../src/store/trendChart.js';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}`, detail ?? '');
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/* -------------------------------------------------------------------------- */
console.log('getTrendSeries');
{
  const both: PwcTier[] = ['anchor', 'healing_arts'];
  const off = getTrendSeries({ splitByTier: false, activeTiers: both });
  check('both tiers, split off → pwc, all_in_view, citywide', same(off, ['pwc', 'all_in_view', 'citywide']), off);
  const on = getTrendSeries({ splitByTier: true, activeTiers: both });
  check(
    'both tiers, split on → anchor, healing_arts, all_in_view, citywide',
    same(on, ['anchor', 'healing_arts', 'all_in_view', 'citywide']),
    on,
  );
  for (const split of [false, true]) {
    const a = getTrendSeries({ splitByTier: split, activeTiers: ['anchor'] });
    check(`anchor only, split ${split} → anchor, all_in_view, citywide`, same(a, ['anchor', 'all_in_view', 'citywide']), a);
    const h = getTrendSeries({ splitByTier: split, activeTiers: ['healing_arts'] });
    check(`healing arts only, split ${split} → healing_arts, all_in_view, citywide`, same(h, ['healing_arts', 'all_in_view', 'citywide']), h);
  }

  const tierSets: PwcTier[][] = [[], ['anchor'], ['healing_arts'], ['anchor', 'healing_arts'], ['healing_arts', 'anchor']];
  let neverBoth = true;
  let neverOver4 = true;
  for (const tiers of tierSets) {
    for (const split of [false, true]) {
      const keys: TrendSeriesKey[] = getTrendSeries({ splitByTier: split, activeTiers: tiers });
      if (keys.includes('pwc') && (keys.includes('anchor') || keys.includes('healing_arts'))) neverBoth = false;
      if (keys.length > 4) neverOver4 = false;
    }
  }
  check('never returns pwc together with a tier key', neverBoth);
  check('never returns more than 4 keys', neverOver4);

  check('activeTiersFor(anchor) = [anchor]', same(activeTiersFor('anchor'), ['anchor']));
  check('activeTiersFor(healing_arts) = [healing_arts]', same(activeTiersFor('healing_arts'), ['healing_arts']));
  check('activeTiersFor(pwc) = both', same(activeTiersFor('pwc'), ['anchor', 'healing_arts']));
  check('activeTiersFor(all) = both', same(activeTiersFor('all'), ['anchor', 'healing_arts']));
}

/* -------------------------------------------------------------------------- */
console.log('resolveLabelCollisions');
{
  const far = [{ id: 'a', y: 10 }, { id: 'b', y: 40 }, { id: 'c', y: 80 }];
  check('labels already far apart stay put', same(resolveLabelCollisions(far), far));

  const close = [{ id: 'a', y: 50 }, { id: 'b', y: 52 }, { id: 'c', y: 54 }];
  const out = resolveLabelCollisions(close);
  const ys = out.map((l) => l.y).sort((x, y) => x - y);
  check(
    'three labels within 5px end up ≥ 14px apart',
    ys[1]! - ys[0]! >= 14 && ys[2]! - ys[1]! >= 14,
    ys,
  );
  check('the topmost label does not move', out.find((l) => l.id === 'a')!.y === 50);

  const shuffled = [close[2]!, close[0]!, close[1]!];
  const byId = (ls: Array<{ id: string; y: number }>): Array<[string, number]> =>
    ls.map((l): [string, number] => [l.id, l.y]).sort((x, y) => x[0].localeCompare(y[0]));
  check('input order does not affect the result', same(byId(resolveLabelCollisions(shuffled)), byId(out)));
  check('output keeps input order', same(resolveLabelCollisions(shuffled).map((l) => l.id), ['c', 'a', 'b']));
  check('custom minGap respected', (() => {
    const r = resolveLabelCollisions(close, 20).map((l) => l.y).sort((x, y) => x - y);
    return r[1]! - r[0]! >= 20 && r[2]! - r[1]! >= 20;
  })());
}

/* -------------------------------------------------------------------------- */
console.log('niceAxis');
{
  const a = niceAxis(21, 55, { isPercent: true });
  check('percent 21–55 → 0–60 step 20', same(a, { min: 0, max: 60, step: 20 }), a);

  const b = niceAxis(2, 9, { isPercent: true });
  const bTicks = (b.max - b.min) / b.step + 1;
  check('percent 2–9 → 0–10 with 3–5 ticks', b.min === 0 && b.max === 10 && bTicks >= 3 && bTicks <= 5, b);

  let neverOver100 = true;
  for (const hi of [61, 81, 88, 95, 99, 99.9, 100]) {
    const r = niceAxis(10, hi, { isPercent: true });
    if (r.max > 100 || r.max < hi) neverOver100 = false;
  }
  check('percent axis never exceeds 100 and still covers the data', neverOver100);

  check('fixed [1, 5] returned unchanged', same(niceAxis(2.3, 4.1, { fixedDomain: [1, 5] }), { min: 1, max: 5, step: 1 }));
  check('fixed [0, 4] returned unchanged', same(niceAxis(1, 3, { fixedDomain: [0, 4] }), { min: 0, max: 4, step: 1 }));

  const n = niceAxis(13, 47);
  const nTicks = (n.max - n.min) / n.step + 1;
  check(
    'number axis 13–47 → min/max on step multiples, ≤ 5 ticks, step in {1,2,5}×10^k',
    n.min <= 13 && n.max >= 47 && n.min % n.step === 0 && n.max % n.step === 0 && nTicks <= 5 &&
      [1, 2, 5].includes(n.step / 10 ** Math.floor(Math.log10(n.step))),
    n,
  );
}

/* -------------------------------------------------------------------------- */
console.log('axisOptionsFor');
{
  check('fixed axis from registry', same(axisOptionsFor({ format: 'integer', axis: { type: 'fixed', domain: [0, 4] } }), { isPercent: false, fixedDomain: [0, 4] }));
  check('percent format, no axis → percent', axisOptionsFor({ format: 'percent' }).isPercent === true);
  check('rate_per_100 format, no axis → percent', axisOptionsFor({ format: 'rate_per_100' }).isPercent === true);
  check('integer format, no axis → number', axisOptionsFor({ format: 'integer' }).isPercent === false);
  check('explicit number axis overrides a percent format', axisOptionsFor({ format: 'percent', axis: { type: 'number' } }).isPercent === false);
}

/* -------------------------------------------------------------------------- */
console.log('small-n classification');
{
  check(`TREND_MIN_N default is 5`, TREND_MIN_N === 5);
  check('n = 0 → gap', pointKind(0, 12) === 'gap');
  check('null value → gap', pointKind(8, null) === 'gap');
  check('n = 3 → hollow', pointKind(3, 12) === 'hollow');
  check('n = 5 → filled', pointKind(5, 12) === 'filled');
  check('override minN = 3: n = 3 → filled', pointKind(3, 12, 3) === 'filled');
  check('override minN = 10: n = 5 → hollow', pointKind(5, 12, 10) === 'hollow');
  check('note text built from the threshold', smallSampleNote(7) === 'Hollow points = fewer than 7 schools reporting');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
