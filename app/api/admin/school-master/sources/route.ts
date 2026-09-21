import { NextResponse } from 'next/server';
import { guardAdmin } from '../../../../../src/server/adminRoutes';
import { getSources } from '../../../../../src/server/schoolMasterSourcesDb';
import { pool } from '../../../../../src/server/db';
import { buildMaster, coverageNotes } from '../../../../../src/admin/schoolMaster/build';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The stored school-master sources (checklist for the admin panel) plus the
 * coverage the current set yields — including fall years stored but waiting
 * for the snapshot, and any required source still missing.
 */
export async function GET(): Promise<NextResponse> {
  return guardAdmin(async () => {
    const sources = await getSources(pool());
    const build = buildMaster(sources);
    return NextResponse.json({
      sources: sources.map(({ extract: _extract, ...rest }) => rest),
      missing: build.errors.map((e) => e.message),
      coverage: build.coverage,
      notes: build.coverage ? coverageNotes(build.coverage) : [],
    });
  });
}
