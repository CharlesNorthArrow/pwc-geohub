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

import type { PwcCategory, PwcMember } from '../contract/types';

export type PwcGroup = 'anchor' | 'healing_arts';

export function belongsToPwcGroup(category: PwcCategory, group: PwcGroup): boolean {
  if (group === 'anchor') return category === 'anchor' || category === 'both';
  return category === 'healing_arts';
}

/** Anchor programming model, from PWC's own `community_school_program` flag
 *  (NOT the NYSED Community Schools list in the school master):
 *   - 'community_school' — Anchor with the full community-school program
 *   - 'social_work'      — Anchor with social-work support only
 *  null for non-Anchor schools. */
export type AnchorProgram = 'community_school' | 'social_work';

export function anchorProgram(member: Pick<PwcMember, 'category' | 'community_school'>): AnchorProgram | null {
  if (!belongsToPwcGroup(member.category, 'anchor')) return null;
  return member.community_school ? 'community_school' : 'social_work';
}
