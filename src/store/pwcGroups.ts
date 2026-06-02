/**
 * PWC group-membership predicate — the both-rule lives in exactly one place.
 *
 * Anchor-wins rule: a school that is BOTH Anchor and Healing Arts counts as
 * Anchor only. Visual symbology renders two disjoint shapes (Anchor stars,
 * Healing-Arts diamonds) and KPI cells / timeline series stay disjoint too.
 *   - Anchor group        = category in {'anchor', 'both'}
 *   - Healing Arts group  = category === 'healing_arts'   (NOT 'both')
 *
 * Used by:
 *   - `applyFilters` (filtered universe, School Type cascade)
 *   - `deriveAnalytics` (KPI cells, timeline series, ranked-list rows)
 *   - Any future feature that needs to ask "is this PWC school in <group>?"
 */

import type { PwcCategory } from '../contract/types';

export type PwcGroup = 'anchor' | 'healing_arts';

export function belongsToPwcGroup(category: PwcCategory, group: PwcGroup): boolean {
  if (group === 'anchor') return category === 'anchor' || category === 'both';
  return category === 'healing_arts';
}
