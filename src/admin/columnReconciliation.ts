/**
 * Column reconciliation — pure functions used by both the API route and
 * (re-)validated server-side so a malicious client can't bypass the gates.
 *
 * Three jobs:
 *   1. classifyColumns(csvHeaders, schema)   → matched / unmatched / missing / extra
 *   2. validateDecisions(classification, decisions) → ok | reasons[]
 *   3. applyDecisions(rawRows, decisions, schema)   → normalized rows
 *
 * Hard rules (enforced here, NOT in the dialog):
 *   - KEY column missing → HARD BLOCK. No decision can override.
 *   - Data column missing → block unless decisions.acknowledgedMissing[col] === true.
 *   - Unmatched CSV column → must have a decision (map to a schema field OR ignore).
 *   - Extra CSV column → must have a decision (only 'ignore' is allowed this round).
 *   - Schema field can't be the target of two unmatched mappings simultaneously
 *     (no two CSV columns map to the same schema field).
 *   - No auto-apply: the dialog presents suggestions, but the server treats
 *     every unmatched column as "needs an explicit decision".
 *
 * Similarity scoring is Levenshtein over normalized names (snake/camel/kebab
 * collapsed to lowercase tokens). Score is RANK ONLY — never a green light.
 */

import { PWC_DATA_FIELDS, PWC_FIELDS, PWC_KEY_FIELDS, type PwcField } from './pwcSchema';

export interface MatchedColumn {
  csvHeader: string;
  fieldId: string;
  /** True when matched via `aliases`, not exact name. Shown in the audit. */
  viaAlias?: boolean;
}

export interface UnmatchedColumn {
  csvHeader: string;
  suggestions: Array<{ fieldId: string; score: number }>;
}

export interface MissingColumn {
  fieldId: string;
  isKey: boolean;
}

export interface ExtraColumn {
  csvHeader: string;
}

export interface Classification {
  matched: MatchedColumn[];
  unmatched: UnmatchedColumn[];
  missing: MissingColumn[];
  extra: ExtraColumn[];
}

export type UnmatchedDecision =
  | { kind: 'map'; csvHeader: string; fieldId: string }
  | { kind: 'ignore'; csvHeader: string };

