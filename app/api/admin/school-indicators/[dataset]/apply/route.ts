import { NextResponse, type NextRequest } from 'next/server';
import { put } from '@vercel/blob';
import { guardAdmin, getUploadSession, deleteUploadSession } from '../../../../../../src/server/adminRoutes';
import type { ReconciliationDecisions } from '../../../../../../src/admin/columnReconciliation';
import { getIndicatorDataset } from '../../../../../../src/admin/indicatorDatasets';
import { buildIndicatorMerge } from '../../../../../../src/server/indicatorUpload';
import {
  applyIndicatorVersion,
  updateIndicatorCsvUrl,
} from '../../../../../../src/server/indicatorAdminDb';
import { renderCsv } from '../../../../../../src/admin/csvRender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApplyBody {
  uploadId: string;
  decisions: ReconciliationDecisions;
  notes?: string;
}

/**
 * Commit a new dataset version. Re-runs the whole pipeline end-to-end (never
 * trusting the preview), then:
 *   1. applyIndicatorVersion — single tx: insert version + rows, swap the
 *      dataset's indicator slice of school_indicator_values (unknown DBNs
 *      kept in the version, skipped live), move the current pointer.
 *   2. Blob CSV snapshot (non-fatal, `blobWarning`).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dataset: string }> },
): Promise<NextResponse> {
  return guardAdmin(async () => {
    const { dataset } = await params;
    const cfg = getIndicatorDataset(dataset);
    if (!cfg) {
      return NextResponse.json({ error: 'unknown_dataset' }, { status: 404 });
    }
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

    const r = await buildIndicatorMerge(session, body.decisions, cfg);
    if (!r.ok) {
      return NextResponse.json(r.body, { status: r.status });
    }
    const { merge } = r.outcome;

    const notes = body.notes?.trim() || null;
    const { versionId, skippedDbns } = await applyIndicatorVersion({
      datasetId: cfg.id,
      createdBy: 'admin',
      source: `upload:${session.filename}`,
      notes,
      rows: merge.newVersionRows,
    });

    let csvUrl: string | null = null;
    let blobWarning: string | null = null;
    try {
      const csv = renderCsv(cfg.fields, merge.newVersionRows);
      const blob = await put(`admin/school_indicators/${cfg.id}/v${versionId}.csv`, csv, {
        access: 'public',
        contentType: 'text/csv; charset=utf-8',
        allowOverwrite: false,
      });
      csvUrl = blob.url;
      await updateIndicatorCsvUrl(versionId, csvUrl);
    } catch (err) {
      blobWarning =
        `CSV snapshot upload failed: ${(err as Error).message}. The version is committed and ` +
        `downloadable from the version history; only the external snapshot link is missing.`;
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
