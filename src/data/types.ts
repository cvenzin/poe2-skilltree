// Shape of `data.json` as found in `poe2-skilltree-export-*/data.json`.
// See INSTRUCTIONS.md §2. Defined permissively for fields we don't use yet;
// strictly for fields the app relies on.

export interface AscendancyFlavourRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Ascendancy {
  id: string;
  /** Can be JSON `null` in the export for unreleased / placeholder
   *  ascendancies (e.g. Ranger2 and Druid3 in 0.5.0). Filtered out at
   *  normalize time — see {@link TreeData.playableAscendancyIds}. */
  name: string | null;
  image: string;
  offsetX: number;
  offsetY: number;
  flavourText?: string;
  flavourTextColour?: string;
  flavourTextSize?: number;
  flavourTextRect?: AscendancyFlavourRect;
}

export interface ClassEntry {
  name: string;
  base_str: number;
  base_dex: number;
  base_int: number;
  image: string;
  image_offset_x: number;
  image_offset_y: number;
  ascendancies: Ascendancy[];
  overridePairs?: Record<string, number> | unknown[];
}

export interface Group {
  x: number;
  y: number;
  orbits: number[];
  nodes: string[];
}

export interface MasteryEffect {
  effect: number;
  stats: string[];
  reminderText?: string[];
}

export interface UnlockConstraint {
  nodes: number[];
  ascendancy?: string;
}

// One entry in the top-level `nodes` map. The synthetic "root" node only has
// `group/orbit/orbitIndex/out/in/edges` — every other field is optional from
// its perspective. We keep them all optional to avoid runtime narrowing pain.
export interface TreeNode {
  id?: string | null;
  skill?: number;
  name?: string;
  icon?: string;
  stats?: string[];
  ascendancyId?: string;
  isAscendancyStart?: boolean;
  isKeystone?: boolean;
  isNotable?: boolean;
  isMastery?: boolean;
  isJewelSocket?: boolean;
  group: number;
  orbit: number;
  orbitIndex: number;
  x?: number;
  y?: number;
  in: string[];
  out: string[];
  edges: number[];
  reminderText?: string[];
  flavourText?: string[];
  masteryEffects?: MasteryEffect[];
  activeEffectImage?: string;
  unlockConstraint?: UnlockConstraint;
  keystonesInRadius?: number[];
  classStartIndex?: number[];
  /** ~12 nodes carry this flag (Internal Layer, Dedication to Kitava, etc.).
   *  Skip drawing edges that touch them — they're special "tribute" / cluster
   *  jewel nodes that PoE renders without connection lines. */
  hideConnection?: boolean;
}

// A raw edge as it appears in data.json — `from`/`to` may be strings ("root")
// or numbers (skill ids). The normalizer rewrites both to strings.
export interface RawEdge {
  from: string | number;
  to: string | number;
  orbit?: number;
  orbitX?: number;
  orbitY?: number;
}

export interface Edge {
  from: string;
  to: string;
  orbit?: number;
  orbitX?: number;
  orbitY?: number;
}

export interface SkillOverride {
  name: string;
  icon: string;
  stats: string[];
  grantedStrength?: number;
  grantedDexterity?: number;
  grantedIntelligence?: number;
}

export interface RawTreeData {
  tree: string;
  classes: ClassEntry[];
  groups: Record<string, Group>;
  nodes: Record<string, TreeNode>;
  edges: RawEdge[];
  skillOverrides?: Record<string, SkillOverride>;
  jewelSlots: number[];
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

// Post-normalization. Same data + derived lookups, edges with string endpoints,
// playable-classes filter, and a few O(1) helpers attached.
export interface TreeData extends Omit<RawTreeData, 'edges'> {
  edges: Edge[];
  // Reverse lookups
  nodeBySkillId: Map<number, string>;          // skill (number) → node key
  startNodeByClassIndex: Map<number, string>;  // classes[i] → start node key
  playableClassIndices: number[];              // classes with ascendancies.length > 0
  /** Set of ascendancy IDs (e.g. "Witch1") that belong to a playable class. Used to
   *  filter PoE 1 placeholder ascendancy nodes (Templar1, Marauder1…) whose parent
   *  class is hidden but whose nodes still exist in the data. */
  playableAscendancyIds: Set<string>;
}