export interface ReconciliationDecisions {
  /** One per unmatched column. Map → assign CSV col to a schema field;
   *  ignore → drop it. */
  unmatched: UnmatchedDecision[];
  /** Each missing data column must appear here with `true` for the admin
   *  to proceed. Missing KEY columns can never be acknowledged. */
  acknowledgedMissing: Record<string, boolean>;
  /** Extra columns are always ignored this round. The dialog still records
   *  this so the audit log carries the trail. */
  ignoredExtra: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Strip non-alphanumerics and lowercase → "Governance School Type" → "governanceschooltype". */
function normalizeName(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

/** Levenshtein distance (O(m·n)) — fine for header-sized strings. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  return prev[n]!;
}

/** 0..1 similarity score (1 = exact match on normalized name). */
function similarity(csvHeader: string, fieldId: string): number {
  const a = normalizeName(csvHeader);
  const b = normalizeName(fieldId);
  if (a.length === 0 && b.length === 0) return 1;
  const d = levenshtein(a, b);
  return 1 - d / Math.max(a.length, b.length);
}

/**
 * Classify the CSV headers against the schema.
 *
 * - Exact name match (case-insensitive, after normalization) → matched.
 * - Alias match (field.aliases) → matched + viaAlias.
 * - Otherwise the CSV column is unmatched and we attach the top-3
 *   highest-similarity schema fields as SUGGESTIONS.
 * - Schema fields not consumed by any match → missing.
 * - CSV columns not matched → extra.
 *
 * Deterministic: stable order in / stable order out.
 */
export function classifyColumns(csvHeaders: string[]): Classification {
  const consumedFields = new Set<string>();
  const consumedHeaders = new Set<string>();
  const matched: MatchedColumn[] = [];

  // Build lookups.
  const fieldByNorm = new Map<string, PwcField>();
  const aliasByNorm = new Map<string, PwcField>();
  for (const f of PWC_FIELDS) {
    fieldByNorm.set(normalizeName(f.id), f);
    for (const a of f.aliases ?? []) {
      aliasByNorm.set(normalizeName(a), f);
    }
  }

  // Pass 1: exact + alias matches.
  for (const h of csvHeaders) {
    const k = normalizeName(h);
    const exact = fieldByNorm.get(k);
    if (exact && !consumedFields.has(exact.id)) {
      matched.push({ csvHeader: h, fieldId: exact.id });
      consumedFields.add(exact.id);
      consumedHeaders.add(h);
      continue;
    }
    const alias = aliasByNorm.get(k);
    if (alias && !consumedFields.has(alias.id)) {
      matched.push({ csvHeader: h, fieldId: alias.id, viaAlias: true });
      consumedFields.add(alias.id);
      consumedHeaders.add(h);
    }
  }

  // Pass 2: leftovers.
  const unmatched: UnmatchedColumn[] = [];
  for (const h of csvHeaders) {
    if (consumedHeaders.has(h)) continue;
    const scored = PWC_FIELDS
      .filter((f) => !consumedFields.has(f.id))
      .map((f) => ({ fieldId: f.id, score: similarity(h, f.id) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    unmatched.push({ csvHeader: h, suggestions: scored });
  }

  const missing: MissingColumn[] = [];
  for (const f of PWC_FIELDS) {
    if (!consumedFields.has(f.id)) {
      missing.push({ fieldId: f.id, isKey: f.isKey });
    }
  }

  const extra: ExtraColumn[] = unmatched.map((u) => ({ csvHeader: u.csvHeader }));

  return { matched, unmatched, missing, extra };
}

/**
 * Re-validate the decisions against the classification. The dialog will have
 * already done some of this client-side; we never trust that — the server
 * has the last word.
 */
export function validateDecisions(
  classification: Classification,
  decisions: ReconciliationDecisions,
): ValidationResult {
  const errors: string[] = [];

  // Mappings supply a missing field — collect targets so we don't double-flag
  // them as "missing & unacknowledged" right after the admin mapped a rename.
  const suppliedByMapping = new Set<string>();
  for (const d of decisions.unmatched) {
    if (d.kind === 'map') suppliedByMapping.add(d.fieldId);
  }

  // 1. KEY columns missing = HARD BLOCK. No decision overrides this (keys
  //    must come from a header literally named DBN / school_year — rule 4
  //    catches mapping attempts separately).
  const missingKeys = classification.missing.filter((m) => m.isKey);
  if (missingKeys.length > 0) {
    errors.push(
      `Missing key columns: ${missingKeys.map((k) => k.fieldId).join(', ')} — these cannot be acknowledged or mapped from another column. Fix the source file.`,
    );
  }

  // 2. Missing data columns require explicit acknowledgment — unless a
  //    mapping is supplying that field (renamed-column path).
  for (const m of classification.missing) {
    if (m.isKey) continue;
    if (suppliedByMapping.has(m.fieldId)) continue;
    if (decisions.acknowledgedMissing[m.fieldId] !== true) {
      errors.push(`Column "${m.fieldId}" is missing from the upload and has not been acknowledged. Acknowledge to import as NULL on every row, or fix the source file.`);
    }
  }

  // 3. Every unmatched column needs a decision.
  const unmatchedHeaders = new Set(classification.unmatched.map((u) => u.csvHeader));
  const decidedHeaders = new Set(decisions.unmatched.map((d) => d.csvHeader));
  for (const h of unmatchedHeaders) {
    if (!decidedHeaders.has(h)) {
      errors.push(`Unmatched column "${h}" has no decision. Map it to a schema field or mark Ignore.`);
    }
  }

  // 4. Mappings can't double-target a schema field; can't target a key
  //    that's already matched (the alias path handles that); can't target a
  //    field not in the schema.
  const mappedFields = new Map<string, string>(); // fieldId → csvHeader
  for (const d of decisions.unmatched) {
    if (d.kind !== 'map') continue;
    if (!PWC_FIELDS.some((f) => f.id === d.fieldId)) {
      errors.push(`Mapping target "${d.fieldId}" is not in the schema.`);
      continue;
    }
    const prior = mappedFields.get(d.fieldId);
    if (prior) {
      errors.push(`Two columns map to "${d.fieldId}": "${prior}" and "${d.csvHeader}". Pick one.`);
    }
    mappedFields.set(d.fieldId, d.csvHeader);
    // Can't map onto a key — the source file should have the key column itself.
    if (PWC_KEY_FIELDS.includes(d.fieldId)) {
      errors.push(`"${d.fieldId}" is a key column; it can't be supplied via column renaming. Fix the source header.`);
    }
  }

  // 5. Extra columns: only 'ignore' is allowed this round. (Schema additions
  //    are out of scope; the dialog enforces this client-side too.)
  for (const h of decisions.ignoredExtra) {
    if (!unmatchedHeaders.has(h)) {
      errors.push(`"${h}" was marked Ignore but isn't in the upload's extra-columns set.`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Materialize the normalized row set — one record per CSV row, keyed by
 * schema field IDs. Missing-and-acknowledged data columns become `null` on
 * every row. Ignored columns are dropped. Mapped columns pull from their
 * source CSV header.
 *
 * Values are NOT coerced here — that's the merge layer's job (typed casts
 * matter for diff equality). We just shape the row.
 */
export function applyDecisions(
  rawRows: Array<Record<string, string>>,
  classification: Classification,
  decisions: ReconciliationDecisions,
): Array<Record<string, string | null>> {
  // Build header → fieldId map.
  const headerToField = new Map<string, string>();
  for (const m of classification.matched) headerToField.set(m.csvHeader, m.fieldId);
  for (const d of decisions.unmatched) {
    if (d.kind === 'map') headerToField.set(d.csvHeader, d.fieldId);
  }

  const out: Array<Record<string, string | null>> = [];
  for (const r of rawRows) {
    const norm: Record<string, string | null> = {};
    for (const f of PWC_FIELDS) norm[f.id] = null;
    for (const [csvHeader, fieldId] of headerToField) {
      const v = r[csvHeader];
      norm[fieldId] = v == null || v === '' ? null : v;
    }
    out.push(norm);
  }
  void PWC_DATA_FIELDS; // referenced for clarity in the schema design
  return out;
}
