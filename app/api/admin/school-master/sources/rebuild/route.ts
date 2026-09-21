import { NextResponse } from 'next/server';
import { guardAdmin, newUploadId, putUploadSession } from '../../../../../../src/server/adminRoutes';
import { classifyColumns } from '../../../../../../src/admin/columnReconciliation';
import { MASTER_FIELDS } from '../../../../../../src/admin/schoolMasterSchema';
import { csvCell } from '../../../../../../src/admin/csvRender';
import { buildFromStored } from '../../../../../../src/server/schoolMasterRebuild';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * "Rebuild master": build the master from every stored source and hand the
 * rows to the regular school-master preview / apply routes as an upload
 * session. A required source not stored yet → 422 listing what's missing.
 */
export async function POST(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const r = await buildFromStored();
    if (!r.ok) return NextResponse.json({ error: 'sources_missing', issues: r.issues }, { status: 422 });

    const headers = MASTER_FIELDS.map((f) => f.id);
    const rawRows = r.build.rows;
    const csvText =
      [headers.join(','), ...rawRows.map((row) => headers.map((h) => csvCell(row[h] || null)).join(','))].join('\n') + '\n';
    const uploadId = newUploadId();
    await putUploadSession({
      uploadId,
      filename: 'stored sources',
      csvText,
      headers,
      rawRows,
      classification: classifyColumns(headers, MASTER_FIELDS),
      createdAt: Date.now(),
      meta: {
        transform: { sourceFiles: r.sourceFiles, warnings: r.build.warnings },
        stagedSources: [],
        coverageNotes: r.notes,
      },
    });
    return NextResponse.json({ uploadId, rowCount: rawRows.length });
  });
}
