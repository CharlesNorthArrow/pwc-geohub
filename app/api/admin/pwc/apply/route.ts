import { NextResponse, type NextRequest } from 'next/server';
import { put } from '@vercel/blob';
import { guardAdmin, getUploadSession, deleteUploadSession } from '../../../../../src/server/adminRoutes';
import {
  applyDecisions,
  validateDecisions,
  type ReconciliationDecisions,
} from '../../../../../src/admin/columnReconciliation';
import { mergeRows } from '../../../../../src/admin/merge';
import {
  applyMergedVersion,
  getCurrentVersionId,
  getVersionRows,
  updateCsvUrl,
} from '../../../../../src/server/adminDb';
import { PWC_FIELDS } from '../../../../../src/admin/pwcSchema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApplyBody {
  uploadId: string;
  decisions: ReconciliationDecisions;
  notes?: string;
}

/**
 * Commit a new version. The server re-runs everything end-to-end — never
 * trusting that whatever preview the client saw is still authoritative.
 * Order of operations:
 *   1. Re-validate decisions.
 *   2. Re-materialize normalized rows + merge against current.
 *   3. Re-check FK (unknown DBNs).
 *   4. applyMergedVersion (single tx: insert version, insert rows, replace
 *      pwc_school_program, swap current pointer).
 *   5. Upload immutable CSV snapshot to Blob; update csv_url on the version
 *      row. If the Blob put fails the data is still safely versioned — the
 *      csv_url stays null and we surface a warning.
 *   6. Delete the upload session.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guardAdmin(async () => {
    let body: ApplyBody;
    try {
      body = (await req.json()) as ApplyBody;
    } catch {
      return NextResponse.json({ error: 'bad_json' }, { status: 400 });
    }
    const session = getUploadSession(body.uploadId);
    if (!session) {
      return NextResponse.json({ error: 'upload_expired' }, { status: 410 });
    }
    const v = validateDecisions(session.classification, body.decisions);
    if (!v.ok) {
      return NextResponse.json({ error: 'invalid_decisions', errors: v.errors }, { status: 422 });
    }
    const normalized = applyDecisions(session.rawRows, session.classification, body.decisions);
    const currentVersionId = await getCurrentVersionId();
    const currentRows = currentVersionId == null ? [] : await getVersionRows(currentVersionId);
    const merge = mergeRows(currentRows, normalized);

    // Unknown DBNs don't block: applyMergedVersion keeps them in the version
    // and skips them on the live table (they go live automatically once the
    // schools master learns the DBN). Reported back as skippedUnknownDbns.
    const notes = body.notes?.trim() || null;
    const { versionId, skippedDbns } = await applyMergedVersion({
      createdBy: 'admin',
      source: `upload:${session.filename}`,
      notes,
      rows: merge.newVersionRows,
    });

    // Materialize the snapshot CSV and stash in Blob. Best-effort: failure here
    // doesn't roll back the version (it's already committed), but we tag the
    // response so the admin knows.
    let csvUrl: string | null = null;
    let blobWarning: string | null = null;
    try {
      const csv = renderCsv(merge.newVersionRows);
      const blob = await put(`admin/pwc_schools/v${versionId}.csv`, csv, {
        access: 'public',
        contentType: 'text/csv; charset=utf-8',
        allowOverwrite: false,
      });
      csvUrl = blob.url;
      await updateCsvUrl(versionId, csvUrl);
    } catch (err) {
      blobWarning = `Blob snapshot failed: ${(err as Error).message}. The version is committed; CSV can be re-materialized from the download endpoint.`;
    }

    deleteUploadSession(body.uploadId);

    return NextResponse.json({
      versionId,
      summary: {
        added: merge.added.length,
        updated: merge.updated.length,
        unchanged: merge.unchanged,
        retained: merge.retained.length,
        newVersionRowCount: merge.newVersionRows.length,
      },
      skippedUnknownDbns: skippedDbns,
      csvUrl,
      blobWarning,
    });
  });
}

function renderCsv(rows: Array<{ dbn: string; school_year: string; payload: Record<string, unknown> }>): string {
  const headers = PWC_FIELDS.map((f) => f.id);
  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    const cells: string[] = [];
    for (const f of PWC_FIELDS) {
      const v = f.isKey
        ? (f.id === 'DBN' ? r.dbn : r.school_year)
        : (r.payload[f.id] ?? null);
      cells.push(csvCell(v));
    }
    lines.push(cells.join(','));
  }
  return lines.join('\n') + '\n';
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  let s: string;
  if (typeof v === 'boolean') s = v ? '1' : '0';
  else s = String(v);
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
