import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { MASTER_FIELDS } from '../../../../../src/admin/schoolMasterSchema';
import { getActiveMasterSchema } from '../../../../../src/server/schoolMasterAdminDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const a = await getActiveMasterSchema();
    return NextResponse.json({
      fields: MASTER_FIELDS.map((f) => ({
        id: f.id,
        type: f.type,
        isKey: f.isKey,
        description: f.description,
        aliases: f.aliases ?? [],
      })),
      keyFields: MASTER_FIELDS.filter((f) => f.isKey).map((f) => f.id),
      currentVersion: a.versionId,
      rowCount: a.rowCount,
      updatedAt: a.updatedAt,
    });
  });
}
