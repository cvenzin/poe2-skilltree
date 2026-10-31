import type { StateCreator } from 'zustand';
import { allocationBudgetError, type AppState } from './store';
import type { TreeData } from '../data/types';
import { proposeNodeEdit, type EditProposal } from '../interaction/nodeActions';

export interface PendingRemoval {
  key: string;
  proposal: EditProposal;
  source: AppState['allocation'];
  mode: AppState['allocationMode'];
  version: string | null;
  className: string | null;
  ascendancyId: string | null;
  data: TreeData;
}
export interface NodeActionState {
  inspectionRevision: number;
  pendingRemoval: PendingRemoval | null;
  dismissInspection: () => void;
  requestRemoval: (key: string, data: TreeData, confirmCascade?: boolean) => void;
  requestNodeAllocation: (key: string, data: TreeData) => void;
  confirmRemoval: () => void;
  cancelRemoval: () => void;
}
export function removalIsCurrent(p: PendingRemoval, s: AppState): boolean {
  return p.source === s.allocation && p.mode === s.allocationMode && p.version === s.activeVersion &&
    p.className === s.className && p.ascendancyId === s.ascendancyId && s.status.kind === 'ready' && s.status.data === p.data;
}
export const createNodeActionState: StateCreator<AppState, [], [], NodeActionState> = (set, get) => ({
  inspectionRevision: 0,
  pendingRemoval: null,
  dismissInspection: () => set((s) => ({ hovered: null, previewPath: null, pendingRemoval: null, attributeRemovalPreview: null,
    inspectionRevision: s.inspectionRevision + 1 })),
  cancelRemoval: () => set({ pendingRemoval: null, attributeRemovalPreview: null }),
  requestNodeAllocation: (key, data) => {
    const s = get();
    if (s.status.kind !== 'ready' || s.status.data !== data) return;
    const proposal = proposeNodeEdit(key, data, s);
    if (typeof proposal === 'string') { set({ validationMessage: proposal }); return; }
    if (proposal.error) {
      if (allocationBudgetError(proposal.next, s.ascendancyId, data)) s.tryAllocate(proposal.next, data);
      set({ validationMessage: proposal.error });
      return;
    }
    if (!proposal.removed.length) { s.tryAllocate(proposal.next, data); return; }
    // Replacing an option can prune dependent branches too. Review that edit
    // before allocating, then use the same attribute/default flow on confirmation.
    set({ pendingRemoval: { key, proposal, source: s.allocation, mode: s.allocationMode, version: s.activeVersion,
      className: s.className, ascendancyId: s.ascendancyId, data }, previewPath: proposal.path });
  },
  requestRemoval: (key, data, confirmCascade = true) => {
    const s = get();
    if (s.status.kind !== 'ready' || s.status.data !== data) return;
    const proposal = proposeNodeEdit(key, data, s);
    if (typeof proposal === 'string' || proposal.error) {
      set({ validationMessage: typeof proposal === 'string' ? proposal : proposal.error }); return;
    }
    if (proposal.removed.length === 0) return;
    if (!confirmCascade || proposal.removed.length === 1) { s.commitAllocation(proposal.next, data); return; }
    const attributeEditor = s.attributeEditor?.kind === 'node' && s.attributeEditor.nodeKey === key && data.nodes[key]?.isGenericAttribute
      ? s.attributeEditor : null;
    set({ pendingRemoval: { key, proposal, source: s.allocation, mode: s.allocationMode, version: s.activeVersion,
      className: s.className, ascendancyId: s.ascendancyId, data }, attributeEditor,
      previewPath: null });
  },
  confirmRemoval: () => {
    const s = get(), p = s.pendingRemoval;
    if (!p) return;
    if (!removalIsCurrent(p, s)) { s.dismissInspection(); return; }
    set({ pendingRemoval: null });
    if (p.proposal.added.length) s.tryAllocate(p.proposal.next, p.data);
    else s.commitAllocation(p.proposal.next, p.data);
  },
});
