import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { modeName, removalImpact } from '../interaction/nodeActions';
import { nodePanelTheme } from './theme';

/** A non-modal review keeps the affected tree visible and allows pan to cancel. */
export default function RemovalConfirmation() {
  const pending = useStore((s) => s.pendingRemoval);
  const editor = useStore((s) => s.attributeEditor);
  const inline = pending && editor?.kind === 'node' && editor.nodeKey === pending.key;
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (pending && !inline) button.current?.focus(); }, [pending, inline]);
  if (!pending || inline) return null;
  const { proposal, data, source } = pending;
  const groups = (['shared', 'set1', 'set2'] as const).flatMap((mode) => {
    const count = proposal.removed.filter((key) => source[mode].has(key)).length;
    return count ? [`${modeName[mode]}: ${count}`] : [];
  });
  const impact = removalImpact(source, proposal.next, data, pending.ascendancyId);
  return <section style={nodePanelTheme} className="removal-confirmation" role="dialog" aria-labelledby="removal-title" aria-describedby="removal-description">
    <h2 id="removal-title">{proposal.added.length ? `Replace option and remove ${proposal.removed.length} nodes?` : `Remove ${proposal.removed.length} nodes?`}</h2>
    <div id="removal-description">
      <p>{proposal.added.length ? `Selecting ${data.nodes[pending.key]?.name ?? 'this option'} replaces its current option and dependent branches.` : `Removing ${data.nodes[pending.key]?.name ?? 'this node'} also removes dependent branches.`}</p>
      {groups.length > 1 && <p>{groups.join(' · ')}</p>}
      <p>{impact}</p>
    </div>
    <button ref={button} type="button" onClick={() => useStore.getState().dismissInspection()}>Cancel</button>
    <button type="button" onClick={() => useStore.getState().confirmRemoval()}>{proposal.added.length ? 'Confirm' : 'Remove'}</button>
  </section>;
}
