import type { StateCreator } from 'zustand';
import type { AppState } from './store';
import { attributeOptions, isAttributeChoice, type AttributeChoice, type AttributeChoices } from './attributes';
import { allAllocated, bucketOf, pruneAllocation, removeKey, type Allocation } from './allocation';
import { resolveCascade } from '../interaction/pathing';
import { pushHistory } from './buildHistory';

export type AttributeEditor = { kind: 'default'; pending?: Allocation } | { kind: 'node'; nodeKey: string };
export interface AttributeState {
  attributeChoices: AttributeChoices;
  defaultAttribute: AttributeChoice | null;
  attributeEditor: AttributeEditor | null;
  openAttributeEditor: (editor: AttributeEditor | null) => void;
  setDefaultAttribute: (choice: AttributeChoice) => void;
  setNodeAttribute: (key: string, choice: AttributeChoice) => void;
  applyDefaultToUnspecified: () => void;
  removeAttributeNode: (key: string) => void;
}

/** Attribute editing shares the allocation history, but never changes budgets. */
export const createAttributeState: StateCreator<AppState, [], [], AttributeState> = (set, get) => ({
  attributeChoices: {},
  defaultAttribute: null,
  attributeEditor: null,
  openAttributeEditor: (editor) => set({ attributeEditor: editor, hovered: null, previewPath: null }),
  setDefaultAttribute: (choice) => set((s) => {
    if (!isAttributeChoice(choice) || s.status.kind !== 'ready' ||
      !attributeOptions(s.status.data, s.allocation, s.ascendancyId).some((option) => option.choice === choice)) return s;
    return { defaultAttribute: choice };
  }),
  setNodeAttribute: (key, choice) => set((s) => {
    if (s.status.kind !== 'ready' || !s.status.data.nodes[key]?.isGenericAttribute ||
      bucketOf(s.allocation, key) !== s.allocationMode ||
      !attributeOptions(s.status.data, s.allocation, s.ascendancyId).some((option) => option.choice === choice) ||
      s.attributeChoices[key] === choice) return s;
    return { attributeChoices: { ...s.attributeChoices, [key]: choice },
      past: pushHistory(s.past, s), future: [], validationMessage: null };
  }),
  applyDefaultToUnspecified: () => set((s) => {
    if (!s.defaultAttribute || s.status.kind !== 'ready' || !attributeOptions(s.status.data, s.allocation, s.ascendancyId)
      .some((option) => option.choice === s.defaultAttribute)) return s;
    const choices = { ...s.attributeChoices };
    let changed = false;
    for (const key of allAllocated(s.allocation)) {
      if (s.status.data.nodes[key]?.isGenericAttribute && !choices[key]) { choices[key] = s.defaultAttribute; changed = true; }
    }
    return changed ? { attributeChoices: choices, past: pushHistory(s.past, s), future: [] } : s;
  }),
  removeAttributeNode: (key) => {
    const s = get();
    if (s.status.kind !== 'ready' || bucketOf(s.allocation, key) !== s.allocationMode ||
      !s.status.data.nodes[key]?.isGenericAttribute) return;
    const data = s.status.data;
    const cls = data.classes.findIndex((entry) => entry.name === s.className);
    const start = data.startNodeByClassIndex.get(cls);
    if (!start) return;
    const roots = new Set([start]);
    for (const [nodeKey, node] of Object.entries(data.nodes)) {
      if (node.isAscendancyStart && node.ascendancyId === s.ascendancyId) roots.add(nodeKey);
    }
    s.commitAllocation(pruneAllocation(resolveCascade(data, removeKey(s.allocation, key), roots, s.ascendancyId), s.ascendancyId, data), data);
  },
});
