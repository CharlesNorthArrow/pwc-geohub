import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin, getUploadSession } from '../../../../../src/server/adminRoutes';
import type { ReconciliationDecisions } from '../../../../../src/admin/columnReconciliation';
import { buildMasterMerge } from '../../../../../src/server/schoolMasterUpload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PreviewBody {
  uploadId: string;
  decisions: ReconciliationDecisions;
}

/**
 * Diff the upload against the current schools_master version. Nothing is
 * written. Unlike the pwc preview there is no unknown-DBN gate — new DBNs
 * are the point of an annual refresh — so `canApply` is true whenever the
 * decisions validate; data-quality signals surface as warnings instead.
 * The updates list is capped server-side (an annual master refresh can touch
 * thousands of rows); `summary.updated` carries the true count.
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

    const r = await buildMasterMerge(session, body.decisions);
    if (!r.ok) {
      return NextResponse.json(r.body, { status: r.status });
    }
    const { merge, warnings, currentVersionId } = r.outcome;

    return NextResponse.json({
      summary: {
        added: merge.added.length,
        updated: merge.updated.length,
        unchanged: merge.unchanged,
        retained: merge.retained.length,
        newVersionRowCount: merge.newVersionRows.length,
      },
      updates: merge.updated.slice(0, 200).map((u) => ({
        dbn: u.dbn,
        school_year: u.school_year,
        changedColumns: u.changedColumns,
        before: pick(u.before, u.changedColumns),
        after: pick(u.after, u.changedColumns),
      })),
      addedSample: merge.added.slice(0, 25).map((row) => ({ dbn: row.dbn, school_year: row.school_year })),
      retainedSample: merge.retained.slice(0, 25).map((row) => ({ dbn: row.dbn, school_year: row.school_year })),
      warnings,
      canApply: true,
      currentVersionId,
    });
  });
}

function pick<T extends Record<string, unknown>>(o: T, keys: string[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) (out as Record<string, unknown>)[k] = o[k];
  return out;
}
