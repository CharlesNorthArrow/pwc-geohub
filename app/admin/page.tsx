import { getActiveSchema } from '../../src/server/adminDb';
import { getActiveMasterSchema } from '../../src/server/schoolMasterAdminDb';
import { getIndicatorDatasetStatuses } from '../../src/server/indicatorAdminDb';
import { INDICATOR_DATASETS } from '../../src/admin/indicatorDatasets';
import { DATASET_GUIDELINES } from '../../src/registry/dataSources';
import { indicatorsById } from '../../src/registry/indicators';
import ProgrammaticSection from './ProgrammaticSection';
import SchoolMasterSection from './SchoolMasterSection';
import IndicatorDatasetCard from './IndicatorDatasetCard';
import CommunitySection from './CommunitySection';

export const dynamic = 'force-dynamic';

export default async function AdminPage(): Promise<React.JSX.Element> {
  const schema = await getActiveSchema();
  const masterSchema = await getActiveMasterSchema();
  const indicatorStatuses = await getIndicatorDatasetStatuses(INDICATOR_DATASETS.map((c) => c.id));
  return (
    <div>
      <h1 style={{ fontSize: 24, margin: '0 0 6px 0' }}>Data Admin</h1>
      <p style={{ color: '#5a6e85', fontSize: 14, margin: '0 0 28px 0' }}>
        Update the datasets that power the dashboard. Each update is versioned and reversible.
      </p>

      <Section
        title="Programmatic data"
        subtitle="PWC-owned data uploaded as CSV (once per year)."
      >
        <ProgrammaticSection initialSchema={schema} />
      </Section>

      <Section
        title="School data master"
        subtitle="School identity, geocoding, enrollment & demographics — the base dataset everything joins to (updated once per year)."
      >
        <SchoolMasterSection initialSchema={masterSchema} />
      </Section>

      <Section
        title="School indicators"
        subtitle="Public data on NYC schools — updated when DOE / State release new years."
      >
        <CardGrid>
          {INDICATOR_DATASETS.map((cfg) => {
            const guidelines = DATASET_GUIDELINES[cfg.id];
            const status = indicatorStatuses[cfg.id];
            if (!guidelines || !status) return null;
            return (
              <IndicatorDatasetCard
                key={cfg.id}
                id={cfg.id}
                title={cfg.title}
                description={cfg.description}
                indicators={cfg.indicatorIds.map((id) => ({
                  id,
                  shortLabel: indicatorsById.get(id)?.short_label ?? indicatorsById.get(id)?.label ?? id,
                }))}
                guidelines={guidelines}
                initialStatus={{
                  versionId: status.versionId,
                  rowCount: status.rowCount,
                  updatedAt: status.updatedAt,
                  latestYearLoaded: status.latestYearLoaded,
                }}
              />
            );
          })}
        </CardGrid>
      </Section>

      <Section
        title="Community indicators"
        subtitle="Federal data sources — synced on schedule."
      >
        <CommunitySection />
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 16, margin: '0 0 2px 0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </h2>
      {subtitle ? (
        <p style={{ color: '#5a6e85', fontSize: 13, margin: '0 0 14px 0' }}>{subtitle}</p>
      ) : null}
      {children}
    </section>
  );
}

function CardGrid({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}
