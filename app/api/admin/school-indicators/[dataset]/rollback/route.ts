import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../src/server/adminRoutes';
import { getIndicatorDataset } from '../../../../../../src/admin/indicatorDatasets';
import {
  applyIndicatorVersion,
  getCurrentIndicatorVersionId,
  getIndicatorVersionDataset,
  getIndicatorVersionRows,
} from '../../../../../../src/server/indicatorAdminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RollbackBody {
  targetVersionId: number;
  notes?: string;
}

/**
 * Roll back by writing a NEW version — history stays append-only. Unlike the
 * school-master flow this is a plain copy of the target's rows (no overlay):
 * apply is delete-and-replace on the live slice and version rows are complete
 * snapshots, so copying the target restores its state exactly.
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
    let body: RollbackBody;
    try {
      body = (await req.json()) as RollbackBody;
    } catch {
      return NextResponse.json({ error: 'bad_json' }, { status: 400 });
    }
    if (!Number.isInteger(body.targetVersionId) || body.targetVersionId <= 0) {
      return NextResponse.json({ error: 'bad_target_version_id' }, { status: 400 });
    }
    const current = await getCurrentIndicatorVersionId(cfg.id);
    if (current === body.targetVersionId) {
      return NextResponse.json({ error: 'already_current' }, { status: 409 });
    }
    const targetDataset = await getIndicatorVersionDataset(body.targetVersionId);
    if (targetDataset !== cfg.id) {
      return NextResponse.json({ error: 'unknown_version' }, { status: 404 });
    }
    const targetRows = await getIndicatorVersionRows(body.targetVersionId);
    if (targetRows.length === 0) {
      return NextResponse.json({ error: 'unknown_version' }, { status: 404 });
    }

    const { versionId } = await applyIndicatorVersion({
      datasetId: cfg.id,
      createdBy: 'admin',
      source: `rollback:v${body.targetVersionId}`,
      notes: body.notes?.trim() || `Rollback to v${body.targetVersionId}`,
      rows: targetRows,
    });

    return NextResponse.json({
      versionId,
      rolledBackTo: body.targetVersionId,
      rowCount: targetRows.length,
    });
  });
}
