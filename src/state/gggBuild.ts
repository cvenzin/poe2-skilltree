import type { TreeData } from '../data/types';
import type { BuildSnapshot } from './store';
import { buildAllocation, pruneAllocation } from './allocation';
import { encodeShareHash } from './shareHash';
import { attributeNode, attributeRecommendation, reconcileAttributeChoices } from './attributes';

/** GGG Build Planner v1 (experimental), passive-tree subset.
 * https://www.pathofexile.com/developer/docs/game#buildplanner
 * Shared passives use the documented string shorthand; exclusive passives
 * carry weapon_set 1 or 2. Numeric export keys are NOT PassiveSkills IDs. */
export interface GggBuild {
  name: string;
  description: string;
  link: string;
  ascendancy?: string;
  passives: Array<string | { id: string; weapon_set?: 1 | 2; additional_text?: string }>;
}

export function gggBuildFilename(name: string, version: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  const patch = version.replace(/[^a-zA-Z0-9.-]/g, '');
  return `${slug || 'poe2-build'}-${patch}.build`;
}

export function createGggBuild(
  snapshot: BuildSnapshot,
  data: TreeData,
  name: string,
  plannerUrl: string,
): GggBuild {
  if (!name.trim()) throw new Error('Enter a build name.');
  const cls = data.classes.find((entry, index) =>
    entry.name === snapshot.className && data.playableClassIndices.includes(index));
  if (!cls) throw new Error('Select a playable class before exporting.');
  if (snapshot.ascendancyId && (!data.playableAscendancyIds.has(snapshot.ascendancyId) ||
    !cls.ascendancies.some((asc) => asc.id === snapshot.ascendancyId))) {
    throw new Error('Select an ascendancy that belongs to your class before exporting.');
  }

  const allocation = buildAllocation(snapshot.shared, snapshot.set1, snapshot.set2);
  if (pruneAllocation(allocation, snapshot.ascendancyId, data) !== allocation) {
    throw new Error('Some allocated passives are locked. Update your tree before exporting.');
  }
  const passives: GggBuild['passives'] = [];
  const choices = reconcileAttributeChoices(snapshot.attributeChoices ?? {}, allocation, data, snapshot.ascendancyId);
  for (const [bucket, weaponSet] of [[allocation.shared, 0], [allocation.set1, 1], [allocation.set2, 2]] as const) {
    for (const key of [...bucket].sort((a, b) => Number(a) - Number(b))) {
      const node = data.nodes[key];
      if (!node) throw new Error('Some allocated passives are unavailable in this tree version.');
      // Starts are implicit; masteries are unused PoE 1 data, not PoE 2 passives.
      if (key === 'root' || node.classStartIndex || node.isAscendancyStart || node.isMastery) continue;
      if (!node.id) throw new Error('Some allocated passives cannot be exported for this tree version.');
      if (node.ascendancyId && node.ascendancyId !== snapshot.ascendancyId) {
        throw new Error('Some passives belong to another ascendancy. Update your tree before exporting.');
      }
      // Ascendancy passives are always shared, including legacy snapshots.
      const choice = choices[key];
      const additionalText = choice ? `${attributeRecommendation(attributeNode(node, choice, data))} is recommended` : null;
      const set = weaponSet === 0 || node.ascendancyId ? null : weaponSet;
      passives.push(additionalText || set ? {
        id: node.id, ...(set ? { weapon_set: set } : {}), ...(additionalText ? { additional_text: additionalText } : {}),
      } : node.id);
    }
  }
  if (passives.length === 0) throw new Error('Allocate at least one passive before exporting.');

  const url = new URL(plannerUrl);
  url.hash = encodeShareHash({
    version: snapshot.version, className: snapshot.className, ascendancyId: snapshot.ascendancyId,
    sharedKeys: [...allocation.shared], set1Keys: [...allocation.set1], set2Keys: [...allocation.set2],
    attributeChoices: choices, defaultAttribute: snapshot.defaultAttribute,
  });
  return {
    name: name.trim(),
    description: `${snapshot.className} passive tree planned for Path of Exile 2 ${snapshot.version}.`,
    link: url.href,
    ...(snapshot.ascendancyId ? { ascendancy: snapshot.ascendancyId } : {}),
    passives,
  };
}
