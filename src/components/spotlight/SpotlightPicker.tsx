'use client';

/**
 * Spotlight landing — a deliberately minimal PWC-school picker.
 * Search box + selectable list (name, borough, PWC group). No map, no
 * filters, no indicator tree (spec §2).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Logo from '../Logo';
import { fetchPwcHistory, fetchSchoolsMaster } from '../../contract/client';
import type { PwcMember, SchoolMaster } from '../../contract/types';
import { categoryTag } from './SpotlightSheet';

export default function SpotlightPicker(): React.JSX.Element {
  const [schools, setSchools] = useState<SchoolMaster[] | null>(null);
  const [members, setMembers] = useState<PwcMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchSchoolsMaster()
      .then((r) => setSchools(r.schools))
      .catch((e) => setError((e as Error).message));
    fetchPwcHistory()
      .then((r) => {
        const years = Object.keys(r.byYear).sort();
        const latest = years[years.length - 1];
        setMembers(latest ? (r.byYear[latest] ?? []) : []);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const rows = useMemo(() => {
    if (!schools || !members) return null;
    const byDbn = new Map(schools.map((s) => [s.dbn, s]));
    const q = query.trim().toLowerCase();
    return members
      .map((m) => ({
        member: m,
        school: byDbn.get(m.dbn) ?? null,
        name: byDbn.get(m.dbn)?.school_name ?? m.dbn,
      }))
      .filter((r) =>
        q === '' ||
        r.name.toLowerCase().includes(q) ||
        r.member.dbn.toLowerCase().includes(q) ||
        (r.school?.borough ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [schools, members, query]);

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100dvh', background: '#f7f9fb', minHeight: 0 }}>
      <Logo />
      <main style={{ overflowY: 'auto', minHeight: 0, padding: '24px 20px 48px' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#002040', margin: 0 }}>Spotlight</h1>
          <p style={{ fontSize: 13, color: '#467c9d', margin: '4px 0 16px' }}>
            Pick a PWC school to build a shareable spotlight card — auto-selected school and
            community outliers, ready for fundraising or celebration.
          </p>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by school name, DBN, or borough…"
            aria-label="Search PWC schools"
            autoFocus
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '10px 12px',
              fontSize: 14,
              border: '1px solid #c5cdd6',
              borderRadius: 8,
              marginBottom: 12,
              background: 'white',
            }}
          />

          {error ? (
            <div style={{ color: '#c0392b', fontSize: 13 }}>Failed to load school list: {error}</div>
          ) : rows == null ? (
            <div style={{ color: '#467c9d', fontSize: 13 }}>Loading PWC schools…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: '#467c9d', fontSize: 13 }}>No PWC school matches “{query}”.</div>
          ) : (
            <div style={{ background: 'white', border: '1px solid #e5e9ee', borderRadius: 8, overflow: 'hidden' }}>
              {rows.map(({ member, school, name }) => {
                const tag = categoryTag(member.category);
                return (
                  <Link
                    key={member.dbn}
                    href={`/spotlight/${encodeURIComponent(member.dbn)}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '11px 14px',
                      borderBottom: '1px solid #eef2f6',
                      textDecoration: 'none',
                      color: '#002040',
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, display: 'block' }}>{name}</span>
                      <span style={{ fontSize: 11, color: '#8296a8' }}>
                        {member.dbn}
                        {school?.borough ? ` · ${school.borough}` : ''}
                      </span>
                    </span>
                    <span
                      style={{
                        background: tag.color,
                        color: 'white',
                        borderRadius: 999,
                        padding: '2px 9px',
                        fontSize: 10,
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {tag.text.replace('PWC ', '').replace(' school', '')}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
