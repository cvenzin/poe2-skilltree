import type { TreeData } from '../data/types';
import { useStore, countBudgets, effectiveBudgetCaps, ASCENDANCY_CAP } from '../state/store';
import BudgetChip from './BudgetChip';

/** Editing context and its independent budgets share one compact area. */
export default function WeaponSetControls({ data }: Readonly<{ data: TreeData }>) {
  const allocation = useStore((s) => s.allocation);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const mode = useStore((s) => s.allocationMode);
  const enabled = useStore((s) => s.weaponSetsEnabled);
  const setMode = useStore((s) => s.setAllocationMode);
  const setEnabled = useStore((s) => s.setWeaponSetsEnabled);
  const counts = countBudgets(allocation, ascendancyId, data);
  const caps = effectiveBudgetCaps(allocation, ascendancyId, data);
  return (
    <section className="toolbar-points" aria-label="Weapon specialization and points">
      <div className="toolbar-weapon-sets">
        <label className="toolbar-checkbox" title="Plan separate passives per weapon set">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span>Weapon Sets</span>
        </label>
        {enabled && <fieldset className="toolbar-editing">
          <legend>Editing</legend>
          <div className="toolbar-segments">
            {([['shared', 'Main'], ['set1', 'Set 1'], ['set2', 'Set 2']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>
            ))}
          </div>
        </fieldset>}
      </div>
      {enabled ? <>
        <div className="toolbar-active-totals" aria-label="Active passive totals">
          <BudgetChip kind="passive" label="Set 1 passives" count={counts.activeIn1} cap={caps.passive}
            note={`${caps.passive - counts.activeIn1} remaining`} emphasized={mode === 'set1'} />
          <BudgetChip kind="passive" label="Set 2 passives" count={counts.activeIn2} cap={caps.passive}
            note={`${caps.passive - counts.activeIn2} remaining`} emphasized={mode === 'set2'} />
        </div>
        <div className="toolbar-point-breakdown" aria-label="Passive breakdown">
          <BudgetChip kind="passive" label="Shared" count={counts.shared} />
          <BudgetChip kind="weaponSet1" label="Set 1 specialization" count={counts.set1} cap={caps.weaponSet} />
          <BudgetChip kind="weaponSet2" label="Set 2 specialization" count={counts.set2} cap={caps.weaponSet} />
        </div>
      </> : <BudgetChip kind="passive" label="Passives" count={counts.shared} cap={caps.passive} />}
      {ascendancyId && <div className="toolbar-ascendancy-budget">
        <BudgetChip kind="ascendancy" label="Ascendancy" count={counts.ascendancy} cap={ASCENDANCY_CAP} />
      </div>}
    </section>
  );
}
