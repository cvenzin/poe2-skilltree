import type { Allocation } from './allocation';
import type { AttributeChoices } from './attributes';

export interface BuildEdit { allocation: Allocation; attributeChoices: AttributeChoices }
const UNDO_LIMIT = 50;

/** Keep immutable build edits only, never the entire Zustand state. */
export function pushHistory(past: BuildEdit[], current: BuildEdit): BuildEdit[] {
  const next = [...past, { allocation: current.allocation, attributeChoices: current.attributeChoices }];
  if (next.length > UNDO_LIMIT) next.shift();
  return next;
}
