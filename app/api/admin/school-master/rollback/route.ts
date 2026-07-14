import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import {
  applyMasterVersion,
  getCurrentMasterVersionId,
  getMasterVersionRows,
  rebuildSchoolGeoCrosswalks,
} from '../../../../../src/server/schoolMasterAdminDb';
import { applyRollbackOverlay } from '../../../../../src/admin/schoolMasterTransform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RollbackBody {
  targetVersionId: number;
  notes?: string;
}

/**
 * Roll back by writing a NEW version — history stays append-only, mirroring
 * the pwc flow. One nuance the pwc flow doesn't have: the new version's rows
 * are the CURRENT rows overlaid with the target's payloads (not a raw copy
 * of the target). Rows added after the target version have no older payload
 * to revert to; overlaying keeps them, so the version stays consistent with
 * the upserted live tables (which never delete). Crosswalks are rebuilt
 * because reverting can move schools.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return guardAdmin(async () => {
    let body: RollbackBody;
    try {
      body = (await req.json()) as RollbackBody;
    } catch {
      return NextResponse.json({ error: 'bad_json' }, { status: 400 });
    }
    if (!Number.isInteger(body.targetVersionId) || body.targetVersionId <= 0) {
      return NextResponse.json({ error: 'bad_target_version_id' }, { status: 400 });
    }
    const current = await getCurrentMasterVersionId();
    if (current === body.targetVersionId) {
      return NextResponse.json({ error: 'already_current' }, { status: 409 });
    }
    const targetRows = await getMasterVersionRows(body.targetVersionId);
    if (targetRows.length === 0) {
      return NextResponse.json({ error: 'unknown_version' }, { status: 404 });
    }
    const currentRows = current == null ? [] : await getMasterVersionRows(current);
    const rows = applyRollbackOverlay(currentRows, targetRows);

    const { versionId } = await applyMasterVersion({
      createdBy: 'admin',
      source: `rollback:v${body.targetVersionId}`,
      notes: body.notes?.trim() || `Rollback to v${body.targetVersionId}`,
      rows,
    });

    let crosswalkWarning: string | null = null;
    try {
      await rebuildSchoolGeoCrosswalks();
    } catch (err) {
      crosswalkWarning = `Geo crosswalk rebuild failed: ${(err as Error).message}. Re-run \`npm run etl:crosswalks\`.`;
    }

    return NextResponse.json({
      versionId,
      rolledBackTo: body.targetVersionId,
      rowCount: rows.length,
      crosswalkWarning,
    });
  });
}
