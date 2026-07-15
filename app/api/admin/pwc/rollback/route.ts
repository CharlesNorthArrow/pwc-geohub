import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import {
  applyMergedVersion,
  getCurrentVersionId,
  getVersionRows,
} from '../../../../../src/server/adminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RollbackBody {
  targetVersionId: number;
  notes?: string;
}

/**
 * Roll back to an older version by writing a NEW version row whose payload
 * set equals the target's. History stays append-only; "current" always
 * points at the most recent version row. The pwc_school_program swap goes
 * through the same atomic tx as a regular apply.
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
    const current = await getCurrentVersionId();
    if (current === body.targetVersionId) {
      return NextResponse.json({ error: 'already_current' }, { status: 409 });
    }
    const targetRows = await getVersionRows(body.targetVersionId);
    if (targetRows.length === 0) {
      return NextResponse.json({ error: 'unknown_version' }, { status: 404 });
    }
    const { versionId, skippedDbns } = await applyMergedVersion({
      createdBy: 'admin',
      source: `rollback:v${body.targetVersionId}`,
      notes: body.notes?.trim() || `Rollback to v${body.targetVersionId}`,
      rows: targetRows.map((r) => ({ dbn: r.dbn, school_year: r.school_year, payload: r.payload })),
    });
    return NextResponse.json({
      versionId,
      rolledBackTo: body.targetVersionId,
      rowCount: targetRows.length,
      skippedUnknownDbns: skippedDbns,
    });
  });
}
