import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { PWC_FIELDS } from '../../../../../src/admin/pwcSchema';
import { getActiveSchema } from '../../../../../src/server/adminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const a = await getActiveSchema();
    return NextResponse.json({
      fields: PWC_FIELDS.map((f) => ({
        id: f.id,
        type: f.type,
        isKey: f.isKey,
        description: f.description,
        aliases: f.aliases ?? [],
      })),
      keyFields: PWC_FIELDS.filter((f) => f.isKey).map((f) => f.id),
      currentVersion: a.versionId,
      rowCount: a.rowCount,
      updatedAt: a.updatedAt,
    });
  });
}
