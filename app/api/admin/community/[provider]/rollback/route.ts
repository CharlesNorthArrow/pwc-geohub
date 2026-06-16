import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../src/server/adminRoutes';
import {
  applyCommunityVersion,
  getCurrentVersionId,
  getVersionRows,
} from '../../../../../../src/server/communityAdminDb';
import type { Provider } from '../../../../../../src/admin/communitySync';
import { pool } from '../../../../../../src/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface RollbackBody {
  targetVersionId: number;
  notes?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
): Promise<NextResponse> {
  return guardAdmin(async () => {
    const { provider: raw } = await params;
    if (raw !== 'acs' && raw !== 'cdc_places') {
      return NextResponse.json({ error: 'unknown_provider' }, { status: 404 });
    }
    const provider = raw as Provider;
    let body: RollbackBody;
    try { body = (await req.json()) as RollbackBody; } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
    if (!Number.isInteger(body.targetVersionId) || body.targetVersionId <= 0) {
      return NextResponse.json({ error: 'bad_target_version_id' }, { status: 400 });
    }
    const current = await getCurrentVersionId(provider);
    if (current === body.targetVersionId) {
      return NextResponse.json({ error: 'already_current' }, { status: 409 });
    }
    const target = await getTargetVersionMeta(provider, body.targetVersionId);
    if (!target) {
      return NextResponse.json({ error: 'unknown_version' }, { status: 404 });
    }
    const rows = await getVersionRows(body.targetVersionId);
    if (rows.length === 0) {
      return NextResponse.json({ error: 'empty_target' }, { status: 404 });
    }
    // Re-derive vintages + max vintage from the target row set.
    const vintages: Record<string, Set<string>> = {};
    let maxVintage = '';
    for (const r of rows) {
      if (!vintages[r.indicator_id]) vintages[r.indicator_id] = new Set();
      vintages[r.indicator_id]!.add(r.year);
      if (r.year > maxVintage) maxVintage = r.year;
    }
    const vintagesIndex: Record<string, string[]> = {};
    for (const k of Object.keys(vintages)) vintagesIndex[k] = [...vintages[k]!].sort();

    const result = await applyCommunityVersion({
      provider,
      source: `rollback:v${body.targetVersionId}`,
      notes: body.notes?.trim() || `Rollback to v${body.targetVersionId}`,
      rows,
      vintages: vintagesIndex,
      newLoadedVintage: maxVintage,
      // For CDC: rollback doesn't restore the precise rowsUpdatedAt at the
      // time of the rolled-back sync; carry the target's `notes`/`source`
      // forward for audit, leave cdc_loaded_updated_at = null so the next
      // availability check will flip "update available" appropriately.
      newCdcLoadedUpdatedAt: null,
    });
    return NextResponse.json({ versionId: result.versionId, rolledBackTo: body.targetVersionId, rowCount: rows.length });
  });
}

async function getTargetVersionMeta(provider: Provider, versionId: number): Promise<{ provider: Provider } | null> {
  const r = await pool().query(
    `SELECT provider FROM community_provider_versions WHERE version_id = $1`,
    [versionId],
  );
  if (r.rows.length === 0) return null;
  if (r.rows[0].provider !== provider) return null;
  return { provider };
}
