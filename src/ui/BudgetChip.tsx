import { useStore } from '../state/store';

interface BudgetChipProps {
  label: string;
  count: number;
  cap: number;
  /** Which budget this chip represents — picks the per-budget rejection tick
   *  to key the shake animation on. */
  kind: 'passive' | 'ascendancy';
}

/**
 * Single budget chip: `<Label> N / cap`. The cap is fixed per game rules
 * (123 passives, 8 ascendancy) and rendered as static text. Over-cap clicks
 * are always rejected.
 *
 * Shake animation: the wrapper's React `key` is bound to this budget's
 * rejection counter from the store. When the counter increments (a commit
 * was rejected against THIS budget), the wrapper remounts and the CSS
 * @keyframes runs once. The other budget's counter doesn't move, so the
 * other chip doesn't remount.
 */
export default function BudgetChip({
  label, count, cap, kind,
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
      <span style={capStyle}>{cap}</span>
    </div>
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
const capStyle: React.CSSProperties = numStyle;
