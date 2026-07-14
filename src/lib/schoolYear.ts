/**
 * Year-coverage helpers — spec §3.6, §6.5, §12 Q4.
 *
 * Graduation is keyed by `cohort_year` (entry year, 4-digit calendar year).
 * Every other school indicator is keyed by `school_year` (e.g. "2024-25").
 *
 * Mapping rule (Q4 default): a 4-year HS cohort that entered in fall `Y`
 * graduates in `Y+4`, i.e., school year `(Y+3)-(Y+4)`.
 *   cohort 2012 → school_year 2015-16
 *   cohort 2013 → school_year 2016-17
 *   ...
 *   cohort 2021 → school_year 2024-25
 *
 * Canonical home is src/lib so both the ETL scripts and the Next.js admin
 * routes share one implementation. (Distinct from src/contract/year.ts,
 * which is the SLIDER_YEARS window + community-year mapping.)
 */

/** Convert a graduation cohort_year (numeric or string) → school_year string. */
export function cohortYearToSchoolYear(cohortYear: string | number | null | undefined): string | null {
  if (cohortYear == null) return null;
  const n = typeof cohortYear === 'number' ? cohortYear : Number(String(cohortYear).trim());
  if (!Number.isFinite(n) || n < 1990 || n > 2100) return null;
  const gradYear = n + 4;
  const startYear = gradYear - 1;
  const endTwo = String(gradYear % 100).padStart(2, '0');
  return `${startYear}-${endTwo}`;
}

/** Parse a "2024-25" school year string → its end year as a 4-digit number. */
export function schoolYearEnd(schoolYear: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(schoolYear);
  if (!m) return null;
  const start = Number(m[1]);
  const endTwo = Number(m[2]);
  // Carry the century from the start year.
  const century = Math.floor(start / 100);
  const candidate = century * 100 + endTwo;
  return candidate >= start ? candidate : candidate + 100;
}

/** Sort school-year strings ascending. */
export function sortSchoolYears(years: string[]): string[] {
  return [...years].sort((a, b) => (schoolYearEnd(a) ?? 0) - (schoolYearEnd(b) ?? 0));
}

/** Latest school_year present in a list (or null if list is empty). */
export function latestSchoolYear(years: string[]): string | null {
  if (years.length === 0) return null;
  const sorted = sortSchoolYears(years);
  return sorted[sorted.length - 1] ?? null;
}
