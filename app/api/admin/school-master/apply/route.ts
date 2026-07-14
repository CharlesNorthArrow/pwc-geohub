import { NextResponse, type NextRequest } from 'next/server';
import { put } from '@vercel/blob';
import { guardAdmin, getUploadSession, deleteUploadSession } from '../../../../../src/server/adminRoutes';
import type { ReconciliationDecisions } from '../../../../../src/admin/columnReconciliation';
import { buildMasterMerge } from '../../../../../src/server/schoolMasterUpload';
import {
  applyMasterVersion,
  rebuildSchoolGeoCrosswalks,
  updateMasterCsvUrl,
} from '../../../../../src/server/schoolMasterAdminDb';
import { MASTER_FIELDS } from '../../../../../src/admin/schoolMasterSchema';
import { renderCsv } from '../../../../../src/admin/csvRender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApplyBody {
  uploadId: string;
  decisions: ReconciliationDecisions;
  notes?: string;
}

/**
 * Commit a new schools_master version. Re-runs the whole pipeline end-to-end
 * (never trusting the preview), then:
 *   1. applyMasterVersion — single tx: insert version + rows, UPSERT the live
 *      `schools` + `schools_year`, move the current pointer. No deletes.
 *   2. Rebuild school_geo_crosswalk (new/moved schools need point-in-polygon
 *      assignments). Non-fatal: failure leaves stale-but-present crosswalks
 *      and is surfaced as `crosswalkWarning`.
 *   3. Blob CSV snapshot (non-fatal, `blobWarning`).
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

    const r = await buildMasterMerge(session, body.decisions);
    if (!r.ok) {
      return NextResponse.json(r.body, { status: r.status });
    }
    const { merge } = r.outcome;

    const notes = body.notes?.trim() || null;
    const { versionId } = await applyMasterVersion({
      createdBy: 'admin',
      source: `upload:${session.filename}`,
      notes,
      rows: merge.newVersionRows,
    });

    let crosswalkWarning: string | null = null;
    try {
      await rebuildSchoolGeoCrosswalks();
    } catch (err) {
      crosswalkWarning =
        `Geo crosswalk rebuild failed: ${(err as Error).message}. The version is committed and the map ` +
        `will render, but new/moved schools may carry stale geography assignments until ` +
        `\`npm run etl:crosswalks\` is re-run.`;
    }

    let csvUrl: string | null = null;
    let blobWarning: string | null = null;
    try {
      const csv = renderCsv(MASTER_FIELDS, merge.newVersionRows);
      const blob = await put(`admin/school_master/v${versionId}.csv`, csv, {
        access: 'public',
        contentType: 'text/csv; charset=utf-8',
        allowOverwrite: false,
      });
      csvUrl = blob.url;
      await updateMasterCsvUrl(versionId, csvUrl);
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
      csvUrl,
      blobWarning: [blobWarning, crosswalkWarning].filter(Boolean).join('\n') || null,
    });
  });
}
