/**
 * PoE node `stats[]` entries contain markup like
 *   "12% increased [Lightning] Damage"
 *   "[CriticalDamageBonus|Critical Damage Bonus] of Hits"
 *   "Grants Skill: <underline>{Fire Spell on Hit}"
 *
 * The first form means "render the tag verbatim". The second form means
 * "the tag is `CriticalDamageBonus` (glossary key) but render as `Critical
 * Damage Bonus`". The third form is presentation markup — the brace contents
 * are visually underlined (see {@link tokenizeStatLine}); plain-text consumers
 * see the inner text only.
 *
 * The bracket regex matches `[Tag]` and `[Tag|Display]` greedy-stop at `]` so
 * two adjacent tags in one line don't merge.
 */
const BRACKET_MARKUP = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;
const UNDERLINE_MARKUP = /<underline>\{([^}]+)\}/g;

function expandBracketMarkup(text: string): string {
  return text.replace(BRACKET_MARKUP, (_, tag: string, display?: string) => display ?? tag);
}

export function stripStatsMarkup(text: string): string {
  return expandBracketMarkup(text).replace(UNDERLINE_MARKUP, (_, inner: string) => inner);
}

export type StatToken =
  | { kind: 'text'; text: string }
  | { kind: 'underline'; text: string };

/** Tokenize a stat line for rich rendering: strips `[Tag|Display]` markup
 *  (replaced by its display text) and splits on `<underline>{inner}` so the
 *  caller can wrap the inner text in an underlined element. Plain-text
 *  consumers (search index) should use {@link stripStatsMarkup} instead. */
export function tokenizeStatLine(text: string): StatToken[] {
  const plain = expandBracketMarkup(text);
  const tokens: StatToken[] = [];
  let cursor = 0;
  for (const m of plain.matchAll(UNDERLINE_MARKUP)) {
    const start = m.index ?? 0;
    if (start > cursor) tokens.push({ kind: 'text', text: plain.slice(cursor, start) });
    // The regex requires group 1 to match, so m[1] is always a string at runtime;
    // `noUncheckedIndexedAccess` widens it to `| undefined`, hence the fallback.
    tokens.push({ kind: 'underline', text: m[1] ?? '' });
    cursor = start + m[0].length;
  }
  if (cursor < plain.length) tokens.push({ kind: 'text', text: plain.slice(cursor) });
  if (tokens.length === 0) tokens.push({ kind: 'text', text: plain });
  return tokens;
}
