import { useState } from 'react';
import { useStore } from '../state/store';

interface BudgetChipProps {
  label: string;
  count: number;
  cap: number;
  /** Which budget this chip represents — picks the per-budget rejection tick
   *  to key the shake animation on. */
  kind: 'passive' | 'ascendancy';
  onCapChange: (n: number) => void;
  /** Editable cap range, per INSTRUCTIONS.md §10. */
  minCap: number;
  maxCap: number;
}

/**
 * Single budget chip: `<Label> N / cap`. Cap is inline-editable (click
 * number → input, blur/Enter commits). Over-cap clicks are always rejected;
 * the chip can still go over visually if the user lowers the cap below the
 * current count.
 *
 * Shake animation: the wrapper's React `key` is bound to this budget's
 * rejection counter from the store. When the counter increments (a commit
 * was rejected against THIS budget), the wrapper remounts and the CSS
 * @keyframes runs once. The other budget's counter doesn't move, so the
 * other chip doesn't remount.
 */
export default function BudgetChip({
  label, count, cap, kind, onCapChange, minCap, maxCap,
}: Readonly<BudgetChipProps>) {
  const tick = useStore((s) =>
    kind === 'passive' ? s.passiveRejectionTick : s.ascendancyRejectionTick
  );

  const over = count > cap;

  return (
    <div
      key={tick}
      style={{ ...chipStyle, ...(over ? chipOverStyle : null), ...(tick > 0 ? chipShakeStyle : null) }}
      data-kind={kind}
    >
      <span style={chipLabelStyle}>{label}</span>
      <span style={over ? chipCountOverStyle : chipCountStyle}>{count}</span>
      <span style={chipSlashStyle}>/</span>
      <CapEditor cap={cap} minCap={minCap} maxCap={maxCap} onCapChange={onCapChange} />
    </div>
  );
}

interface CapEditorProps {
  cap: number;
  minCap: number;
  maxCap: number;
  onCapChange: (n: number) => void;
}

function CapEditor({ cap, minCap, maxCap, onCapChange }: Readonly<CapEditorProps>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(cap));

  if (!editing) {
    return (
      <button
        type="button"
        style={capButtonStyle}
        onClick={() => { setDraft(String(cap)); setEditing(true); }}
        title="Click to edit cap"
      >
        {cap}
      </button>
    );
  }

  const commit = () => {
    const n = Number.parseInt(draft, 10);
    if (Number.isFinite(n)) onCapChange(n);
    setEditing(false);
  };

  return (
    <input
      type="number"
      value={draft}
      autoFocus
      min={minCap}
      max={maxCap}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { setDraft(String(cap)); setEditing(false); }
      }}
      style={capInputStyle}
    />
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 6px',
  background: '#1c1812',
  border: '1px solid #4a3f28',
  borderRadius: 3,
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
  transition: 'background-color 150ms, border-color 150ms',
};

const chipOverStyle: React.CSSProperties = {
  background: '#3a1010',
  borderColor: '#a04040',
};

const chipShakeStyle: React.CSSProperties = {
  animation: 'poe2-shake 250ms',
};

const chipLabelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  opacity: 0.65,
  marginRight: 2,
};

// Count and cap share the same look so the chip reads as a single "N / M"
// value. Over-cap is the only state that changes the count's colour/weight.
const numStyle: React.CSSProperties = {
  color: '#e4d8b8',
  fontWeight: 500,
  fontSize: 13,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
};

const chipCountStyle: React.CSSProperties = numStyle;
const chipCountOverStyle: React.CSSProperties = { ...numStyle, color: '#ff8080', fontWeight: 700 };
const chipSlashStyle: React.CSSProperties = { ...numStyle, opacity: 0.4 };

const capButtonStyle: React.CSSProperties = {
  ...numStyle,
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  cursor: 'pointer',
  font: 'inherit',
};

const capInputStyle: React.CSSProperties = {
  ...numStyle,
  background: '#0f0c08',
  border: '1px solid #6b5a3a',
  borderRadius: 2,
  width: 44,
  padding: '0 2px',
};
