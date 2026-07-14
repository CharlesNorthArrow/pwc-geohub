import { getActiveSchema } from '../../src/server/adminDb';
import { getActiveMasterSchema } from '../../src/server/schoolMasterAdminDb';
import ProgrammaticSection from './ProgrammaticSection';
import SchoolMasterSection from './SchoolMasterSection';
import StubCard from './StubCard';
import CommunitySection from './CommunitySection';

export const dynamic = 'force-dynamic';

// 11 school indicator cards + 2 community sync cards = the 13 stubs. Each one
// will, in a future round, become its own functional surface; this round they
// only render with last-job copy and disabled actions.
const SCHOOL_STUB_CARDS = [
  { id: 'arts_ed', title: 'Arts Education Score', description: 'NYC DOE Arts Education Survey. Updated annually; per-school score.' },
  { id: 'suspensions', title: 'Suspension Rate', description: 'NYC DOE suspensions / enrollment by school × year.' },
  { id: 'temp_housing', title: 'Temporary Housing', description: 'NYCDOE temp-housing rate (students in shelter / temporary housing).' },
  { id: 'math', title: 'Math Proficiency', description: 'NY State 3-8 Math — % proficient (Levels 3+4).' },
  { id: 'ela', title: 'ELA Proficiency', description: 'NY State 3-8 ELA — % proficient (Levels 3+4).' },
  { id: 'chronic_absent', title: 'Chronic Absenteeism', description: '% students chronically absent (≥10% of school days).' },
  { id: 'graduation', title: 'Graduation Rate', description: 'NYC DOE 4-yr cohort graduation rate (HS only).' },
  { id: 'school_quality', title: 'School Quality / Safety', description: 'NYC DOE School Quality Reports — safety & climate.' },
  { id: 'family_survey', title: 'Family Survey', description: 'NYC DOE Family Survey responses.' },
  { id: 'teacher_survey', title: 'Teacher Survey', description: 'NYC DOE Teacher Survey responses.' },
  { id: 'student_survey', title: 'Student Survey', description: 'NYC DOE Student Survey responses (incl. mental-health items).' },
];

export default async function AdminPage(): Promise<React.JSX.Element> {
  const schema = await getActiveSchema();
  const masterSchema = await getActiveMasterSchema();
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
          {SCHOOL_STUB_CARDS.map((c) => (
            <StubCard key={c.id} title={c.title} description={c.description} family="school" />
          ))}
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
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}
