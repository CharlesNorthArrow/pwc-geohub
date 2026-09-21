/**
 * Raw-file transforms — one per hosted school-indicator dataset. Each takes
 * the file(s) exactly as the admin downloaded them from DOE and returns rows
 * in the dataset's canonical CSV shape (src/admin/indicatorDatasets.ts), which then flow through the
 * normal reconcile → preview → apply pipeline.
 *
 * Issues split into two tiers:
 *  - errors: the file's structure drifted beyond what the transform can
 *    handle (missing sheet / column / question, no valid rows, …). Nothing is
 *    stored; the admin sees every problem.
 *  - warnings: tolerated drift (fuzzy sheet/column match, question moved,
 *    value scale changed, …). The upload continues; the preview shows them.
 */

export interface RawFile {
  name: string;
  data: Uint8Array;
}

export interface TransformIssue {
  /** Stable machine code, e.g. 'sheet_not_found'. */
  code: string;
  /** Source file the issue relates to, when file-specific. */
  file?: string;
  /** Plain-language explanation for the admin. */
  message: string;
  expected?: string;
  found?: string;
}

export interface TransformContext {
  /**
   * School year confirmed by the admin (single-file uploads of datasets whose
   * year isn't inside the file). Overrides the filename guess.
   */
  schoolYear?: string;
  /** `${dbn}|${school_year}` → total enrollment. Suspensions only. */
  enrollment?: ReadonlyMap<string, number | null>;
}

/** One output row: canonical column id → cell text ('' = blank). */
export type CanonicalRow = Record<string, string>;

export interface TransformResult {
  rows: CanonicalRow[];
  errors: TransformIssue[];
  warnings: TransformIssue[];
  stats: {
    files: string[];
    /** Rows emitted, after DBN validation and filters. */
    rowCount: number;
    schoolYears: string[];
  };
}

export interface RawTransform {
  datasetId: string;
  /** Upload accepts several files at once (e.g. the five SQR school types). */
  multiFile: boolean;
  /**
   * 'in_file'           — the year is a column in the data.
   * 'filename_or_pick'  — guessed from the filename; the admin confirms it
   *                       (single file) in the upload dialog.
   * 'filename_code'     — encoded in the DOE filename (SQR `202425-…`).
   */
  yearSource: 'in_file' | 'filename_or_pick' | 'filename_code';
  /** File extensions the transform understands (lower-case, with dot). */
  accepts: readonly string[];
  /** Transform needs ctx.enrollment for the upload's school year(s). */
  needsEnrollment?: boolean;
  run(files: readonly RawFile[], ctx: TransformContext): TransformResult;
}
