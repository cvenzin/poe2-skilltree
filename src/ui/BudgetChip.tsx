import { useStore } from '../state/store';
import './BudgetChip.css';

interface BudgetChipProps {
  label: string;
  count: number;
  cap?: number;
  kind: 'passive' | 'ascendancy' | 'weaponSet1' | 'weaponSet2';
  note?: string;
  emphasized?: boolean;
}

/** Rejection ticks remount the affected counter to replay its feedback. */
export default function BudgetChip({ label, count, cap, kind, note, emphasized = false }: Readonly<BudgetChipProps>) {
  const tick = useStore((s) => {
    switch (kind) {
      case 'passive': return s.passiveRejectionTick;
      case 'ascendancy': return s.ascendancyRejectionTick;
      case 'weaponSet1': return s.weaponSet1RejectionTick;
      case 'weaponSet2': return s.weaponSet2RejectionTick;
    }
  });
  const over = cap !== undefined && count > cap;
  return (
    <div key={tick} className="budget-chip" data-kind={kind} data-emphasized={emphasized}
      data-over={over} data-rejected={tick > 0}>
      <span className="budget-chip__label">{label}</span>
      <span className="budget-chip__value">{count}{cap !== undefined && <><span className="budget-chip__cap"> / {cap}</span></>}</span>
      {note && <span className="budget-chip__note">{note}</span>}
    </div>
  );
}
