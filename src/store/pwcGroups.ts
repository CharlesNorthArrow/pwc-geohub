/**
 * PWC group-membership predicate — the "both-rule" lives in exactly one place.
 *
 * Spec §12 Q1 default: a school is in the Anchor group when its category is
 * 'anchor' OR 'both'; in the Healing Arts group when 'healing_arts' OR 'both'.
 * Both-category schools count in BOTH KPI cells, paint both halos, and pass
 * either School Type filter.
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
  return category === 'healing_arts' || category === 'both';
}
