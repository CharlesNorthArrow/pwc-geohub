/**
 * One probe-and-record routine reused by both:
 *   - POST /api/admin/community/check (admin-gated, on-demand)
 *   - GET  /api/cron/community-availability-check (cron-gated, monthly)
 *
 * Wraps each provider's probe in try/catch so a failure on one provider
 * doesn't take out the other — and so a transient blip surfaces as
 * "couldn't check" rather than a false "up to date".
 */

import { probeAcs, probeCdcPlaces, type Provider } from '../admin/communityProbe';
import { recordCheckFailure, recordCheckSuccess } from './communityAdminDb';

export interface CheckOutcome {
  provider: Provider;
  ok: boolean;
  latestVintage?: string;
  cdcRowsUpdatedAt?: string;
  error?: string;
}

export async function runChecks(): Promise<CheckOutcome[]> {
  const out: CheckOutcome[] = [];
  // ACS
  try {
    const probe = await probeAcs();
    await recordCheckSuccess({ provider: 'acs', latestVintage: probe.latestVintage, cdcLatestUpdatedAt: null });
    out.push({ provider: 'acs', ok: true, latestVintage: probe.latestVintage });
  } catch (err) {
    const msg = (err as Error).message;
    await recordCheckFailure({ provider: 'acs', error: msg });
    out.push({ provider: 'acs', ok: false, error: msg });
  }
  // CDC
  try {
    const probe = await probeCdcPlaces();
    await recordCheckSuccess({
      provider: 'cdc_places',
      latestVintage: probe.latestVintage,
      cdcLatestUpdatedAt: probe.rowsUpdatedAt,
    });
    out.push({
      provider: 'cdc_places',
      ok: true,
      latestVintage: probe.latestVintage,
      cdcRowsUpdatedAt: probe.rowsUpdatedAt,
    });
  } catch (err) {
    const msg = (err as Error).message;
    await recordCheckFailure({ provider: 'cdc_places', error: msg });
    out.push({ provider: 'cdc_places', ok: false, error: msg });
  }
  return out;
}
