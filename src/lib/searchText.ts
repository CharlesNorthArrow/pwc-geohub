/**
 * Forgiving text search for school pickers. DOE names read "P.S. 015 Roberto
 * Clemente" while people type "PS 15" or "ps015": both sides are lower-cased,
 * stripped of punctuation, number tokens lose leading zeros, and the match
 * ignores spaces — so "PS 165", "P.S. 165" and "ps165" all find P.S. 165.
 */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/(^| )0+(?=\d)/g, '$1')
    .replace(/ /g, '');
}

/** True when every part of the query (split on whitespace) appears in the text. */
export function matchesSearch(text: string, query: string): boolean {
  const hay = normalizeSearch(text);
  return query
    .trim()
    .split(/\s{2,}|,/)
    .map(normalizeSearch)
    .filter(Boolean)
    .every((part) => hay.includes(part));
}
