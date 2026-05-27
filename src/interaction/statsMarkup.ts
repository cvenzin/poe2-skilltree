/**
 * PoE node `stats[]` entries contain markup like
 *   "12% increased [Lightning] Damage"
 *   "[CriticalDamageBonus|Critical Damage Bonus] of Hits"
 *
 * The first form means "render the tag verbatim". The second form means
 * "the tag is `CriticalDamageBonus` (glossary key) but render as `Critical
 * Damage Bonus`". For v1 we just strip the markup to plain text — clickable
 * nested-glossary tooltips per INSTRUCTIONS.md §7.3 are a later iteration.
 *
 * The regex matches `[Tag]` and `[Tag|Display]` greedy-stop at `]` so two
 * adjacent tags in one line don't merge.
 */
const MARKUP = /\[([^\]|]+)(?:\|([^\]]+))?\]/g;

export function stripStatsMarkup(text: string): string {
  return text.replace(MARKUP, (_, tag: string, display?: string) => display ?? tag);
}
