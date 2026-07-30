import { NextResponse, type NextRequest } from 'next/server';
import { guardAdmin } from '../../../../../../src/server/adminRoutes';
import { getIndicatorDataset } from '../../../../../../src/admin/indicatorDatasets';
import { getIndicatorDatasetStatuses } from '../../../../../../src/server/indicatorAdminDb';
import { indicatorsById } from '../../../../../../src/registry/indicators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dataset schema + active-version summary. Superset of what ViewSchemaDialog
 * reads; `latestYearLoaded` also feeds the card's year pill on refresh.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dataset: string }> },
): Promise<NextResponse> {
  return guardAdmin(async () => {
    const { dataset } = await params;
    const cfg = getIndicatorDataset(dataset);
    if (!cfg) {
      return NextResponse.json({ error: 'unknown_dataset' }, { status: 404 });
    }
    const statuses = await getIndicatorDatasetStatuses([cfg.id]);
    const s = statuses[cfg.id]!;
    return NextResponse.json({
      fields: cfg.fields.map((f) => ({
        id: f.id,
        type: f.type,
        isKey: f.isKey,
        description: f.description,
        aliases: f.aliases ?? [],
      })),
      keyFields: cfg.fields.filter((f) => f.isKey).map((f) => f.id),
      currentVersion: s.versionId,
      rowCount: s.rowCount,
      updatedAt: s.updatedAt,
      latestYearLoaded: s.latestYearLoaded,
      indicators: cfg.indicatorIds.map((id) => ({
        id,
        short_label: indicatorsById.get(id)?.short_label ?? indicatorsById.get(id)?.label ?? id,
      })),
    });
  });
}
