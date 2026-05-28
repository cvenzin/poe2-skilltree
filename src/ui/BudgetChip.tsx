import { useStore } from '../state/store';
import { palette, fontDisplay, controlHeight } from './theme';

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
      {/* Inner row aligns the display-font label and the body-font numbers on
          a shared text baseline (their box centres don't coincide because the
          fonts have different metrics); the chip then centres the row. */}
      <span style={chipInnerStyle}>
        <span style={chipLabelStyle}>{label}</span>
        <span style={over ? chipCountOverStyle : chipCountStyle}>{count}</span>
        <span style={chipSlashStyle}>/</span>
        <span style={capStyle}>{cap}</span>
      </span>
    </div>
  );
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  height: controlHeight,
  boxSizing: 'border-box',
  padding: '0 10px',
  background: palette.fieldBg,
  border: `1px solid ${palette.border}`,
  borderRadius: 3,
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
  transition: 'background-color 150ms, border-color 150ms',
};

const chipInnerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: 5,
};

const chipOverStyle: React.CSSProperties = {
  background: palette.dangerBg,
  borderColor: palette.dangerBorder,
};

const chipShakeStyle: React.CSSProperties = {
  animation: 'poe2-shake 250ms',
};

const chipLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: fontDisplay,
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  color: palette.textMuted,
  marginRight: 2,
};

// Count and cap share the same look so the chip reads as a single "N / M"
// value. Over-cap is the only state that changes the count's colour/weight.
const numStyle: React.CSSProperties = {
  color: palette.textTitle,
  fontWeight: 500,
  fontSize: 13,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
};

const chipCountStyle: React.CSSProperties = numStyle;
const chipCountOverStyle: React.CSSProperties = { ...numStyle, color: palette.dangerText, fontWeight: 700 };
const chipSlashStyle: React.CSSProperties = { ...numStyle, opacity: 0.4 };
const capStyle: React.CSSProperties = numStyle;
