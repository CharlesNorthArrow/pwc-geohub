import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin, getUploadSession } from '../../../../../src/server/adminRoutes';
import {
  applyDecisions,
  validateDecisions,
  type ReconciliationDecisions,
} from '../../../../../src/admin/columnReconciliation';
import { mergeRows } from '../../../../../src/admin/merge';
import {
  findUnknownDbns,
  getCurrentVersionId,
  getVersionRows,
} from '../../../../../src/server/adminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PreviewBody {
  uploadId: string;
  decisions: ReconciliationDecisions;
}

/**
 * Given the upload session + admin's decisions, re-validate, materialize the
 * normalized rows, diff against the current version, and return a preview
 * payload. Nothing is written. Apply uses the SAME decisions; the server
 * re-runs everything end-to-end there too — preview ≠ trusted gate.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guardAdmin(async () => {
    let body: PreviewBody;
    try {
      body = (await req.json()) as PreviewBody;
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

    // FK pre-check: incoming DBNs not in `schools` would crash the apply tx.
    const incomingDbns = merge.newVersionRows.map((r) => r.dbn);
    const unknownDbns = await findUnknownDbns(incomingDbns);

    return NextResponse.json({
      summary: {
        added: merge.added.length,
        updated: merge.updated.length,
        unchanged: merge.unchanged,
        retained: merge.retained.length,
        newVersionRowCount: merge.newVersionRows.length,
      },
      updates: merge.updated.map((u) => ({
        dbn: u.dbn,
        school_year: u.school_year,
        changedColumns: u.changedColumns,
        before: pick(u.before, u.changedColumns),
        after: pick(u.after, u.changedColumns),
      })),
      addedSample: merge.added.slice(0, 25).map((r) => ({ dbn: r.dbn, school_year: r.school_year })),
      retainedSample: merge.retained.slice(0, 25).map((r) => ({ dbn: r.dbn, school_year: r.school_year })),
      warnings: {
        unknownDbns,
        unknownDbnCount: unknownDbns.length,
        retainedFromCurrent: merge.retained.length,
      },
      canApply: unknownDbns.length === 0,
      currentVersionId,
    });
  });
}

function pick<T extends Record<string, unknown>>(o: T, keys: string[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) (out as Record<string, unknown>)[k] = o[k];
  return out;
}
