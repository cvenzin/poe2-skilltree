import type { SkillOverride, TreeData, TreeNode } from '../data/types';
import { allAllocated, isAllocated, type Allocation } from './allocation';

/** Stable build values; upstream override skill numbers may change by version. */
export const ATTRIBUTE_CHOICES = ['strength', 'dexterity', 'intelligence', 'damage', 'defences', 'cost_efficiency'] as const;
export type AttributeChoice = typeof ATTRIBUTE_CHOICES[number];
export type AttributeChoices = Readonly<Partial<Record<string, AttributeChoice>>>;
export interface AttributeOption { choice: AttributeChoice; override: SkillOverride }

export function isAttributeChoice(value: unknown): value is AttributeChoice {
  return typeof value === 'string' && ATTRIBUTE_CHOICES.some((choice) => choice === value);
}

export function parseAttributeChoices(value: unknown): AttributeChoices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, choice]) => /^\d+$/.test(key) && isAttributeChoice(choice)));
}

function choiceForOverride(override: SkillOverride): AttributeChoice | null {
  const id = override.id ?? '';
  if (/^generic_attribute_intelligence_?$/.test(id)) return 'intelligence';
  for (const choice of ATTRIBUTE_CHOICES) {
    if (id === `generic_attribute_${choice}` || id === `pathfinder_alternate_generic_attribute_${choice}`) return choice;
  }
  return null;
}

/** GGG's bundled exports gate the three Pathfinder alternatives on this passive.
 * Use the table ID, not the localized name or numeric tree key. */
export function attributeOptions(data: TreeData, allocation: Allocation, ascendancyId: string | null): AttributeOption[] {
  const unlocked = [...allocation.shared].some((key) => {
    const node = data.nodes[key];
    return node?.id === 'AscendancyRanger3Notable9' && node.ascendancyId === ascendancyId;
  });
  const options: AttributeOption[] = [];
  for (const override of Object.values(data.skillOverrides ?? {})) {
    const choice = choiceForOverride(override);
    if (!choice || (override.id?.startsWith('pathfinder_') && !unlocked)) continue;
    options.push({ choice, override });
  }
  return options.sort((a, b) => ATTRIBUTE_CHOICES.indexOf(a.choice) - ATTRIBUTE_CHOICES.indexOf(b.choice));
}

export function reconcileAttributeChoices(
  choices: AttributeChoices, allocation: Allocation, data: TreeData, ascendancyId: string | null,
): AttributeChoices {
  const allowed = new Set(attributeOptions(data, allocation, ascendancyId).map((option) => option.choice));
  return Object.fromEntries(Object.entries(choices).filter(([key, choice]) =>
    data.nodes[key]?.isGenericAttribute && isAllocated(allocation, key) && choice && allowed.has(choice)));
}

export function choicesForAllocation(
  choices: AttributeChoices, previous: Allocation, next: Allocation, data: TreeData,
  ascendancyId: string | null, defaultChoice: AttributeChoice | null,
): AttributeChoices {
  const result = { ...reconcileAttributeChoices(choices, next, data, ascendancyId) };
  const allowed = attributeOptions(data, next, ascendancyId).some((option) => option.choice === defaultChoice);
  if (defaultChoice && allowed) for (const key of allAllocated(next)) {
    if (!isAllocated(previous, key) && data.nodes[key]?.isGenericAttribute) result[key] = defaultChoice;
  }
  return result;
}

/** Only replace presentation fields; the original table ID and topology stay intact. */
export function attributeNode(node: TreeNode, choice: AttributeChoice | undefined, data: TreeData): TreeNode {
  if (!node.isGenericAttribute || !choice) return node;
  const override = Object.values(data.skillOverrides ?? {}).find((entry) => choiceForOverride(entry) === choice);
  return override ? { ...node, name: override.name, icon: override.icon, stats: override.stats } : node;
}

export function attributeRecommendation(node: Pick<TreeNode, 'stats'>): string {
  return (node.stats ?? []).join('; ').replace(/\[([^\]|]+)(?:\|([^\]]+))?\]/g, (_match, tag: string, display?: string) => display ?? tag);
}
