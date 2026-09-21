'use client';

import { useEffect, useRef, useState } from 'react';

export interface AdminNavItem {
  id: string;
  label: string;
}

/**
 * Four side-by-side tabs pinned under the admin header. Clicking one
 * smooth-scrolls to its section and sets the URL hash (deep link); the
 * active tab follows the scroll position. Opening /admin#<id> lands on
 * that section.
 */
export default function AdminSectionNav({ items }: { items: readonly AdminNavItem[] }): React.JSX.Element {
  const [active, setActive] = useState(items[0]?.id ?? '');
  const [top, setTop] = useState(0);
  const navRef = useRef<HTMLElement | null>(null);
  const clickedAt = useRef(0);

  // Stick right below the layout's sticky header, whatever its height.
  useEffect(() => {
    const header = document.querySelector('header');
    const measure = (): void => setTop(header ? header.getBoundingClientRect().height : 0);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Scroll-spy: the active section is the last one whose top has passed
  // just below the tab bar.
  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el != null);
    if (sections.length === 0) return;
    const scroller = findScroller(navRef.current);
    const onScroll = (): void => {
      if (Date.now() - clickedAt.current < 800) return; // let a smooth scroll finish
      const offset = (navRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let current = sections[0]!.id;
      for (const s of sections) if (s.getBoundingClientRect().top <= offset) current = s.id;
      // At the very bottom, the last section wins even if it's short.
      if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) {
        current = sections[sections.length - 1]!.id;
      }
      setActive(current);
    };
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => target.removeEventListener('scroll', onScroll);
  }, [items]);

  // Deep link: /admin#school-master scrolls there once the page has rendered.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id && items.some((i) => i.id === id)) {
      setActive(id);
      requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
    }
  }, [items]);

  const go = (id: string): void => {
    clickedAt.current = Date.now();
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
  };

  return (
    <nav
      ref={navRef}
      aria-label="Data Admin sections"
      style={{
        position: 'sticky',
        top,
        zIndex: 9,
        display: 'grid',
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        gap: 6,
        padding: '10px 0',
        margin: '0 0 24px 0',
        background: '#f6f8fb',
        borderBottom: '1px solid #e1e8ef',
      }}
    >
      {items.map((item) => {
        const on = item.id === active;
        return (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={(e) => {
              e.preventDefault();
              go(item.id);
            }}
            aria-current={on ? 'true' : undefined}
            style={{
              textAlign: 'center',
              padding: '9px 8px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              background: on ? '#027BC0' : '#fff',
              color: on ? '#fff' : '#027BC0',
              border: `1px solid ${on ? '#027BC0' : '#c7d3e0'}`,
              transition: 'background 120ms, color 120ms',
            }}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

/** The nearest scrolling ancestor (the admin layout scrolls a div, not the window). */
function findScroller(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}
